import { insertFixtureRow, type TestContext } from '../support';

/** Membre en mode complet : accord santé, mode ouvert, écran v1 passé, réglages complets (sauf demande contraire). */
export async function fullMember(
  ctx: TestContext,
  userId: string,
  o: { settings?: boolean; goal?: 'lose' | 'maintain' | 'gain'; cumulative?: number; heightCm?: number } = {},
): Promise<void> {
  const db = ctx.deps.db;
  await insertFixtureRow(db, 'consent_event', { ownerId: userId, type: 'health', action: 'grant' });
  await insertFixtureRow(db, 'nutrition_state', { fullOpen: 1 });
  const settings =
    o.settings === false
      ? {}
      : {
          sexForCalc: 'male',
          heightCm: o.heightCm ?? 180,
          activityLevel: 2,
          goal: o.goal ?? 'maintain',
          cumulativeAdjustmentKcal: o.cumulative ?? 0,
        };
  await insertFixtureRow(db, 'nutrition_profile', {
    ownerId: userId,
    mode: 'full',
    modeReason: 'choice',
    safetyScreenVersion: 1,
    safetyScreenAt: '2026-10-06T10:00:00.000Z',
    ...settings,
  });
}

/** Cible en vigueur posée directement ; `refWeightG` est le poids de référence enregistré dans ses entrées. */
export async function seedTarget(
  ctx: TestContext,
  userId: string,
  o: { validFrom: string; refWeightG?: number; algoVersion?: string; reason?: string; goal?: string },
) {
  return insertFixtureRow(ctx.deps.db, 'nutrition_target', {
    ownerId: userId,
    validFrom: o.validFrom,
    algoVersion: o.algoVersion ?? 'nutri-1.0.0',
    reason: o.reason ?? 'initial',
    effectiveGoal: o.goal ?? 'maintain',
    inputs: JSON.stringify({
      age: 36,
      sex_for_calc: 'male',
      height_cm: 180,
      ref_weight_g: o.refWeightG ?? 80_000,
      activity_level: 2,
      pal: 1.55,
      requested_goal: o.goal ?? 'maintain',
      cumulative_adjustment_kcal: 0,
    }),
  });
}

export async function seedWeighIns(
  ctx: TestContext,
  userId: string,
  entries: Array<[date: string, weightG: number]>,
): Promise<void> {
  for (const [date, weightG] of entries) {
    await insertFixtureRow(ctx.deps.db, 'weigh_in', { ownerId: userId, date, weightG });
  }
}

export const open = (ctx: TestContext, cookie: string) =>
  ctx.request('/api/nutrition/open', { method: 'POST', cookie, json: {} });

export const NO_ANSWERS = { pregnancy: 'no', eating_disorder: 'no', medical: 'no' } as const;

export const SETUP = {
  sex_for_calc: 'male',
  height_cm: 180,
  activity_level: 2,
  goal: 'maintain',
  weigh_in: { id: '0190aaaa-0000-7000-8000-000000000001', date: '2026-11-09', weight_g: 80_000 },
} as const;

/** Accord santé actif et mode complet ouvert, sans profil. */
export async function openFullFor(ctx: TestContext, userId: string): Promise<void> {
  await insertFixtureRow(ctx.deps.db, 'consent_event', { ownerId: userId, type: 'health', action: 'grant' });
  await ctx.deps.db.updateTable('nutritionState').set({ fullOpen: 1 }).execute();
}

export const screen = (ctx: TestContext, cookie: string, json: unknown) =>
  ctx.request('/api/nutrition/screen', { method: 'POST', cookie, json });

export const putMode = (ctx: TestContext, cookie: string, json: unknown) =>
  ctx.request('/api/nutrition/mode', { method: 'PUT', cookie, json });
