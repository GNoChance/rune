import {
  type NutritionCheckin,
  type NutritionNeed,
  type NutritionState,
  SAFETY_SCREEN,
} from '@rune/contracts';
import { addDays, mondayOf, NUTRI_ALGO_VERSION, referenceWeight, type WeighIn, weekMean } from '@rune/domain';
import type { Selectable } from 'kysely';
import type { DbExecutor, NutritionCheckinTable } from '../db/schema';
import type { AppDeps } from '../deps';
import { loadNutritionContext, type NutritionContext } from './context';
import { listTargets, type NutritionTargetRow } from './targets-service';

type WeeklyMean = Extract<NutritionState, { effective_mode: 'full' }>['weekly_means'][number];

export type NutritionCheckinRow = Selectable<NutritionCheckinTable>;

/** Lignes vivantes qui nourrissent l'état rendu ; vides tant que le mode effectif n'est pas `full`. */
export interface NutritionRows {
  /** Cible en vigueur. */
  target: NutritionTargetRow | null;
  /** Du plus ancien au plus récent (`week_start`). */
  checkins: NutritionCheckinRow[];
  weighIns: WeighIn[];
}

export const EMPTY_ROWS: NutritionRows = { target: null, checkins: [], weighIns: [] };

const WEEKLY_MEANS_SHOWN = 12;

/** Lignes vivantes du compte pour l'état rendu ; rien hors mode effectif `full` (C2 jamais servi). */
export async function loadNutritionRows(db: DbExecutor, ctx: NutritionContext): Promise<NutritionRows> {
  if (ctx.effective.mode !== 'full') return EMPTY_ROWS;
  const targets = await listTargets(db, ctx.userId);
  const checkins = await db
    .selectFrom('nutritionCheckin')
    .selectAll()
    .where('ownerId', '=', ctx.userId)
    .where('deletedAt', 'is', null)
    .orderBy('weekStart', 'asc')
    .execute();
  const weighIns = await liveWeighIns(db, ctx.userId);
  return { target: targets.at(-1) ?? null, checkins, weighIns };
}

export async function liveWeighIns(db: DbExecutor, userId: string): Promise<WeighIn[]> {
  const rows = await db
    .selectFrom('weighIn')
    .select(['date', 'weightG'])
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .orderBy('date', 'asc')
    .execute();
  return rows.flatMap((r) =>
    r.date !== null && r.weightG !== null ? [{ date: r.date, weightG: r.weightG }] : [],
  );
}

export function checkinView(row: NutritionCheckinRow): NutritionCheckin {
  const required = <T>(v: T | null): T => {
    if (v === null) throw new Error('ligne nutrition_checkin vivante incomplète');
    return v;
  };
  return {
    week_start: required(row.weekStart),
    weigh_in_count: required(row.weighInCount),
    mean_weight_g: row.meanWeightG,
    change_pct: row.changePct,
    representative: required(row.representative) === 1,
    decision: required(row.decision),
    position: row.position,
    proposed_delta_kcal: row.proposedDeltaKcal,
    response: row.response,
  };
}

/** Bilan à traiter : le plus récent seulement, proposition ou perte rapide, sans réponse. */
function actionable(row: NutritionCheckinRow | undefined): row is NutritionCheckinRow {
  return (
    row !== undefined &&
    row.response === null &&
    (row.decision === 'proposal' || row.decision === 'rapid_loss')
  );
}

/** Variation en %, 2 décimales, moitié en s'éloignant de zéro. */
function changePct(cur: number, prev: number): number {
  const v = (100 * (cur - prev)) / prev;
  return Math.sign(v) * (Math.round(Math.abs(v) * 100) / 100);
}

/** Les 12 dernières semaines (la courante comprise) qui ont au moins une pesée, de la plus ancienne à la plus récente. */
export function weeklyMeans(weighIns: WeighIn[], today: string): WeeklyMean[] {
  const thisMonday = mondayOf(today);
  const out: WeeklyMean[] = [];
  let previous: number | null = null;
  for (let i = WEEKLY_MEANS_SHOWN; i >= 0; i--) {
    const monday = addDays(thisMonday, -7 * i);
    const { count, meanG } = weekMean(weighIns, monday);
    if (i < WEEKLY_MEANS_SHOWN && count > 0) {
      out.push({
        week_start: monday,
        weigh_in_count: count,
        mean_weight_g: meanG,
        change_pct: meanG !== null && previous !== null ? changePct(meanG, previous) : null,
      });
    }
    previous = meanG;
  }
  return out;
}

function needsOf(
  ctx: NutritionContext,
  rows: NutritionRows,
  refWeightG: number | null,
): NutritionNeed | null {
  if (ctx.effective.mode !== 'full') {
    if (ctx.effective.cause === 'no_health_consent') return 'consent';
    if (ctx.effective.cause === 'screen_outdated') return 'screen';
    return null;
  }
  const p = ctx.profile;
  const complete =
    p !== null && p.sexForCalc !== null && p.heightCm !== null && p.activityLevel !== null && p.goal !== null;
  if (!complete || rows.target === null) return 'setup';
  if (rows.target.algoVersion !== NUTRI_ALGO_VERSION && refWeightG === null) return 'weigh_in';
  return null;
}

/** État rendu (spec brique 5 §7) : rien d'autre que les champs réduits hors mode effectif `full`. */
export function buildNutritionState(ctx: NutritionContext, rows: NutritionRows): NutritionState {
  const profile = ctx.profile;
  const refWeightG = referenceWeight(rows.weighIns, ctx.today);
  const shared = {
    cause: ctx.effective.cause,
    stored_mode: profile?.mode ?? 'disabled',
    full_open: ctx.fullOpen,
    screen_version_current: SAFETY_SCREEN.version,
    needs: needsOf(ctx, rows, refWeightG),
  } as const;
  const mode = ctx.effective.mode;
  if (mode !== 'full') {
    return {
      effective_mode: mode,
      ...shared,
      mode_reason: profile?.modeReason === 'choice' ? 'choice' : null,
    };
  }
  const t = rows.target;
  const latest = rows.checkins.at(-1);
  return {
    effective_mode: 'full',
    ...shared,
    mode_reason: profile?.modeReason ?? null,
    settings: {
      sex_for_calc: profile?.sexForCalc ?? null,
      height_cm: profile?.heightCm ?? null,
      activity_level: profile?.activityLevel ?? null,
      goal: profile?.goal ?? null,
    },
    safety_pause: profile?.safetyPause === 1,
    target: t && {
      bmr_kcal: t.bmrKcal,
      tdee_kcal: t.tdeeKcal,
      kcal_target: t.kcalTarget,
      kcal_min: t.kcalMin,
      kcal_max: t.kcalMax,
      protein_g_min: t.proteinGMin,
      protein_g_max: t.proteinGMax,
      fat_g_min: t.fatGMin,
      carbs_g: t.carbsG,
      fiber_g: t.fiberG,
      water_ml: t.waterMl,
      effective_goal: t.effectiveGoal,
      applied_rules: t.appliedRules,
      algo_version: t.algoVersion,
      valid_from: t.validFrom,
      reason: t.reason,
    },
    last_checkin: latest ? checkinView(latest) : null,
    checkin: actionable(latest) ? checkinView(latest) : null,
    weekly_means: weeklyMeans(rows.weighIns, ctx.today),
    reference_weight_g: refWeightG,
  };
}

/** Lecture seule : contexte, lignes et état rendu. */
export async function readNutritionState(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
): Promise<NutritionState> {
  const ctx = await loadNutritionContext(db, deps, userId);
  return buildNutritionState(ctx, await loadNutritionRows(db, ctx));
}
