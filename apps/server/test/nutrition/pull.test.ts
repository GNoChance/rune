import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  createUserAndLogin,
  insertFixtureRow,
  syncPull,
  type TestContext,
} from '../support';
import { fullMember, seedTarget, seedWeighIns } from './fixtures';

/* Pull filtré par le mode effectif (spec brique 5 §6.4). */

let ctx: TestContext;
afterEach(() => ctx?.close());

type Pulled = { entity: string; row: Record<string, unknown> };
const NUTRITION_TABLES = ['weigh_in', 'nutrition_target', 'nutrition_checkin'];

async function seed() {
  ctx = await createTestContext({ now: '2026-11-09T09:00:00.000Z' });
  const u = await createUserAndLogin(ctx);
  await fullMember(ctx, u.id, { cumulative: -100 });
  const target = await seedTarget(ctx, u.id, { validFrom: '2026-11-02' });
  await seedWeighIns(ctx, u.id, [['2026-11-07', 80_000]]);
  await insertFixtureRow(ctx.deps.db, 'nutrition_checkin', {
    ownerId: u.id,
    weekStart: '2026-11-02',
    meanWeightG: 80_000,
    createdTargetId: (target as { id: string }).id,
  });
  return u;
}

describe('GET /api/sync/pull et le mode nutrition', () => {
  it('en mode complet : les trois tables, le profil entier, nutrition.effective_mode = full', async () => {
    const u = await seed();
    const res = await syncPull(ctx, u.cookie);
    const rows = res.body.rows as Pulled[];
    for (const t of NUTRITION_TABLES) expect(rows.filter((r) => r.entity === t)).toHaveLength(1);
    const profile = rows.find((r) => r.entity === 'nutrition_profile')?.row;
    expect(profile).toMatchObject({
      mode: 'full',
      heightCm: 180,
      goal: 'maintain',
      cumulativeAdjustmentKcal: -100,
    });
    expect(res.body.nutrition).toEqual({ effective_mode: 'full', cause: expect.any(String) });
  });

  it('en qualitatif : aucune ligne des trois tables, profil sans colonne C2', async () => {
    const u = await seed();
    await ctx.deps.db
      .updateTable('nutritionProfile')
      .set({ mode: 'qualitative', modeReason: 'safety' })
      .execute();
    const res = await syncPull(ctx, u.cookie);
    const rows = res.body.rows as Pulled[];
    expect(rows.filter((r) => NUTRITION_TABLES.includes(r.entity))).toHaveLength(0);
    const profile = rows.find((r) => r.entity === 'nutrition_profile')?.row as Record<string, unknown>;
    expect(profile.mode).toBe('qualitative');
    expect(profile.modeReason).toBeNull();
    for (const key of [
      'safetyScreenVersion',
      'safetyScreenAt',
      'safetyPause',
      'sexForCalc',
      'heightCm',
      'activityLevel',
      'goal',
      'cumulativeAdjustmentKcal',
    ]) {
      expect(profile).not.toHaveProperty(key);
    }
    expect(res.body.nutrition).toMatchObject({ effective_mode: 'qualitative' });
    expect(JSON.stringify(res.body)).not.toContain('80000');
  });

  it('sans accord santé : rien des trois tables, mode effectif réduit', async () => {
    const u = await seed();
    await ctx.deps.db.deleteFrom('consentEvent').execute();
    const res = await syncPull(ctx, u.cookie);
    expect((res.body.rows as Pulled[]).filter((r) => NUTRITION_TABLES.includes(r.entity))).toHaveLength(0);
    expect(res.body.nutrition.effective_mode).not.toBe('full');
  });

  it('la réponse porte nutrition même sans profil', async () => {
    ctx = await createTestContext();
    const u = await createUserAndLogin(ctx);
    const res = await syncPull(ctx, u.cookie);
    expect(res.status).toBe(200);
    expect(res.body.nutrition).toMatchObject({ effective_mode: 'disabled' });
  });

  it('deux membres en mode complet : aucune ligne nutrition de l’un chez l’autre', async () => {
    const a = await seed();
    const b = await createUserAndLogin(ctx);
    await fullMember(ctx, b.id, { heightCm: 165 });
    const bTarget = await seedTarget(ctx, b.id, { validFrom: '2026-11-03' });
    await seedWeighIns(ctx, b.id, [['2026-11-08', 61_200]]);
    await insertFixtureRow(ctx.deps.db, 'nutrition_checkin', { ownerId: b.id, weekStart: '2026-11-02' });
    for (const [me, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const res = await syncPull(ctx, me.cookie);
      const rows = res.body.rows as Pulled[];
      const nutrition = rows.filter((r) => [...NUTRITION_TABLES, 'nutrition_profile'].includes(r.entity));
      expect(nutrition.length).toBeGreaterThanOrEqual(4);
      for (const r of nutrition) expect(r.row.ownerId).toBe(me.id);
      expect(rows.some((r) => r.row.id === other.id && r.entity === 'nutrition_profile')).toBe(false);
    }
    const aRows = (await syncPull(ctx, a.cookie)).body.rows as Pulled[];
    expect(aRows.some((r) => r.row.id === (bTarget as { id: string }).id)).toBe(false);
    expect(JSON.stringify(aRows)).not.toContain('61200');
  });
});
