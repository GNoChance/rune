import {
  COMMENT_BODY_MAX,
  COMMENT_BODY_MIN,
  type CommentPart,
  cleanCommentBody,
  commentBodyLength,
} from '@rune/contracts';
import { type FormEvent, useCallback, useId, useRef, useState } from 'react';
import { commentDraft, useRepos } from '../../repos';
import { Banner, BottomSheet, Button, errorMessage } from '../../ui';
import styles from './review.module.css';
import { PART_LABELS } from './review-labels';
import { useOnLostAccess } from './use-lost-access';

/** Phrase de prudence sous le champ (spec brique 2 §3.3). */
export const COMMENT_CAUTION = "Parle de la fiche, pas de ta santé ni de celle d'un membre.";

/**
 * Feuille du bas « Commenter : <partie> » (spec brique 2 §3.3 et §4.5) :
 * - le champ « Ton commentaire », décrit par la phrase de prudence puis le compteur « n / 1000 », qui compte le
 *   texte tel que le serveur le gardera (`cleanCommentBody`, en caractères : `commentBodyLength`) ; au-delà de 1000,
 *   « trop long » et Envoyer inactif ;
 * - brouillon gardé sur l'appareil à chaque frappe (un par compte et par fiche, avec sa partie) : il revient quand
 *   on rouvre la même partie, après une coupure ou une fermeture ; une autre partie part d'un champ vide et le
 *   remplace dès qu'on y écrit ; vider le champ l'efface ; l'envoi réussi l'efface aussi (dépôt) ;
 * - Envoyer : la partie, le texte tel que tapé (le serveur le nettoie) et la révision affichée ; un échec reste dans
 *   la feuille avec la saisie (hors ligne : « Nécessite le réseau ») ; un accès perdu renvoie au Profil.
 */
export function CommentSheet(p: {
  part: CommentPart;
  sheetId: string;
  accountId: string;
  baseRevision: number;
  /** Partie du brouillon gardé après une frappe, `null` quand il est effacé. */
  onDraftChange(part: CommentPart | null): void;
  onClose(): void;
  onSent(): void;
}) {
  const repos = useRepos();
  const onLostAccess = useOnLostAccess();
  const formId = useId();
  const fieldId = useId();
  const cautionId = useId();
  const counterId = useId();
  const [body, setBody] = useState(() => {
    const draft = commentDraft.get(p.accountId, p.sheetId);
    return draft?.part === p.part ? draft.body : '';
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const length = commentBodyLength(cleanCommentBody(body));
  const tooLong = length > COMMENT_BODY_MAX;
  const canSend = length >= COMMENT_BODY_MIN && !tooLong;
  const label = PART_LABELS[p.part];
  const { onClose } = p;
  const close = useCallback(() => {
    if (!sending.current) onClose();
  }, [onClose]);

  function change(value: string) {
    setBody(value);
    if (value === '') {
      commentDraft.clear(p.accountId, p.sheetId);
      p.onDraftChange(null);
    } else {
      commentDraft.set(p.accountId, p.sheetId, { part: p.part, body: value });
      p.onDraftChange(p.part);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSend || sending.current) return;
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      await repos.review.comment(p.sheetId, { part: p.part, body, baseRevision: p.baseRevision });
      sending.current = false;
      p.onSent();
    } catch (err) {
      sending.current = false;
      if (onLostAccess(err)) return;
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <BottomSheet
      open
      title={`Commenter : ${label}`}
      onClose={close}
      actions={
        <>
          <Button type="submit" form={formId} disabled={!canSend || pending}>
            Envoyer
          </Button>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Annuler
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.commentForm} noValidate onSubmit={(e) => void submit(e)}>
        <div className={styles.commentField}>
          <label htmlFor={fieldId} className={styles.commentLabel}>
            Ton commentaire
          </label>
          <textarea
            id={fieldId}
            rows={6}
            value={body}
            aria-describedby={`${cautionId} ${counterId}`}
            aria-invalid={tooLong ? true : undefined}
            className={styles.commentInput}
            onChange={(e) => change(e.target.value)}
          />
          <p id={cautionId} className={styles.caution}>
            {COMMENT_CAUTION}
          </p>
          <p id={counterId} className={styles.counter} data-over={tooLong ? '' : undefined}>
            {`${length} / ${COMMENT_BODY_MAX}${tooLong ? ' · trop long' : ''}`}
          </p>
        </div>
        {error ? <Banner tone="error">{error}</Banner> : null}
      </form>
    </BottomSheet>
  );
}
