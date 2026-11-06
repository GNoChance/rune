import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  createUser,
  createUserAndLogin,
  insertFixtureRow,
  login,
  type TestContext,
} from '../support';
import { fullMember, seedTarget, seedWeighIns } from './fixtures';

/* « Supprimer mes données nutrition » (spec brique 5 §6.5). */

let ctx: TestContext;
afterEach(() => ctx?.close());

const del = (cookie: string) => ctx.request('/api/nutrition/data', { method: 'DELETE', cookie });
const ownerRows = (table: 'weighIn' | 'nutritionTarget' | 'nutritionCheckin', id: string) =>
  ctx.deps.db.selectFrom(table).selectAll().where('ownerId', '=', id).execute();

describe('DELETE /api/nutrition/data', () => {
  it('tombstones des trois tables, colonnes C2 du profil effacées, mode inchangé', async () => {
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
      recalibrationTargetId: (target as { id: string }).id,
    });
    const before = await ctx.deps.db.selectFrom('nutritionProfile').selectAll().executeTakeFirstOrThrow();

    const res = await del(u.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ effective_mode: 'full', needs: 'setup', target: null });

    for (const table of ['weighIn', 'nutritionTarget', 'nutritionCheckin'] as const) {
      const rows = await ownerRows(table, u.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.deletedAt).not.toBeNull();
    }
    expect((await ownerRows('weighIn', u.id))[0]).toMatchObject({ date: null, weightG: null });
    expect((await ownerRows('nutritionTarget', u.id))[0]).toMatchObject({ inputs: null, kcalTarget: null });
    expect((await ownerRows('nutritionCheckin', u.id))[0]).toMatchObject({
      weekStart: null,
      meanWeightG: null,
      createdTargetId: null,
      recalibrationTargetId: null,
    });

    const p = await ctx.deps.db.selectFrom('nutritionProfile').selectAll().executeTakeFirstOrThrow();
    expect(p).toMatchObject({
      mode: 'full',
      sexForCalc: null,
      heightCm: null,
      activityLevel: null,
      goal: null,
      cumulativeAdjustmentKcal: 0,
      safetyScreenVersion: before.safetyScreenVersion,
    });
    expect(p.rev).toBeGreaterThan(before.rev);
    const consents = await ctx.deps.db
      .selectFrom('consentEvent')
      .selectAll()
      .where('ownerId', '=', u.id)
      .execute();
    expect(consents).toHaveLength(1);
  });

  it("sans profil ni donnée : 200, rien n'est créé", async () => {
    ctx = await createTestContext();
    const u = await createUserAndLogin(ctx);
    expect((await del(u.cookie)).status).toBe(200);
    expect(await ctx.deps.db.selectFrom('nutritionProfile').selectAll().execute()).toHaveLength(0);
  });

  it("ne touche pas aux données d'un autre membre, admin compris", async () => {
    ctx = await createTestContext({ now: '2026-11-09T09:00:00.000Z' });
    const a = await createUserAndLogin(ctx);
    const b = await createUserAndLogin(ctx);
    await fullMember(ctx, b.id);
    await seedTarget(ctx, b.id, { validFrom: '2026-11-02' });
    await seedWeighIns(ctx, b.id, [['2026-11-07', 80_000]]);
    expect((await del(a.cookie)).status).toBe(200);
    const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
    const adminCookie = await login(ctx, 'porteur', admin.password);
    expect((await del(adminCookie)).status).toBe(200);
    for (const table of ['weighIn', 'nutritionTarget'] as const) {
      expect((await ownerRows(table, b.id))[0]?.deletedAt).toBeNull();
    }
    expect(
      await ctx.deps.db
        .selectFrom('nutritionProfile')
        .select('heightCm')
        .where('ownerId', '=', b.id)
        .executeTakeFirst(),
    ).toEqual({ heightCm: 180 });
  });
});
