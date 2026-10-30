import { afterEach, describe, expect, it } from 'vitest';
import { requireReviewer } from '../../src/review/guard';
import { createTestContext, createUser, login, syncPull, type TestContext } from '../support';

let ctx: TestContext;
afterEach(() => ctx?.close());

const WRONG = 'faux faux faux faux';
/** Route factice sous /api/review : les vraies routes de relecture arrivent avec la tâche 8. */
const PROBE = '/api/review/probe';

const post = (path: string, cookie: string, json: unknown = {}, ip = '100.64.0.1') =>
  ctx.request(path, { method: 'POST', cookie, json, ip });
const flagsPath = (id: string) => `/api/admin/members/${id}/reviewer-flags`;
const events = (type: string) =>
  ctx.deps.db.selectFrom('securityEvent').selectAll().where('type', '=', type).execute();
const userRow = (id: string) =>
  ctx.deps.db.selectFrom('user').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const probe = (cookie?: string) => ctx.request(PROBE, cookie ? { cookie } : {});

async function setup() {
  ctx = await createTestContext();
  // Montée avant toute requête : le routeur de Hono se fige à la première.
  ctx.app.get(PROBE, requireReviewer, (c) => c.json({ ok: true }));
  const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
  const adminCookie = await login(ctx, 'porteur', admin.password);
  return { admin, adminCookie };
}

describe('POST /api/admin/members/:id/reviewer-flags', () => {
  it('coche les drapeaux : 200 MemberSummary, compte modifié, journal avant/après (spec brique 2 §3.1)', async () => {
    const { admin, adminCookie } = await setup();
    const m = await createUser(ctx, { username: 'ines' });
    const before = await userRow(m.id);
    const res = await post(flagsPath(m.id), adminCookie, {
      catalogReviewer: true,
      healthProfessional: true,
      password: admin.password,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: m.id,
      username: 'ines',
      role: 'member',
      catalogReviewer: true,
      healthProfessional: true,
    });
    const row = await userRow(m.id);
    expect(row).toMatchObject({ catalogReviewer: 1, healthProfessional: 1, updatedBy: admin.id });
    // Le compte suit dans son propre pull : rev neuf.
    expect(row.rev).toBeGreaterThan(before.rev);
    const logged = await events('reviewer_flags_changed');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ actorId: admin.id, targetId: m.id, outcome: 'success' });
    expect(JSON.parse(logged[0]?.details ?? 'null')).toEqual({
      catalogReviewerBefore: false,
      catalogReviewerAfter: true,
      healthProfessionalBefore: false,
      healthProfessionalAfter: true,
    });

    const off = await post(flagsPath(m.id), adminCookie, {
      catalogReviewer: true,
      healthProfessional: false,
      password: admin.password,
    });
    expect(await off.json()).toMatchObject({ catalogReviewer: true, healthProfessional: false });
    const second = await events('reviewer_flags_changed');
    expect(second).toHaveLength(2);
    expect(JSON.parse(second[1]?.details ?? 'null')).toEqual({
      catalogReviewerBefore: true,
      catalogReviewerAfter: true,
      healthProfessionalBefore: true,
      healthProfessionalAfter: false,
    });
  });

  it("mot de passe faux ou absent : rien n'est écrit (P-AUT-5)", async () => {
    const { adminCookie } = await setup();
    const m = await createUser(ctx, { username: 'ines' });
    const before = await userRow(m.id);
    const bad = await post(flagsPath(m.id), adminCookie, {
      catalogReviewer: true,
      healthProfessional: false,
      password: WRONG,
    });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: 'invalid_credentials' });
    const missing = await post(flagsPath(m.id), adminCookie, {
      catalogReviewer: true,
      healthProfessional: false,
    });
    expect(missing.status).toBe(400);
    expect(await userRow(m.id)).toEqual(before);
    expect(await events('reviewer_flags_changed')).toHaveLength(0);
  });

  it("l'admin ne coche pas le drapeau santé sur son propre compte : 403 self_health_flag", async () => {
    const { admin, adminCookie } = await setup();
    const before = await userRow(admin.id);
    for (const catalogReviewer of [true, false]) {
      const res = await post(flagsPath(admin.id), adminCookie, {
        catalogReviewer,
        healthProfessional: true,
        password: admin.password,
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'self_health_flag' });
    }
    expect(await userRow(admin.id)).toEqual(before);
    expect(await events('reviewer_flags_changed')).toHaveLength(0);
    // Son propre drapeau de relecteur reste permis (sans effet : l'admin relit déjà).
    const own = await post(flagsPath(admin.id), adminCookie, {
      catalogReviewer: true,
      healthProfessional: false,
      password: admin.password,
    });
    expect(own.status).toBe(200);
  });

  it('drapeau santé sur un autre admin : accepté, mais il ne fait pas de lui un relecteur santé', async () => {
    const { admin, adminCookie } = await setup();
    const other = await createUser(ctx, { username: 'second', role: 'admin' });
    const res = await post(flagsPath(other.id), adminCookie, {
      catalogReviewer: true,
      healthProfessional: true,
      password: admin.password,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      role: 'admin',
      catalogReviewer: true,
      healthProfessional: true,
    });
  });

  it('mêmes valeurs : 200 sans écriture ni journal', async () => {
    const { admin, adminCookie } = await setup();
    const m = await createUser(ctx, { username: 'ines', catalogReviewer: true });
    const before = await userRow(m.id);
    const res = await post(flagsPath(m.id), adminCookie, {
      catalogReviewer: true,
      healthProfessional: false,
      password: admin.password,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ catalogReviewer: true, healthProfessional: false });
    expect(await userRow(m.id)).toEqual(before);
    expect(await events('reviewer_flags_changed')).toHaveLength(0);
  });

  it('membre inconnu : 404 ; corps invalide : 400 ; relectrice ou membre : 403', async () => {
    const { admin, adminCookie } = await setup();
    const unknown = await post(flagsPath('inconnu'), adminCookie, {
      catalogReviewer: true,
      healthProfessional: false,
      password: admin.password,
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'not_found' });
    const m = await createUser(ctx, { username: 'ines' });
    const invalid = await post(flagsPath(m.id), adminCookie, {
      catalogReviewer: 1,
      healthProfessional: false,
      password: admin.password,
    });
    expect(invalid.status).toBe(400);
    const reviewer = await createUser(ctx, {
      username: 'zoe',
      catalogReviewer: true,
      healthProfessional: true,
    });
    const cookie = await login(ctx, 'zoe', reviewer.password, '100.64.0.2');
    const denied = await post(
      flagsPath(m.id),
      cookie,
      { catalogReviewer: true, healthProfessional: true, password: reviewer.password },
      '100.64.0.2',
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'forbidden' });
    expect((await userRow(m.id)).catalogReviewer).toBe(0);
  });
});

describe('garde de la relecture (requireReviewer)', () => {
  it('sans session : 401 ; membre : 403 ; relectrice et admin : accès', async () => {
    const { adminCookie } = await setup();
    const none = await probe();
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: 'unauthenticated' });
    const m = await createUser(ctx, { username: 'lea' });
    const member = await probe(await login(ctx, 'lea', m.password));
    expect(member.status).toBe(403);
    expect(await member.json()).toEqual({ error: 'forbidden' });
    // Drapeau santé seul, sans drapeau de relecteur : pas de relecture.
    const h = await createUser(ctx, { username: 'hugo', healthProfessional: true });
    expect((await probe(await login(ctx, 'hugo', h.password))).status).toBe(403);
    const r = await createUser(ctx, { username: 'zoe', catalogReviewer: true });
    expect((await probe(await login(ctx, 'zoe', r.password))).status).toBe(200);
    expect((await probe(adminCookie)).status).toBe(200);
  });

  it("retirer le drapeau coupe l'accès dès la requête suivante, sans nouvelle connexion (Review Focus 4)", async () => {
    const { admin, adminCookie } = await setup();
    const r = await createUser(ctx, { username: 'zoe', catalogReviewer: true });
    const cookie = await login(ctx, 'zoe', r.password, '100.64.0.2');
    expect((await probe(cookie)).status).toBe(200);
    const off = await post(flagsPath(r.id), adminCookie, {
      catalogReviewer: false,
      healthProfessional: false,
      password: admin.password,
    });
    expect(off.status).toBe(200);
    const denied = await probe(cookie);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'forbidden' });
    // La session elle-même reste ouverte : le reste de l'appli répond.
    expect((await ctx.request('/api/me', { cookie })).status).toBe(200);
  });

  it("rétrograder un admin coupe l'accès dès la requête suivante (spec brique 2 §7, critère 1)", async () => {
    const { admin, adminCookie } = await setup();
    const b = await createUser(ctx, { username: 'second', role: 'admin', password: 'quatorze carac' });
    const cookie = await login(ctx, 'second', b.password, '100.64.0.2');
    expect((await probe(cookie)).status).toBe(200);
    const demoted = await post(`/api/admin/members/${b.id}/role`, adminCookie, {
      role: 'member',
      password: admin.password,
    });
    expect(demoted.status).toBe(204);
    expect((await probe(cookie)).status).toBe(403);
  });
});

describe('visibilité des drapeaux (spec brique 2 §3.1)', () => {
  it("/api/me porte les drapeaux du compte courant, jamais ceux d'un autre", async () => {
    const { admin, adminCookie } = await setup();
    const r = await createUser(ctx, { username: 'zoe' });
    const m = await createUser(ctx, { username: 'lea' });
    await post(flagsPath(r.id), adminCookie, {
      catalogReviewer: true,
      healthProfessional: true,
      password: admin.password,
    });
    const rCookie = await login(ctx, 'zoe', r.password, '100.64.0.2');
    const mine = await (await ctx.request('/api/me', { cookie: rCookie })).json();
    expect(mine).toMatchObject({ id: r.id, catalogReviewer: true, healthProfessional: true });
    const mCookie = await login(ctx, 'lea', m.password, '100.64.0.3');
    const other = await ctx.request('/api/me', { cookie: mCookie });
    const text = await other.text();
    expect(JSON.parse(text)).toMatchObject({ id: m.id, catalogReviewer: false, healthProfessional: false });
    expect(text).not.toContain(r.id);
    // L'admin reçoit aussi ses propres drapeaux (bruts) : le rôle fait de lui un relecteur.
    expect(await (await ctx.request('/api/me', { cookie: adminCookie })).json()).toMatchObject({
      role: 'admin',
      catalogReviewer: false,
      healthProfessional: false,
    });
  });

  it("les drapeaux d'un autre ne sortent que par /api/admin/members", async () => {
    const { admin, adminCookie } = await setup();
    const r = await createUser(ctx, { username: 'zoe' });
    const m = await createUser(ctx, { username: 'lea' });
    await post(flagsPath(r.id), adminCookie, {
      catalogReviewer: true,
      healthProfessional: true,
      password: admin.password,
    });
    const list = (await (await ctx.request('/api/admin/members', { cookie: adminCookie })).json()) as {
      username: string;
      catalogReviewer: boolean;
      healthProfessional: boolean;
    }[];
    expect(list.map((x) => [x.username, x.catalogReviewer, x.healthProfessional])).toEqual([
      ['lea', false, false],
      ['porteur', false, false],
      ['zoe', true, true],
    ]);
    // Ni une relectrice, ni un membre n'ont accès à la liste.
    const rCookie = await login(ctx, 'zoe', r.password, '100.64.0.2');
    expect((await ctx.request('/api/admin/members', { cookie: rCookie })).status).toBe(403);
    const mCookie = await login(ctx, 'lea', m.password, '100.64.0.3');
    expect((await ctx.request('/api/admin/members', { cookie: mCookie })).status).toBe(403);
    // Le pull d'un autre membre ne contient pas le compte de la relectrice.
    const pulled = await syncPull(ctx, mCookie);
    expect(pulled.status).toBe(200);
    expect(JSON.stringify(pulled.body)).not.toContain(r.id);
  });
});
