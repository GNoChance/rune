import type { DraftSheet, ExerciseSheet, ReviewSheetResponse } from '@rune/contracts';
import { canonicalJson, contentOf } from '@rune/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { upsertIllustration } from '../../src/catalog/repo';
import { getServerMeta } from '../../src/db/server-meta';
import { createTestContext, createUser, login, type TestContext } from '../support';
import { illustrationFixture, retiredDraft, sheetFixture, skeletonFixture } from '../support/catalog';
import { postTransition, putSheet, rebuild, seedSheet } from '../support/review';

let ctx: TestContext;
afterEach(() => ctx?.close());

const T0 = '2026-10-06T10:00:00.000Z';
const NOW = '2026-10-30T09:00:00.000Z';

async function setup() {
  ctx = await createTestContext();
  const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
  // Publiée, révision 4, sensible (genoux), relue par l'admin.
  const published = await seedSheet(ctx, sheetFixture('goblet-squat', { reviewed_by: admin.id }));
  const draft = await seedSheet(ctx, skeletonFixture('brouillon'));
  await rebuild(ctx);
  const cookie = await login(ctx, 'porteur', admin.password);
  ctx.clock.set(NOW);
  return { admin: { ...admin, cookie }, published, draft };
}

/** Copie de `s` sans les clés `keys`. */
function without(s: Readonly<Record<string, unknown>>, ...keys: string[]): Record<string, unknown> {
  const copy = { ...s };
  for (const key of keys) delete copy[key];
  return copy;
}

const revisions = (id: string) =>
  ctx.deps.db
    .selectFrom('exerciseRevision')
    .selectAll()
    .where('exerciseId', '=', id)
    .orderBy('revision')
    .execute();
const stored = (id: string) =>
  ctx.deps.db.selectFrom('exercise').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const version = async () => (await getServerMeta(ctx.deps.db)).catalogVersion;

async function ok(pending: Response | Promise<Response>): Promise<ReviewSheetResponse> {
  const res = await pending;
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ReviewSheetResponse;
}

/** 422 `transition_blocked` avec `blockers`, sans rien écrire sur la fiche `id` ni changer le catalogue servi. */
async function expectBlocked(
  res: Response,
  blockers: readonly string[],
  id: string,
  before: { revision: number; rows: number; version: string | null },
) {
  expect(res.status).toBe(422);
  expect(await res.json()).toEqual({ error: 'transition_blocked', blockers });
  expect((await stored(id)).revision).toBe(before.revision);
  expect(await revisions(id)).toHaveLength(before.rows);
  expect(await version()).toBe(before.version);
}

/** Champs rédigés d'une fiche complète, non sensible (niveau 1, hanches seulement), pour compléter un brouillon. */
function completed(draft: DraftSheet): DraftSheet {
  const full = sheetFixture(draft.id, { stressed_joints: ['hips'] });
  return {
    ...draft,
    aliases: full.aliases,
    primary_muscles: full.primary_muscles,
    secondary_muscles: full.secondary_muscles,
    stressed_joints: full.stressed_joints,
    instructions: full.instructions,
    key_points: full.key_points,
    mistakes: full.mistakes,
    safety: full.safety,
    breathing: full.breathing,
    illustrations: [],
    review_notes: 'Profondeur à vérifier.',
  };
}

describe('PUT /api/admin/exercises/:id (spec brique 2 §3.5)', () => {
  it('reprend les champs système de la base, révision + 1, updated_at ; une clé absente efface le champ', async () => {
    const { admin, draft } = await setup();
    const res = await putSheet(
      ctx,
      admin.cookie,
      'brouillon',
      {
        ...draft,
        name: 'Squat sumo',
        setup: 'Écarte les pieds plus large que les épaules.',
        // Champs système du corps : ignorés.
        id: 'autre-id',
        status: 'published',
        revision: 40,
        reviewed_by: 'pirate',
        published_at: NOW,
        drafting: { origin: 'human', generated_at: NOW },
      },
      1,
    );
    const body = await ok(res);
    expect(body.sheet).toEqual({
      ...draft,
      name: 'Squat sumo',
      setup: 'Écarte les pieds plus large que les épaules.',
      revision: 2,
      updated_at: NOW,
    });
    expect(body).toMatchObject({ queues: ['drafts'], exportedRevision: 1, comments: [] });

    const cleared = await ok(putSheet(ctx, admin.cookie, 'brouillon', without(body.sheet, 'setup'), 2));
    expect(cleared.sheet).not.toHaveProperty('setup');
    expect((await stored('brouillon')).content).toBe('{}');

    const rows = await revisions('brouillon');
    expect(rows.map((r) => [r.revision, r.status, r.savedBy, r.savedAt])).toEqual([
      [1, 'draft', null, T0],
      [2, 'draft', admin.id, NOW],
      [3, 'draft', admin.id, NOW],
    ]);
    expect(rows[1]?.content).toBe(canonicalJson(contentOf(body.sheet)));
  });

  it('chaque écriture, transitions comprises, crée une ligne de révision : content = contentOf, sans id de compte', async () => {
    const { admin, draft } = await setup();
    const sheets: DraftSheet[] = [draft];
    const last = () => sheets.at(-1) as DraftSheet;
    const push = async (res: Promise<Response>) => sheets.push((await ok(res)).sheet);

    await push(putSheet(ctx, admin.cookie, 'brouillon', completed(draft), 1));
    await push(
      postTransition(ctx, admin.cookie, 'brouillon', {
        to: 'reviewed',
        baseRevision: 2,
        reviewChecked: true,
        minorsConfirmed: true,
      }),
    );
    await push(putSheet(ctx, admin.cookie, 'brouillon', { ...last(), breathing: 'Souffle en montant.' }, 3));
    await push(postTransition(ctx, admin.cookie, 'brouillon', { to: 'published', baseRevision: 4 }));
    await push(postTransition(ctx, admin.cookie, 'brouillon', { to: 'retired', baseRevision: 5 }));

    expect(sheets.map((s) => [s.revision, s.status])).toEqual([
      [1, 'draft'],
      [2, 'draft'],
      [3, 'reviewed'],
      [4, 'reviewed'],
      [5, 'published'],
      [6, 'retired'],
    ]);
    // La fiche porte l'id de l'admin (reviewed_by) ; le contenu des révisions jamais.
    expect(last()).toMatchObject({
      reviewed_by: admin.id,
      reviewed_at: NOW,
      published_at: NOW,
      retired_at: NOW,
    });
    const rows = await revisions('brouillon');
    expect(rows.map((r) => [r.revision, r.status])).toEqual(sheets.map((s) => [s.revision, s.status]));
    rows.forEach((row, i) => {
      expect(row.content).toBe(canonicalJson(contentOf(sheets[i] as DraftSheet)));
      expect(row.content).not.toContain(admin.id);
      expect(row.content).not.toContain('reviewed_by');
      expect(row.content).not.toContain('Profondeur à vérifier.');
    });
    expect(rows.slice(1).every((r) => r.savedBy === admin.id && r.savedAt === NOW)).toBe(true);
  });

  it('fiche publiée : elle reste publiée, reviewed_by et reviewed_at mis à jour (04 §8)', async () => {
    const { admin, published } = await setup();
    const other = await createUser(ctx, { username: 'second', role: 'admin', password: 'quatorze carac' });
    const cookie = await login(ctx, 'second', other.password);
    const body = await ok(putSheet(ctx, cookie, 'goblet-squat', { ...published, breathing: 'Souffle.' }, 4));
    expect(body.sheet).toMatchObject({
      status: 'published',
      revision: 5,
      breathing: 'Souffle.',
      reviewed_by: other.id,
      reviewed_at: NOW,
      published_at: published.published_at,
      updated_at: NOW,
    });
    expect(admin.id).not.toBe(other.id);
  });

  it.each<[string, (s: ExerciseSheet) => Record<string, unknown>]>([
    ['un champ obligatoire absent', (s) => without(s, 'breathing')],
    ['une entrée de sécurité de 121 caractères', (s) => ({ ...s, safety: ['x'.repeat(121)] })],
    [
      'des muscles secondaires qui recoupent les principaux',
      (s) => ({ ...s, secondary_muscles: ['glutes'] }),
    ],
    ['un code hors taxonomie', (s) => ({ ...s, movement_pattern: 'cartwheel' })],
    ['un champ facultatif à null', (s) => ({ ...s, setup: null })],
    ['une clé hors schéma', (s) => ({ ...s, exported_revision: 4 })],
  ])('fiche publiée avec %s : 422 invalid_sheet, rien n’est écrit', async (_, edit) => {
    const { admin, published } = await setup();
    const before = { revision: 4, rows: 1, version: await version() };
    const res = await putSheet(ctx, admin.cookie, 'goblet-squat', edit(published), 4);
    await expectBlocked(res, ['invalid_sheet'], 'goblet-squat', before);
  });

  it('brouillon : champs rédigés absents acceptés, un champ présent garde ses bornes', async () => {
    const { admin, draft } = await setup();
    await ok(putSheet(ctx, admin.cookie, 'brouillon', { ...draft, breathing: 'Souffle.' }, 1));
    const before = { revision: 2, rows: 2, version: await version() };
    const res = await putSheet(ctx, admin.cookie, 'brouillon', { ...draft, instructions: ['Une seule.'] }, 2);
    await expectBlocked(res, ['invalid_sheet'], 'brouillon', before);
  });

  it('fiche retirée déjà publiée : elle reste servie, donc complète ; brouillon retiré : incomplet accepté', async () => {
    const { admin } = await setup();
    const retired = await seedSheet(
      ctx,
      sheetFixture('ancienne', { status: 'retired', retired_at: '2026-10-28T08:00:00.000Z' }),
    );
    const before = { revision: 4, rows: 1, version: await version() };
    const res = await putSheet(ctx, admin.cookie, 'ancienne', without(retired, 'breathing'), 4);
    await expectBlocked(res, ['invalid_sheet'], 'ancienne', before);

    const neverPublished = await seedSheet(ctx, retiredDraft('jamais-publiee'));
    const body = await ok(
      putSheet(ctx, admin.cookie, 'jamais-publiee', without(neverPublished, 'breathing'), 4),
    );
    expect(body.sheet).toMatchObject({ status: 'retired', revision: 5 });
    expect(body.sheet).not.toHaveProperty('breathing');
  });

  describe('règles entre fiches du validateur du catalogue (04 §13, critère 1)', () => {
    async function withManifest() {
      const env = await setup();
      const a = illustrationFixture('squat-start');
      const b = illustrationFixture('squat-end', { source: 'workout_guide' });
      await upsertIllustration(ctx.deps.db, a.entry);
      await upsertIllustration(ctx.deps.db, b.entry);
      return env;
    }

    it.each<[string, Record<string, unknown>]>([
      [
        "un alias qui reprend le nom d'une autre fiche après normalize",
        { aliases: ['EXERCICE goblet squat'] },
      ],
      ['un mode de charge que le matériel ne porte pas', { load_mode: 'barbell' }],
      ['un pointeur vers une fiche absente', { chain_id: 'squat', easier_id: 'inconnue' }],
      [
        'une illustration absente du manifeste',
        { illustrations: [{ illustration_id: 'absente', role: 'start' }] },
      ],
      [
        'des illustrations de deux sources',
        {
          illustrations: [
            { illustration_id: 'squat-start', role: 'start' },
            { illustration_id: 'squat-end', role: 'end' },
          ],
        },
      ],
    ])('%s : 422 invalid_sheet', async (_, edit) => {
      const { admin, draft } = await withManifest();
      const before = { revision: 1, rows: 1, version: await version() };
      const res = await putSheet(ctx, admin.cookie, 'brouillon', { ...draft, ...edit }, 1);
      await expectBlocked(res, ['invalid_sheet'], 'brouillon', before);
    });

    it('une chaîne se modifie une fiche à la fois : pointeur pas encore réciproque accepté', async () => {
      const { admin, draft, published } = await withManifest();
      await ok(
        putSheet(
          ctx,
          admin.cookie,
          'goblet-squat',
          { ...published, chain_id: 'squat', easier_id: 'brouillon' },
          4,
        ),
      );
      const body = await ok(
        putSheet(
          ctx,
          admin.cookie,
          'brouillon',
          { ...draft, chain_id: 'squat', harder_id: 'goblet-squat' },
          1,
        ),
      );
      expect(body.sheet).toMatchObject({ chain_id: 'squat', harder_id: 'goblet-squat' });
      const illustrated = await ok(
        putSheet(
          ctx,
          admin.cookie,
          'brouillon',
          { ...body.sheet, illustrations: [{ illustration_id: 'squat-start', role: 'start' }] },
          2,
        ),
      );
      expect(illustrated.sheet.illustrations).toEqual([{ illustration_id: 'squat-start', role: 'start' }]);
    });
  });

  it('fiche inconnue : 404 ; corps invalide : 400 ; rien n’est écrit', async () => {
    const { admin, draft } = await setup();
    const unknown = await putSheet(ctx, admin.cookie, 'inconnue', draft, 1);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'not_found' });
    for (const json of [
      { baseRevision: 1 },
      { sheet: draft },
      { sheet: [draft], baseRevision: 1 },
      { sheet: draft, baseRevision: 0 },
      { sheet: draft, baseRevision: '1' },
    ]) {
      const res = await ctx.request('/api/admin/exercises/brouillon', {
        method: 'PUT',
        cookie: admin.cookie,
        json,
      });
      expect(res.status, JSON.stringify(json)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('validation');
    }
    expect(await revisions('brouillon')).toHaveLength(1);
  });
});
