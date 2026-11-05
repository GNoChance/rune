import { COACH_REPORT_CATEGORIES, type CoachReportCategory } from '@rune/contracts';
import { COACH_CONFIG } from '@rune/domain';
import { useId, useState } from 'react';
import { NetworkRequiredError } from '../../api/client';
import { useRepos } from '../../repos';
import { BottomSheet, Button } from '../../ui';
import styles from './coach-page.module.css';
import { REPORT_TEXTS, STATE_TEXTS } from './coach-texts';

/** Plafond du commentaire (`reportCommentChars`, spec §5.2). */
const COMMENT_CHARS = COACH_CONFIG.limits.reportCommentChars;

/**
 * Feuille « Signaler » d'une réponse du coach (spec brique 4 §16.6) : une catégorie, un commentaire de 500
 * caractères au plus, l'avertissement que l'admin lira l'échange et saura qu'il vient de la personne, puis la
 * confirmation. Le serveur décide (404 si le message n'est pas une réponse du coach de cette personne).
 */
export function ReportSheet(p: { threadId: string; messageSeq: number; onClose(): void }) {
  const repos = useRepos();
  const groupId = useId();
  const fieldId = useId();
  const [category, setCategory] = useState<CoachReportCategory | null>(null);
  const [comment, setComment] = useState('');
  const [phase, setPhase] = useState<'form' | 'sending' | 'sent'>('form');
  const [error, setError] = useState<string | null>(null);

  // Le texte qui part est le texte rogné ; le serveur compte en unités UTF-16 (`z.string().max(500)`).
  const sentComment = comment.trim();
  const tooLong = sentComment.length > COMMENT_CHARS;
  const canSend = category !== null && !tooLong && phase === 'form';

  async function send() {
    if (category === null || !canSend) return;
    setPhase('sending');
    setError(null);
    try {
      await repos.coach.report({
        threadId: p.threadId,
        messageSeq: p.messageSeq,
        category,
        ...(sentComment === '' ? {} : { comment: sentComment }),
      });
      setPhase('sent');
    } catch (e) {
      setError(e instanceof NetworkRequiredError ? STATE_TEXTS.offline : REPORT_TEXTS.failed);
      setPhase('form');
    }
  }

  const sent = phase === 'sent';
  return (
    <BottomSheet
      open
      title={REPORT_TEXTS.title}
      onClose={p.onClose}
      actions={
        sent ? undefined : (
          <>
            <Button block disabled={!canSend} onClick={() => void send()}>
              {REPORT_TEXTS.send}
            </Button>
            <Button variant="secondary" block onClick={p.onClose}>
              {REPORT_TEXTS.close}
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <p role="status" className={styles.reportNote}>
          {REPORT_TEXTS.thanks}
        </p>
      ) : (
        <div className={styles.reportForm}>
          <fieldset className={styles.reportChoices} aria-labelledby={groupId}>
            <legend id={groupId} className={styles.reportNote}>
              {REPORT_TEXTS.categoryLegend}
            </legend>
            {COACH_REPORT_CATEGORIES.map((c) => (
              <label key={c} className={styles.reportChoice}>
                <input
                  type="radio"
                  name={groupId}
                  value={c}
                  checked={category === c}
                  onChange={() => setCategory(c)}
                />
                {REPORT_TEXTS.categories[c]}
              </label>
            ))}
          </fieldset>
          <label htmlFor={fieldId} className={styles.reportNote}>
            {REPORT_TEXTS.commentLabel}
          </label>
          <textarea
            id={fieldId}
            className={styles.reportField}
            value={comment}
            aria-invalid={tooLong || undefined}
            onChange={(e) => setComment(e.target.value)}
          />
          {tooLong ? <p className={styles.reportError}>{REPORT_TEXTS.tooLong}</p> : null}
          <p className={styles.reportNote}>{REPORT_TEXTS.warning}</p>
          {error === null ? null : (
            <p role="alert" className={styles.reportError}>
              {error}
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
