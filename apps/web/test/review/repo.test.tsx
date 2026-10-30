import type {
  CreateCommentRequest,
  DraftSheet,
  MemberSummary,
  MeResponse,
  ReviewCommentView,
  ReviewListItem,
  ReviewListResponse,
  ReviewQueue,
  ReviewSheetResponse,
} from '@rune/contracts';
import { REVIEW_QUEUES } from '@rune/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkRequiredError } from '../../src/api/client';
import { getMeta } from '../../src/local-db/meta';
import {
  commentDraft,
  createRepos,
  isLostAccess,
  type Repos,
  ReviewAccessLostError,
  revisionConflictOf,
  transitionBlockersOf,
} from '../../src/repos';
import { createFakeApi, type FakeApi, type FakeRequest } from '../support/fake-api';
import { createTestServices, makeMe } from '../support/render';

// Dépôt de la relecture (plan brique 2, Task 15) : API en ligne seulement (classe H), « Nécessite le réseau »
// hors ligne, perte du rôle (403) reconnue, brouillon de commentaire gardé sur l'appareil par compte et par fiche.

/** Squelette de brouillon (04 §8 étape 1), révision 3. */
const SHEET: DraftSheet = {
  id: 'push-up',
  schema_version: 1,
  revision: 3,
  status: 'draft',
  batch: 'A',
  name: 'Pompes',
  movement_pattern: 'horizontal_push',
  mechanics: 'compound',
  unilateral: false,
  measure: 'reps',
  load_mode: 'bodyweight',
  equipment_options: [[]],
  level: 1,
  not_for_minors: false,
};

function item(id: string, queues: ReviewQueue[], o: Partial<ReviewListItem> = {}): ReviewListItem {
  return {
    id,
    name: `Fiche ${id}`,
    status: 'reviewed',
    batch: 'A',
    revision: 2,
    movementPattern: 'squat',
    level: 1,
    notForMinors: false,
    stressedJoints: [],
    sensitive: false,
    openComments: 0,
    greenLight: 'missing',
    validatedByMe: false,
    illustrationCount: 0,
    queues,
    ...o,
  };
}

function listBody(items: ReviewListItem[]): ReviewListResponse {
  const counts = Object.fromEntries(
    REVIEW_QUEUES.map((q) => [q, items.filter((i) => i.queues.includes(q)).length]),
  ) as ReviewListResponse['counts'];
  return {
    items,
    counts,
    progress: [
      { batch: 'A', published: 0, total: items.length },
      { batch: 'B', published: 0, total: 0 },
    ],
  };
}

const COMMENT: ReviewCommentView = {
  id: 'c-1',
  part: 'mistakes',
  body: 'La deuxième erreur répète la première.',
  revision: 3,
  createdAt: '2026-10-06T12:00:00.000Z',
  resolvedAt: null,
  authorName: 'lea',
  mine: true,
};

const SHEET_VIEW: ReviewSheetResponse = {
  sheet: SHEET,
  sensitive: false,
  greenLight: 'missing',
  validatedByMe: false,
  queues: ['drafts'],
  diff: null,
  diffBase: null,
  comments: [COMMENT],
};

const MEMBER: MemberSummary = {
  id: 'u-2',
  username: 'zoe',
  role: 'member',
  status: 'active',
  isMinor: false,
  lastLoginAt: null,
  onboardingCompleted: true,
  consents: { health: false, aiCoach: false },
  activeSessions: 1,
  catalogReviewer: true,
  healthProfessional: false,
};

const reviewer = (o: Partial<MeResponse> = {}) => makeMe({ catalogReviewer: true, ...o });

async function setup(o: { me?: MeResponse; api?: FakeApi } = {}) {
  const t = await createTestServices({ me: o.me ?? reviewer(), api: o.api });
  return { ...t, repos: createRepos(t.services) };
}

const callsTo = (api: FakeApi, path: string) => api.calls.filter((c) => c.path === path);
const only = (calls: FakeRequest[]): FakeRequest => {
  expect(calls).toHaveLength(1);
  return calls[0] as FakeRequest;
};
const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => {
      throw new Error('promesse résolue, refus attendu');
    },
    (e: unknown) => e,
  );

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('reviewRepo : lectures (GET /api/review/*)', () => {
  it('list() sans file : GET /api/review/exercises sans paramètre, réponse validée', async () => {
    const body = listBody([item('a', ['to_review']), item('b', ['drafts'], { status: 'draft' })]);
    const api = createFakeApi().on('GET', '/api/review/exercises', { status: 200, body });
    const { repos } = await setup({ api });
    expect(await repos.review.list()).toEqual(body);
    const call = only(callsTo(api, '/api/review/exercises'));
    expect(call.query.toString()).toBe('');
  });

  it('list(queue) et filtres : queue, batch et status passent en paramètres', async () => {
    const api = createFakeApi().on('GET', '/api/review/exercises', { status: 200, body: listBody([]) });
    const { repos } = await setup({ api });
    await repos.review.list('to_review');
    await repos.review.list('drafts', { batch: 'E2', status: 'draft' });
    const [first, second] = callsTo(api, '/api/review/exercises');
    expect(first?.query.toString()).toBe('queue=to_review');
    expect(Object.fromEntries(second?.query ?? [])).toEqual({
      queue: 'drafts',
      batch: 'E2',
      status: 'draft',
    });
  });

  it('get(id) : GET /api/review/exercises/:id (id encodé), réponse validée', async () => {
    const api = createFakeApi().on('GET', '/api/review/exercises/:id', { status: 200, body: SHEET_VIEW });
    const { repos } = await setup({ api });
    expect(await repos.review.get('push-up')).toEqual(SHEET_VIEW);
    expect(api.calls.at(-1)?.path).toBe('/api/review/exercises/push-up');
    await repos.review.get('a b');
    expect(api.calls.at(-1)?.path).toBe('/api/review/exercises/a%20b');
  });

  it('réponse hors contrat : refusée (jamais affichée à moitié)', async () => {
    const api = createFakeApi().on('GET', '/api/review/exercises', { status: 200, body: { items: 'x' } });
    const { repos } = await setup({ api });
    await expect(repos.review.list()).rejects.toThrow();
  });
});

describe('reviewRepo : écritures de relecture (POST, toujours un corps JSON)', () => {
  it('comment : POST …/comments {part, body, baseRevision}, en JSON, commentaire rendu', async () => {
    const api = createFakeApi().on('POST', '/api/review/exercises/:id/comments', {
      status: 201,
      body: COMMENT,
    });
    const { repos } = await setup({ api });
    const req: CreateCommentRequest = { part: 'mistakes', body: COMMENT.body, baseRevision: 3 };
    expect(await repos.review.comment('push-up', req)).toEqual(COMMENT);
    const call = only(callsTo(api, '/api/review/exercises/push-up/comments'));
    expect(call.method).toBe('POST');
    expect(call.headers.get('Content-Type')).toBe('application/json');
    expect(call.body).toEqual(req);
  });

  it('comment envoyé : le brouillon de cette fiche pour ce compte est effacé, les autres restent', async () => {
    const api = createFakeApi().on('POST', '/api/review/exercises/:id/comments', {
      status: 201,
      body: COMMENT,
    });
    const { repos } = await setup({ api });
    commentDraft.set('u-1', 'push-up', { part: 'mistakes', body: 'brouillon' });
    commentDraft.set('u-1', 'squat', { part: 'general', body: 'autre fiche' });
    commentDraft.set('u-9', 'push-up', { part: 'general', body: 'autre compte' });
    await repos.review.comment('push-up', { part: 'mistakes', body: 'brouillon', baseRevision: 3 });
    expect(commentDraft.get('u-1', 'push-up')).toBeNull();
    expect(commentDraft.get('u-1', 'squat')).toEqual({ part: 'general', body: 'autre fiche' });
    expect(commentDraft.get('u-9', 'push-up')).toEqual({ part: 'general', body: 'autre compte' });
  });

  it('comment refusé ou hors ligne : le brouillon reste (une coupure ne le perd pas)', async () => {
    const api = createFakeApi().on('POST', '/api/review/exercises/:id/comments', {
      status: 409,
      body: { error: 'not_reviewable' },
    });
    const { repos } = await setup({ api });
    commentDraft.set('u-1', 'push-up', { part: 'safety', body: 'à garder' });
    const req: CreateCommentRequest = { part: 'safety', body: 'à garder', baseRevision: 3 };
    expect(await caught(repos.review.comment('push-up', req))).toMatchObject({ code: 'not_reviewable' });
    api.setOffline('reject');
    expect(await caught(repos.review.comment('push-up', req))).toBeInstanceOf(NetworkRequiredError);
    expect(commentDraft.get('u-1', 'push-up')).toEqual({ part: 'safety', body: 'à garder' });
  });

  it('resolve : POST /api/review/comments/:cid/resolve avec le corps JSON {} (sinon 415)', async () => {
    const resolved = { ...COMMENT, resolvedAt: '2026-10-06T13:00:00.000Z' };
    const api = createFakeApi().on('POST', '/api/review/comments/:cid/resolve', {
      status: 200,
      body: resolved,
    });
    const { repos } = await setup({ api });
    expect(await repos.review.resolve('c-1')).toEqual(resolved);
    const call = only(callsTo(api, '/api/review/comments/c-1/resolve'));
    expect(call.init.body).toBe('{}');
    expect(call.headers.get('Content-Type')).toBe('application/json');
  });

  it('validate : POST …/validations {baseRevision}, validation rendue (201 ou 200 doublon)', async () => {
    const validation = { id: 'v-1', revision: 3, createdAt: '2026-10-06T12:00:00.000Z' };
    const api = createFakeApi().on('POST', '/api/review/exercises/:id/validations', {
      status: 201,
      body: validation,
    });
    const { repos } = await setup({ api });
    expect(await repos.review.validate('push-up', { baseRevision: 3 })).toEqual(validation);
    expect(only(callsTo(api, '/api/review/exercises/push-up/validations')).body).toEqual({ baseRevision: 3 });
    api.on('POST', '/api/review/exercises/:id/validations', { status: 200, body: validation });
    expect(await repos.review.validate('push-up', { baseRevision: 3 })).toEqual(validation);
  });

  it('409 revision_conflict : ApiError, et revisionConflictOf rend la fiche courante', async () => {
    const current = { ...SHEET, revision: 4, name: 'Pompes classiques' };
    const api = createFakeApi().on('POST', '/api/review/exercises/:id/validations', {
      status: 409,
      body: { error: 'revision_conflict', current },
    });
    const { repos } = await setup({ api });
    const error = await caught(repos.review.validate('push-up', { baseRevision: 3 }));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('revision_conflict');
    expect(revisionConflictOf(error)).toEqual(current);
    expect(revisionConflictOf(new ApiError(409, 'not_reviewable', { error: 'not_reviewable' }))).toBeNull();
    expect(revisionConflictOf(new Error('x'))).toBeNull();
  });
});

describe('reviewRepo : outils de l’admin (types provisoires, routes de la Task 9)', () => {
  it('save : PUT /api/admin/exercises/:id {sheet, baseRevision}, fiche rendue, puis un pull', async () => {
    const saved = { ...SHEET, revision: 4 };
    const api = createFakeApi().on('PUT', '/api/admin/exercises/:id', { status: 200, body: saved });
    const { repos, sync } = await setup({ me: makeMe({ role: 'admin' }), api });
    expect(await repos.review.save('push-up', { sheet: SHEET, baseRevision: 3 })).toEqual(saved);
    const call = only(callsTo(api, '/api/admin/exercises/push-up'));
    expect(call.method).toBe('PUT');
    expect(call.body).toEqual({ sheet: SHEET, baseRevision: 3 });
    expect(sync.pullCount).toBe(1);
  });

  it('transition : POST …/transition {to, baseRevision, reviewChecked, minorsConfirmed}, puis un pull', async () => {
    const reviewed = { ...SHEET, revision: 4, status: 'draft' as const };
    const api = createFakeApi().on('POST', '/api/admin/exercises/:id/transition', {
      status: 200,
      body: reviewed,
    });
    const { repos, sync } = await setup({ me: makeMe({ role: 'admin' }), api });
    const req = { to: 'draft' as const, baseRevision: 3, reviewChecked: true, minorsConfirmed: true };
    expect(await repos.review.transition('push-up', req)).toEqual(reviewed);
    expect(only(callsTo(api, '/api/admin/exercises/push-up/transition')).body).toEqual(req);
    expect(sync.pullCount).toBe(1);
  });

  it('422 transition_blocked : transitionBlockersOf rend les blocages dans l’ordre reçu', async () => {
    const api = createFakeApi().on('POST', '/api/admin/exercises/:id/transition', {
      status: 422,
      body: { error: 'transition_blocked', blockers: ['incomplete', 'review_unchecked'] },
    });
    const { repos, sync } = await setup({ me: makeMe({ role: 'admin' }), api });
    const error = await caught(repos.review.transition('push-up', { to: 'reviewed', baseRevision: 3 }));
    expect(transitionBlockersOf(error)).toEqual(['incomplete', 'review_unchecked']);
    expect(transitionBlockersOf(new ApiError(409, 'revision_conflict', {}))).toBeNull();
    expect(sync.pullCount).toBe(0);
  });

  it('exportCatalog : GET /api/admin/exercises/export, fichier rendu tel quel', async () => {
    const file = { exercises: [SHEET] };
    const api = createFakeApi().on('GET', '/api/admin/exercises/export', { status: 200, body: file });
    const { repos } = await setup({ me: makeMe({ role: 'admin' }), api });
    expect(await repos.review.exportCatalog()).toEqual(file);
  });

  it('setReviewerFlags : POST /api/admin/members/:id/reviewer-flags, MemberSummary à jour rendu', async () => {
    const api = createFakeApi().on('POST', '/api/admin/members/:id/reviewer-flags', {
      status: 200,
      body: MEMBER,
    });
    const { repos } = await setup({ me: makeMe({ role: 'admin' }), api });
    const req = { catalogReviewer: true, healthProfessional: false, password: 'secret' };
    expect(await repos.review.setReviewerFlags('u-2', req)).toEqual(MEMBER);
    expect(only(callsTo(api, '/api/admin/members/u-2/reviewer-flags')).body).toEqual(req);
  });

  it('403 self_health_flag : erreur de l’API telle quelle, pas une perte du rôle (aucune relecture de /api/me)', async () => {
    const api = createFakeApi().on('POST', '/api/admin/members/:id/reviewer-flags', {
      status: 403,
      body: { error: 'self_health_flag' },
    });
    const { repos } = await setup({ me: makeMe({ role: 'admin' }), api });
    const req = { catalogReviewer: true, healthProfessional: true, password: 'secret' };
    const error = await caught(repos.review.setReviewerFlags('u-1', req));
    expect((error as ApiError).code).toBe('self_health_flag');
    expect(isLostAccess(error)).toBe(false);
    expect(callsTo(api, '/api/me')).toHaveLength(0);
  });
});

describe('reviewRepo hors ligne : « Nécessite le réseau », rien d’écrit en local', () => {
  const CALLS: [string, (r: Repos) => Promise<unknown>][] = [
    ['list', (r) => r.review.list()],
    ['get', (r) => r.review.get('push-up')],
    ['comment', (r) => r.review.comment('push-up', { part: 'general', body: 'x', baseRevision: 3 })],
    ['resolve', (r) => r.review.resolve('c-1')],
    ['validate', (r) => r.review.validate('push-up', { baseRevision: 3 })],
    ['save', (r) => r.review.save('push-up', { sheet: SHEET, baseRevision: 3 })],
    ['transition', (r) => r.review.transition('push-up', { to: 'reviewed', baseRevision: 3 })],
    ['exportCatalog', (r) => r.review.exportCatalog()],
    [
      'setReviewerFlags',
      (r) =>
        r.review.setReviewerFlags('u-2', { catalogReviewer: true, healthProfessional: false, password: 'p' }),
    ],
  ];
  for (const [name, call] of CALLS) {
    it(name, async () => {
      const { repos, api, sync, db } = await setup();
      api.setOffline('reject');
      const error = await caught(call(repos));
      expect(error).toBeInstanceOf(NetworkRequiredError);
      expect((error as Error).message).toBe('Nécessite le réseau');
      expect(sync.pullCount).toBe(0);
      expect(await db.outbox.count()).toBe(0);
    });
  }
});

describe('reviewRepo : rôle perdu en pleine session (403 forbidden)', () => {
  /** Relecture refusée (403) ; /api/me répond `me` (null : en erreur). */
  function revokedApi(me: MeResponse | null): FakeApi {
    return createFakeApi()
      .on('GET', '/api/review/exercises', { status: 403, body: { error: 'forbidden' } })
      .on('POST', '/api/review/comments/:cid/resolve', { status: 403, body: { error: 'forbidden' } })
      .on('PUT', '/api/admin/exercises/:id', { status: 403, body: { error: 'forbidden' } })
      .on('GET', '/api/me', me ? { status: 200, body: me } : { status: 500, body: { error: 'internal' } });
  }

  it('drapeau retiré : ReviewAccessLostError (une ApiError forbidden), meta.me laissé à l’écran', async () => {
    const api = revokedApi(makeMe({ catalogReviewer: false }));
    const { repos, db } = await setup({ api });
    const error = await caught(repos.review.list());
    expect(error).toBeInstanceOf(ReviewAccessLostError);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('forbidden');
    expect(isLostAccess(error)).toBe(true);
    expect(callsTo(api, '/api/me')).toHaveLength(1);
    // L'écran quitte la relecture avant de relire le profil : la garde ne montre pas une page introuvable.
    expect((await getMeta(db, 'me'))?.catalogReviewer).toBe(true);
  });

  it('encore relectrice (commentaire d’une autre marqué traité) : refus ordinaire, pas une perte du rôle', async () => {
    const api = revokedApi(reviewer());
    const { repos } = await setup({ api });
    const error = await caught(repos.review.resolve('c-9'));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('forbidden');
    expect(isLostAccess(error)).toBe(false);
  });

  it('admin rétrogradé : relecteur s’il garde le drapeau (refus ordinaire), sinon accès perdu', async () => {
    const kept = await setup({ me: makeMe({ role: 'admin' }), api: revokedApi(reviewer()) });
    const save = (r: Repos) => r.review.save('push-up', { sheet: SHEET, baseRevision: 3 });
    expect(isLostAccess(await caught(save(kept.repos)))).toBe(false);
    const lost = await setup({ me: makeMe({ role: 'admin' }), api: revokedApi(makeMe()) });
    expect(isLostAccess(await caught(save(lost.repos)))).toBe(true);
  });

  it('profil illisible après le 403 : accès perdu (le serveur a refusé la relecture)', async () => {
    const { repos } = await setup({ api: revokedApi(null) });
    expect(isLostAccess(await caught(repos.review.list()))).toBe(true);
  });

  it('autres refus (401, 404, 409) : erreurs de l’API telles quelles, sans relire /api/me', async () => {
    const api = createFakeApi()
      .on('GET', '/api/review/exercises/:id', { status: 404, body: { error: 'not_found' } })
      .on('POST', '/api/review/exercises/:id/validations', {
        status: 409,
        body: { error: 'not_reviewable' },
      });
    const { repos } = await setup({ api });
    expect(await caught(repos.review.get('x'))).toMatchObject({ code: 'not_found' });
    expect(await caught(repos.review.validate('x', { baseRevision: 1 }))).toMatchObject({
      code: 'not_reviewable',
    });
    expect(callsTo(api, '/api/me')).toHaveLength(0);
  });
});

describe('Comment relire : vu une fois par compte (meta de l’appareil)', () => {
  it('pas vu au départ ; marqué pour ce compte ; un autre compte ne l’a pas vu', async () => {
    const { repos, db } = await setup();
    expect(await repos.review.introSeen()).toBe(false);
    await repos.review.markIntroSeen();
    expect(await repos.review.introSeen()).toBe(true);
    expect(await getMeta(db, 'reviewIntroSeen')).toBe('u-1');
    const other = await setup({ me: reviewer({ id: 'u-2' }), api: undefined });
    await other.db.meta.put({ key: 'reviewIntroSeen', value: 'u-1' });
    expect(await other.repos.review.introSeen()).toBe(false);
  });
});

describe('commentDraft : brouillon de commentaire en localStorage, par compte et par fiche', () => {
  it('get/set/clear sous la clé rune.review.draft.<compte>.<fiche>', () => {
    expect(commentDraft.get('u-1', 'push-up')).toBeNull();
    commentDraft.set('u-1', 'push-up', { part: 'safety', body: 'Ligne 1\nLigne 2' });
    expect(JSON.parse(localStorage.getItem('rune.review.draft.u-1.push-up') ?? 'null')).toEqual({
      part: 'safety',
      body: 'Ligne 1\nLigne 2',
    });
    expect(commentDraft.get('u-1', 'push-up')).toEqual({ part: 'safety', body: 'Ligne 1\nLigne 2' });
    expect(commentDraft.get('u-2', 'push-up')).toBeNull();
    expect(commentDraft.get('u-1', 'squat')).toBeNull();
    commentDraft.clear('u-1', 'push-up');
    expect(localStorage.getItem('rune.review.draft.u-1.push-up')).toBeNull();
  });

  it('valeur illisible ou hors contrat : aucun brouillon', () => {
    localStorage.setItem('rune.review.draft.u-1.a', '{pas du json');
    localStorage.setItem('rune.review.draft.u-1.b', JSON.stringify({ part: 'inconnue', body: 'x' }));
    localStorage.setItem('rune.review.draft.u-1.c', JSON.stringify({ part: 'general' }));
    expect(commentDraft.get('u-1', 'a')).toBeNull();
    expect(commentDraft.get('u-1', 'b')).toBeNull();
    expect(commentDraft.get('u-1', 'c')).toBeNull();
  });

  it('stockage bloqué : aucun brouillon, aucune levée', () => {
    const refused = () => {
      throw new DOMException('refusé', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refused);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refused);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refused);
    expect(commentDraft.get('u-1', 'push-up')).toBeNull();
    expect(() => commentDraft.set('u-1', 'push-up', { part: 'general', body: 'x' })).not.toThrow();
    expect(() => commentDraft.clear('u-1', 'push-up')).not.toThrow();
  });

  it('déconnexion : tous les brouillons de relecture effacés, les autres réglages gardés', async () => {
    const api = createFakeApi().on('POST', '/api/auth/logout', { status: 204 });
    const { repos } = await setup({ api });
    commentDraft.set('u-1', 'push-up', { part: 'general', body: 'a' });
    commentDraft.set('u-1', 'squat', { part: 'general', body: 'b' });
    commentDraft.set('u-7', 'squat', { part: 'general', body: 'ancien compte' });
    localStorage.setItem('rune.theme', 'carnet');
    await repos.me.logout('current');
    expect(commentDraft.get('u-1', 'push-up')).toBeNull();
    expect(commentDraft.get('u-1', 'squat')).toBeNull();
    expect(commentDraft.get('u-7', 'squat')).toBeNull();
    expect(Object.keys(localStorage)).toEqual(['rune.theme']);
  });

  it('suppression du compte : brouillons effacés', async () => {
    const api = createFakeApi().on('POST', '/api/me/delete', { status: 204 });
    const { repos } = await setup({ api });
    commentDraft.set('u-1', 'push-up', { part: 'general', body: 'a' });
    await repos.me.deleteAccount('secret');
    expect(commentDraft.get('u-1', 'push-up')).toBeNull();
  });

  it('compte supprimé constaté par l’API (410) : brouillons effacés avec la base', async () => {
    const api = createFakeApi().on('GET', '/api/review/exercises', {
      status: 410,
      body: { error: 'account_deleted' },
    });
    const { repos, visits } = await setup({ api });
    commentDraft.set('u-1', 'push-up', { part: 'general', body: 'a' });
    await caught(repos.review.list());
    await vi.waitFor(() => expect(visits).toContain('/login?reason=account_deleted'));
    expect(commentDraft.get('u-1', 'push-up')).toBeNull();
  });
});
