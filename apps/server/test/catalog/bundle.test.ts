import { createHash } from 'node:crypto';
import {
  type CatalogBundle,
  SERVED_EXCLUDED_KEYS,
  type ServedSheet,
  ServedSheetSchema,
} from '@rune/contracts';
import { buildChains, canonicalJson, substitutes, usableChainSteps } from '@rune/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { currentCatalog, getServedCatalog, rebuildCatalog } from '../../src/catalog/bundle';
import { insertSheet, upsertIllustration } from '../../src/catalog/repo';
import { getServerMeta } from '../../src/db/server-meta';
import { createLogger } from '../../src/logger';
import { createTestContext, type TestContext } from '../support';
import { illustrationFixture, retiredDraft, sheetFixture, skeletonFixture } from '../support/catalog';

let ctx: TestContext;
afterEach(() => ctx?.close());

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const at = (iso: string) => ({ savedAt: iso, savedBy: null, exportedRevision: null });

async function setup(lines: string[] = []): Promise<TestContext> {
  ctx = await createTestContext({
    now: '2026-10-30T08:00:00.000Z',
    deps: { logger: createLogger((l) => lines.push(l)) },
  });
  return ctx;
}

const rebuild = (templates?: readonly unknown[]) =>
  ctx.deps.db.transaction().execute((trx) => rebuildCatalog(trx, ctx.deps, templates));

/** Une fiche de chaque cas : seules `published` et `retired-published` sont servies (spec §3.6). */
async function seedStatuses(): Promise<void> {
  const db = ctx.deps.db;
  const now = '2026-10-29T08:00:00.000Z';
  await insertSheet(db, skeletonFixture('draft-sheet'), at(now));
  await insertSheet(
    db,
    sheetFixture('reviewed-sheet', { status: 'reviewed', published_at: undefined }),
    at(now),
  );
  await insertSheet(db, sheetFixture('published-sheet', { batch: 'E3' }), at(now));
  await insertSheet(
    db,
    sheetFixture('retired-published', { status: 'retired', retired_at: '2026-10-28T08:00:00.000Z' }),
    at(now),
  );
  await insertSheet(db, skeletonFixture('retired-skeleton', { status: 'retired' }), at(now));
  // Brouillon complet retiré sans avoir été publié : jamais servi, même s'il passe le schéma de la fiche servie.
  await insertSheet(db, retiredDraft(), at(now));
}

describe('rebuildCatalog', () => {
  it('catalogue vide : version = sha256 de la forme canonique, posée dans server_meta', async () => {
    await setup();
    const bundle = await rebuild();
    const content = { adviceSheets: [], exercises: [], illustrations: [], programTemplates: [] };
    expect(bundle).toEqual({ version: sha(canonicalJson(content)), ...content });
    expect(await getServerMeta(ctx.deps.db)).toMatchObject({
      catalogVersion: bundle.version,
      catalogUpdatedAt: '2026-10-30T08:00:00.000Z',
    });
    expect(getServedCatalog(ctx.deps)).toEqual(bundle);
  });

  it('sert les fiches published et les retirées déjà publiées, triées par id, sans colonne éditoriale ni batch', async () => {
    await setup();
    await seedStatuses();
    const bundle = await rebuild();
    expect(bundle.exercises.map((s) => [s.id, s.status])).toEqual([
      ['published-sheet', 'published'],
      ['retired-published', 'retired'],
    ]);
    for (const served of bundle.exercises) {
      expect(ServedSheetSchema.parse(served)).toEqual(served);
      for (const key of [...SERVED_EXCLUDED_KEYS, 'exported_revision'])
        expect(served).not.toHaveProperty(key);
    }
    expect(JSON.stringify(bundle)).not.toContain('REPERE-NOTES');
    // Fiche servie = la fiche de la base moins ses clés éditoriales, dans l'ordre de 04 §4.
    const {
      batch: _b,
      review_notes: _n,
      drafting: _d,
      reviewed_at: _ra,
      published_at: _p,
      updated_at: _u,
      ...rest
    } = sheetFixture('published-sheet', { batch: 'E3' });
    expect(bundle.exercises[0]).toEqual(rest);
    expect(Object.keys(bundle.exercises[0] ?? {})).toEqual(Object.keys(rest));
  });

  it('manifeste complet trié par id, et modèles reçus : tous deux dans la version', async () => {
    await setup();
    const b = illustrationFixture('b-start');
    const a = illustrationFixture('a-start', { modifications: undefined, replace_before_public: true });
    await upsertIllustration(ctx.deps.db, b.entry);
    await upsertIllustration(ctx.deps.db, a.entry);
    const withManifest = await rebuild();
    expect(withManifest.illustrations).toEqual([a.entry, b.entry]);
    const withTemplates = await rebuild([{ id: 'full-body' }]);
    expect(withTemplates.programTemplates).toEqual([{ id: 'full-body' }]);
    expect(withTemplates.version).not.toBe(withManifest.version);
    // Les modèles reçus restent ceux des reconstructions suivantes (enregistrement d'une fiche, tâche 9).
    expect((await rebuild()).version).toBe(withTemplates.version);
  });

  it('version inchangée : server_meta non réécrit', async () => {
    await setup();
    await seedStatuses();
    const first = await rebuild();
    ctx.clock.set('2026-10-31T08:00:00.000Z');
    const second = await rebuild();
    expect(second.version).toBe(first.version);
    expect((await getServerMeta(ctx.deps.db)).catalogUpdatedAt).toBe('2026-10-30T08:00:00.000Z');
  });

  it('fiche publiée corrigée : nouveau contenu servi et nouvelle version (Review Focus 1)', async () => {
    await setup();
    await seedStatuses();
    const before = await rebuild();
    const content = await ctx.deps.db
      .selectFrom('exercise')
      .select('content')
      .where('id', '=', 'published-sheet')
      .executeTakeFirstOrThrow();
    const corrected = { ...JSON.parse(content.content), breathing: 'Souffle en remontant, sans bloquer.' };
    await ctx.deps.db
      .updateTable('exercise')
      .set({ content: JSON.stringify(corrected), revision: 5 })
      .where('id', '=', 'published-sheet')
      .execute();
    ctx.clock.set('2026-10-31T08:00:00.000Z');
    const after = await rebuild();
    expect(after.version).not.toBe(before.version);
    expect(after.exercises[0]).toMatchObject({
      revision: 5,
      breathing: 'Souffle en remontant, sans bloquer.',
    });
    expect(await getServerMeta(ctx.deps.db)).toMatchObject({
      catalogVersion: after.version,
      catalogUpdatedAt: '2026-10-31T08:00:00.000Z',
    });
  });

  it('écriture sur un brouillon ou une colonne éditoriale : la version ne bouge pas (spec §3.7)', async () => {
    await setup();
    await seedStatuses();
    const before = await rebuild();
    await ctx.deps.db
      .updateTable('exercise')
      .set({ name: 'Renommé', revision: 2 })
      .where('id', '=', 'draft-sheet')
      .execute();
    await ctx.deps.db
      .updateTable('exercise')
      .set({ reviewNotes: 'Autre note', batch: 'B', exportedRevision: 4 })
      .where('id', '=', 'published-sheet')
      .execute();
    expect((await rebuild()).version).toBe(before.version);
  });

  it('fiche servie invalide en base : écartée et journalisée, le reste est servi', async () => {
    const lines: string[] = [];
    await setup(lines);
    await seedStatuses();
    await ctx.deps.db
      .updateTable('exercise')
      .set({ content: '{}' })
      .where('id', '=', 'retired-published')
      .execute();
    const bundle = await rebuild();
    expect(bundle.exercises.map((s) => s.id)).toEqual(['published-sheet']);
    expect(lines.join('\n')).toContain('catalog_sheet_unservable');
  });

  it('les fonctions du catalogue acceptent les fiches servies sans conversion', async () => {
    await setup();
    await seedStatuses();
    const { exercises } = await rebuild();
    const chains: Map<string, ServedSheet[]> = buildChains(exercises);
    const ctxServed = {
      catalog: exercises,
      equipment: 'all' as const,
      maxLevel: 3 as const,
      cautious: false,
    };
    const steps: ServedSheet[] = usableChainSteps('aucune', ctxServed);
    const subs: ServedSheet[] = substitutes(exercises[0] as ServedSheet, ctxServed);
    expect(chains.size).toBe(0);
    expect(steps).toEqual([]);
    expect(subs).toEqual([]);
  });
});

describe('currentCatalog', () => {
  it('sans bloc en mémoire : reconstruit depuis la base', async () => {
    await setup();
    await seedStatuses();
    expect(getServedCatalog(ctx.deps)).toBeNull();
    const bundle = await currentCatalog(ctx.deps);
    expect(bundle.exercises.map((s) => s.id)).toEqual(['published-sheet', 'retired-published']);
    expect((await getServerMeta(ctx.deps.db)).catalogVersion).toBe(bundle.version);
  });

  it('bloc en mémoire à jour : servi tel quel', async () => {
    await setup();
    const bundle = await rebuild();
    expect(await currentCatalog(ctx.deps)).toBe(bundle);
  });

  it("transaction annulée après la reconstruction : le bloc de la base est servi, pas celui de l'écriture perdue", async () => {
    await setup();
    await seedStatuses();
    const committed: CatalogBundle = await rebuild();
    await expect(
      ctx.deps.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('exercise')
          .set({ name: 'Perdu' })
          .where('id', '=', 'published-sheet')
          .execute();
        await rebuildCatalog(trx, ctx.deps);
        throw new Error('échec après la reconstruction');
      }),
    ).rejects.toThrow('échec');
    expect(getServedCatalog(ctx.deps)?.version).not.toBe(committed.version);
    const served = await currentCatalog(ctx.deps);
    expect(served.version).toBe(committed.version);
    expect(served.exercises[0]?.name).toBe('Exercice published-sheet');
  });
});
