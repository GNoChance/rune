import type { NutritionState } from '@rune/contracts';
import {
  addDays,
  adjustedTargetIsSame,
  decideCheckin,
  mondayOf,
  NUTRI_ALGO_VERSION,
  parisDate,
  referenceWeight,
} from '@rune/domain';
import type { SessionUser } from '../app-env';
import { writeStamp } from '../db/rev';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { loadNutritionContext, type NutritionContext } from './context';
import { buildNutritionState, liveWeighIns, loadNutritionRows } from './state';
import {
  createTarget,
  currentTarget,
  listTargets,
  type NutritionTargetRow,
  targetsInputFor,
} from './targets-service';

/** Poids de la cible créée par le bilan : M(S), ramenée au pas de 100 g (moitié vers le haut). */
const toWeightStep = (meanG: number): number => Math.round(meanG / 100) * 100;

/** Étape 3 : une cible d'une autre version se recalcule avec le poids de référence ; sans lui, elle reste affichée. */
async function refreshOutdatedTarget(trx: DbExecutor, deps: AppDeps, ctx: NutritionContext): Promise<void> {
  const target = await currentTarget(trx, ctx.userId);
  if (!target || target.algoVersion === NUTRI_ALGO_VERSION) return;
  const weight = referenceWeight(await liveWeighIns(trx, ctx.userId), ctx.today);
  if (weight === null) return;
  const input = targetsInputFor(ctx, weight);
  if (input) await createTarget(trx, deps, ctx.userId, 'new_algo_version', input);
}

/**
 * Point de départ du bilan (07 §5.7.3, spec §9) : date de Paris de la dernière cible qui n'est pas un recalibrage,
 * ou du dernier refus d'une proposition ; la plus récente des deux.
 */
async function startPointOf(trx: DbExecutor, userId: string, targets: NutritionTargetRow[]) {
  const dates = targets.filter((t) => t.reason !== 'weight_recalibration').map((t) => t.validFrom);
  const declined = await trx
    .selectFrom('nutritionCheckin')
    .select('respondedAt')
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .where('response', '=', 'declined')
    .execute();
  for (const d of declined) if (d.respondedAt) dates.push(parisDate(new Date(d.respondedAt)));
  return dates.sort().at(-1) ?? null;
}

/**
 * Étape 4 : bilan de la semaine S qui précède celle du jour, créé une fois si la semaine finit après la première
 * cible. Les cibles de recalibrage et de sécurité IMC naissent avant la ligne du bilan, qui les référence.
 */
async function createWeeklyCheckin(trx: DbExecutor, deps: AppDeps, ctx: NutritionContext): Promise<void> {
  const profile = ctx.profile;
  if (!profile || profile.heightCm === null || profile.goal === null) return;
  const weekStart = addDays(mondayOf(ctx.today), -7);
  const existing = await trx
    .selectFrom('nutritionCheckin')
    .select('id')
    .where('ownerId', '=', ctx.userId)
    .where('weekStart', '=', weekStart)
    .executeTakeFirst();
  if (existing) return;
  const targets = await listTargets(trx, ctx.userId);
  const first = targets[0];
  if (!first || addDays(weekStart, 6) < first.validFrom) return;

  const target = targets.at(-1) as NutritionTargetRow;
  const weighIns = await liveWeighIns(trx, ctx.userId);
  const startPoint = (await startPointOf(trx, ctx.userId, targets)) ?? weekStart;
  const prevMonday = addDays(weekStart, -7);
  const prev = await trx
    .selectFrom('nutritionCheckin')
    .selectAll()
    .where('ownerId', '=', ctx.userId)
    .where('deletedAt', 'is', null)
    .where('weekStart', '=', prevMonday)
    .executeTakeFirst();
  const prevWeekTarget = targets.filter((t) => t.validFrom <= addDays(weekStart, -1)).at(-1);
  const todayWeight = referenceWeight(weighIns, ctx.today) ?? target.inputs.ref_weight_g;

  const result = decideCheckin({
    weekStart,
    weighIns,
    startPoint,
    target: { effectiveGoal: target.effectiveGoal, refWeightG: target.inputs.ref_weight_g },
    targetForPrevWeek: prevWeekTarget ? { effectiveGoal: prevWeekTarget.effectiveGoal } : null,
    previousCheckin: prev
      ? {
          meanWeightG: prev.meanWeightG,
          position: prev.position,
          representative: prev.representative === 1,
          countable: prevMonday >= startPoint,
        }
      : null,
    representative: true,
    heightCm: profile.heightCm,
    requestedGoal: profile.goal,
    safetyPause: profile.safetyPause === 1,
    limitReached: (delta) => {
      const input = targetsInputFor(ctx, todayWeight);
      return input ? adjustedTargetIsSame(input, delta) : false;
    },
  });

  let recalibrationTargetId: string | null = null;
  let createdTargetId: string | null = null;
  if (result.meanWeightG !== null && result.recalibrate) {
    const input = targetsInputFor(ctx, toWeightStep(result.meanWeightG));
    if (input)
      recalibrationTargetId = (await createTarget(trx, deps, ctx.userId, 'weight_recalibration', input)).id;
  }
  if (result.meanWeightG !== null && result.lowBmiSafety) {
    const input = targetsInputFor(ctx, toWeightStep(result.meanWeightG), {
      goal: 'maintain',
      cumulativeAdjustmentKcal: 0,
    });
    if (input) {
      createdTargetId = (await createTarget(trx, deps, ctx.userId, 'low_bmi_safety', input)).id;
      // Sans ce changement, la règle 2 se redéclencherait chaque semaine.
      const stamp = await writeStamp(trx, deps, ctx.userId);
      await trx
        .updateTable('nutritionProfile')
        .set({ goal: 'maintain', cumulativeAdjustmentKcal: 0, ...stamp })
        .where('id', '=', ctx.userId)
        .execute();
    }
  }

  const stamp = await writeStamp(trx, deps, ctx.userId);
  await trx
    .insertInto('nutritionCheckin')
    .values({
      id: deps.ids.uuidv7(),
      ownerId: ctx.userId,
      createdAt: stamp.updatedAt,
      ...stamp,
      weekStart,
      weighInCount: result.weighInCount,
      meanWeightG: result.meanWeightG,
      changePct: result.changePct,
      representative: 1,
      decision: result.decision,
      position: result.position,
      proposedDeltaKcal: result.proposedDeltaKcal,
      createdTargetId,
      recalibrationTargetId,
    })
    .execute();
}

/**
 * Ouverture du module (spec brique 5 §8), en une transaction : hors mode `full`, l'état réduit et rien d'autre ;
 * sinon cible d'une autre version recalculée, puis bilan de la semaine écoulée.
 */
export async function openNutrition(deps: AppDeps, user: Pick<SessionUser, 'id'>): Promise<NutritionState> {
  return deps.db.transaction().execute(async (trx) => {
    let ctx = await loadNutritionContext(trx, deps, user.id);
    if (ctx.effective.mode === 'full') {
      await refreshOutdatedTarget(trx, deps, ctx);
      await createWeeklyCheckin(trx, deps, ctx);
      ctx = await loadNutritionContext(trx, deps, user.id);
    }
    return buildNutritionState(ctx, await loadNutritionRows(trx, ctx));
  });
}
