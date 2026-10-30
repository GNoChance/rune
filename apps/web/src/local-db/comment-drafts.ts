import { CommentPartSchema } from '@rune/contracts';
import { z } from 'zod';

/*
 * Brouillon d'un commentaire de relecture (spec brique 2 §4.5) : seule donnée de relecture gardée sur l'appareil,
 * pour qu'une coupure réseau ne perde pas la saisie. Une clé `localStorage` par compte et par fiche, effacée à
 * l'envoi (dépôt de relecture), à la déconnexion et à la suppression du compte (`wipeUserData`). Un stockage
 * bloqué (navigation privée, cookies refusés) ne fait rien lever : il n'y a simplement pas de brouillon.
 */

const PREFIX = 'rune.review.draft.';

export const CommentDraftSchema = z.object({ part: CommentPartSchema, body: z.string() });
export type CommentDraft = z.infer<typeof CommentDraftSchema>;

/** `rune.review.draft.<compte>.<fiche>`. */
export const commentDraftKey = (accountId: string, exerciseId: string): string =>
  `${PREFIX}${accountId}.${exerciseId}`;

export function getCommentDraft(accountId: string, exerciseId: string): CommentDraft | null {
  try {
    const raw = localStorage.getItem(commentDraftKey(accountId, exerciseId));
    if (raw === null) return null;
    const parsed = CommentDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function setCommentDraft(accountId: string, exerciseId: string, draft: CommentDraft): void {
  try {
    localStorage.setItem(commentDraftKey(accountId, exerciseId), JSON.stringify(draft));
  } catch {
    // Stockage plein ou bloqué : le brouillon reste seulement à l'écran.
  }
}

export function clearCommentDraft(accountId: string, exerciseId: string): void {
  try {
    localStorage.removeItem(commentDraftKey(accountId, exerciseId));
  } catch {
    // Stockage bloqué : rien n'a pu y être écrit.
  }
}

/** Tous les brouillons de relecture de l'appareil, quel que soit le compte ; le reste de `localStorage` reste. */
export function clearAllCommentDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Stockage bloqué : rien n'a pu y être écrit.
  }
}
