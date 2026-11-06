import { NutritionStateSchema } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, createUserAndLogin, insertFixtureRow, type TestContext } from '../support';
import { fullMember, open, seedTarget, seedWeighIns } from './fixtures';

/* Ouverture du module nutrition (spec brique 5 §8) : mode effectif, besoins, bilan de la semaine écoulée. */

let ctx: TestContext;
afterEach(() => ctx?.close());

// Lundi 2026-11-09, 10 h à Paris.
const MONDAY = '2026-11-09T09:00:00.000Z';

const checkins = () => ctx.deps.db.selectFrom('nutritionCheckin').selectAll().orderBy('weekStart').execute();
const targets = () => ctx.deps.db.selectFrom('nutritionTarget').selectAll().orderBy('id').execute();

describe('ouverture hors mode complet', () => {
  it("rend l'état réduit, sans aucune ligne C2 et sans bilan", async () => {
    ctx = await createTestContext({ now: MONDAY });
    const u = await createUserAndLogin(ctx);
    // Mode complet stocké mais pas d'accord santé : mode effectif qualitatif.
    await insertFixtureRow(ctx.deps.db, 'nutrition_state', { fullOpen: 1 });
    await insertFixtureRow(ctx.deps.db, 'nutrition_profile', {
      ownerId: u.id,
      mode: 'full',
      modeReason: 'choice',
      safetyScreenVersion: 1,
      sexForCalc: 'male',
      heightCm: 180,
      activityLevel: 2,
      goal: 'lose',
    });
    await seedTarget(ctx, u.id, { validFrom: '2026-11-03' });
    await seedWeighIns(ctx, u.id, [
      ['2026-11-03', 80_000],
      ['2026-11-04', 80_000],
      ['2026-11-05', 80_000],
    ]);
    const res = await open(ctx, u.cookie);
    expect(res.status).toBe(200);
    const text = await res.text();
    const state = NutritionStateSchema.parse(JSON.parse(text));
    expect(state).toMatchObject({
      effective_mode: 'qualitative',
      cause: 'no_health_consent',
      stored_mode: 'full',
      needs: 'consent',
    });
    for (const secret of ['settings', 'target', 'kcal', 'weight', 'sex_for_calc', 'height', 'checkin']) {
      expect(text).not.toContain(secret);
    }
    expect(await checkins()).toHaveLength(0);
  });

  it('un compte sans profil est désactivé', async () => {
    ctx = await createTestContext({ now: MONDAY });
    const u = await createUserAndLogin(ctx);
    const state = (await (await open(ctx, u.cookie)).json()) as Record<string, unknown>;
    expect(state).toMatchObject({ effective_mode: 'disabled', cause: 'stored', stored_mode: 'disabled' });
    expect(state.needs).toBeNull();
  });
});

describe('ouverture en mode complet', () => {
  it('sans réglages : needs = setup', async () => {
    ctx = await createTestContext({ now: MONDAY });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id, { settings: false });
    const state = NutritionStateSchema.parse(await (await open(ctx, u.cookie)).json());
    expect(state).toMatchObject({ effective_mode: 'full', needs: 'setup', target: null });
    expect(await checkins()).toHaveLength(0);
  });

  it("cible d'une autre version sans pesée récente : needs = weigh_in, ancienne cible rendue", async () => {
    ctx = await createTestContext({ now: MONDAY });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    await seedTarget(ctx, u.id, { validFrom: '2026-10-01', algoVersion: 'nutri-0.9.0' });
    await seedWeighIns(ctx, u.id, [['2026-10-20', 80_000]]);
    const state = NutritionStateSchema.parse(await (await open(ctx, u.cookie)).json());
    expect(state).toMatchObject({ needs: 'weigh_in', reference_weight_g: null });
    expect(state.effective_mode === 'full' && state.target?.algo_version).toBe('nutri-0.9.0');
    expect(await targets()).toHaveLength(1);
  });

  it("cible d'une autre version avec une pesée récente : new_algo_version, ajustement conservé", async () => {
    ctx = await createTestContext({ now: MONDAY });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id, { cumulative: -100, goal: 'lose' });
    await seedTarget(ctx, u.id, { validFrom: '2026-10-01', algoVersion: 'nutri-0.9.0' });
    await seedWeighIns(ctx, u.id, [['2026-11-08', 80_000]]);
    const state = NutritionStateSchema.parse(await (await open(ctx, u.cookie)).json());
    const rows = await targets();
    expect(rows).toHaveLength(2);
    const created = rows.find((r) => r.reason === 'new_algo_version');
    expect(created).toMatchObject({ algoVersion: 'nutri-1.0.0', validFrom: '2026-11-09' });
    expect(JSON.parse(created?.inputs ?? '{}')).toMatchObject({
      ref_weight_g: 80_000,
      cumulative_adjustment_kcal: -100,
    });
    expect(state).toMatchObject({ needs: null });
    expect(state.effective_mode === 'full' && state.target?.reason).toBe('new_algo_version');
  });
});

describe('bilan de la semaine écoulée', () => {
  it('lundi 2026-11-09 : bilan de la semaine du 2026-11-02, créé une seule fois', async () => {
    ctx = await createTestContext({ now: MONDAY });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    await seedTarget(ctx, u.id, { validFrom: '2026-11-03' });
    await seedWeighIns(ctx, u.id, [
      ['2026-11-03', 80_000],
      ['2026-11-05', 80_200],
      ['2026-11-07', 80_100],
      ['2026-11-08', 79_900],
    ]);
    const first = NutritionStateSchema.parse(await (await open(ctx, u.cookie)).json());
    await open(ctx, u.cookie);
    const rows = await checkins();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      weekStart: '2026-11-02',
      weighInCount: 4,
      meanWeightG: 80_050,
      decision: 'insufficient_data',
      representative: 1,
      createdTargetId: null,
      recalibrationTargetId: null,
    });
    expect(rows[0]?.rev).toBeGreaterThan(0);
    expect(first.effective_mode === 'full' && first.last_checkin?.week_start).toBe('2026-11-02');
    expect(first.effective_mode === 'full' && first.checkin).toBeNull();
  });

  it('un bilan est figé : une pesée ajoutée ensuite ne le change pas', async () => {
    ctx = await createTestContext({ now: MONDAY });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    await seedTarget(ctx, u.id, { validFrom: '2026-11-03' });
    await seedWeighIns(ctx, u.id, [
      ['2026-11-03', 80_000],
      ['2026-11-05', 80_000],
      ['2026-11-07', 80_000],
    ]);
    await open(ctx, u.cookie);
    await seedWeighIns(ctx, u.id, [['2026-11-08', 90_000]]);
    await open(ctx, u.cookie);
    expect((await checkins())[0]).toMatchObject({ weighInCount: 3, meanWeightG: 80_000 });
  });

  it('pas de bilan pour une semaine finie avant la première cible', async () => {
    ctx = await createTestContext({ now: MONDAY });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    await seedTarget(ctx, u.id, { validFrom: '2026-11-09' });
    await open(ctx, u.cookie);
    expect(await checkins()).toHaveLength(0);
  });

  it('pas de rattrapage de la semaine du 2026-10-26', async () => {
    ctx = await createTestContext({ now: MONDAY });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    await seedTarget(ctx, u.id, { validFrom: '2026-10-20' });
    await open(ctx, u.cookie);
    expect((await checkins()).map((c) => c.weekStart)).toEqual(['2026-11-02']);
  });

  it('lundi 2026-10-26 à 0 h 30 de Paris (23 h 30 UTC le 25) : semaine du 2026-10-19', async () => {
    ctx = await createTestContext({ now: '2026-10-25T23:30:00.000Z' });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    await seedTarget(ctx, u.id, { validFrom: '2026-10-12' });
    await open(ctx, u.cookie);
    expect((await checkins()).map((c) => c.weekStart)).toEqual(['2026-10-19']);
  });

  it("un bilan plus ancien sans réponse n'est plus à traiter", async () => {
    ctx = await createTestContext({ now: MONDAY });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    await seedTarget(ctx, u.id, { validFrom: '2026-10-01' });
    await insertFixtureRow(ctx.deps.db, 'nutrition_checkin', {
      ownerId: u.id,
      weekStart: '2026-10-26',
      weighInCount: 5,
      meanWeightG: 80_000,
      decision: 'proposal',
      position: 'above',
      proposedDeltaKcal: -100,
    });
    const state = NutritionStateSchema.parse(await (await open(ctx, u.cookie)).json());
    expect(state.effective_mode === 'full' && state.checkin).toBeNull();
    expect(state.effective_mode === 'full' && state.last_checkin?.week_start).toBe('2026-11-02');
  });

  it('le bilan le plus récent sans réponse, proposition, est à traiter', async () => {
    ctx = await createTestContext({ now: MONDAY });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    await seedTarget(ctx, u.id, { validFrom: '2026-10-01' });
    await insertFixtureRow(ctx.deps.db, 'nutrition_checkin', {
      ownerId: u.id,
      weekStart: '2026-11-02',
      weighInCount: 5,
      meanWeightG: 80_000,
      decision: 'proposal',
      position: 'above',
      proposedDeltaKcal: -100,
    });
    const state = NutritionStateSchema.parse(await (await open(ctx, u.cookie)).json());
    expect(state.effective_mode === 'full' && state.checkin?.week_start).toBe('2026-11-02');
    expect(await checkins()).toHaveLength(1);
  });

  it('un écart de 2 kg ou plus crée une cible weight_recalibration liée au bilan', async () => {
    ctx = await createTestContext({ now: MONDAY });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id, { cumulative: -100, goal: 'lose' });
    await seedTarget(ctx, u.id, { validFrom: '2026-10-01', refWeightG: 80_000, goal: 'lose' });
    await seedWeighIns(ctx, u.id, [
      ['2026-11-03', 77_500],
      ['2026-11-05', 77_500],
      ['2026-11-07', 77_500],
    ]);
    await open(ctx, u.cookie);
    const created = (await targets()).find((t) => t.reason === 'weight_recalibration');
    expect(created).toBeDefined();
    expect(JSON.parse(created?.inputs ?? '{}')).toMatchObject({
      ref_weight_g: 77_500,
      cumulative_adjustment_kcal: -100,
    });
    const [checkin] = await checkins();
    expect(checkin?.recalibrationTargetId).toBe(created?.id);
    expect(checkin?.createdTargetId).toBeNull();
    const profile = await ctx.deps.db.selectFrom('nutritionProfile').selectAll().executeTakeFirstOrThrow();
    expect(profile).toMatchObject({ goal: 'lose', cumulativeAdjustmentKcal: -100 });
  });

  it("IMC < 18,5 en perte : cible low_bmi_safety, ajustement à 0, objectif du profil à 'maintain'", async () => {
    ctx = await createTestContext({ now: MONDAY });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id, { cumulative: -100, goal: 'lose' });
    await seedTarget(ctx, u.id, { validFrom: '2026-10-01', refWeightG: 59_000, goal: 'lose' });
    await seedWeighIns(ctx, u.id, [
      ['2026-11-03', 59_000],
      ['2026-11-05', 59_000],
      ['2026-11-07', 59_000],
    ]);
    const before = await ctx.deps.db.selectFrom('nutritionProfile').selectAll().executeTakeFirstOrThrow();
    await open(ctx, u.cookie);
    const created = (await targets()).find((t) => t.reason === 'low_bmi_safety');
    expect(created).toBeDefined();
    expect(JSON.parse(created?.inputs ?? '{}')).toMatchObject({ cumulative_adjustment_kcal: 0 });
    const [checkin] = await checkins();
    expect(checkin).toMatchObject({ decision: 'safety_pause', createdTargetId: created?.id });
    const profile = await ctx.deps.db.selectFrom('nutritionProfile').selectAll().executeTakeFirstOrThrow();
    expect(profile).toMatchObject({ goal: 'maintain', cumulativeAdjustmentKcal: 0, safetyPause: 0 });
    expect(profile.rev).toBeGreaterThan(before.rev);
  });
});
