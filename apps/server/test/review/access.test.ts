import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, createUser, login, type TestContext } from '../support';
import { sheetFixture } from '../support/catalog';
import { seedSheet } from '../support/review';
import { fillPath, listRoutes } from '../support/routes';

// Plancher : liste, détail, commentaire, résolution, validation (spec brique 2 §3.9).
const MIN_REVIEW_ROUTES = 5;

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup() {
  ctx = await createTestContext();
  await seedSheet(ctx, sheetFixture('goblet-squat'));
  const member = await createUser(ctx, { username: 'lea' });
  const reviewer = await createUser(ctx, { username: 'zoe', catalogReviewer: true });
  const health = await createUser(ctx, {
    username: 'hana',
    catalogReviewer: true,
    healthProfessional: true,
  });
  return {
    member: await login(ctx, 'lea', member.password),
    reviewer: await login(ctx, 'zoe', reviewer.password),
    health: await login(ctx, 'hana', health.password),
    reviewerId: reviewer.id,
  };
}

const call = (route: { method: string; path: string }, cookie?: string) =>
  ctx.request(fillPath(route.path, 'goblet-squat'), {
    method: route.method,
    ...(cookie ? { cookie } : {}),
    ...(route.method === 'GET' ? {} : { json: {} }),
  });

describe('droits sur /api/review/* et /api/admin/*, par énumération (spec brique 2 §7, critère 1)', () => {
  it('sans session : 401 ; membre : 403 ; relectrice et relectrice santé : accès à la relecture', async () => {
    const cookies = await setup();
    const review = listRoutes(ctx.app).filter(
      (r) => r.path.startsWith('/api/review/') && !r.path.startsWith('/api/review/advice'),
    );
    expect(review.length).toBeGreaterThanOrEqual(MIN_REVIEW_ROUTES);
    for (const r of review) {
      const label = `${r.method} ${r.path}`;
      const none = await call(r);
      expect(none.status, label).toBe(401);
      expect(await none.json(), label).toEqual({ error: 'unauthenticated' });
      const member = await call(r, cookies.member);
      expect(member.status, label).toBe(403);
      expect(await member.json(), label).toEqual({ error: 'forbidden' });
      for (const cookie of [cookies.reviewer, cookies.health]) {
        const res = await call(r, cookie);
        expect([401, 403], label).not.toContain(res.status);
      }
    }
  });

  it("une relectrice reçoit 403 sur chaque route de l'administration, comme un membre", async () => {
    const cookies = await setup();
    const admin = listRoutes(ctx.app).filter(
      (r) => r.path.startsWith('/api/admin/') || r.path.startsWith('/api/review/advice'),
    );
    expect(admin.length).toBeGreaterThan(0);
    for (const r of admin) {
      for (const cookie of [cookies.member, cookies.reviewer, cookies.health]) {
        const res = await call(r, cookie);
        expect(res.status, `${r.method} ${r.path}`).toBe(403);
      }
    }
  });

  it('retirer le drapeau de relecteur coupe la liste dès la requête suivante (Review Focus 4)', async () => {
    const { reviewer, reviewerId } = await setup();
    expect((await ctx.request('/api/review/exercises', { cookie: reviewer })).status).toBe(200);
    await ctx.deps.db.updateTable('user').set({ catalogReviewer: 0 }).where('id', '=', reviewerId).execute();
    const denied = await ctx.request('/api/review/exercises', { cookie: reviewer });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'forbidden' });
  });
});
