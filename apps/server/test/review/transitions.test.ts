import {
  CATALOG_MAX_SHEETS,
  type DraftSheet,
  type ExerciseStatus,
  type ReviewSheetResponse,
} from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { insertSheet } from '../../src/catalog/repo';
import { createTestContext, createUser, login, type TestContext } from '../support';
import { sheetFixture, skeletonFixture } from '../support/catalog';
import { postTransition, putSheet, rebuild } from '../support/review';

let ctx: TestContext;
afterEach(() => ctx?.close());

const NOW = '2026-10-30T09:00:00.000Z';
const RETIRED_AT = '2026-10-28T08:00:00.000Z';

/** Insère des fiches dans une seule transaction : les pointeurs de chaîne sont vérifiés au commit. */
async function seedAll(sheets: readonly DraftSheet[]): Promise<void> {
  await ctx.deps.db.transaction().execute(async (trx) => {
    for (const sheet of sheets) {
      await insertSheet(trx, sheet, { savedAt: NOW, savedBy: null, exportedRevision: sheet.revision });
    }
  });
}

/** Fiche relue complète, jamais publiée ; non sensible (hanches seulement) sauf surcharge. */
const reviewed = (id: string, overrides: Partial<DraftSheet> = {}) =>
  sheetFixture(id, { status: 'reviewed', published_at: undefined, stressed_joints: ['hips'], ...overrides });

/** Chaîne `rangee` de trois fiches publiées, pointeurs réciproques. */
const CHAIN = [
  sheetFixture('chain-a', { chain_id: 'rangee', harder_id: 'chain-b' }),
  sheetFixture('chain-b', { chain_id: 'rangee', easier_id: 'chain-a', harder_id: 'chain-c' }),
  sheetFixture('chain-c', { chain_id: 'rangee', easier_id: 'chain-b' }),
];

const SHEETS: DraftSheet[] = [
  skeletonFixture('brouillon'),
  sheetFixture('brouillon-complet', { status: 'draft', published_at: undefined, reviewed_at: undefined }),
  // Brouillon enregistré invalide (insertion directe, hors API) : seul moyen d'atteindre invalid_sheet.
  skeletonFixture('brouillon-invalide', { safety: ['x'.repeat(121)] }),
  reviewed('relue'),
  reviewed('relue-sensible', { stressed_joints: ['knees'] }),
  reviewed('relue-bloquee', {
    stressed_joints: ['knees'],
    illustrations: [{ illustration_id: 'absente', role: 'start' }],
  }),
  sheetFixture('publiee'),
  sheetFixture('retiree', { status: 'retired', retired_at: RETIRED_AT }),
  skeletonFixture('brouillon-retire', { status: 'retired', retired_at: RETIRED_AT }),
  ...CHAIN,
];
const ACTIVE = SHEETS.filter((s) => s.status !== 'retired').length;

async function setup() {
  ctx = await createTestContext();
  await seedAll(SHEETS);
  await rebuild(ctx);
  const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
  const zoe = await createUser(ctx, { username: 'zoe', catalogReviewer: true });
  const hana = await createUser(ctx, { username: 'hana', catalogReviewer: true, healthProfessional: true });
  const cookies = {
    admin: await login(ctx, 'porteur', admin.password),
    zoe: await login(ctx, 'zoe', zoe.password),
    hana: await login(ctx, 'hana', hana.password),
  };
  ctx.clock.set(NOW);
  return { admin, cookies };
}

const revisionOf = async (id: string) =>
  (await ctx.deps.db.selectFrom('exercise').select('revision').where('id', '=', id).executeTakeFirstOrThrow())
    .revision;
const base = (id: string) => SHEETS.find((s) => s.id === id)?.revision ?? 0;

/** Transition `id → to` depuis la révision en base, avec les cases cochées sauf surcharge. */
async function move(
  cookie: string,
  id: string,
  to: ExerciseStatus,
  boxes: { reviewChecked?: boolean; minorsConfirmed?: boolean } = {},
) {
  return postTransition(ctx, cookie, id, { to, baseRevision: await revisionOf(id), ...boxes });
}

async function ok(res: Response): Promise<ReviewSheetResponse> {
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ReviewSheetResponse;
}

/** 422 avec `blockers` dans l'ordre ; la fiche garde sa révision. */
async function blocked(res: Promise<Response>, id: string, blockers: readonly string[]) {
  const before = await revisionOf(id);
  const response = await res;
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: 'transition_blocked', blockers });
  expect(await revisionOf(id)).toBe(before);
}

const BOTH = { reviewChecked: true, minorsConfirmed: true };

describe('POST /api/admin/exercises/:id/transition : circuit de 04 §8', () => {
  it.each<[string, ExerciseStatus]>([
    ['brouillon-complet', 'draft'],
    ['brouillon-complet', 'published'],
    ['relue', 'reviewed'],
    ['publiee', 'draft'],
    ['publiee', 'reviewed'],
    ['publiee', 'published'],
    ['retiree', 'draft'],
    ['retiree', 'published'],
    ['retiree', 'retired'],
  ])('%s → %s : transition absente du circuit, 400 sur `to`, rien n’est écrit', async (id, to) => {
    const { cookies } = await setup();
    const res = await move(cookies.admin, id, to, BOTH);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'validation',
      issues: [{ path: 'to', message: expect.stringContaining('04 §8') }],
    });
    expect(await revisionOf(id)).toBe(base(id));
  });

  it('fiche inconnue : 404 ; corps invalide : 400', async () => {
    const { cookies } = await setup();
    const unknown = await postTransition(ctx, cookies.admin, 'inconnue', { to: 'retired', baseRevision: 1 });
    expect(unknown.status).toBe(404);
    for (const json of [
      { to: 'archived', baseRevision: 4 },
      { to: 'retired' },
      { to: 'retired', baseRevision: 4, reviewChecked: 'oui' },
    ]) {
      const res = await ctx.request('/api/admin/exercises/publiee/transition', {
        method: 'POST',
        cookie: cookies.admin,
        json,
      });
      expect(res.status, JSON.stringify(json)).toBe(400);
    }
    expect(await revisionOf('publiee')).toBe(4);
  });
});

describe('draft → reviewed (spec brique 2 §3.6)', () => {
  it('blocages dans l’ordre : incomplete, invalid_sheet, review_unchecked, minors_unconfirmed', async () => {
    const { cookies } = await setup();
    await blocked(move(cookies.admin, 'brouillon-invalide', 'reviewed'), 'brouillon-invalide', [
      'incomplete',
      'invalid_sheet',
      'review_unchecked',
      'minors_unconfirmed',
    ]);
    await blocked(move(cookies.admin, 'brouillon', 'reviewed', BOTH), 'brouillon', ['incomplete']);
    await blocked(
      move(cookies.admin, 'brouillon-complet', 'reviewed', { reviewChecked: true }),
      'brouillon-complet',
      ['minors_unconfirmed'],
    );
    await blocked(
      move(cookies.admin, 'brouillon-complet', 'reviewed', { minorsConfirmed: true }),
      'brouillon-complet',
      ['review_unchecked'],
    );
  });

  it('fiche complète, cases cochées : relue, reviewed_by et reviewed_at renseignés, contenu inchangé', async () => {
    const { admin, cookies } = await setup();
    const body = await ok(await move(cookies.admin, 'brouillon-complet', 'reviewed', BOTH));
    const before = SHEETS[1] as DraftSheet;
    expect(body.sheet).toEqual({
      ...before,
      status: 'reviewed',
      revision: before.revision + 1,
      reviewed_by: admin.id,
      reviewed_at: NOW,
      updated_at: NOW,
    });
    const contents = await ctx.deps.db
      .selectFrom('exerciseRevision')
      .select('content')
      .where('exerciseId', '=', 'brouillon-complet')
      .orderBy('revision')
      .execute();
    expect(contents).toHaveLength(2);
    expect(contents[1]?.content).toBe(contents[0]?.content);
  });
});

describe('reviewed → draft et reviewed → published', () => {
  it('renvoi en rédaction toujours permis, même avec un commentaire ouvert et sans feu vert', async () => {
    const { cookies } = await setup();
    const comment = await ctx.request('/api/review/exercises/relue-sensible/comments', {
      method: 'POST',
      cookie: cookies.zoe,
      json: { part: 'safety', body: 'À reprendre.', baseRevision: 4 },
    });
    expect(comment.status).toBe(201);
    const body = await ok(await move(cookies.admin, 'relue-sensible', 'draft'));
    expect(body.sheet).toMatchObject({ status: 'draft', revision: 5 });
  });

  it('publication : open_comments, health_validation_missing, illustrations_missing dans cet ordre', async () => {
    const { cookies } = await setup();
    const comment = await ctx.request('/api/review/exercises/relue-bloquee/comments', {
      method: 'POST',
      cookie: cookies.zoe,
      json: { part: 'general', body: 'Une remarque.', baseRevision: 4 },
    });
    expect(comment.status).toBe(201);
    await blocked(move(cookies.admin, 'relue-bloquee', 'published'), 'relue-bloquee', [
      'open_comments',
      'health_validation_missing',
      'illustrations_missing',
    ]);
  });

  it('fiche non sensible sans blocage : publiée, published_at renseigné', async () => {
    const { cookies } = await setup();
    const body = await ok(await move(cookies.admin, 'relue', 'published'));
    expect(body.sheet).toMatchObject({
      status: 'published',
      revision: 5,
      published_at: NOW,
      updated_at: NOW,
    });
  });

  it('fiche sensible : publiable avec le feu vert santé à jour, plus après une modification du contenu', async () => {
    const { cookies } = await setup();
    await blocked(move(cookies.admin, 'relue-sensible', 'published'), 'relue-sensible', [
      'health_validation_missing',
    ]);
    const validate = await ctx.request('/api/review/exercises/relue-sensible/validations', {
      method: 'POST',
      cookie: cookies.hana,
      json: { baseRevision: 4 },
    });
    expect(validate.status).toBe(201);
    const sheet = SHEETS.find((s) => s.id === 'relue-sensible') as DraftSheet;
    await ok(await putSheet(ctx, cookies.admin, 'relue-sensible', { ...sheet, breathing: 'Souffle.' }, 4));
    await blocked(move(cookies.admin, 'relue-sensible', 'published'), 'relue-sensible', [
      'health_validation_missing',
    ]);
    const again = await ctx.request('/api/review/exercises/relue-sensible/validations', {
      method: 'POST',
      cookie: cookies.hana,
      json: { baseRevision: 5 },
    });
    expect(again.status).toBe(201);
    const body = await ok(await move(cookies.admin, 'relue-sensible', 'published'));
    expect(body).toMatchObject({ sheet: { status: 'published' }, greenLight: 'ok' });
  });
});

describe('→ retired', () => {
  it.each(['brouillon', 'relue', 'publiee'])('%s → retired : retired_at renseigné', async (id) => {
    const { cookies } = await setup();
    const body = await ok(await move(cookies.admin, id, 'retired'));
    expect(body.sheet).toMatchObject({ status: 'retired', retired_at: NOW, revision: base(id) + 1 });
  });

  it('refus de retirer une fiche citée par un modèle, dans une liste de slot ou par sa chaîne', async () => {
    const { cookies } = await setup();
    await rebuild(ctx, [
      {
        id: 'gym-beginner-full-body',
        workouts: [
          {
            id: 'A',
            slots: [
              { id: 'A1', exercises: ['publiee'] },
              { id: 'A2', chain: 'rangee' },
            ],
          },
        ],
      },
    ]);
    await blocked(move(cookies.admin, 'publiee', 'retired'), 'publiee', ['referenced_by_template']);
    await blocked(move(cookies.admin, 'chain-a', 'retired'), 'chain-a', [
      'referenced_by_template',
      'chain_break',
    ]);
    await ok(await move(cookies.admin, 'relue', 'retired'));
  });

  it('brouillon incomplet déjà publié une fois : il resterait servi une fois retiré, donc invalid_sheet', async () => {
    const { cookies } = await setup();
    await seedAll([skeletonFixture('republiee', { published_at: '2026-10-01T08:00:00.000Z' })]);
    await blocked(move(cookies.admin, 'republiee', 'retired'), 'republiee', ['invalid_sheet']);
  });

  it('chain_break : retirer le milieu coupe la chaîne ; après avoir relié ses voisines, on peut', async () => {
    const { cookies } = await setup();
    await blocked(move(cookies.admin, 'chain-b', 'retired'), 'chain-b', ['chain_break']);
    const [a, , c] = CHAIN as [DraftSheet, DraftSheet, DraftSheet];
    await ok(await putSheet(ctx, cookies.admin, 'chain-a', { ...a, harder_id: 'chain-c' }, 4));
    await ok(await putSheet(ctx, cookies.admin, 'chain-c', { ...c, easier_id: 'chain-a' }, 4));
    await ok(await move(cookies.admin, 'chain-b', 'retired'));
  });
});

describe('retired → reviewed (réactivation)', () => {
  it('fiche complète, les deux cases cochées : relue, retired_at effacé, published_at gardé', async () => {
    const { admin, cookies } = await setup();
    const body = await ok(await move(cookies.admin, 'retiree', 'reviewed', BOTH));
    expect(body.sheet).toMatchObject({
      status: 'reviewed',
      revision: 5,
      reviewed_by: admin.id,
      reviewed_at: NOW,
      published_at: (SHEETS.find((s) => s.id === 'retiree') as DraftSheet).published_at,
    });
    expect(body.sheet).not.toHaveProperty('retired_at');
  });

  it('les deux cases de draft → reviewed sont demandées : une fiche retirée a pu être modifiée', async () => {
    const { cookies } = await setup();
    await blocked(move(cookies.admin, 'retiree', 'reviewed'), 'retiree', [
      'review_unchecked',
      'minors_unconfirmed',
    ]);
    await blocked(move(cookies.admin, 'retiree', 'reviewed', { reviewChecked: true }), 'retiree', [
      'minors_unconfirmed',
    ]);
  });

  it('brouillon retiré incomplet : incomplete', async () => {
    const { cookies } = await setup();
    await blocked(move(cookies.admin, 'brouillon-retire', 'reviewed', BOTH), 'brouillon-retire', [
      'incomplete',
    ]);
  });

  it(`catalog_full à ${CATALOG_MAX_SHEETS} fiches non retirées, permise à ${CATALOG_MAX_SHEETS - 1}`, async () => {
    const { cookies } = await setup();
    await seedAll(
      Array.from({ length: CATALOG_MAX_SHEETS - ACTIVE }, (_, i) => skeletonFixture(`remplissage-${i}`)),
    );
    await blocked(move(cookies.admin, 'retiree', 'reviewed', BOTH), 'retiree', ['catalog_full']);
    await ok(await move(cookies.admin, 'brouillon', 'retired'));
    await ok(await move(cookies.admin, 'retiree', 'reviewed', BOTH));
  });
});
