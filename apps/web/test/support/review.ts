import {
  type DraftSheet,
  DraftSheetSchema,
  type MeResponse,
  REVIEW_QUEUES,
  type ReviewBatchProgress,
  type ReviewCommentView,
  type ReviewListItem,
  type ReviewListResponse,
  type ReviewQueue,
  type ReviewSheetResponse,
} from '@rune/contracts';
import { screen } from '@testing-library/react';
import { setMeta } from '../../src/local-db/meta';
import { settle } from './auth';
import { BASE_SHEET } from './catalog';
import { createFakeApi, type FakeApi, type FakeReply } from './fake-api';
import { createTestLocalDb } from './local-db';
import { makeMe, type RenderAppResult, renderApp } from './render';

// Données d'essai de l'écran de relecture (plan brique 2, Task 16) : lignes de la liste, fiche vue par une
// relectrice, commentaires, et ouverture de l'appli sur /review… (« Comment relire » déjà vu).

export const reviewer = (o: Partial<MeResponse> = {}) => makeMe({ catalogReviewer: true, ...o });
export const healthReviewer = (o: Partial<MeResponse> = {}) => reviewer({ healthProfessional: true, ...o });
export const admin = (o: Partial<MeResponse> = {}) => makeMe({ role: 'admin', ...o });

export const REVIEW_LIST = '/api/review/exercises';
export const reviewSheetPath = (id: string) => `/api/review/exercises/${id}`;

export function reviewItem(
  id: string,
  queues: ReviewQueue[],
  o: Partial<ReviewListItem> = {},
): ReviewListItem {
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

/** Réponse de la liste : compteurs tirés des files des lignes, avancement des lots A et B par défaut. */
export function reviewList(items: ReviewListItem[], progress?: ReviewBatchProgress[]): ReviewListResponse {
  const counts = Object.fromEntries(
    REVIEW_QUEUES.map((q) => [q, items.filter((i) => i.queues.includes(q)).length]),
  ) as ReviewListResponse['counts'];
  return {
    items,
    counts,
    progress: progress ?? [
      { batch: 'A', published: 0, total: items.length },
      { batch: 'B', published: 0, total: 0 },
    ],
  };
}

/** Squat goblet relu, version 4, lot A : fiche complète de la relecture. */
export const REVIEW_SHEET: DraftSheet = DraftSheetSchema.parse({
  ...structuredClone(BASE_SHEET),
  status: 'reviewed',
  batch: 'A',
  setup: 'Prends un haltère de poids moyen.',
  easier_tip: 'Descends sur une chaise derrière toi.',
});

/** Fiche vue par une relectrice : la fiche relue surchargée par `sheet`, puis le reste de la réponse. */
export function sheetResponse(
  o: Omit<Partial<ReviewSheetResponse>, 'sheet'> & { sheet?: Partial<DraftSheet> } = {},
): ReviewSheetResponse {
  const { sheet, ...rest } = o;
  return {
    sheet: DraftSheetSchema.parse({ ...structuredClone(REVIEW_SHEET), ...sheet }),
    sensitive: false,
    greenLight: 'missing',
    validatedByMe: false,
    queues: ['to_review'],
    diff: null,
    diffBase: null,
    comments: [],
    ...rest,
  };
}

export function reviewComment(
  id: string,
  part: ReviewCommentView['part'],
  o: Partial<ReviewCommentView> = {},
): ReviewCommentView {
  return {
    id,
    part,
    body: `Commentaire ${id}`,
    revision: 4,
    createdAt: '2026-10-05T08:30:00.000Z',
    resolvedAt: null,
    authorName: 'zoe',
    mine: false,
    ...o,
  };
}

/** Faux serveur de la relecture : la liste et une fiche (réponses fixes ou fonctions). */
export function reviewApi(o: {
  list?: FakeReply | (() => FakeReply);
  sheets?: Record<string, FakeReply | (() => FakeReply)>;
}): FakeApi {
  const api = createFakeApi();
  if (o.list) api.on('GET', REVIEW_LIST, o.list);
  for (const [id, reply] of Object.entries(o.sheets ?? {})) api.on('GET', reviewSheetPath(id), reply);
  return api;
}

export const ok = <T>(body: T): FakeReply => ({ status: 200, body });

/**
 * Drapeau de relectrice retiré par l'admin juste avant la requête `method path` : elle reçoit 403 `forbidden`, et
 * `/api/me` dit ensuite « plus relectrice » (avant, il dit relectrice, comme au lancement de l'appli).
 */
export function revokeOn(api: FakeApi, method: string, path: string): FakeApi {
  let revoked = false;
  return api
    .on(method, path, () => {
      revoked = true;
      return { status: 403, body: { error: 'forbidden' } };
    })
    .on('GET', '/api/me', () => ok(revoked ? reviewer({ catalogReviewer: false }) : reviewer()));
}

/** Appels reçus par le faux serveur sur `path` (et la méthode, GET par défaut). */
export const callsTo = (api: FakeApi, path: string, method = 'GET') =>
  api.calls.filter((c) => c.path === path && c.method === method);

/**
 * L'appli au chemin `path` de la relecture, « Comment relire » déjà vu par le compte : attend le titre de niveau 1
 * et les lectures faites.
 */
export async function openReview(
  path: string,
  o: { me?: MeResponse; api: FakeApi; db?: ReturnType<typeof createTestLocalDb> },
): Promise<RenderAppResult> {
  const me = o.me ?? reviewer();
  const db = o.db ?? createTestLocalDb();
  await setMeta(db, 'reviewIntroSeen', me.id);
  const view = await renderApp({ path, me, api: o.api, db });
  await screen.findByRole('heading', { level: 1 });
  await settle();
  return view;
}
