import type { DraftSheet } from '@rune/contracts';
import { transitionBlockers } from './blockers';
import {
  hasValidatedContent,
  healthGreenLight,
  isSensitive,
  type ReviewerState,
  type RevisionRow,
  type Validation,
} from './review';

/** Commentaire d'une fiche (spec brique 2 §3.3) : `authorId` `null` une fois le compte supprimé. */
export type ReviewComment = { authorId: string | null; resolvedAt: string | null };

/**
 * Entrée de `reviewQueues` : une fiche et ce que la base sait d'elle, vus par `callerId`.
 * - `revisions`, `validations`, `comments` : ceux de la fiche ;
 * - `users` : rôle et drapeaux actuels des comptes, au moins des auteurs de validations ;
 * - `manifestIds` : `id` des illustrations du manifeste.
 */
export type ReviewQueuesInput = {
  sheet: DraftSheet;
  callerId: string;
  revisions: readonly RevisionRow[];
  validations: readonly Validation[];
  comments: readonly ReviewComment[];
  users: ReadonlyMap<string, ReviewerState>;
  manifestIds: ReadonlySet<string>;
};

/** Prédicats des files de relecture (spec brique 2 §3.8) pour une fiche ; les clés des files sont leurs codes. */
export type ReviewQueueFlags = {
  /** `reviewed`, et l'appelant n'a pas validé le contenu courant. */
  to_review: boolean;
  /** `draft` (« Brouillons à commenter ») ; jamais compté par la carte d'accueil. */
  drafts: boolean;
  /** `reviewed`, sensible, sans feu vert santé à jour. */
  health_pending: boolean;
  /** `published`, sensible, sans feu vert santé à jour (« À revalider »). */
  revalidate: boolean;
  /** Au moins un commentaire ouvert écrit par l'appelant. */
  mine: boolean;
  /** « Prête à publier » : `reviewed` et aucun blocage de `reviewed → published`. */
  readyToPublish: boolean;
};

/**
 * Files de relecture où se trouve une fiche (spec brique 2 §3.8). Le serveur filtre sa liste avec, la carte
 * d'accueil compte `to_review`, plus `health_pending` et `revalidate` pour une relectrice santé (§4.4).
 */
export function reviewQueues(input: ReviewQueuesInput): ReviewQueueFlags {
  const { sheet, callerId, revisions, validations, comments, users, manifestIds } = input;
  const status = sheet.status;
  const checked = status === 'reviewed' || status === 'published';
  const greenLight = checked && healthGreenLight(sheet, revisions, validations, users);
  const missingGreenLight = checked && isSensitive(sheet) && !greenLight;
  // Seuls les blocages de `reviewed → published` comptent : les entrées propres aux autres transitions
  // (cases de relecture, modèles, catalogue) sont neutres.
  const publishBlockers =
    status === 'reviewed'
      ? transitionBlockers({
          sheet,
          to: 'published',
          comments,
          greenLight,
          reviewChecked: true,
          minorsConfirmed: true,
          manifestIds,
          templateRefs: new Set(),
          catalog: [],
        })
      : null;
  return {
    to_review: status === 'reviewed' && !hasValidatedContent(sheet, revisions, validations, callerId),
    drafts: status === 'draft',
    health_pending: status === 'reviewed' && missingGreenLight,
    revalidate: status === 'published' && missingGreenLight,
    mine: comments.some((c) => c.authorId === callerId && c.resolvedAt === null),
    readyToPublish: publishBlockers !== null && publishBlockers.length === 0,
  };
}

/** Lots du cœur (spec brique 2 §2) : l'avancement « Cœur · n / m publiées » est la somme de leurs lignes. */
export const CORE_BATCHES = ['A', 'B'] as const;

/** Avancement d'un lot : fiches `published`, et fiches non retirées (brouillons compris). */
export type BatchProgress = { batch: string; published: number; total: number };

/** Rang d'un lot : `A`, `B`, puis `E1`, `E2`… dans l'ordre de leur numéro ; un code inconnu en dernier. */
function batchRank(batch: string): number {
  if (batch === 'A') return 0;
  if (batch === 'B') return 1;
  const extension = /^E([1-9][0-9]?)$/.exec(batch);
  return extension === null ? Number.MAX_SAFE_INTEGER : 1 + Number(extension[1]);
}

const byBatch = (a: BatchProgress, b: BatchProgress) =>
  batchRank(a.batch) - batchRank(b.batch) || (a.batch < b.batch ? -1 : a.batch > b.batch ? 1 : 0);

/**
 * Avancement par lot (spec brique 2 §2 et §3.8), une ligne par lot : `A` et `B` toujours (le cœur, même vides),
 * puis chaque lot d'extension qui a au moins une fiche non retirée, dans l'ordre de son numéro. Une fiche
 * retirée ne compte nulle part.
 */
export function progressByBatch(catalog: readonly Pick<DraftSheet, 'batch' | 'status'>[]): BatchProgress[] {
  const rows = new Map<string, BatchProgress>(
    CORE_BATCHES.map((batch) => [batch, { batch, published: 0, total: 0 }]),
  );
  for (const sheet of catalog) {
    if (sheet.status === 'retired') continue;
    let row = rows.get(sheet.batch);
    if (row === undefined) {
      row = { batch: sheet.batch, published: 0, total: 0 };
      rows.set(sheet.batch, row);
    }
    row.total += 1;
    if (sheet.status === 'published') row.published += 1;
  }
  return [...rows.values()].sort(byBatch);
}
