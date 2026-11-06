import { afterEach, describe, expect, it } from 'vitest';
import { withdrawHealthConsent } from '../../src/privacy/consent';
import { deleteAccount } from '../../src/privacy/delete-account';
import { fullMember, seedTarget, seedWeighIns } from '../nutrition/fixtures';
import { createTestContext, createUser, insertFixtureRow, type TestContext } from '../support';

/* Retrait de l'accord santé et suppression du compte, côté nutrition (spec brique 5 §6.5, 09 §8). */

let ctx: TestContext;
afterEach(() => ctx?.close());

async function seed(userId: string) {
  await fullMember(ctx, userId, { cumulative: -200, goal: 'lose' });
  await ctx.deps.db
    .updateTable('nutritionProfile')
    .set({ safetyPause: 1 })
    .where('ownerId', '=', userId)
    .execute();
  const target = (await seedTarget(ctx, userId, { validFrom: '2026-11-02' })) as { id: string };
  await seedWeighIns(ctx, userId, [['2026-11-07', 80_000]]);
  await insertFixtureRow(ctx.deps.db, 'nutrition_checkin', {
    ownerId: userId,
    weekStart: '2026-11-02',
    meanWeightG: 80_000,
    createdTargetId: target.id,
    recalibrationTargetId: target.id,
  });
}

const withdraw = (userId: string) =>
  ctx.deps.db
    .transaction()
    .execute((trx) => withdrawHealthConsent(trx, ctx.deps, userId, { actorId: userId, ip: null }));

const SYNC_ONLY = ['id', 'ownerId', 'rev', 'createdAt', 'updatedAt', 'updatedBy', 'deletedAt'];

describe('retrait du consentement santé et nutrition', () => {
  it('trois tables en tombstones sans contenu, profil neutralisé, revs neufs', async () => {
    ctx = await createTestContext({ now: '2026-11-09T09:00:00.000Z' });
    const u = await createUser(ctx);
    await seed(u.id);
    await ctx.deps.db
      .updateTable('nutritionProfile')
      .set({ modeReason: 'safety', mode: 'qualitative' })
      .execute();
    const before = await ctx.deps.db.selectFrom('nutritionProfile').selectAll().executeTakeFirstOrThrow();
    const meta = await ctx.deps.db.selectFrom('serverMeta').select('syncCounter').executeTakeFirstOrThrow();

    await withdraw(u.id);

    for (const table of ['weighIn', 'nutritionTarget', 'nutritionCheckin'] as const) {
      const [row, ...rest] = await ctx.deps.db
        .selectFrom(table)
        .selectAll()
        .where('ownerId', '=', u.id)
        .execute();
      expect(rest).toHaveLength(0);
      expect(row?.deletedAt).not.toBeNull();
      expect(row?.rev).toBeGreaterThan(meta.syncCounter);
      const content = Object.entries(row ?? {}).filter(([k, v]) => !SYNC_ONLY.includes(k) && v !== null);
      expect(content).toEqual([]);
    }
    const profile = await ctx.deps.db.selectFrom('nutritionProfile').selectAll().executeTakeFirstOrThrow();
    expect(profile).toMatchObject({
      deletedAt: null,
      mode: 'disabled',
      modeReason: null,
      safetyScreenVersion: null,
      safetyScreenAt: null,
      safetyPause: 0,
      sexForCalc: null,
      heightCm: null,
      activityLevel: null,
      goal: null,
      cumulativeAdjustmentKcal: 0,
    });
    expect(profile.rev).toBeGreaterThan(before.rev);
  });

  it('un motif de choix reste', async () => {
    ctx = await createTestContext();
    const u = await createUser(ctx);
    await seed(u.id);
    await withdraw(u.id);
    const profile = await ctx.deps.db.selectFrom('nutritionProfile').selectAll().executeTakeFirstOrThrow();
    expect(profile.modeReason).toBe('choice');
  });

  it("n'agit pas sur un autre membre", async () => {
    ctx = await createTestContext();
    const a = await createUser(ctx, { username: 'lea' });
    const b = await createUser(ctx, { username: 'tom' });
    await seed(a.id);
    await seed(b.id);
    await withdraw(a.id);
    const theirs = await ctx.deps.db.selectFrom('weighIn').selectAll().where('ownerId', '=', b.id).execute();
    expect(theirs[0]?.deletedAt).toBeNull();
    const profile = await ctx.deps.db
      .selectFrom('nutritionProfile')
      .selectAll()
      .where('ownerId', '=', b.id)
      .executeTakeFirstOrThrow();
    expect(profile.mode).toBe('full');
  });

  it("la suppression du compte efface les quatre tables du membre et rien d'un autre", async () => {
    ctx = await createTestContext();
    const a = await createUser(ctx, { username: 'lea' });
    const b = await createUser(ctx, { username: 'tom' });
    await seed(a.id);
    await seed(b.id);
    await ctx.deps.db
      .transaction()
      .execute((trx) => deleteAccount(trx, ctx.deps, a.id, { actorId: a.id, ip: null }));
    for (const table of ['nutritionProfile', 'weighIn', 'nutritionTarget', 'nutritionCheckin'] as const) {
      const rows = await ctx.deps.db.selectFrom(table).selectAll().execute();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.ownerId === b.id)).toBe(true);
    }
  });
});
