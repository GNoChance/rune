import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, createUserAndLogin, type TestContext } from '../support';
import { fullMember, seedTarget, seedWeighIns } from './fixtures';

/* Réglages nutrition (spec brique 5 §7) : aperçu sans écriture, cible profile_change, garde-fous de l'objectif. */

let ctx: TestContext;
afterEach(() => ctx?.close());

const NOW = '2026-11-09T09:00:00.000Z';

const preview = (cookie: string, changes: unknown) =>
  ctx.request('/api/nutrition/settings/preview', { method: 'POST', cookie, json: { changes } });
const put = (cookie: string, json: unknown) =>
  ctx.request('/api/nutrition/settings', { method: 'PUT', cookie, json });

const targets = () => ctx.deps.db.selectFrom('nutritionTarget').selectAll().orderBy('id').execute();
const profileOf = (id: string) =>
  ctx.deps.db.selectFrom('nutritionProfile').selectAll().where('ownerId', '=', id).executeTakeFirstOrThrow();

async function member(o: Parameters<typeof fullMember>[2] = {}, weight = 80_000) {
  ctx = await createTestContext({ now: NOW });
  const u = await createUserAndLogin(ctx);
  await fullMember(ctx, u.id, o);
  await seedTarget(ctx, u.id, { validFrom: '2026-11-02' });
  await seedWeighIns(ctx, u.id, [
    ['2026-11-07', weight],
    ['2026-11-08', weight],
  ]);
  return u;
}

describe('POST /api/nutrition/settings/preview', () => {
  it('rend la cible qui en résulterait sans rien écrire', async () => {
    const u = await member({ cumulative: -100 });
    const before = await targets();
    const profileBefore = await profileOf(u.id);
    const res = await preview(u.cookie, { activity_level: 3 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { target: { kcal_target: number; effective_goal: string } };
    expect(body.target.kcal_target).toBeGreaterThan(0);
    expect(await targets()).toHaveLength(before.length);
    expect(await profileOf(u.id)).toEqual(profileBefore);
  });

  it('409 weigh_in_required sans pesée de moins de 14 jours', async () => {
    ctx = await createTestContext({ now: NOW });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    await seedTarget(ctx, u.id, { validFrom: '2026-10-01' });
    await seedWeighIns(ctx, u.id, [['2026-10-10', 80_000]]);
    const res = await preview(u.cookie, { activity_level: 3 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'weigh_in_required' });
  });

  it('refuse hors mode complet et un corps invalide', async () => {
    ctx = await createTestContext({ now: NOW });
    const u = await createUserAndLogin(ctx);
    expect((await preview(u.cookie, { activity_level: 3 })).status).toBe(422);
    expect((await preview(u.cookie, { height_cm: 50 })).status).toBe(400);
  });
});

describe('PUT /api/nutrition/settings', () => {
  it('changement de niveau : cible profile_change, ajustement conservé', async () => {
    const u = await member({ cumulative: -100 });
    const res = await put(u.cookie, { activity_level: 3 });
    expect(res.status).toBe(200);
    const state = (await res.json()) as { settings: { activity_level: number }; target: { reason: string } };
    expect(state.settings.activity_level).toBe(3);
    expect(state.target.reason).toBe('profile_change');
    expect(await profileOf(u.id)).toMatchObject({ activityLevel: 3, cumulativeAdjustmentKcal: -100 });
    const all = await targets();
    expect(all).toHaveLength(2);
    expect(JSON.parse(all.at(-1)?.inputs ?? '{}')).toMatchObject({ cumulative_adjustment_kcal: -100 });
  });

  it("changement d'objectif : ajustement remis à 0", async () => {
    const u = await member({ cumulative: -100 });
    const res = await put(u.cookie, { goal: 'gain' });
    expect(res.status).toBe(200);
    expect(await profileOf(u.id)).toMatchObject({ goal: 'gain', cumulativeAdjustmentKcal: 0 });
    expect(JSON.parse((await targets()).at(-1)?.inputs ?? '{}')).toMatchObject({
      cumulative_adjustment_kcal: 0,
    });
  });

  it('goal = lose pendant la pause de sécurité : 422 goal_not_allowed', async () => {
    const u = await member();
    await ctx.deps.db.updateTable('nutritionProfile').set({ safetyPause: 1 }).execute();
    const res = await put(u.cookie, { goal: 'lose' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'goal_not_allowed' });
    expect((await preview(u.cookie, { goal: 'lose' })).status).toBe(422);
    expect(await targets()).toHaveLength(1);
  });

  it('goal = lose avec un IMC < 18,5 : 422 goal_not_allowed', async () => {
    const u = await member({}, 50_000);
    const res = await put(u.cookie, { goal: 'lose' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'goal_not_allowed' });
  });

  it('409 weigh_in_required sans pesée récente, rien écrit', async () => {
    ctx = await createTestContext({ now: NOW });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    await seedTarget(ctx, u.id, { validFrom: '2026-10-01' });
    const res = await put(u.cookie, { activity_level: 3 });
    expect(res.status).toBe(409);
    expect(await targets()).toHaveLength(1);
    expect(await profileOf(u.id)).toMatchObject({ activityLevel: 2 });
  });
});
