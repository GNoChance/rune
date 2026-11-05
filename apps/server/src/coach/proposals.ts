import type { InstanceChangeOperation } from '@rune/contracts';
import { coachLoadGuard, UnknownRulesVersionError } from '@rune/domain';
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

/**
 * Résultat de la garde de hausse : vérifiable, avec les slots dont la charge prévue monterait (triés, vide si aucun),
 * ou non vérifiable, quand le rejeu est impossible.
 */
export type CoachLoadCheck = { verifiable: true; increases: string[] } | { verifiable: false };

/**
 * Garde de hausse du changement `change` du coach, comme s'il était accepté à `now` (§12.2, étape 6, C6) :
 * `coachLoadGuard` sur le rejeu de l'instance active, dans chacun des lieux vivants (la liste que reçoit
 * `validateChange`) et au lieu principal de `planWorkout`, suspensions levées. Lecture seule. Non vérifiable seulement
 * sans rejeu possible : aucune entrée de rejeu (`loadReplayInput`, déjà journalisé), ou une séance aux règles inconnues
 * du serveur (`UnknownRulesVersionError`), qu'une mise à jour du serveur lève ; toute autre erreur remonte.
 */
export async function checkCoachLoad(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  change: { id: string; operations: readonly InstanceChangeOperation[] },
  now: Date,
): Promise<CoachLoadCheck> {
  const replay = await loadReplayInput(db, deps, userId);
  if (replay === null) return { verifiable: false };
  const places = [...(await placesOf(db, userId, { live: true })).values()];
  const plan = await loadPlanContext(db, deps, userId, now);
  try {
    const increases = coachLoadGuard(
      { replay, change: { ...change, author: 'coach' }, decidedAt: now.getTime(), plan },
      places,
    );
    return { verifiable: true, increases };
  } catch (err) {
    if (err instanceof UnknownRulesVersionError) return { verifiable: false };
    throw err;
  }
}

/**
 * Écriture d'une proposition du coach (§12.3), dans la transaction de l'enregistrement de l'échange (§8.7) :
 * propositions périmées expirées (`expireProposals`) ; propositions `proposed` du coach de la personne → `expired`,
 * chacune avec un rev neuf (C4 : celles du moteur restent) ; puis insertion de `p` sur son instance, `author` coach,
 * `reason_code` `COACH_PROPOSAL`, `reason` seulement avec l'accord santé (C7), `status` `proposed`, ou `expired` si
 * l'instance n'est plus active ou si sa révision n'est plus celle de la validation, `expires_at` = celui de la tentative (`p.expiresAt`, le même que l'événement `proposal`),
 * `ai_generated`, `ai_model` (modèle de l'itération), `prompt_version` et `coach_thread_id` du fil. Sans modèle
 * (`p.model` nul : la tentative ne l'a pas posé), erreur `coach_proposal_model_missing`, de même `coach_proposal_expiry_missing`, avant toute écriture : une
 * ligne `ai_generated` sans `ai_model` ne s'écrit jamais. Rend le statut écrit : seule une proposition `proposed` a une
 * carte et figure dans `proposalIds`.
 */
export async function insertCoachProposal(
  trx: DbExecutor,
  deps: AppDeps,
  p: PendingProposal,
  ctx: { userId: string; threadId: string; promptVersion: string; now: Date; healthConsent: boolean },
): Promise<'proposed' | 'expired'> {
  if (p.model === null) throw new Error('coach_proposal_model_missing');
  if (p.expiresAt === null) throw new Error('coach_proposal_expiry_missing');
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
  const status = current ? 'proposed' : 'expired';
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
      status,
      expiresAt: p.expiresAt,
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
  return status;
}
