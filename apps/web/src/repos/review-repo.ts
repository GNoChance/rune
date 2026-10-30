import {
  type CreateCommentRequest,
  type DraftSheet,
  IllustrationEntry,
  MemberSummary,
  MeResponse,
  type PublishBlocker,
  ReviewCommentView,
  type ReviewListQuery,
  ReviewListResponse,
  type ReviewQueue,
  ReviewSheetResponse,
  RevisionConflictBody,
  type SaveSheetRequest,
  type SetReviewerFlagsRequest,
  TransitionBlockedBody,
  type TransitionRequest,
  type ValidateRequest,
  ValidationResponse,
} from '@rune/contracts';
import { isReviewer } from '@rune/domain';
import { z } from 'zod';
import { ApiError } from '../api/client';
import type { AppServices } from '../app-services';
import {
  type CommentDraft,
  clearCommentDraft,
  getCommentDraft,
  setCommentDraft,
} from '../local-db/comment-drafts';
import { getMeta, setMeta } from '../local-db/meta';
import { sendThenPull } from './rows';

export type { CommentDraft } from '../local-db/comment-drafts';

/**
 * Contenu du fichier `exercises-export.json` (04 §10, `EXERCISES_EXPORT_FILE`) : le tableau des fiches, tous statuts,
 * tel que le serveur le rend. L'écran le télécharge sans le relire (`pnpm data:pull` valide chaque fiche).
 */
export type CatalogExport = unknown[];
const CatalogExportFile = z.array(z.unknown());

/** Filtres de la liste en plus de la file (`GET /api/review/exercises`). */
export type ReviewListFilters = Omit<ReviewListQuery, 'queue'>;

/**
 * Refus 403 `forbidden` d'un compte qui n'est plus relecteur effectif (drapeau retiré, admin rétrogradé) : l'écran
 * dit « Tu n'as plus accès à la relecture. » et revient au Profil. Reste une `ApiError` `forbidden` pour le code
 * qui ne fait pas la différence.
 */
export class ReviewAccessLostError extends ApiError {
  constructor(cause: ApiError) {
    super(cause.status, cause.code, cause.body);
    this.name = 'ReviewAccessLostError';
  }
}

/** Accès à la relecture perdu en pleine session (`lostAccess`). */
export const isLostAccess = (e: unknown): e is ReviewAccessLostError => e instanceof ReviewAccessLostError;

/** Fiche courante d'un 409 `revision_conflict` (validation, enregistrement, transition) ; null sinon. */
export function revisionConflictOf(e: unknown): DraftSheet | null {
  if (!(e instanceof ApiError) || e.code !== 'revision_conflict') return null;
  const parsed = RevisionConflictBody.safeParse(e.body);
  return parsed.success ? parsed.data.current : null;
}

/** Blocages d'un 422 `transition_blocked`, dans l'ordre reçu (`PUBLISH_BLOCKERS`) ; null sinon. */
export function transitionBlockersOf(e: unknown): PublishBlocker[] | null {
  if (!(e instanceof ApiError) || e.code !== 'transition_blocked') return null;
  const parsed = TransitionBlockedBody.safeParse(e.body);
  return parsed.success ? parsed.data.blockers : null;
}

/**
 * Brouillon d'un commentaire, par compte et par fiche (clé `rune.review.draft.<compte>.<fiche>` de
 * `localStorage`) : effacé à l'envoi par `comment`, à la déconnexion et à la suppression du compte.
 */
export const commentDraft: {
  get(accountId: string, exerciseId: string): CommentDraft | null;
  set(accountId: string, exerciseId: string, draft: CommentDraft): void;
  clear(accountId: string, exerciseId: string): void;
} = { get: getCommentDraft, set: setCommentDraft, clear: clearCommentDraft };

/**
 * Relecture des fiches (spec brique 2 §3.9), classe H : en ligne seulement, rien n'est gardé dans la base de
 * l'appareil. Hors ligne : `NetworkRequiredError` (« Nécessite le réseau ») ; 403 `forbidden` d'un compte qui
 * n'est plus relecteur : `ReviewAccessLostError` ; les autres refus restent des `ApiError`.
 */
export interface ReviewRepo {
  /** Liste, compteurs des files et avancement par lot ; sans file : toutes les fiches. */
  list(queue?: ReviewQueue, filters?: ReviewListFilters): Promise<ReviewListResponse>;
  get(id: string): Promise<ReviewSheetResponse>;
  /** Commentaire envoyé : le brouillon de la fiche pour ce compte est effacé. */
  comment(id: string, req: CreateCommentRequest): Promise<ReviewCommentView>;
  /** « Traité » (idempotent) : le commentaire mis à jour. */
  resolve(commentId: string): Promise<ReviewCommentView>;
  validate(id: string, req: ValidateRequest): Promise<ValidationResponse>;
  /**
   * Admin : enregistrement (409 `revision_conflict` : `revisionConflictOf` ; 422 `invalid_sheet` :
   * `transitionBlockersOf`), puis un pull du catalogue ; la fiche vue par l'admin après l'écriture.
   */
  save(id: string, req: SaveSheetRequest): Promise<ReviewSheetResponse>;
  /** Admin : changement de statut (422 : `transitionBlockersOf`), puis un pull du catalogue ; comme `save`. */
  transition(id: string, req: TransitionRequest): Promise<ReviewSheetResponse>;
  /** Admin : le contenu du fichier `exercises-export.json` ; le serveur met `exported_revision` à jour. */
  exportCatalog(): Promise<CatalogExport>;
  /**
   * Admin : entrées du manifeste des illustrations gardé avec le catalogue de l'appareil (classe C, `GET
   * /api/catalog`), pour choisir les illustrations d'une fiche ; une entrée illisible est écartée.
   */
  illustrationManifest(): Promise<IllustrationEntry[]>;
  /** Admin : drapeaux d'un membre et mot de passe de l'admin (P-AUT-5) ; le `MemberSummary` à jour. */
  setReviewerFlags(memberId: string, req: SetReviewerFlagsRequest): Promise<MemberSummary>;
  /** « Comment relire » déjà vu par le compte de l'appareil. */
  introSeen(): Promise<boolean>;
  markIntroSeen(): Promise<void>;
}

export function createReviewRepo(s: AppServices): ReviewRepo {
  const { api, db } = s;
  const exercise = (id: string, action = '') =>
    `/api/review/exercises/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
  const adminExercise = (id: string, action = '') =>
    `/api/admin/exercises/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

  /** Profil relu sur le serveur (sans toucher à `meta.me`) : encore relecteur effectif ? */
  async function stillReviewer(): Promise<boolean> {
    try {
      return isReviewer(await api.get('/api/me', MeResponse));
    } catch {
      // Profil illisible juste après un refus de la relecture : on s'en tient au refus.
      return false;
    }
  }

  /**
   * Un 403 `forbidden` vient de la garde (plus relecteur, plus admin) ou d'une règle de la route (commentaire
   * d'une autre) : le profil relu tranche. `meta.me` n'est pas écrit ici : l'écran quitte d'abord la relecture,
   * puis relit le profil, sans que la garde n'affiche entre-temps une page introuvable.
   */
  async function guarded<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'forbidden' && !(await stillReviewer())) {
        throw new ReviewAccessLostError(error);
      }
      throw error;
    }
  }

  return {
    list(queue, filters = {}) {
      const params = new URLSearchParams();
      if (queue) params.set('queue', queue);
      if (filters.batch) params.set('batch', filters.batch);
      if (filters.status) params.set('status', filters.status);
      const query = params.toString();
      return guarded(() => api.get(`/api/review/exercises${query ? `?${query}` : ''}`, ReviewListResponse));
    },
    get: (id) => guarded(() => api.get(exercise(id), ReviewSheetResponse)),
    async comment(id, req) {
      const created = await guarded(() => api.send('POST', exercise(id, 'comments'), req, ReviewCommentView));
      const accountId = await getMeta(db, 'userId');
      if (accountId) clearCommentDraft(accountId, id);
      return created;
    },
    resolve: (commentId) =>
      guarded(() =>
        api.send(
          'POST',
          `/api/review/comments/${encodeURIComponent(commentId)}/resolve`,
          {},
          ReviewCommentView,
        ),
      ),
    validate: (id, req) =>
      guarded(() => api.send('POST', exercise(id, 'validations'), req, ValidationResponse)),
    save: (id, req) =>
      guarded(() => sendThenPull(s, 'PUT', adminExercise(id), { body: req, schema: ReviewSheetResponse })),
    transition: (id, req) =>
      guarded(() =>
        sendThenPull(s, 'POST', adminExercise(id, 'transition'), {
          body: req,
          schema: ReviewSheetResponse,
        }),
      ),
    exportCatalog: () => guarded(() => api.get('/api/admin/exercises/export', CatalogExportFile)),
    async illustrationManifest() {
      const rows: unknown[] = await db.table('illustrations').toArray();
      return rows.flatMap((row) => {
        const parsed = IllustrationEntry.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      });
    },
    setReviewerFlags: (memberId, req) =>
      guarded(() =>
        sendThenPull(s, 'POST', `/api/admin/members/${encodeURIComponent(memberId)}/reviewer-flags`, {
          body: req,
          schema: MemberSummary,
        }),
      ),
    async introSeen() {
      const accountId = await getMeta(db, 'userId');
      return accountId !== undefined && (await getMeta(db, 'reviewIntroSeen')) === accountId;
    },
    async markIntroSeen() {
      const accountId = await getMeta(db, 'userId');
      if (accountId) await setMeta(db, 'reviewIntroSeen', accountId);
    },
  };
}
