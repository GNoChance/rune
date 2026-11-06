import { afterEach, describe, expect, it } from 'vitest';
import { seedOrMergeAdviceSheets } from '../../src/nutrition/advice-loader';
import { createTestContext, createUser, createUserAndLogin, login, type TestContext } from '../support';
import { adviceFile } from './advice-fixtures';

let ctx: TestContext;
afterEach(() => ctx?.close());

const NOW = '2026-11-09T09:00:00.000Z';

async function boot(files = [adviceFile('a')]) {
  ctx = await createTestContext({ now: NOW });
  await ctx.deps.db.transaction().execute((trx) => seedOrMergeAdviceSheets(trx, files, NOW));
  const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
  return { adminCookie: await login(ctx, 'porteur', admin.password), admin };
}
const call = (
  cookie: string,
  path: string,
  method = 'GET',
  json: unknown = method === 'GET' ? undefined : {},
) => ctx.request(`/api/review/advice${path}`, { method, cookie, ...(json !== undefined ? { json } : {}) });

describe('relecture des fiches conseils', () => {
  it('relectrice non admin : 403 partout', async () => {
    await boot();
    const rev = await createUserAndLogin(ctx, { catalogReviewer: true });
    for (const [path, method] of [
      ['', 'GET'],
      ['/a', 'GET'],
      ['/a', 'PUT'],
      ['/a/review', 'POST'],
      ['/a/publish', 'POST'],
      ['/a/retire', 'POST'],
    ] as const) {
      expect((await call(rev.cookie, path, method, method === 'GET' ? undefined : {})).status).toBe(403);
    }
  });

  it('liste, lit, et 404 pour une fiche inconnue', async () => {
    const { adminCookie } = await boot([adviceFile('a'), adviceFile('b')]);
    const list = (await (await call(adminCookie, '')).json()) as { id: string; status: string }[];
    expect(list.map((s) => [s.id, s.status])).toEqual([
      ['a', 'draft'],
      ['b', 'draft'],
    ]);
    expect(await (await call(adminCookie, '/a')).json()).toMatchObject({
      id: 'a',
      sources: [{ url: 'https://example.org/source' }],
    });
    expect((await call(adminCookie, '/zz')).status).toBe(404);
  });

  it('cycle complet : review, publish, retire, avec dates et relectrice', async () => {
    const { adminCookie, admin } = await boot();
    const reviewed = await (await call(adminCookie, '/a/review', 'POST')).json();
    expect(reviewed).toMatchObject({ status: 'reviewed', reviewed_by: admin.id, reviewed_at: NOW });
    const published = await (await call(adminCookie, '/a/publish', 'POST')).json();
    expect(published).toMatchObject({ status: 'published', published_at: NOW });
    const retired = await (await call(adminCookie, '/a/retire', 'POST')).json();
    expect(retired).toMatchObject({ status: 'retired', retired_at: NOW });
  });

  it('mauvais statut de départ : 409', async () => {
    const { adminCookie } = await boot();
    expect((await call(adminCookie, '/a/publish', 'POST')).status).toBe(409);
    expect((await call(adminCookie, '/a/retire', 'POST')).status).toBe(409);
  });

  it('review refusé en 422 avec les issues du contrôle', async () => {
    const { adminCookie } = await boot([adviceFile('a', { sources: [] })]);
    const res = await call(adminCookie, '/a/review', 'POST');
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: 'transition_blocked',
      issues: [{ code: 'no_source' }],
    });
    const row = await ctx.deps.db.selectFrom('adviceSheet').selectAll().executeTakeFirstOrThrow();
    expect(row.status).toBe('draft');
  });

  it('publish refait le contrôle', async () => {
    const { adminCookie } = await boot();
    await call(adminCookie, '/a/review', 'POST');
    await ctx.deps.db.updateTable('adviceSheet').set({ sources: '[]' }).execute();
    const res = await call(adminCookie, '/a/publish', 'POST');
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ issues: [{ code: 'no_source' }] });
  });

  it('modifier le texte remet en draft, version + 1 ; le contrôle revient à la relecture', async () => {
    const { adminCookie } = await boot();
    await call(adminCookie, '/a/review', 'POST');
    const res = await call(adminCookie, '/a', 'PUT', { title: 'Autre', body_md: 'Un texte revu.' });
    expect(await res.json()).toMatchObject({
      status: 'draft',
      version: 2,
      title: 'Autre',
      body_md: 'Un texte revu.',
      reviewed_at: null,
    });
    expect((await call(adminCookie, '/a', 'PUT', { title: '', body_md: 'x' })).status).toBe(400);
    const numbers = await call(adminCookie, '/a', 'PUT', {
      title: 'T',
      body_md: 'Mange 150 g de protéines par jour.',
    });
    expect(numbers.status).toBe(200);
    expect((await call(adminCookie, '/a/review', 'POST')).status).toBe(422);
  });
});
