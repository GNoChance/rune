import { useId } from 'react';
import styles from './coach-page.module.css';
import { COUNTER_FROM, counterText, MESSAGE_CHARS } from './coach-texts';

/** Points de code, pas unités UTF-16 : un « 💪 » compte pour un (le serveur compte de même, `messageChars`). */
export const codePoints = (text: string): number => [...text].length;

/**
 * Saisie du coach (spec brique 4 §16.2) : champ multiligne en 16 px, compteur à partir de 1 800 points de code,
 * « Envoyer » de 48 px. `disabled` éteint le champ (hors ligne, limite, réponse ailleurs) ; `busy` seulement
 * l'envoi (un échange est en cours : on peut déjà écrire la suite).
 */
export function Composer(p: {
  value: string;
  onChange(text: string): void;
  onSend(): void;
  disabled: boolean;
  busy: boolean;
}) {
  const id = useId();
  const counterId = useId();
  const count = codePoints(p.value);
  const over = count > MESSAGE_CHARS;
  const canSend = !p.disabled && !p.busy && !over && p.value.trim() !== '';
  return (
    <form
      className={styles.composer}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) p.onSend();
      }}
    >
      <label htmlFor={id} className={styles.srOnly}>
        Ton message au coach
      </label>
      <div className={styles.inputRow}>
        <textarea
          id={id}
          className={styles.field}
          rows={2}
          value={p.value}
          disabled={p.disabled}
          aria-invalid={over || undefined}
          aria-describedby={count >= COUNTER_FROM ? counterId : undefined}
          onChange={(e) => p.onChange(e.target.value)}
        />
        <button type="submit" className={styles.send} disabled={!canSend}>
          Envoyer
        </button>
      </div>
      {count >= COUNTER_FROM ? (
        <p id={counterId} className={`${styles.counter} ${over ? styles.counterOver : ''}`}>
          {counterText(count)}
        </p>
      ) : null}
    </form>
  );
}
