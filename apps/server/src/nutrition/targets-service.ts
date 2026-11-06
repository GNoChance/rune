import type { AppliedRule, NutritionGoal, TargetReason } from '@rune/contracts';
import { computeNutritionTargets, type TargetInputsJson, type TargetsInput } from '@rune/domain';
import { type Selectable, sql } from 'kysely';
import { writeStamp } from '../db/rev';
import type { DbExecutor, NutritionTargetTable } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { loadNutritionContext, type NutritionContext } from './context';

/** Ligne vivante de `nutrition_target`, `inputs` et `appliedRules` décodés (07 §5.12). */
export interface NutritionTargetRow {
  id: string;
  rev: number;
  validFrom: string;
  algoVersion: string;
  reason: TargetReason;
  inputs: TargetInputsJson;
  effectiveGoal: NutritionGoal;
  bmrKcal: number;
  tdeeKcal: number;
  kcalTarget: number;
  kcalMin: number;
  kcalMax: number;
  proteinGMin: number;
  proteinGMax: number;
  fatGMin: number;
  carbsG: number;
  fiberG: number;
  waterMl: number;
  appliedRules: AppliedRule[];
}

/** Une ligne vivante a toutes ses colonnes (CHECK `live` de la migration 0009). */
function required<T>(value: T | null): T {
  if (value === null) throw new Error('ligne nutrition_target vivante incomplète');
  return value;
}

type StoredTarget = Selectable<NutritionTargetTable>;

const selectTargets = (db: DbExecutor, userId: string) =>
  db.selectFrom('nutritionTarget').selectAll().where('ownerId', '=', userId).where('deletedAt', 'is', null);

function decode(row: StoredTarget): NutritionTargetRow {
  return {
    id: row.id,
    rev: row.rev,
    validFrom: required(row.validFrom),
    algoVersion: required(row.algoVersion),
    reason: required(row.reason),
    inputs: JSON.parse(required(row.inputs)) as TargetInputsJson,
    effectiveGoal: required(row.effectiveGoal),
    bmrKcal: required(row.bmrKcal),
    tdeeKcal: required(row.tdeeKcal),
    kcalTarget: required(row.kcalTarget),
    kcalMin: required(row.kcalMin),
    kcalMax: required(row.kcalMax),
    proteinGMin: required(row.proteinGMin),
    proteinGMax: required(row.proteinGMax),
    fatGMin: required(row.fatGMin),
    carbsG: required(row.carbsG),
    fiberG: required(row.fiberG),
    waterMl: required(row.waterMl),
    appliedRules: JSON.parse(required(row.appliedRules)) as AppliedRule[],
  };
}

/** Cibles vivantes, de la plus ancienne à la plus récente (`valid_from`, puis `id`). */
export async function listTargets(db: DbExecutor, userId: string): Promise<NutritionTargetRow[]> {
  const rows = await selectTargets(db, userId).orderBy('validFrom', 'asc').orderBy('id', 'asc').execute();
  return rows.map(decode);
}

/** Cible en vigueur : la dernière par (`valid_from`, `id`). */
export async function currentTarget(db: DbExecutor, userId: string): Promise<NutritionTargetRow | null> {
  const row = await selectTargets(db, userId)
    .orderBy('validFrom', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? decode(row) : null;
}

/** Entrée du calcul tirée des réglages du profil ; `null` tant qu'un réglage manque. */
export function targetsInputFor(
  ctx: NutritionContext,
  weightG: number,
  override: Partial<Pick<TargetsInput, 'goal' | 'cumulativeAdjustmentKcal'>> = {},
): TargetsInput | null {
  const p = ctx.profile;
  if (!p || p.sexForCalc === null || p.heightCm === null || p.activityLevel === null || p.goal === null) {
    return null;
  }
  return {
    age: ctx.age,
    sexForCalc: p.sexForCalc,
    heightCm: p.heightCm,
    weightG,
    activityLevel: p.activityLevel,
    goal: override.goal ?? p.goal,
    cumulativeAdjustmentKcal: override.cumulativeAdjustmentKcal ?? p.cumulativeAdjustmentKcal,
  };
}

/**
 * Calcule et enregistre une cible (immuable, rev neuf). Refuse hors mode effectif `full` (`mode_not_allowed`) et
 * une entrée hors domaine (`validation`). `valid_from` est la date de Paris du jour.
 */
export async function createTarget(
  trx: DbExecutor,
  deps: AppDeps,
  userId: string,
  reason: TargetReason,
  input: TargetsInput,
): Promise<NutritionTargetRow> {
  const ctx = await loadNutritionContext(trx, deps, userId);
  if (ctx.effective.mode !== 'full') throw httpError('mode_not_allowed');
  const result = computeNutritionTargets(input);
  if ('refusal' in result) {
    throw httpError(result.refusal === 'MODE_NOT_FULL' ? 'mode_not_allowed' : 'validation');
  }
  const { targets, inputs } = result;
  const stamp = await writeStamp(trx, deps, userId);
  const id = deps.ids.uuidv7();
  // En SQL brut : le plugin camelCase écrirait `protein_gmin` pour `proteinGMin` (suite de majuscules).
  await sql`insert into nutrition_target
    (id, owner_id, rev, created_at, updated_at, updated_by, valid_from, algo_version, reason, inputs,
     effective_goal, bmr_kcal, tdee_kcal, kcal_target, kcal_min, kcal_max, protein_g_min, protein_g_max,
     fat_g_min, carbs_g, fiber_g, water_ml, applied_rules)
    values (${id}, ${userId}, ${stamp.rev}, ${stamp.updatedAt}, ${stamp.updatedAt}, ${stamp.updatedBy},
     ${ctx.today}, ${targets.algo_version}, ${reason}, ${JSON.stringify(inputs)}, ${targets.effective_goal},
     ${targets.bmr_kcal}, ${targets.tdee_kcal}, ${targets.kcal_target}, ${targets.kcal_min}, ${targets.kcal_max},
     ${targets.protein_g_min}, ${targets.protein_g_max}, ${targets.fat_g_min}, ${targets.carbs_g},
     ${targets.fiber_g}, ${targets.water_ml}, ${JSON.stringify(targets.applied_rules)})`.execute(trx);
  const created = await selectTargets(trx, userId).where('id', '=', id).executeTakeFirstOrThrow();
  return decode(created);
}
