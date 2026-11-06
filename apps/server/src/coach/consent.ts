import { parisDate } from '@rune/domain';
import type { Transaction } from 'kysely';
import { logSecurityEvent } from '../auth/security-log';
import { writeStamp } from '../db/rev';
import type { Database } from '../db/schema';
import type { AppDeps } from '../deps';
import type { HealthWithdrawHook } from '../privacy/consent';
import { getConsentState, insertConsentEvent } from '../privacy/consent-state';
import { deleteAllThreads } from './threads';

/*
 * Retraits d'accord côté coach (spec brique 4 §6.3, §14.2). Tout se fait dans la transaction de l'appelant ; la route
 * interrompt l'échange en cours (`abortFor`) après la validation. Rien du contenu n'entre dans les journaux (P-LOG-2).
 * Ce module n'importe de `privacy/consent.ts` que des types : `privacy/consent.ts` importe le crochet ci-dessous.
 */

/**
 * Entrée `coach_thread` de `HEALTH_WITHDRAW_HOOKS` (§6.3, choix C13) : fils ouverts de la personne clos
 * (`health_withdrawn`, ainsi que ceux du jour clos pour `persona_change`, `version_change` ou `nutrition_mode_change`), `brief` à NULL sur tous ses fils, `blocks` à NULL sur tous ses messages. `display_text` et
 * `coach_report.exchange_text` (copie choisie par la personne) restent. Tables de classe H : ni rev, ni tombstone.
 */
export const coachHealthWithdrawHook: HealthWithdrawHook = async (trx, deps, userId) => {
  // Aussi les fils du jour clos pour un changement de coach ou de réglage : sans cela le message suivant en rouvrirait un.
  const today = parisDate(deps.clock.now());
  await trx
    .updateTable('coachThread')
    .set({ isOpen: 0, closedReason: 'health_withdrawn' })
    .where('userId', '=', userId)
    .where((eb) =>
      eb.or([
        eb('isOpen', '=', 1),
        eb.and([
          eb('day', '=', today),
          eb('closedReason', 'in', ['persona_change', 'version_change', 'nutrition_mode_change']),
        ]),
      ]),
    )
    .execute();
  await trx
    .updateTable('coachThread')
    .set({ brief: null })
    .where('userId', '=', userId)
    .where('brief', 'is not', null)
    .execute();
  await trx
    .updateTable('coachMessage')
    .set({ blocks: null })
    .where('userId', '=', userId)
    .where('blocks', 'is not', null)
    .execute();
};

/**
 * Désactivation du coach = retrait de l'accord `ai_coach` (§6.3, §14.2, choix C34) ; sans effet si l'accord n'est pas
 * actif. Dans l'ordre : propositions du coach en attente supprimées logiquement (rev neuf, propagé par pull) ; fils
 * supprimés, messages en cascade (`deleteAllThreads`, qui détache d'abord `instance_change.coach_thread_id` et
 * `coach_call.thread_id`) ; signalements supprimés ; événement `withdraw` ; `consent_revoked` au journal de sécurité.
 * Les propositions acceptées restent dans le programme, le journal d'usage reste 12 mois.
 */
export async function withdrawCoachConsent(
  trx: Transaction<Database>,
  deps: AppDeps,
  userId: string,
  actor: { actorId: string | null; ip: string | null },
  opts: { replay?: boolean } = {},
): Promise<void> {
  const consent = (await getConsentState(trx, userId)).aiCoach;
  if (!consent.active) return;
  const pending = await trx
    .selectFrom('instanceChange')
    .select('id')
    .where('ownerId', '=', userId)
    .where('author', '=', 'coach')
    .where('status', '=', 'proposed')
    .where('deletedAt', 'is', null)
    .orderBy('id')
    .execute();
  for (const { id } of pending) {
    const stamp = await writeStamp(trx, deps, actor.actorId);
    await trx
      .updateTable('instanceChange')
      .set({ deletedAt: stamp.updatedAt, ...stamp })
      .where('id', '=', id)
      .execute();
  }
  await deleteAllThreads(trx, deps, userId);
  await trx.deleteFrom('coachReport').where('userId', '=', userId).execute();
  await insertConsentEvent(trx, deps, userId, 'ai_coach', 'withdraw', consent.textVersion ?? '');
  await logSecurityEvent(trx, deps, {
    type: 'consent_revoked',
    actorId: actor.actorId,
    targetId: userId,
    ip: actor.ip,
    outcome: 'success',
    details: { consentType: 'ai_coach', ...(opts.replay ? { replay: true } : {}) },
  });
}
