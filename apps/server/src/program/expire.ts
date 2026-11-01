import { writeStamp } from '../db/rev';
import type { DbExecutor } from '../db/schema';

/**
 * Expiration des propositions (05 §15.4, spec brique 3 §4.4.6) : une proposition de `ownerId` dont la date limite est
 * dépassée (`expires_at` < `now`, la limite elle-même encore valable) ou dont `base_revision` n'est plus la révision
 * de son instance passe à `expired`, chacune avec un rev neuf. `decided_at` reste vide : personne n'a décidé.
 * Appelée avant chaque rejeu et chaque pull de l'utilisateur, et par l'API du programme.
 */
export async function expireProposals(trx: DbExecutor, ownerId: string, now: Date): Promise<void> {
  const at = now.toISOString();
  const stale = await trx
    .selectFrom('instanceChange as c')
    .innerJoin('programInstance as i', 'i.id', 'c.instanceId')
    .select('c.id')
    .where('c.ownerId', '=', ownerId)
    .where('c.status', '=', 'proposed')
    .where('c.deletedAt', 'is', null)
    .where((eb) =>
      eb.or([
        eb.and([eb('c.expiresAt', 'is not', null), eb('c.expiresAt', '<', at)]),
        eb('c.baseRevision', '!=', eb.ref('i.revision')),
      ]),
    )
    .orderBy('c.id')
    .execute();
  for (const { id } of stale) {
    const stamp = await writeStamp(trx, { clock: { now: () => now } }, null);
    await trx
      .updateTable('instanceChange')
      .set({ status: 'expired', ...stamp })
      .where('id', '=', id)
      .execute();
  }
}
