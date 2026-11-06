import type { CoachId } from '@rune/contracts';
import { CoachAvatar } from '../../ui';
import styles from './coach-page.module.css';
import { GUIDED_TEXTS } from './coach-texts';

/**
 * Bulle du fil (spec brique 4 §16.2) : la personne à droite ; le coach à gauche, avec son avatar, le badge « IA »
 * (`data-ai-generated`, C29), « Réponse coupée » si `truncated` et « Signaler ». Texte brut : retours à la ligne
 * conservés, jamais de Markdown ni de lien. `streaming` : bulle en cours d'écriture, sans « Signaler » (rien à
 * signaler avant `done`) ; `toolLabel` : l'indicateur d'outil, réel.
 */
export function ChatBubble(
  p:
    | { author: 'user'; text: string; arriving?: boolean; guided?: boolean }
    | {
        author: 'assistant';
        coach: CoachId;
        text: string;
        truncated?: boolean;
        streaming?: boolean;
        toolLabel?: string | null;
        onReport?: () => void;
      },
) {
  if (p.author === 'user') {
    return (
      <div className={`${styles.row} ${styles.mineRow}`} data-role="user">
        <div className={`${styles.mineBubble} ${p.arriving ? styles.arriving : ''}`}>
          <p className={styles.text}>{p.text}</p>
          {p.guided ? <p className={styles.guidedNote}>{GUIDED_TEXTS.chosen}</p> : null}
        </div>
      </div>
    );
  }
  return (
    <div className={`${styles.row} ${styles.coachRow}`} data-role="assistant" data-ai-generated="true">
      <CoachAvatar coach={p.coach} size={32} decorative />
      <div className={`${styles.coachBubble} ${p.streaming ? styles.arriving : ''}`}>
        <span className={styles.aiBadge}>IA</span>
        {p.text ? <p className={styles.text}>{p.text}</p> : null}
        {p.toolLabel ? <p className={styles.tool}>{p.toolLabel}</p> : null}
        {p.truncated ? <p className={styles.truncated}>Réponse coupée</p> : null}
        {p.streaming ? null : (
          <button type="button" className={styles.report} onClick={p.onReport}>
            Signaler
          </button>
        )}
      </div>
    </div>
  );
}
