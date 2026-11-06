import { parisDate } from '@rune/domain';
import { sql } from 'kysely';
import { writeStamp } from '../db/rev';
import type { EntitySyncHooks, HookCtx, SyncHooksMap } from '../sync/hooks';
import { OpRejection } from '../sync/push';
import { loadNutritionContext } from './context';

/*
 * Contrôles du serveur au push des pesées (spec brique 5 §6.3), dans l'ordre de la spec, en plus des règles
 * génériques de la synchro. Le 1 (accord santé absent : `applied_partial`, rien d'écrit, aucun rejet) est celui de
 * la table C2 dans `applyOp`. Un patch ne corrige que `weight_g` : `date` n'est donc pas une colonne immuable (elle
 * serait retirée en silence avant tout contrôle), le hook la refuse.
 */

type Fields = Record<string, unknown>;

const MIN_WEIGHT_G = 30_000;
const MAX_WEIGHT_G = 250_000;
const WEIGHT_STEP_G = 100;

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function assertWeight(value: unknown): void {
  const ok =
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_WEIGHT_G &&
    value <= MAX_WEIGHT_G &&
    value % WEIGHT_STEP_G === 0;
  if (!ok) throw new OpRejection('validation', 'weight_g');
}

async function beforeApply({ trx, deps, userId, op }: HookCtx, fields: Fields): Promise<void> {
  const ctx = await loadNutritionContext(trx, deps, userId);
  // Sans accord, seule une suppression arrive ici (3 : la table C2 écarte le reste) : elle s'applique.
  if (!ctx.healthConsentActive) return;
  // 2. La mutation est acceptée par le client (07 §5.7.1.3), refusée ici.
  if (ctx.effective.mode !== 'full') {
    throw new OpRejection('forbidden', `nutrition_mode_${ctx.effective.mode}`);
  }
  if (op.kind === 'delete') return;
  // 3. Domaine du poids, date réelle et pas dans le futur (Paris).
  if (op.kind === 'patch') {
    if (Object.hasOwn(fields, 'date')) throw new OpRejection('validation', 'date_immutable');
    if (Object.hasOwn(fields, 'weight_g')) assertWeight(fields.weight_g);
    return;
  }
  assertWeight(fields.weight_g);
  const date = fields.date;
  if (!isCalendarDate(date) || date > parisDate(deps.clock.now()))
    throw new OpRejection('validation', 'date');
  // 4. Une seule pesée vivante par jour : l'ancienne passe en tombstone, l'ordre d'arrivée décide (R-SYN-5).
  const known = await trx.selectFrom('weighIn').select('id').where('id', '=', op.id).executeTakeFirst();
  if (known) return;
  const previous = await trx
    .selectFrom('weighIn')
    .select('id')
    .where('ownerId', '=', userId)
    .where('date', '=', date)
    .where('deletedAt', 'is', null)
    .execute();
  for (const { id } of previous) {
    const stamp = await writeStamp(trx, deps, userId);
    await sql`update weigh_in set deleted_at = ${stamp.updatedAt}, rev = ${stamp.rev}, updated_at = ${stamp.updatedAt}, updated_by = ${stamp.updatedBy} where id = ${id}`.execute(
      trx,
    );
  }
}

const weighIn: EntitySyncHooks = {
  allowedKinds: ['create', 'patch', 'delete'],
  beforeApply,
};

export const NUTRITION_SYNC_HOOKS: SyncHooksMap = { weigh_in: weighIn };
