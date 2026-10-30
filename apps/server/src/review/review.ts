import {
  COMMENT_PARTS,
  type CreateCommentRequest,
  type DraftSheet,
  type GreenLight,
  REVIEW_QUEUES,
  type ReviewCommentView,
  type ReviewListItem,
  type ReviewListQuery,
  type ReviewListResponse,
  type ReviewQueue,
  type ReviewSheetResponse,
  type ReviewValidationView,
  type ValidateRequest,
  type ValidationResponse,
} from '@rune/contracts';
import {
  contentDiff,
  hasValidatedContent,
  healthGreenLight,
  isHealthReviewer,
  isSensitive,
  progressByBatch,
  type ReviewerState,
  type ReviewQueueFlags,
  type RevisionRow,
  reviewQueues,
  standingHealthValidations,
  type Validation,
} from '@rune/domain';
import type { Selectable } from 'kysely';
import type { SessionUser } from '../app-env';
import { rowToSheet } from '../catalog/repo';
import type { DbExecutor, ExerciseTable } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';

/*
 * Relecture à plusieurs (spec brique 2 §3.2 à §3.4, §3.8, §3.9) : files, fiche vue par un relecteur, commentaires
 * et validations. Les prédicats (files, feu vert, différentiel) sont ceux de `packages/domain`, jamais réécrits
 * ici. Un commentaire ou une validation ne touche pas au catalogue servi (§3.7) : ni `rebuildCatalog`, ni
 * `catalog_version`.
 */

type ExerciseRow = Selectable<ExerciseTable>;

type CommentRow = {
  id: string;
  exerciseId: string;
  authorId: string | null;
  authorName: string | null;
  part: ReviewCommentView['part'];
  body: string;
  revision: number;
  createdAt: string;
  resolvedAt: string | null;
};

type ValidationRow = Validation & {
  id: string;
  exerciseId: string;
  reviewerName: string | null;
  createdAt: string;
};

/** Ce que la base sait de la relecture d'une fiche, ou de toutes. */
type ReviewData = {
  rows: ExerciseRow[];
  revisions: Map<string, RevisionRow[]>;
  validations: Map<string, ValidationRow[]>;
  comments: Map<string, CommentRow[]>;
  /** Rôle et drapeaux actuels des auteurs de validations. */
  users: Map<string, ReviewerState>;
  manifestIds: Set<string>;
  replaceBeforePublic: number;
};

/** Une fiche évaluée pour l'appelant. */
type Evaluated = {
  row: ExerciseRow;
  sheet: DraftSheet;
  revisions: RevisionRow[];
  validations: ValidationRow[];
  comments: CommentRow[];
  users: Map<string, ReviewerState>;
  sensitive: boolean;
  greenLight: GreenLight;
  validatedByMe: boolean;
  queues: ReviewQueue[];
};

const groupBy = <T extends { exerciseId: string }>(items: readonly T[]): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.exerciseId);
    if (group === undefined) groups.set(item.exerciseId, [item]);
    else group.push(item);
  }
  return groups;
};

/**
 * Lit, pour une fiche (`exerciseId`) ou pour toutes, la fiche, ses validations, ses commentaires, les révisions
 * utiles, l'état des auteurs de validations et le manifeste. Les révisions ne servent qu'à juger des validations
 * (feu vert, « validée par toi », différentiel) : celles d'une fiche sans validation ne sont pas lues, ce qui ne
 * change aucun résultat des fonctions du domaine.
 */
async function loadReviewData(db: DbExecutor, exerciseId?: string): Promise<ReviewData> {
  const rows = await db
    .selectFrom('exercise')
    .selectAll()
    .$if(exerciseId !== undefined, (qb) => qb.where('id', '=', exerciseId as string))
    .execute();
  const validations = await db
    .selectFrom('exerciseValidation as v')
    .leftJoin('user as u', 'u.id', 'v.reviewerId')
    .select([
      'v.id',
      'v.exerciseId',
      'v.reviewerId',
      'v.revision',
      'v.health',
      'v.createdAt',
      'u.username as reviewerName',
      'u.role',
      'u.catalogReviewer',
      'u.healthProfessional',
    ])
    .$if(exerciseId !== undefined, (qb) => qb.where('v.exerciseId', '=', exerciseId as string))
    .orderBy('v.createdAt')
    .orderBy('v.id')
    .execute();
  const users = new Map<string, ReviewerState>();
  for (const v of validations) {
    if (v.reviewerId === null || v.role === null) continue;
    users.set(v.reviewerId, {
      id: v.reviewerId,
      role: v.role,
      catalogReviewer: v.catalogReviewer === 1,
      healthProfessional: v.healthProfessional === 1,
    });
  }
  const validated = [...new Set(validations.map((v) => v.exerciseId))];
  const revisions =
    validated.length === 0
      ? []
      : await db
          .selectFrom('exerciseRevision')
          .select(['exerciseId', 'revision', 'content', 'savedBy'])
          .where('exerciseId', 'in', validated)
          .execute();
  const comments = await db
    .selectFrom('exerciseComment as c')
    .leftJoin('user as u', 'u.id', 'c.authorId')
    .select([
      'c.id',
      'c.exerciseId',
      'c.authorId',
      'u.username as authorName',
      'c.part',
      'c.body',
      'c.revision',
      'c.createdAt',
      'c.resolvedAt',
    ])
    .$if(exerciseId !== undefined, (qb) => qb.where('c.exerciseId', '=', exerciseId as string))
    .execute();
  const illustrations = await db.selectFrom('illustration').select(['id', 'replaceBeforePublic']).execute();
  return {
    rows,
    revisions: groupBy(
      revisions.map((r) => ({
        exerciseId: r.exerciseId,
        revision: r.revision,
        content: JSON.parse(r.content) as Record<string, unknown>,
        savedBy: r.savedBy,
      })),
    ),
    validations: groupBy(
      validations.map((v) => ({
        id: v.id,
        exerciseId: v.exerciseId,
        reviewerId: v.reviewerId,
        reviewerName: v.reviewerName,
        revision: v.revision,
        health: v.health === 1,
        createdAt: v.createdAt,
      })),
    ),
    comments: groupBy(comments),
    users,
    manifestIds: new Set(illustrations.map((i) => i.id)),
    replaceBeforePublic: illustrations.filter((i) => i.replaceBeforePublic === 1).length,
  };
}

/** Code de file (contrat) → prédicat de `reviewQueues` (domaine). */
const QUEUE_FLAGS: Record<ReviewQueue, keyof ReviewQueueFlags> = {
  to_review: 'to_review',
  drafts: 'drafts',
  health_pending: 'health_pending',
  revalidate: 'revalidate',
  mine: 'mine',
  ready_to_publish: 'readyToPublish',
};

/**
 * État agrégé du feu vert (spec brique 2 §3.1) : `ok` si `healthGreenLight` ; `stale` si une validation santé
 * remplit encore les conditions 1 et 2 sans porter sur le contenu courant ; `missing` sinon.
 */
function greenLightOf(
  sheet: DraftSheet,
  revisions: readonly RevisionRow[],
  validations: readonly Validation[],
  users: ReadonlyMap<string, ReviewerState>,
): GreenLight {
  if (healthGreenLight(sheet, revisions, validations, users)) return 'ok';
  return standingHealthValidations(revisions, validations, users).length > 0 ? 'stale' : 'missing';
}

function evaluate(data: ReviewData, row: ExerciseRow, caller: SessionUser): Evaluated {
  const sheet = rowToSheet(row);
  const revisions = data.revisions.get(row.id) ?? [];
  const validations = data.validations.get(row.id) ?? [];
  const comments = data.comments.get(row.id) ?? [];
  const flags = reviewQueues({
    sheet,
    callerId: caller.id,
    revisions,
    validations,
    comments,
    users: data.users,
    manifestIds: data.manifestIds,
  });
  return {
    row,
    sheet,
    revisions,
    validations,
    comments,
    users: data.users,
    sensitive: isSensitive(sheet),
    greenLight: greenLightOf(sheet, revisions, validations, data.users),
    validatedByMe: hasValidatedContent(sheet, revisions, validations, caller.id),
    queues: REVIEW_QUEUES.filter((queue) => flags[QUEUE_FLAGS[queue]]),
  };
}

const isAdmin = (caller: SessionUser) => caller.role === 'admin';

/** Ordre binaire de deux chaînes (unités UTF-16). */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const NAME_COLLATOR = new Intl.Collator('fr', { sensitivity: 'base' });

function toListItem(e: Evaluated): ReviewListItem {
  const { sheet } = e;
  return {
    id: sheet.id,
    name: sheet.name,
    status: sheet.status,
    batch: sheet.batch,
    revision: sheet.revision,
    movementPattern: sheet.movement_pattern,
    level: sheet.level,
    notForMinors: sheet.not_for_minors,
    stressedJoints: sheet.stressed_joints ?? [],
    sensitive: e.sensitive,
    openComments: e.comments.filter((c) => c.resolvedAt === null).length,
    greenLight: e.greenLight,
    validatedByMe: e.validatedByMe,
    illustrationCount: sheet.illustrations?.length ?? 0,
    queues: e.queues,
  };
}

/**
 * `GET /api/review/exercises` (spec brique 2 §3.9) : fiches filtrées par `batch` et `status`, puis par `queue`,
 * triées par nom (collation française, sans casse ni accent) puis par `id` ; compteurs des files avant le filtre
 * `queue` ; avancement par lot sur tout le catalogue ; compteurs de l'admin.
 */
export async function listReview(
  db: DbExecutor,
  caller: SessionUser,
  query: ReviewListQuery,
): Promise<ReviewListResponse> {
  const data = await loadReviewData(db);
  const scoped = data.rows
    .filter(
      (row) =>
        (query.batch === undefined || row.batch === query.batch) &&
        (query.status === undefined || row.status === query.status),
    )
    .map((row) => evaluate(data, row, caller));
  const counts = Object.fromEntries(
    REVIEW_QUEUES.map((queue) => [queue, scoped.filter((e) => e.queues.includes(queue)).length]),
  ) as Record<ReviewQueue, number>;
  const queue = query.queue;
  const items = scoped
    .filter((e) => queue === undefined || e.queues.includes(queue))
    .map(toListItem)
    .sort((a, b) => NAME_COLLATOR.compare(a.name, b.name) || compareText(a.id, b.id));
  return {
    items,
    counts,
    progress: progressByBatch(data.rows),
    ...(isAdmin(caller)
      ? {
          admin: {
            toExport: data.rows.filter((row) => row.exportedRevision !== row.revision).length,
            replaceBeforePublic: data.replaceBeforePublic,
          },
        }
      : {}),
  };
}

/** Fiche telle que l'appelant peut la voir (spec brique 2 §3.1) : sans `drafting` ni `reviewed_by` hors admin. */
function visibleSheet(sheet: DraftSheet, caller: SessionUser): DraftSheet {
  if (isAdmin(caller)) return sheet;
  const { drafting: _drafting, reviewed_by: _reviewedBy, ...visible } = sheet;
  return visible;
}

const PART_RANK = new Map<string, number>(COMMENT_PARTS.map((part, i) => [part, i]));

/** Ordre d'affichage (spec brique 2 §3.3) : liste des parties, ouverts avant traités, `created_at`, `id`. */
const byDisplayOrder = (a: CommentRow, b: CommentRow) =>
  (PART_RANK.get(a.part) ?? 0) - (PART_RANK.get(b.part) ?? 0) ||
  Number(a.resolvedAt !== null) - Number(b.resolvedAt !== null) ||
  compareText(a.createdAt, b.createdAt) ||
  compareText(a.id, b.id);

function commentView(c: CommentRow, caller: SessionUser): ReviewCommentView {
  return {
    id: c.id,
    part: c.part,
    body: c.body,
    revision: c.revision,
    createdAt: c.createdAt,
    resolvedAt: c.resolvedAt,
    authorName: c.authorName,
    mine: c.authorId === caller.id,
  };
}

/**
 * Différentiel (spec brique 2 §3.2) depuis la révision `base` : clés de contenu changées et leurs anciennes
 * valeurs. `null` sans révision de départ (aucune validation, ou ligne de révision absente).
 */
function diffFrom(
  sheet: DraftSheet,
  revisions: readonly RevisionRow[],
  base: number | undefined,
): Pick<ReviewSheetResponse, 'diff' | 'diffBase'> {
  const from = base === undefined ? undefined : revisions.find((r) => r.revision === base);
  if (from === undefined) return { diff: null, diffBase: null };
  const diff = contentDiff(from.content, sheet);
  const values = Object.fromEntries(
    diff.filter((key) => Object.hasOwn(from.content, key)).map((key) => [key, from.content[key]]),
  );
  return { diff, diffBase: { revision: from.revision, values } };
}

/**
 * `GET /api/review/exercises/:id` (spec brique 2 §3.9) : la fiche selon le tableau de visibilité, ses
 * commentaires triés, l'état du feu vert, le différentiel de l'appelant (pour l'admin : depuis la dernière
 * validation santé qui remplit encore les conditions 1 et 2) ; l'admin reçoit en plus les validations
 * nominatives et la révision exportée.
 */
export async function reviewSheet(
  db: DbExecutor,
  caller: SessionUser,
  exerciseId: string,
): Promise<ReviewSheetResponse> {
  const data = await loadReviewData(db, exerciseId);
  const row = data.rows[0];
  if (row === undefined) throw httpError('not_found');
  const e = evaluate(data, row, caller);
  const standing = standingHealthValidations(e.revisions, e.validations, e.users);
  const base = isAdmin(caller)
    ? standing.at(-1)?.revision
    : e.validations
        .filter((v) => v.reviewerId === caller.id)
        .reduce<number | undefined>((last, v) => Math.max(last ?? v.revision, v.revision), undefined);
  const response: ReviewSheetResponse = {
    sheet: visibleSheet(e.sheet, caller),
    sensitive: e.sensitive,
    greenLight: e.greenLight,
    validatedByMe: e.validatedByMe,
    queues: e.queues,
    ...diffFrom(e.sheet, e.revisions, base),
    comments: [...e.comments].sort(byDisplayOrder).map((c) => commentView(c, caller)),
  };
  if (!isAdmin(caller)) return response;
  const standingKeys = new Set(standing.map((v) => `${v.reviewerId}:${v.revision}`));
  const validations: ReviewValidationView[] = e.validations.map((v) => ({
    id: v.id,
    reviewerId: v.reviewerId,
    reviewerName: v.reviewerName,
    revision: v.revision,
    health: v.health,
    standing: standingKeys.has(`${v.reviewerId}:${v.revision}`),
    createdAt: v.createdAt,
  }));
  return { ...response, validations, exportedRevision: row.exportedRevision };
}

/**
 * `POST /api/review/exercises/:id/comments` (spec brique 2 §3.3) : commentaire en texte brut (déjà nettoyé par le
 * contrat), gardé avec la révision vue par l'autrice, même dépassée. Fiche inconnue : 404 ; retirée : 409
 * `not_reviewable` ; révision future : 400. À appeler dans une transaction.
 */
export async function addComment(
  trx: DbExecutor,
  deps: AppDeps,
  caller: SessionUser,
  exerciseId: string,
  req: CreateCommentRequest,
): Promise<ReviewCommentView> {
  const sheet = await trx
    .selectFrom('exercise')
    .select(['status', 'revision'])
    .where('id', '=', exerciseId)
    .executeTakeFirst();
  if (sheet === undefined) throw httpError('not_found');
  if (sheet.status === 'retired') throw httpError('not_reviewable');
  if (req.baseRevision > sheet.revision) {
    throw httpError('validation', { issues: [{ path: 'baseRevision', message: 'Révision inconnue' }] });
  }
  const row: CommentRow = {
    id: deps.ids.uuidv7(),
    exerciseId,
    authorId: caller.id,
    authorName: caller.username,
    part: req.part,
    body: req.body,
    revision: req.baseRevision,
    createdAt: deps.clock.now().toISOString(),
    resolvedAt: null,
  };
  const { authorName: _, ...values } = row;
  await trx
    .insertInto('exerciseComment')
    .values({ ...values, resolvedBy: null })
    .execute();
  return commentView(row, caller);
}

/**
 * `POST /api/review/comments/:cid/resolve` (spec brique 2 §3.3) : « Traité », par l'autrice ou l'admin
 * (sinon 403). Idempotent : un commentaire déjà traité garde son `resolved_at` et son `resolved_by`. À appeler
 * dans une transaction.
 */
export async function resolveComment(
  trx: DbExecutor,
  deps: AppDeps,
  caller: SessionUser,
  commentId: string,
): Promise<ReviewCommentView> {
  const read = () =>
    trx
      .selectFrom('exerciseComment as c')
      .leftJoin('user as u', 'u.id', 'c.authorId')
      .select([
        'c.id',
        'c.exerciseId',
        'c.authorId',
        'u.username as authorName',
        'c.part',
        'c.body',
        'c.revision',
        'c.createdAt',
        'c.resolvedAt',
      ])
      .where('c.id', '=', commentId)
      .executeTakeFirst();
  const comment = await read();
  if (comment === undefined) throw httpError('not_found');
  if (comment.authorId !== caller.id && !isAdmin(caller)) throw httpError('forbidden');
  if (comment.resolvedAt !== null) return commentView(comment, caller);
  const resolvedAt = deps.clock.now().toISOString();
  await trx
    .updateTable('exerciseComment')
    .set({ resolvedAt, resolvedBy: caller.id })
    .where('id', '=', commentId)
    .where('resolvedAt', 'is', null)
    .execute();
  return commentView({ ...comment, resolvedAt }, caller);
}

/**
 * `POST /api/review/exercises/:id/validations` (spec brique 2 §3.4) : on ne valide que ce qu'on a vu, donc la
 * révision courante (sinon 409 `revision_conflict` avec la fiche courante, sans évaluer d'autre condition), et
 * seulement une fiche `reviewed` ou `published` (409 `not_reviewable`). `health` = drapeau santé effectif de
 * l'appelant à cet instant, pour l'historique : le feu vert relit les drapeaux actuels et écarte l'auteur de la
 * dernière modification du contenu (`standingHealthValidations`), dont la validation est gardée sans compter.
 * Doublon : la validation existante, `created` faux. À appeler dans une transaction.
 */
export async function validateSheet(
  trx: DbExecutor,
  deps: AppDeps,
  caller: SessionUser,
  exerciseId: string,
  req: ValidateRequest,
): Promise<{ validation: ValidationResponse; created: boolean }> {
  const row = await trx.selectFrom('exercise').selectAll().where('id', '=', exerciseId).executeTakeFirst();
  if (row === undefined) throw httpError('not_found');
  if (req.baseRevision !== row.revision) {
    throw httpError('revision_conflict', { current: visibleSheet(rowToSheet(row), caller) });
  }
  if (row.status !== 'reviewed' && row.status !== 'published') throw httpError('not_reviewable');
  const existing = await trx
    .selectFrom('exerciseValidation')
    .select(['id', 'revision', 'createdAt'])
    .where('exerciseId', '=', exerciseId)
    .where('reviewerId', '=', caller.id)
    .where('revision', '=', row.revision)
    .executeTakeFirst();
  if (existing !== undefined) return { validation: existing, created: false };
  const validation: ValidationResponse = {
    id: deps.ids.uuidv7(),
    revision: row.revision,
    createdAt: deps.clock.now().toISOString(),
  };
  await trx
    .insertInto('exerciseValidation')
    .values({
      ...validation,
      exerciseId,
      reviewerId: caller.id,
      health: isHealthReviewer(caller) ? 1 : 0,
    })
    .execute();
  return { validation, created: true };
}
