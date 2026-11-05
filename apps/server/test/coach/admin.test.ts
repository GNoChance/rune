import type { CoachAdminView, CoachReportDetail, CoachReportSummary } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLogger,
  createTestContext,
  createUser,
  insertFixtureRow,
  login,
  type TestContext,
} from '../support';

/*
 * Administration du coach (spec brique 4 §17) : coûts du mois de Paris sans aucun nombre de messages, état,
 * relance, signalements lisibles (seule donnée C3 de l'admin, P-ADM-1) et classés.
 */

let ctx: TestContext;
let lines: string[];
afterEach(() => ctx?.close());

async function setup(now = '2026-11-05T10:00:00.000Z') {
  lines = [];
  ctx = await createTestContext({ now, deps: { logger: createLogger((l) => lines.push(l)) } });
  const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
  const adminCookie = await login(ctx, 'porteur', admin.password);
  return { admin, adminCookie };
}

const call = (cookie: string, path: string, method = 'GET', json?: unknown) =>
  ctx.request(`/api/admin/coach${path}`, { method, cookie, ...(json === undefined ? {} : { json }) });
const events = (type: string) =>
  ctx.deps.db.selectFrom('securityEvent').selectAll().where('type', '=', type).execute();
const viewOf = async (cookie: string) => (await (await call(cookie, '')).json()) as CoachAdminView;

describe('GET /api/admin/coach', () => {
  it('coûts du mois de Paris par membre, total, limites, compteurs, signalements ouverts', async () => {
    const { adminCookie } = await setup();
    const lea = await createUser(ctx, { username: 'lea' });
    const paul = await createUser(ctx, { username: 'paul' });
    const db = ctx.deps.db;
    await insertFixtureRow(db, 'coach_call', { userId: lea.id, day: '2026-11-02', costUsdMicros: 1_234_000 });
    await insertFixtureRow(db, 'coach_call', { userId: lea.id, day: '2026-11-04', costUsdMicros: 500_000 });
    await insertFixtureRow(db, 'coach_call', {
      userId: paul.id,
      day: '2026-10-31',
      costUsdMicros: 9_000_000,
    });
    await insertFixtureRow(db, 'coach_call', { userId: paul.id, day: '2026-11-03', costUsdMicros: 10_000 });
    await insertFixtureRow(db, 'coach_safety_counter', { month: '2026-11', kind: 'refusal', count: 3 });
    await insertFixtureRow(db, 'coach_safety_counter', { month: '2025-12', kind: 'refusal', count: 4 });
    await insertFixtureRow(db, 'coach_safety_counter', { month: '2025-11', kind: 'refusal', count: 5 });
    await insertFixtureRow(db, 'coach_report', { userId: lea.id });

    const res = await call(adminCookie, '');
    expect(res.status).toBe(200);
    const view = (await res.json()) as CoachAdminView;
    expect(view.month).toBe('2026-11');
    expect(view.totalUsd).toBe(1.74);
    expect(view.workspaceLimitUsd).toBe(20);
    expect(view.members).toEqual([
      { username: 'lea', costUsd: 1.73, budgetUsd: 3 },
      { username: 'paul', costUsd: 0.01, budgetUsd: 3 },
      { username: 'porteur', costUsd: 0, budgetUsd: 3 },
    ]);
    expect(view.counters).toEqual([
      { month: '2025-12', kind: 'refusal', count: 4 },
      { month: '2026-11', kind: 'refusal', count: 3 },
    ]);
    expect(view.openReports).toBe(1);
    expect(view.state).toMatchObject({ enabled: false, suspendedUntil: null, catalogChanged: false });
    // Aucun nombre de messages par personne, aucun contenu.
    expect(JSON.stringify(view)).not.toMatch(/message/i);
  });

  it("le mois de Paris change à minuit de Paris, en heure d'hiver comme en heure d'été", async () => {
    const cases = [
      // minuit du 1er novembre à Paris = 23:00 UTC le 31 octobre (UTC+1)
      ['2026-10-31T22:59:59.000Z', '2026-10'],
      ['2026-10-31T23:00:00.000Z', '2026-11'],
      // minuit du 1er juin à Paris = 22:00 UTC le 31 mai (UTC+2)
      ['2026-05-31T21:59:59.000Z', '2026-05'],
      ['2026-05-31T22:00:00.000Z', '2026-06'],
    ] as const;
    for (const [now, month] of cases) {
      const { adminCookie } = await setup(now);
      const u = await createUser(ctx, { username: 'lea' });
      const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 0));
      const lastMonth = last.toISOString().slice(0, 7);
      await insertFixtureRow(ctx.deps.db, 'coach_call', {
        userId: u.id,
        day: `${lastMonth}-${String(last.getUTCDate()).padStart(2, '0')}`,
        costUsdMicros: 1_000_000,
      });
      await insertFixtureRow(ctx.deps.db, 'coach_call', {
        userId: u.id,
        day: `${month}-01`,
        costUsdMicros: 2_000_000,
      });
      const view = await viewOf(adminCookie);
      expect(view.month, now).toBe(month);
      expect(view.totalUsd, now).toBe(2);
      ctx.close();
    }
  });
});

describe('état et relance', () => {
  it('PUT /state {enabled: true} sans évaluation : toujours non configuré, événement écrit', async () => {
    const { admin, adminCookie } = await setup();
    const res = await call(adminCookie, '/state', 'PUT', { enabled: true });
    expect(res.status).toBe(204);
    const view = await viewOf(adminCookie);
    expect(view.state).toMatchObject({ enabled: true, configured: false });
    expect(view.state.notConfiguredCause).not.toBeNull();
    const logged = await events('coach_state_changed');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ actorId: admin.id });
    expect(JSON.parse(logged[0]?.details ?? 'null')).toEqual({ enabled: true });
    expect(ctx.deps.coach.configured.ok).toBe(false);
  });

  it('PUT /state avec un corps invalide : 400', async () => {
    const { adminCookie } = await setup();
    expect((await call(adminCookie, '/state', 'PUT', { enabled: 'oui' })).status).toBe(400);
  });

  it('POST /resume : suspendedUntil à NULL', async () => {
    const { adminCookie } = await setup();
    await ctx.deps.db
      .updateTable('coachState')
      .set({ suspendedUntil: '2026-12-01T23:00:00.000Z' })
      .where('id', '=', 1)
      .execute();
    expect((await viewOf(adminCookie)).state.suspendedUntil).toBe('2026-12-01T23:00:00.000Z');
    expect((await call(adminCookie, '/resume', 'POST', {})).status).toBe(204);
    expect((await viewOf(adminCookie)).state.suspendedUntil).toBeNull();
    expect(await events('coach_state_changed')).toHaveLength(1);
  });

  it('un membre reçoit 403 sur chaque route', async () => {
    await setup();
    const m = await createUser(ctx, { username: 'lea' });
    const cookie = await login(ctx, 'lea', m.password);
    for (const [path, method] of [
      ['', 'GET'],
      ['/state', 'PUT'],
      ['/resume', 'POST'],
      ['/reports', 'GET'],
      ['/reports/x', 'GET'],
      ['/reports/x', 'DELETE'],
    ] as const) {
      expect((await call(cookie, path, method, method === 'GET' ? undefined : {})).status, path).toBe(403);
    }
  });
});

describe('signalements', () => {
  async function withReport(minor = false) {
    const base = await setup();
    const lea = await createUser(ctx, { username: 'lea', ...(minor ? { birthDate: '2010-01-01' } : {}) });
    const row = await insertFixtureRow(ctx.deps.db, 'coach_report', {
      userId: lea.id,
      threadId: 'fil-supprime',
      category: 'unsafe',
      comment: 'Dangereux',
      exchangeText: 'Toi : A\n\nCoach IA : B',
      createdAt: '2026-11-04T08:00:00.000Z',
    });
    return { ...base, lea, id: row.id as string };
  }

  it('liste : date, catégorie, pseudo, mineur ou non', async () => {
    const { adminCookie, id } = await withReport(true);
    const list = (await (await call(adminCookie, '/reports')).json()) as CoachReportSummary[];
    expect(list).toEqual([
      { id, createdAt: '2026-11-04T08:00:00.000Z', category: 'unsafe', username: 'lea', minor: true },
    ]);
  });

  it("détail lisible même si le fil est supprimé ou n'est plus lié", async () => {
    const { adminCookie, id } = await withReport();
    const res = await call(adminCookie, `/reports/${id}`);
    expect(res.status).toBe(200);
    expect((await res.json()) as CoachReportDetail).toEqual({
      id,
      createdAt: '2026-11-04T08:00:00.000Z',
      category: 'unsafe',
      username: 'lea',
      minor: false,
      exchangeText: 'Toi : A\n\nCoach IA : B',
      comment: 'Dangereux',
    });
    await ctx.deps.db.updateTable('coachReport').set({ threadId: null }).execute();
    expect((await call(adminCookie, `/reports/${id}`)).status).toBe(200);
  });

  it('signalement inconnu : 404', async () => {
    const { adminCookie } = await withReport();
    expect((await call(adminCookie, '/reports/absent')).status).toBe(404);
    expect((await call(adminCookie, '/reports/absent', 'DELETE')).status).toBe(404);
  });

  it('DELETE : ligne supprimée, coach_report_classified sans contenu', async () => {
    const { admin, adminCookie, id } = await withReport();
    expect((await call(adminCookie, `/reports/${id}`, 'DELETE')).status).toBe(204);
    expect(await ctx.deps.db.selectFrom('coachReport').select('id').execute()).toEqual([]);
    const logged = await events('coach_report_classified');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ actorId: admin.id, details: null });
    expect(JSON.stringify(logged) + lines.join('\n')).not.toMatch(/Dangereux|Coach IA|lea/);
  });
});
