import type { InstanceChangeOperation } from '@rune/contracts';
import { coachLoadGuard, currentRules } from '@rune/domain';
import { writeStamp } from '../db/rev';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { expireProposals } from '../program/expire';
import { placesOf } from '../program/replay-service';
import { loadPlanContext, loadReplayInput } from './brief-input';
import type { PendingProposal } from './tools/types';

/*
 * Propositions du coach (spec brique 4 §12) : garde de hausse de charge (§12.2, étape 6, choix C6), calculée par
 * `propose_program_change` puis de nouveau à l'acceptation ; écriture en fin d'échange (§12.3, choix C4, C5, C7).
 * Rien de leur contenu n'entre dans les journaux.
 */

const DAY_MS = 86_400_000;

/**
 * Slots dont la charge prévue monterait si le changement `change` du coach était accepté à `now` (§12.2, étape 6,
 * C6), triés : `coachLoadGuard` sur le rejeu de l'instance active, dans chacun des lieux vivants (la liste que reçoit
 * `validateChange`) et au lieu principal de `planWorkout`, suspensions levées. Vide : aucune hausse. Lecture seule.
 * Appelée après le validateur : une instance active sans rejeu possible est une erreur interne, et une séance aux
 * règles inconnues du serveur lève `UnknownRulesVersionError`, comme le rejeu.
 */
export async function coachLoadIncreases(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  change: { id: string; operations: readonly InstanceChangeOperation[] },
  now: Date,
): Promise<string[]> {
  const replay = await loadReplayInput(db, deps, userId);
  if (replay === null) throw new Error('replay_unavailable');
  const places = [...(await placesOf(db, userId, { live: true })).values()];
  return coachLoadGuard(
    {
      replay,
      change: { ...change, author: 'coach' },
      decidedAt: now.getTime(),
      plan: await loadPlanContext(db, deps, userId, now),
    },
    places,
  );
}

/**
 * Écriture d'une proposition du coach (§12.3), dans la transaction de l'enregistrement de l'échange (§8.7) :
 * propositions périmées expirées (`expireProposals`) ; propositions `proposed` du coach de la personne → `expired`,
 * chacune avec un rev neuf (C4 : celles du moteur restent) ; puis insertion de `p` sur son instance, `author` coach,
 * `reason_code` `COACH_PROPOSAL`, `reason` seulement avec l'accord santé (C7), `status` `proposed`, ou `expired` si
 * l'instance n'est plus active ou si sa révision n'est plus celle de la validation, `expires_at` = création + 7 jours,
 * `ai_generated`, `ai_model` (modèle de l'itération), `prompt_version` et `coach_thread_id` du fil.
 */
export async function insertCoachProposal(
  trx: DbExecutor,
  deps: AppDeps,
  p: PendingProposal,
  ctx: { userId: string; threadId: string; promptVersion: string; now: Date; healthConsent: boolean },
): Promise<void> {
  const { userId, now } = ctx;
  await expireProposals(trx, userId, now);
  const waiting = await trx
    .selectFrom('instanceChange')
    .select('id')
    .where('ownerId', '=', userId)
    .where('author', '=', 'coach')
    .where('status', '=', 'proposed')
    .where('deletedAt', 'is', null)
    .orderBy('id')
    .execute();
  for (const { id } of waiting) {
    const stamp = await writeStamp(trx, deps, null);
    await trx
      .updateTable('instanceChange')
      .set({ status: 'expired', ...stamp })
      .where('id', '=', id)
      .execute();
  }
  const instance = await trx
    .selectFrom('programInstance')
    .select(['status', 'revision'])
    .where('id', '=', p.instanceId)
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  const current = instance?.status === 'active' && instance.revision === p.baseRevision;
  const stamp = await writeStamp(trx, deps, null);
  await trx
    .insertInto('instanceChange')
    .values({
      id: p.id,
      ownerId: userId,
      instanceId: p.instanceId,
      baseRevision: p.baseRevision,
      author: 'coach',
      operations: JSON.stringify(p.operations),
      reasonCode: 'COACH_PROPOSAL',
      reason: ctx.healthConsent ? p.reason : null,
      status: current ? 'proposed' : 'expired',
      expiresAt: new Date(now.getTime() + currentRules().proposalValidDays * DAY_MS).toISOString(),
      decidedAt: null,
      aiGenerated: 1,
      aiModel: p.model,
      promptVersion: ctx.promptVersion,
      coachThreadId: ctx.threadId,
      createdAt: now.toISOString(),
      deletedAt: null,
      ...stamp,
    })
    .execute();
}
