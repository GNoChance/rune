import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson } from '@rune/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATALOG_STARTUP_TASK } from '../../../apps/server/src/catalog/loader';
import {
  createTestContext,
  createUser,
  insertFixtureRow,
  login,
  seqIds,
  type TestContext,
} from '../../../apps/server/test/support';
import {
  illustrationFixture,
  retiredDraft,
  sheetFixture,
  skeletonFixture,
  tempDataDirs,
} from '../../../apps/server/test/support/catalog';
import { postTransition, putSheet } from '../../../apps/server/test/support/review';
import { main, parseExport, pullExport } from '../../data/pull';
import { validateDataDir } from '../../data/validate';

/** Squelette valide (04 §8, étape 1). */
const skeleton = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  schema_version: 1,
  revision: 1,
  status: 'draft',
  batch: 'A',
  name: `Exercice ${id}`,
  movement_pattern: 'squat',
  mechanics: 'compound',
  unilateral: false,
  measure: 'reps',
  load_mode: 'bodyweight',
  equipment_options: [[]],
  level: 1,
  not_for_minors: false,
  ...extra,
});

/** Export tel que le sert le serveur : tableau de fiches en forme canonique. */
const exportOf = (sheets: readonly Record<string, unknown>[]) =>
  `${JSON.stringify(
    sheets.map((s) => JSON.parse(canonicalJson(s))),
    null,
    2,
  )}\n`;

function capture() {
  const lines: { out: string[]; err: string[] } = { out: [], err: [] };
  return {
    lines,
    console: { log: (s: string) => lines.out.push(s), error: (s: string) => lines.err.push(s) },
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rune-pull-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const read = (id: string) => readFile(join(dir, 'exercises', `${id}.json`), 'utf8');
const files = async () => (await readdir(join(dir, 'exercises'))).sort();

describe('data:pull : découpe de l’export (04 §10)', () => {
  it('une fiche par fichier, en forme canonique ; seuls les fichiers changés sont réécrits', async () => {
    const a = skeleton('squat-sumo');
    const b = skeleton('fente-avant', { movement_pattern: 'lunge' });
    const first = await pullExport(exportOf([a, b]), dir);
    expect(first).toEqual({
      errors: [],
      created: ['fente-avant', 'squat-sumo'],
      updated: [],
      unchanged: [],
      kept: [],
    });
    expect(await files()).toEqual(['fente-avant.json', 'squat-sumo.json']);
    expect(await read('squat-sumo')).toBe(canonicalJson(a));

    const again = await pullExport(exportOf([a, { ...b, revision: 2, name: 'Fente' }]), dir);
    expect(again).toMatchObject({ created: [], updated: ['fente-avant'], unchanged: ['squat-sumo'] });
    expect(JSON.parse(await read('fente-avant'))).toMatchObject({ revision: 2, name: 'Fente' });
  });

  it('une fiche du dépôt absente de l’export est gardée et signalée', async () => {
    await mkdir(join(dir, 'exercises'), { recursive: true });
    const local = canonicalJson(skeleton('pas-encore-chargee'));
    await writeFile(join(dir, 'exercises', 'pas-encore-chargee.json'), local);
    const report = await pullExport(exportOf([skeleton('squat-sumo')]), dir);
    expect(report.kept).toEqual(['pas-encore-chargee']);
    expect(await read('pas-encore-chargee')).toBe(local);
  });

  it.each<[string, string, string]>([
    ['JSON illisible', '[{', 'invalid_json'],
    ['autre chose qu’un tableau', '{"exercises": []}', 'invalid_export'],
    ['une fiche invalide', exportOf([skeleton('ok'), skeleton('ko', { level: 4 })]), 'invalid_sheet'],
    ['un id en double', exportOf([skeleton('ok'), skeleton('ok')]), 'duplicate_id'],
    ['un id qui sort du dossier', exportOf([skeleton('ok'), skeleton('../evasion')]), 'invalid_sheet'],
  ])('%s : export refusé, rien n’est écrit', async (_, text, code) => {
    const report = await pullExport(text, dir);
    expect(report.errors.map((e) => e.code)).toContain(code);
    expect(report.created).toEqual([]);
    await expect(readdir(join(dir, 'exercises'))).rejects.toThrow();
    expect(parseExport(text).errors.length).toBeGreaterThan(0);
  });

  it('main : usage 2 ; export refusé 1 ; succès 0 puis validation du dossier', async () => {
    const out = capture();
    expect(await main([], out.console)).toBe(2);
    expect(await main(['a.json', 'b.json'], out.console)).toBe(2);
    expect(await main(['a.json', '--strict'], out.console)).toBe(2);

    const file = join(dir, 'exercises-export.json');
    await writeFile(file, '{}');
    expect(await main([file, '--dir', dir], out.console)).toBe(1);
    expect(out.lines.err.at(-1)).toBe('Export refusé : 1 erreur(s), aucun fichier écrit.');

    await writeFile(join(dir, 'glossary.json'), '[]\n');
    await writeFile(file, exportOf([skeleton('squat-sumo')]));
    const ok = capture();
    expect(await main([file, '--dir', dir], ok.console)).toBe(0);
    expect(ok.lines.out).toEqual([
      '1 fiche(s) créée(s), 0 modifiée(s), 0 inchangée(s).',
      'Catalogue valide : lance la PR.',
    ]);
    expect((await validateDataDir(dir)).errors).toEqual([]);

    // Export valide fiche par fiche, mais catalogue invalide (alias en double) : fichiers écrits, sortie 1.
    await writeFile(
      file,
      exportOf([skeleton('squat-sumo'), skeleton('fente', { aliases: ['Exercice squat sumo'] })]),
    );
    const invalid = capture();
    expect(await main([file, '--dir', dir], invalid.console)).toBe(1);
    expect(invalid.lines.err.some((l) => l.includes('[duplicate_alias]'))).toBe(true);
    expect(await files()).toEqual(['fente.json', 'squat-sumo.json']);
  });
});

describe('aller-retour (04 §13, critère 8)', () => {
  const dirs = tempDataDirs();
  const contexts: TestContext[] = [];
  afterEach(() => {
    for (const c of contexts.splice(0)) c.close();
    dirs.cleanup();
  });

  const NOW = '2026-10-30T09:00:00.000Z';
  const illustration = illustrationFixture('goblet-squat-start');
  const SOURCE = [
    sheetFixture('wall-push-up', { chain_id: 'pompes', harder_id: 'push-up', stressed_joints: ['wrists'] }),
    sheetFixture('push-up', { chain_id: 'pompes', easier_id: 'wall-push-up', stressed_joints: ['wrists'] }),
    sheetFixture('goblet-squat', {
      illustrations: [{ illustration_id: illustration.entry.id, role: 'start' }],
    }),
    sheetFixture('hip-thrust', { status: 'draft', published_at: undefined, stressed_joints: ['hips'] }),
    sheetFixture('ancienne', { status: 'retired', retired_at: '2026-10-28T08:00:00.000Z' }),
    skeletonFixture('brouillon'),
    retiredDraft('retiree'),
  ];

  async function context(contentDir: string, seed: number) {
    const ctx = await createTestContext({ config: { contentDir }, deps: { ids: seqIds(seed) } });
    contexts.push(ctx);
    return ctx;
  }

  async function exportOfBase(ctx: TestContext, cookie: string): Promise<string> {
    const res = await ctx.request('/api/admin/exercises/export', { cookie });
    expect(res.status).toBe(200);
    return res.text();
  }

  it('export → data:pull → chargement sur une base vide → export identique octet pour octet', async () => {
    // Base A : amorcée depuis le dépôt, puis modifiée par l'admin dans l'appli.
    const a = await context(dirs.create({ sheets: SOURCE, illustrations: [illustration] }), 1);
    await CATALOG_STARTUP_TASK.run(a.deps);
    const admin = await createUser(a, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
    const cookie = await login(a, 'porteur', admin.password);
    a.clock.set(NOW);
    const ok = async (res: Promise<Response>) => expect((await res).status).toBe(200);
    await ok(putSheet(a, cookie, 'brouillon', { ...skeletonFixture('brouillon'), name: 'Squat sumo' }, 1));
    await ok(
      postTransition(a, cookie, 'hip-thrust', {
        to: 'reviewed',
        baseRevision: 4,
        reviewChecked: true,
        minorsConfirmed: true,
      }),
    );
    await ok(postTransition(a, cookie, 'hip-thrust', { to: 'published', baseRevision: 5 }));
    const goblet = SOURCE[2] as Record<string, unknown>;
    await ok(putSheet(a, cookie, 'goblet-squat', { ...goblet, breathing: 'Souffle en remontant.' }, 4));
    const exported = await exportOfBase(a, cookie);
    expect(exported).toContain(admin.id); // reviewed_by

    // data:pull dans un dépôt qui a le même manifeste, puis data:validate.
    const repo = dirs.create({ illustrations: [illustration], raw: { 'glossary.json': '[]\n' } });
    const file = join(repo, 'exercises-export.json');
    await writeFile(file, exported);
    expect(await main([file, '--dir', repo], capture().console)).toBe(0);
    await rm(file);
    expect((await validateDataDir(repo)).errors).toEqual([]);

    // Base B vide, où le compte relecteur existe (sinon reviewed_by devient NULL au chargement).
    const b = await context(repo, 2);
    await insertFixtureRow(b.deps.db, 'user', { id: admin.id });
    await CATALOG_STARTUP_TASK.run(b.deps);
    const adminB = await createUser(b, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
    expect(adminB.id).not.toBe(admin.id);
    const again = await exportOfBase(b, await login(b, 'porteur', adminB.password));
    expect(again).toBe(exported);
  });
});
