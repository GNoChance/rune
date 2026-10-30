import type { CommentPart, ReviewCommentView } from '@rune/contracts';
import { useId } from 'react';
import { Badge, formatDateTime } from '../../ui';
import styles from './review.module.css';
import { PART_LABELS } from './review-labels';

/** Bulle de commentaire : l'icône du bouton « Commenter ». */
function CommentIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    </svg>
  );
}

/**
 * Un commentaire (spec brique 2 §3.3) : son texte **brut** (texte React, jamais du HTML : un `<b>` tapé s'affiche
 * tel quel ; retours à la ligne gardés par le style), puis l'auteur (« Ancien relecteur » une fois le compte
 * supprimé), la version vue en l'écrivant et la date ; « Traité » s'il l'est, sinon le bouton « Traité » pour qui
 * peut le marquer (son autrice, l'admin), décrit par le texte du commentaire.
 */
function CommentItem(p: {
  comment: ReviewCommentView;
  canResolve: boolean;
  resolving: boolean;
  onResolve(): void;
}) {
  const bodyId = useId();
  const { comment } = p;
  const resolved = comment.resolvedAt !== null;
  return (
    <li className={styles.comment} data-comment="" data-resolved={resolved ? '' : undefined}>
      <p id={bodyId} className={styles.commentBody}>
        {comment.body}
      </p>
      <p className={styles.commentMeta}>
        {`${comment.authorName ?? 'Ancien relecteur'} · version ${comment.revision} · ${formatDateTime(comment.createdAt)}`}
      </p>
      {resolved ? (
        <span className={styles.commentState}>
          <Badge tone="muted">Traité</Badge>
        </span>
      ) : p.canResolve ? (
        <button
          type="button"
          className={styles.smallButton}
          aria-describedby={bodyId}
          disabled={p.resolving}
          onClick={p.onResolve}
        >
          Traité
        </button>
      ) : null}
    </li>
  );
}

/**
 * Sous une partie de la fiche de relecture : ses commentaires (ouverts puis traités, dans l'ordre du serveur), puis
 * « Commenter : <partie> » — « Reprendre le commentaire : <partie> » si un brouillon de cette partie attend sur
 * l'appareil. Une fiche retirée ne se commente plus (`canComment` faux) : seuls ses commentaires restent ; sans
 * commentaire, rien.
 */
export function PartComments(p: {
  part: CommentPart;
  comments: readonly ReviewCommentView[];
  canComment: boolean;
  hasDraft: boolean;
  canResolve(comment: ReviewCommentView): boolean;
  resolving: string | null;
  onComment(part: CommentPart): void;
  onResolve(comment: ReviewCommentView): void;
}) {
  const label = PART_LABELS[p.part];
  if (!p.canComment && p.comments.length === 0) return null;
  const action = p.hasDraft ? 'Reprendre le commentaire' : 'Commenter';
  return (
    <div className={styles.partComments}>
      {p.comments.length > 0 ? (
        <ul aria-label={`Commentaires : ${label}`} className={styles.commentList}>
          {p.comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              canResolve={p.canResolve(comment)}
              resolving={p.resolving === comment.id}
              onResolve={() => p.onResolve(comment)}
            />
          ))}
        </ul>
      ) : null}
      {p.canComment ? (
        <button
          type="button"
          className={styles.smallButton}
          aria-label={`${action} : ${label}`}
          onClick={() => p.onComment(p.part)}
        >
          <CommentIcon />
          {action}
        </button>
      ) : null}
    </div>
  );
}
