import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { rebuildCatalog } from '../../src/catalog/bundle';
import { CATALOG_STARTUP_TASK } from '../../src/catalog/loader';
import { getServerMeta } from '../../src/db/server-meta';
import { createTestContext, createUser, createUserAndLogin, type TestContext } from '../support';
import { retiredDraft, sheetFixture, skeletonFixture, tempDataDirs, writeDataDir } from '../support/catalog';

const REPO_DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../data');

let ctx: TestContext;
const dirs = tempDataDirs();
afterEach(() => {
  ctx?.close();
  dirs.cleanup();
});

async function setup(contentDir = REPO_DATA): Promise<string> {
  ctx = await createTestContext({ config: { contentDir } });
  await CATALOG_STARTUP_TASK.run(ctx.deps);
  const { cookie } = await createUserAndLogin(ctx);
  return cookie;
}

/** Colonnes éditoriales de 04 « Modèle de données » et `batch` : jamais servies (spec §7, critère 9 modifié). */
const EDITORIAL = [
  'review_notes',
  'drafting',
  'reviewed_by',
  'reviewed_at',
  'published_at',
  'retired_at',
  'updated_at',
  'exported_revision',
  'batch',
];

// Chaque test amorce le catalogue (tout `data/` du dépôt pour certains) : le délai par défaut (5 s) dépassait quand toute
// la suite tournait en parallèle.
describe('GET /api/catalog', { timeout: 30_000 }, () => {
  it('sans session : 401', async () => {
    ctx = await createTestContext({ config: { contentDir: REPO_DATA } });
    expect((await ctx.request('/api/catalog')).status).toBe(401);
  });

  it('avec session : 200, version, ETag et no-cache', async () => {
    const cookie = await setup();
    const res = await ctx.request('/api/catalog', { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; exercises: unknown[] };
    expect(body.version).toBe((await getServerMeta(ctx.deps.db)).catalogVersion);
    expect(body.exercises).toEqual([]);
    expect(res.headers.get('ETag')).toBe(`"${body.version}"`);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('ne sert ni draft, ni reviewed, ni brouillon retiré, ni colonne éditoriale, ni batch (critère 9)', async () => {
    const contentDir = dirs.create();
    ctx = await createTestContext({ config: { contentDir } });
    const reviewer = await createUser(ctx);
    writeDataDir(contentDir, {
      sheets: [
        skeletonFixture('draft-sheet', { review_notes: 'REPERE-BROUILLON' }),
        sheetFixture('reviewed-sheet', { status: 'reviewed', published_at: undefined }),
        sheetFixture('published-sheet', { batch: 'E7', reviewed_by: reviewer.id }),
        sheetFixture('retired-published', { status: 'retired', retired_at: '2026-10-28T08:00:00.000Z' }),
        retiredDraft(),
      ],
    });
    await CATALOG_STARTUP_TASK.run(ctx.deps);
    expect(
      await ctx.deps.db
        .selectFrom('exercise')
        .select('reviewedBy')
        .where('id', '=', 'published-sheet')
        .execute(),
    ).toEqual([{ reviewedBy: reviewer.id }]);
    const { cookie } = await createUserAndLogin(ctx);
    const res = await ctx.request('/api/catalog', { cookie });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { exercises: Record<string, unknown>[] };
    expect(body.exercises.map((s) => [s.id, s.status])).toEqual([
      ['published-sheet', 'published'],
      ['retired-published', 'retired'],
    ]);
    for (const sheet of body.exercises) for (const key of EDITORIAL) expect(sheet).not.toHaveProperty(key);
    for (const key of EDITORIAL) expect(text).not.toContain(`"${key}"`);
    const markers = [
      'REPERE-NOTES',
      'REPERE-BROUILLON',
      'REPERE-RETIRE',
      'draft-sheet',
      'reviewed-sheet',
      'retired-draft',
      'E7',
    ];
    for (const marker of [...markers, reviewer.id]) expect(text).not.toContain(marker);
  });

  it('data/ du dépôt sur base vide : chaque fiche est amorcée avec son statut, les brouillons sont dans la relecture et jamais servis', async () => {
    const dir = join(REPO_DATA, 'exercises');
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map(
        (name) =>
          JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
            id: string;
            status: string;
            published_at?: string;
          },
      )
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const drafts = files.filter((s) => s.status === 'draft').map((s) => s.id);
    const served = files
      .filter((s) => s.status === 'published' || (s.status === 'retired' && s.published_at !== undefined))
      .map((s) => s.id);

    const cookie = await setup();
    expect(await ctx.deps.db.selectFrom('exercise').select(['id', 'status']).orderBy('id').execute()).toEqual(
      files.map((s) => ({ id: s.id, status: s.status })),
    );

    const catalog = await ctx.request('/api/catalog', { cookie });
    expect(catalog.status).toBe(200);
    const body = (await catalog.json()) as { exercises: { id: string }[] };
    expect(body.exercises.map((s) => s.id)).toEqual(served);

    const reviewer = await createUserAndLogin(ctx, { catalogReviewer: true });
    const res = await ctx.request('/api/review/exercises?status=draft', { cookie: reviewer.cookie });
    expect(res.status).toBe(200);
    const list = (await res.json()) as { items: { id: string }[] };
    expect(list.items.map((i) => i.id).sort()).toEqual(drafts);
  });

  it('If-None-Match identique, faible ou dans une liste : 304 sans corps', async () => {
    const cookie = await setup();
    const etag = (await ctx.request('/api/catalog', { cookie })).headers.get('ETag') as string;
    for (const value of [etag, `W/${etag}`, `"autre", ${etag}`]) {
      const res = await ctx.request('/api/catalog', { cookie, headers: { 'If-None-Match': value } });
      expect(res.status).toBe(304);
      expect(await res.text()).toBe('');
      expect(res.headers.get('ETag')).toBe(etag);
    }
  });

  it('If-None-Match différent : 200', async () => {
    const cookie = await setup();
    const res = await ctx.request('/api/catalog', { cookie, headers: { 'If-None-Match': '"autre"' } });
    expect(res.status).toBe(200);
  });

  it('ETag = version : une fiche publiée corrigée change la version, le téléphone retélécharge', async () => {
    const cookie = await setup(dirs.create({ sheets: [sheetFixture('goblet-squat')] }));
    const etag = (await ctx.request('/api/catalog', { cookie })).headers.get('ETag') as string;
    await ctx.deps.db.transaction().execute(async (trx) => {
      await trx.updateTable('exercise').set({ name: 'Squat goblet corrigé', revision: 5 }).execute();
      await rebuildCatalog(trx, ctx.deps);
    });
    const res = await ctx.request('/api/catalog', { cookie, headers: { 'If-None-Match': etag } });
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).not.toBe(etag);
    const body = (await res.json()) as { version: string; exercises: { name: string }[] };
    expect(body.exercises[0]?.name).toBe('Squat goblet corrigé');
    expect((await getServerMeta(ctx.deps.db)).catalogVersion).toBe(body.version);
  });

  it('sans chargement au démarrage : bloc reconstruit depuis la base', async () => {
    ctx = await createTestContext({ config: { contentDir: REPO_DATA } });
    const { cookie } = await createUserAndLogin(ctx);
    const res = await ctx.request('/api/catalog', { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string };
    expect(body.version).toBe((await getServerMeta(ctx.deps.db)).catalogVersion);
  });
});
