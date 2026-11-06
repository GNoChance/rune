import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CATALOG_STARTUP_TASK } from '../../src/catalog/loader';
import { loadAdviceFiles, seedOrMergeAdviceSheets } from '../../src/nutrition/advice-loader';
import { createTestContext, type TestContext } from '../support';
import { adviceDirs, adviceFile } from './advice-fixtures';

let ctx: TestContext;
const dirs = adviceDirs();
afterEach(() => {
  ctx?.close();
  dirs.cleanup();
});

const NOW = '2026-11-09T09:00:00.000Z';
const merge = (files: ReturnType<typeof adviceFile>[], now = NOW) =>
  ctx.deps.db.transaction().execute((trx) => seedOrMergeAdviceSheets(trx, files, now));
const row = (id: string) =>
  ctx.deps.db.selectFrom('adviceSheet').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

describe('seedOrMergeAdviceSheets', () => {
  it('une fiche nouvelle entre en draft, version 1', async () => {
    ctx = await createTestContext({ now: NOW });
    expect(await merge([adviceFile('a')])).toEqual({ added: 1, changed: 0 });
    expect(await row('a')).toMatchObject({ status: 'draft', version: 1, draftOrigin: 'human' });
  });

  it('contenu identique : statut gardé, rien ne change', async () => {
    ctx = await createTestContext({ now: NOW });
    await merge([adviceFile('a')]);
    await ctx.deps.db
      .updateTable('adviceSheet')
      .set({ status: 'published', publishedAt: NOW })
      .where('id', '=', 'a')
      .execute();
    expect(await merge([adviceFile('a')], '2026-11-10T09:00:00.000Z')).toEqual({ added: 0, changed: 0 });
    expect(await row('a')).toMatchObject({ status: 'published', version: 1, updatedAt: NOW });
  });

  it('contenu changé : retour à draft, version + 1, relecture effacée', async () => {
    ctx = await createTestContext({ now: NOW });
    await merge([adviceFile('a')]);
    await ctx.deps.db
      .updateTable('adviceSheet')
      .set({ status: 'published', publishedAt: NOW, reviewedAt: NOW })
      .where('id', '=', 'a')
      .execute();
    const later = '2026-11-10T09:00:00.000Z';
    expect(await merge([adviceFile('a', { title: 'Nouveau titre' })], later)).toEqual({
      added: 0,
      changed: 1,
    });
    expect(await row('a')).toMatchObject({
      status: 'draft',
      version: 2,
      title: 'Nouveau titre',
      reviewedAt: null,
      publishedAt: null,
      updatedAt: later,
    });
  });

  it('range les colonnes JSON et les colonnes à plusieurs mots', async () => {
    ctx = await createTestContext({ now: NOW });
    await merge([adviceFile('a', { visible_modes: ['qualitative'], tags: ['x', 'y'] })]);
    const r = await row('a');
    expect(JSON.parse(r.visibleModes)).toEqual(['qualitative']);
    expect(JSON.parse(r.tags)).toEqual(['x', 'y']);
    expect(r.bodyMd).toContain('repas variés');
  });
});

describe('loadAdviceFiles', () => {
  it('dossier absent : aucune fiche, pas d’erreur', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rune-advice-empty-'));
    try {
      expect(await loadAdviceFiles({ config: { contentDir: dir } as never })).toEqual({
        files: [],
        invalid: [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lit les fichiers valides, signale les autres', async () => {
    const dir = dirs.create([adviceFile('a'), adviceFile('b')]);
    writeFileSync(join(dir, 'advice', 'cassee.json'), '{ pas du json');
    writeFileSync(join(dir, 'advice', 'autre.json'), JSON.stringify(adviceFile('pas-autre')));
    const res = await loadAdviceFiles({ config: { contentDir: dir } as never });
    expect(res.files.map((f) => f.id)).toEqual(['a', 'b']);
    expect(res.invalid).toEqual(['advice/autre.json', 'advice/cassee.json']);
  });

  it('le démarrage verse les fiches avec le catalogue', async () => {
    const dir = dirs.create([adviceFile('a')]);
    ctx = await createTestContext({ now: NOW, config: { contentDir: dir } });
    await CATALOG_STARTUP_TASK.run(ctx.deps);
    expect(await row('a')).toMatchObject({ status: 'draft', version: 1 });
  });
});
