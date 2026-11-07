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

let ctx: TestContext;
afterEach(() => ctx?.close());

const NOW = '2026-11-09T09:00:00.000Z';
type Pulled = { entity: string; rev: number; row: Record<string, unknown> };
type Rows = Record<'weigh_in' | 'nutrition_target' | 'nutrition_checkin' | 'nutrition_profile', Pulled[]>;
/** Les trois tables vides ; le profil, s'il est servi, est celui de la session. */
const onlyOwnProfile = (body: Rows, userId: string) => {
  expect({ ...body, nutrition_profile: [] }).toEqual({
    weigh_in: [],
    nutrition_target: [],
    nutrition_checkin: [],
    nutrition_profile: [],
  });
  for (const r of body.nutrition_profile) expect(r.row.id).toBe(userId);
};
const rows = (cookie: string) => ctx.request('/api/nutrition/rows', { cookie });

describe('GET /api/nutrition/rows', () => {
  it('session exigée', async () => {
    ctx = await createTestContext({ now: NOW });
    expect((await ctx.request('/api/nutrition/rows')).status).toBe(401);
  });

  it('en mode complet : les lignes vivantes des trois tables et le profil entier, décodés', async () => {
    ctx = await createTestContext({ now: NOW });
    const u = await createUserAndLogin(ctx);
    await fullMember(ctx, u.id);
    await seedTarget(ctx, u.id, { validFrom: '2026-11-03' });
    await seedWeighIns(ctx, u.id, [['2026-11-03', 80_000]]);
    await insertFixtureRow(ctx.deps.db, 'weigh_in', {
      ownerId: u.id,
      date: null,
      weightG: null,
      deletedAt: NOW,
    });
    await insertFixtureRow(ctx.deps.db, 'nutrition_checkin', { ownerId: u.id, weekStart: '2026-11-02' });
    const res = await rows(u.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Rows;
    expect(body.weigh_in).toHaveLength(1);
    expect(body.weigh_in[0]).toMatchObject({
      entity: 'weigh_in',
      row: { date: '2026-11-03', weightG: 80_000 },
    });
    expect(body.nutrition_target).toHaveLength(1);
    expect(body.nutrition_target[0]?.row.appliedRules).toEqual([]);
    expect(body.nutrition_target[0]?.row.inputs).toMatchObject({ ref_weight_g: 80_000 });
    expect(body.nutrition_checkin).toHaveLength(1);
    expect(body.nutrition_checkin[0]?.row.representative).toBe(true);
    // Le profil revient avec ses colonnes C2 : après une fermeture puis réouverture du mode complet, le pull ne les
    // renverrait pas seul (rev inchangé).
    expect(body.nutrition_profile).toHaveLength(1);
    expect(body.nutrition_profile[0]).toMatchObject({
      entity: 'nutrition_profile',
      row: { id: u.id, mode: 'full', heightCm: 180, goal: 'maintain', safetyPause: false },
    });
  });

  it('hors mode complet : listes vides', async () => {
    ctx = await createTestContext({ now: NOW });
    const u = await createUserAndLogin(ctx);
    await insertFixtureRow(ctx.deps.db, 'nutrition_profile', { ownerId: u.id, mode: 'qualitative' });
    await seedTarget(ctx, u.id, { validFrom: '2026-11-03' });
    await seedWeighIns(ctx, u.id, [['2026-11-03', 80_000]]);
    const body = (await (await rows(u.cookie)).json()) as Rows;
    expect(body).toEqual({
      weigh_in: [],
      nutrition_target: [],
      nutrition_checkin: [],
      nutrition_profile: [],
    });
  });

  it("jamais les lignes d'autrui, admin compris", async () => {
    ctx = await createTestContext({ now: NOW });
    const a = await createUserAndLogin(ctx);
    await fullMember(ctx, a.id);
    await seedTarget(ctx, a.id, { validFrom: '2026-11-03' });
    await seedWeighIns(ctx, a.id, [['2026-11-03', 80_000]]);
    await insertFixtureRow(ctx.deps.db, 'nutrition_checkin', { ownerId: a.id, weekStart: '2026-11-02' });

    const b = await createUserAndLogin(ctx);
    await insertFixtureRow(ctx.deps.db, 'consent_event', { ownerId: b.id, type: 'health', action: 'grant' });
    await insertFixtureRow(ctx.deps.db, 'nutrition_profile', {
      ownerId: b.id,
      mode: 'full',
      safetyScreenVersion: 1,
    });
    onlyOwnProfile((await (await rows(b.cookie)).json()) as Rows, b.id);

    const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
    const adminCookie = await login(ctx, 'porteur', admin.password);
    await insertFixtureRow(ctx.deps.db, 'consent_event', {
      ownerId: admin.id,
      type: 'health',
      action: 'grant',
    });
    await insertFixtureRow(ctx.deps.db, 'nutrition_profile', {
      ownerId: admin.id,
      mode: 'full',
      safetyScreenVersion: 1,
    });
    onlyOwnProfile((await (await rows(adminCookie)).json()) as Rows, admin.id);
  });
});
