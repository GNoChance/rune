import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DraftSheet } from '@rune/contracts';
import { canonicalJson, contentOf } from '@rune/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { getServedCatalog } from '../../src/catalog/bundle';
import {
  CATALOG_STARTUP_TASK,
  type CatalogFiles,
  CatalogLoadError,
  loadCatalogFiles,
  seedOrMergeCatalog,
} from '../../src/catalog/loader';
import { insertSheet, rowToSheet } from '../../src/catalog/repo';
import { getServerMeta } from '../../src/db/server-meta';
import { STARTUP_TASKS } from '../../src/startup';
import { createLogger, createTestContext, createUser, dumpDatabase, type TestContext } from '../support';
import {
  illustrationFixture,
  retiredDraft,
  sheetFixture,
  skeletonFixture,
  tempDataDirs,
  writeDataDir,
} from '../support/catalog';

const REPO_DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../data');

let ctx: TestContext;
const dirs = tempDataDirs();
afterEach(() => {
  ctx?.close();
  dirs.cleanup();
});

let lines: string[] = [];
async function setup(contentDir: string): Promise<TestContext> {
  lines = [];
  ctx = await createTestContext({
    now: '2026-10-30T08:00:00.000Z',
    config: { contentDir },
    deps: { logger: createLogger((l) => lines.push(l)) },
  });
  return ctx;
}

/** Lignes du journal dont le message vaut `msg`. */
const logged = (msg: string) =>
  lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((entry) => entry.msg === msg);

const ids = async () =>
  (await ctx.deps.db.selectFrom('exercise').select(['id', 'status']).orderBy('id').execute()).map((r) => [
    r.id,
    r.status,
  ]);

const merge = (files: CatalogFiles) =>
  ctx.deps.db.transaction().execute((trx) => seedOrMergeCatalog(trx, files, '2026-10-30T08:00:00.000Z'));

const loaded = async (): Promise<CatalogFiles> => {
  const result = await loadCatalogFiles(ctx.deps);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.files;
};

/** Chaîne de deux fiches publiées (R-CH-1). */
const CHAIN = [
  sheetFixture('split-squat', { chain_id: 'split-squat', harder_id: 'bulgarian-split-squat' }),
  sheetFixture('bulgarian-split-squat', { chain_id: 'split-squat', easier_id: 'split-squat', level: 2 }),
];

/** Un catalogue complet : un cas par statut, une chaîne, deux illustrations, un modèle. */
function fullCatalog() {
  const start = illustrationFixture('goblet-squat-start');
  const end = illustrationFixture('goblet-squat-end');
  return {
    sheets: [
      skeletonFixture('draft-sheet'),
      sheetFixture('reviewed-sheet', { status: 'reviewed', published_at: undefined }),
      sheetFixture('goblet-squat', {
        illustrations: [
          { illustration_id: 'goblet-squat-start', role: 'start' },
          { illustration_id: 'goblet-squat-end', role: 'end' },
        ],
      }),
      sheetFixture('retired-published', { status: 'retired', retired_at: '2026-10-28T08:00:00.000Z' }),
      retiredDraft(),
      ...CHAIN,
    ],
    illustrations: [start, end],
    templates: { 'full-body': { id: 'full-body' } },
  };
}

describe('data/', () => {
  it('data/LICENSE existe', () => {
    expect(existsSync(join(REPO_DATA, 'LICENSE'))).toBe(true);
  });
});

describe('loadCatalogFiles', () => {
  it('le dossier data/ du dépôt est valide', async () => {
    await setup(REPO_DATA);
    const result = await loadCatalogFiles(ctx.deps);
    expect(result.ok).toBe(true);
  });

  it('dossier sans fichier : catalogue vide', async () => {
    await setup(dirs.create());
    expect(await loaded()).toEqual({ sheets: [], manifest: [], templates: [] });
  });

  it('lit fiches, manifeste et modèles (triés par nom de fichier)', async () => {
    const spec = fullCatalog();
    await setup(dirs.create({ ...spec, templates: { b: { id: 'b' }, a: { id: 'a' } } }));
    const files = await loaded();
    expect(files.sheets.map((s) => s.id)).toEqual(
      [...spec.sheets.map((s) => s.id)].sort((a, b) => (a < b ? -1 : 1)),
    );
    expect(files.sheets.find((s) => s.id === 'goblet-squat')).toEqual(spec.sheets[2]);
    expect(files.manifest).toEqual(spec.illustrations.map((i) => i.entry));
    expect(files.templates).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  const valid = sheetFixture('goblet-squat');
  const start = illustrationFixture('goblet-squat-start');
  it.each([
    ['JSON illisible', { raw: { 'exercises/goblet-squat.json': '{' } }, 'invalid_json'],
    ['fiche invalide', { sheets: [{ ...valid, level: 4 }] }, 'unknown_code'],
    ['fiche publiée incomplète', { sheets: [{ ...valid, safety: undefined }] }, 'incomplete'],
    [
      'fichier non canonique',
      { raw: { 'exercises/goblet-squat.json': JSON.stringify(valid) } },
      'not_canonical',
    ],
    [
      'id différent du nom de fichier',
      { raw: { 'exercises/autre.json': canonicalJson(valid) } },
      'id_mismatch',
    ],
    [
      'manifeste invalide',
      { raw: { 'illustrations/manifest.json': '[{"id":"x","file":"pas-bon"}]' } },
      'invalid_manifest',
    ],
    [
      "fichier d'illustration absent",
      { raw: { 'illustrations/manifest.json': JSON.stringify([start.entry]) } },
      'illustration_file_missing',
    ],
    [
      'illustration hors manifeste',
      { sheets: [{ ...valid, illustrations: [{ illustration_id: 'x', role: 'start' }] }] },
      'illustration_unknown',
    ],
    ['programme illisible', { raw: { 'programs/a.json': '{' } }, 'invalid_json'],
  ] as const)('%s : refusé avec ses erreurs', async (_name, spec, code) => {
    await setup(dirs.create({ templates: { ok: { id: 'ok' } }, ...spec }));
    const result = await loadCatalogFiles(ctx.deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain(code);
    // Les modèles lisibles restent servis avec le catalogue de la base.
    expect(result.templates).toEqual([{ id: 'ok' }]);
  });
});

describe('seedOrMergeCatalog', () => {
  it('base vide : tout est amorcé avec son statut, une révision par fiche, exported_revision = revision', async () => {
    const spec = fullCatalog();
    await setup(dirs.create(spec));
    const report = await merge(await loaded());
    expect(report).toMatchObject({ seeded: true, ignored: [], refused: [], illustrations: 2 });
    expect(report.inserted).toHaveLength(spec.sheets.length);
    expect(await ids()).toEqual(
      spec.sheets.map((s) => [s.id, s.status]).sort(([a], [b]) => ((a as string) < (b as string) ? -1 : 1)),
    );
    const rows = await ctx.deps.db.selectFrom('exercise').selectAll().execute();
    for (const row of rows) {
      const file = spec.sheets.find((s) => s.id === row.id) as DraftSheet;
      expect(rowToSheet(row)).toEqual(JSON.parse(canonicalJson(file)));
      expect(row.exportedRevision).toBe(file.revision);
    }
    const revisions = await ctx.deps.db
      .selectFrom('exerciseRevision')
      .selectAll()
      .orderBy('exerciseId')
      .execute();
    expect(revisions).toHaveLength(spec.sheets.length);
    for (const r of revisions) {
      const file = spec.sheets.find((s) => s.id === r.exerciseId) as DraftSheet;
      expect(r).toEqual({
        exerciseId: file.id,
        revision: file.revision,
        content: canonicalJson(contentOf(file)),
        status: file.status,
        savedBy: null,
        savedAt: '2026-10-30T08:00:00.000Z',
      });
    }
    const illustrations = await ctx.deps.db
      .selectFrom('illustration')
      .select(['id', 'file'])
      .orderBy('id')
      .execute();
    expect(illustrations.map((i) => i.id)).toEqual(['goblet-squat-end', 'goblet-squat-start']);
  });

  it("une fiche déjà en base n'est jamais écrasée (la base fait foi)", async () => {
    await setup(dirs.create({ sheets: [sheetFixture('goblet-squat')] }));
    await insertSheet(
      ctx.deps.db,
      skeletonFixture('goblet-squat', { name: 'Version de la base', revision: 7 }),
      {
        savedAt: '2026-10-29T08:00:00.000Z',
        savedBy: null,
        exportedRevision: null,
      },
    );
    const before = dumpDatabase(ctx.deps.sqlite);
    const report = await merge(await loaded());
    expect(report).toMatchObject({ seeded: false, inserted: [], ignored: ['goblet-squat'] });
    expect(dumpDatabase(ctx.deps.sqlite)).toBe(before);
  });

  it('base non vide : une nouvelle fiche non draft est refusée, un nouveau brouillon inséré', async () => {
    await setup(
      dirs.create({
        sheets: [
          sheetFixture('goblet-squat'),
          sheetFixture('new-published'),
          sheetFixture('new-reviewed', { status: 'reviewed', published_at: undefined }),
          skeletonFixture('new-draft'),
        ],
      }),
    );
    await insertSheet(ctx.deps.db, sheetFixture('goblet-squat'), {
      savedAt: '2026-10-29T08:00:00.000Z',
      savedBy: null,
      exportedRevision: 4,
    });
    const report = await merge(await loaded());
    expect(report.inserted).toEqual(['new-draft']);
    expect(report.refused).toEqual([
      { id: 'new-published', status: 'published' },
      { id: 'new-reviewed', status: 'reviewed' },
    ]);
    expect(await ids()).toEqual([
      ['goblet-squat', 'published'],
      ['new-draft', 'draft'],
    ]);
  });

  it("base non vide : un brouillon qui pointe vers une fiche refusée fait tout refuser, rien n'est écrit", async () => {
    const chain = [
      skeletonFixture('easy', { chain_id: 'pair', harder_id: 'hard' }),
      sheetFixture('hard', {
        chain_id: 'pair',
        easier_id: 'easy',
        status: 'reviewed',
        published_at: undefined,
      }),
    ];
    await setup(dirs.create({ sheets: [sheetFixture('goblet-squat'), ...chain] }));
    await insertSheet(ctx.deps.db, sheetFixture('goblet-squat'), {
      savedAt: '2026-10-29T08:00:00.000Z',
      savedBy: null,
      exportedRevision: 4,
    });
    const before = dumpDatabase(ctx.deps.sqlite);
    const error = await merge(await loaded()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CatalogLoadError);
    expect((error as CatalogLoadError).errors).toEqual([
      expect.objectContaining({ file: 'exercises/easy.json', code: 'chain_pointer' }),
    ]);
    expect(dumpDatabase(ctx.deps.sqlite)).toBe(before);
  });

  it("reviewed_by : gardé si le compte existe, NULL sinon (aucun compte n'est créé)", async () => {
    await setup(dirs.create());
    const reviewer = await createUser(ctx);
    writeDataDir(ctx.deps.config.contentDir, {
      sheets: [
        sheetFixture('known-reviewer', { reviewed_by: reviewer.id }),
        sheetFixture('ghost-reviewer', { reviewed_by: '0199f0a2-7c1e-7d3a-9b4e-2f6a1c8d5e70' }),
      ],
    });
    const report = await merge(await loaded());
    expect(report.unknownReviewers).toBe(1);
    const rows = await ctx.deps.db
      .selectFrom('exercise')
      .select(['id', 'reviewedBy'])
      .orderBy('id')
      .execute();
    expect(rows).toEqual([
      { id: 'ghost-reviewer', reviewedBy: null },
      { id: 'known-reviewer', reviewedBy: reviewer.id },
    ]);
  });

  it('manifeste : le dépôt fait foi (entrée mise à jour, entrée nouvelle insérée)', async () => {
    const start = illustrationFixture('goblet-squat-start');
    await setup(dirs.create({ illustrations: [start] }));
    await merge(await loaded());
    const changed = illustrationFixture('goblet-squat-start', {
      creators: ['Greg Priday', 'Bryl Lim'],
      modifications: undefined,
      replace_before_public: true,
    });
    const end = illustrationFixture('goblet-squat-end');
    const dir = ctx.deps.config.contentDir;
    rmSync(join(dir, 'illustrations'), { recursive: true });
    writeDataDir(dir, { illustrations: [changed, end] });
    const report = await merge(await loaded());
    expect(report.illustrations).toBe(2);
    const rows = await ctx.deps.db.selectFrom('illustration').selectAll().orderBy('id').execute();
    expect(rows.map((r) => [r.id, r.creators, r.modifications, r.replaceBeforePublic])).toEqual([
      ['goblet-squat-end', '["Greg Priday"]', 'Nettoyage du SVG, renommage.', 0],
      ['goblet-squat-start', '["Greg Priday","Bryl Lim"]', null, 1],
    ]);
  });
});

describe('CATALOG_STARTUP_TASK', () => {
  it('est enregistrée', () => {
    expect(STARTUP_TASKS).toContain(CATALOG_STARTUP_TASK);
    expect(CATALOG_STARTUP_TASK.name).toBe('catalog');
  });

  it('charge, amorce et reconstruit le bloc servi', async () => {
    await setup(dirs.create(fullCatalog()));
    await CATALOG_STARTUP_TASK.run(ctx.deps);
    const bundle = getServedCatalog(ctx.deps);
    expect(bundle?.exercises.map((s) => s.id)).toEqual([
      'bulgarian-split-squat',
      'goblet-squat',
      'retired-published',
      'split-squat',
    ]);
    expect(bundle?.illustrations.map((i) => i.id)).toEqual(['goblet-squat-end', 'goblet-squat-start']);
    expect(bundle?.programTemplates).toEqual([{ id: 'full-body' }]);
    expect((await getServerMeta(ctx.deps.db)).catalogVersion).toBe(bundle?.version);
    expect(logged('catalog_seeded')).toEqual([expect.objectContaining({ count: 7 })]);
  });

  it('deux chargements de suite ne changent rien', async () => {
    await setup(dirs.create(fullCatalog()));
    await CATALOG_STARTUP_TASK.run(ctx.deps);
    const before = dumpDatabase(ctx.deps.sqlite);
    const version = getServedCatalog(ctx.deps)?.version;
    ctx.clock.set('2026-10-31T08:00:00.000Z');
    await CATALOG_STARTUP_TASK.run(ctx.deps);
    expect(dumpDatabase(ctx.deps.sqlite)).toBe(before);
    expect(getServedCatalog(ctx.deps)?.version).toBe(version);
    expect(logged('catalog_sheets_ignored')).toEqual([expect.objectContaining({ count: 7 })]);
  });

  it('nouvelle fiche publiée sur base non vide : refusée et journalisée', async () => {
    await setup(dirs.create({ sheets: [sheetFixture('goblet-squat')] }));
    await CATALOG_STARTUP_TASK.run(ctx.deps);
    writeDataDir(ctx.deps.config.contentDir, { sheets: [sheetFixture('new-published')] });
    await CATALOG_STARTUP_TASK.run(ctx.deps);
    expect(await ids()).toEqual([['goblet-squat', 'published']]);
    expect(logged('catalog_sheet_refused')).toEqual([
      expect.objectContaining({ level: 'warn', event: 'new-published', code: 'published' }),
    ]);
    expect(getServedCatalog(ctx.deps)?.exercises.map((s) => s.id)).toEqual(['goblet-squat']);
  });

  it("fichier invalide : rien n'est écrit, l'appli démarre avec le catalogue déjà en base", async () => {
    await setup(dirs.create({ sheets: [sheetFixture('goblet-squat')] }));
    await CATALOG_STARTUP_TASK.run(ctx.deps);
    const version = getServedCatalog(ctx.deps)?.version;
    const before = dumpDatabase(ctx.deps.sqlite);
    const dir = ctx.deps.config.contentDir;
    writeDataDir(dir, { sheets: [skeletonFixture('new-draft')] });
    writeFileSync(join(dir, 'exercises/broken.json'), '{');
    // Redémarrage : le bloc en mémoire est perdu.
    const restarted = { ...ctx.deps };
    await expect(CATALOG_STARTUP_TASK.run(restarted)).resolves.toBeUndefined();
    expect(dumpDatabase(ctx.deps.sqlite)).toBe(before);
    expect(getServedCatalog(restarted)?.exercises.map((s) => s.id)).toEqual(['goblet-squat']);
    expect(getServedCatalog(restarted)?.version).toBe(version);
    expect(logged('catalog_invalid')).toContainEqual(
      expect.objectContaining({ level: 'error', code: 'invalid_json', event: 'exercises/broken.json' }),
    );
  });

  it("pointeur vers une fiche refusée : rien n'est écrit, erreur journalisée, catalogue de la base servi", async () => {
    await setup(dirs.create({ sheets: [sheetFixture('goblet-squat')] }));
    await CATALOG_STARTUP_TASK.run(ctx.deps);
    const before = dumpDatabase(ctx.deps.sqlite);
    writeDataDir(ctx.deps.config.contentDir, {
      sheets: CHAIN.map((s, i) => (i === 0 ? { ...s, status: 'draft' } : s)),
    });
    await expect(CATALOG_STARTUP_TASK.run(ctx.deps)).resolves.toBeUndefined();
    expect(dumpDatabase(ctx.deps.sqlite)).toBe(before);
    expect(logged('catalog_invalid')).toContainEqual(expect.objectContaining({ code: 'chain_pointer' }));
    expect(getServedCatalog(ctx.deps)?.exercises.map((s) => s.id)).toEqual(['goblet-squat']);
  });
});
