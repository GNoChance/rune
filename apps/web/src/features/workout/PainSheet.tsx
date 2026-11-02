import { useId, useState } from 'react';
import { useRepos, type WorkoutExerciseView } from '../../repos';
import { Banner, BottomSheet, UNEXPECTED_ERROR_MESSAGE } from '../../ui';
import styles from './live.module.css';

/*
 * « Douleur ou gêne » (05 §13.6 à §13.8, spec brique 3 §7.3) : « Gêne » → ne pas augmenter la prochaine fois,
 * « Douleur » → alléger, puis le conseil de sécurité et un autre exercice du même type de mouvement (`SwapSheet`).
 * Le dépôt ne garde `painLevel` qu'avec l'accord santé ; sans, seul l'ajustement neutre est écrit.
 */

/** Conseil de sécurité, mot pour mot (05 §13.6). */
export const PAIN_ADVICE =
  "Arrête l'exercice si la douleur augmente ; si elle persiste, consulte un médecin ou un kiné ; douleur à la poitrine ou malaise : appelle le 15 ou le 112.";
/** Pour un mineur, en plus (05 §14). */
export const PAIN_ADVICE_MINOR = 'Parles-en à un parent.';
/** Mineur, exercice à la barre (05 §14) : sur la carte, et avec le conseil. */
export const MINOR_BARBELL = 'Entraîne-toi avec un adulte expérimenté.';

const LEVELS = [
  { level: 'discomfort', label: 'Gêne', help: 'La prochaine fois, pas de hausse pour cet exercice.' },
  { level: 'pain', label: 'Douleur', help: 'La prochaine fois, cet exercice est allégé.' },
] as const;

/** Conseil de sécurité, et pour un mineur ce qui s'y ajoute ; `id` le relie à la feuille qui l'annonce. */
export function PainAdvice(p: { id: string; minor: boolean; barbell: boolean }) {
  return (
    <div id={p.id} className={styles.advice}>
      <p>{PAIN_ADVICE}</p>
      {p.minor ? <p>{PAIN_ADVICE_MINOR}</p> : null}
      {p.minor && p.barbell ? <p>{MINOR_BARBELL}</p> : null}
    </div>
  );
}

export function PainSheet(p: {
  exercise: WorkoutExerciseView;
  name: string;
  /** « Douleur » enregistrée : le conseil et le changement d'exercice suivent. */
  onPain(): void;
  onClose(): void;
}) {
  const repos = useRepos();
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const report = async (level: 'discomfort' | 'pain') => {
    setPending(true);
    setError(null);
    try {
      await repos.workouts.markPain(p.exercise.id, level);
      if (level === 'pain') p.onPain();
      else p.onClose();
    } catch {
      setError(UNEXPECTED_ERROR_MESSAGE);
      setPending(false);
    }
  };

  return (
    <BottomSheet open title="Douleur ou gêne" onClose={p.onClose}>
      <p className={styles.sheetDetail}>{p.name}</p>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <ul className={styles.effortList}>
        {LEVELS.map(({ level, label, help }) => (
          <li key={level}>
            <button
              type="button"
              className={styles.choice}
              aria-labelledby={`${id}-${level}`}
              aria-describedby={`${id}-${level}-help`}
              disabled={pending}
              onClick={() => void report(level)}
            >
              <span id={`${id}-${level}`}>{label}</span>
              <span id={`${id}-${level}-help`} className={styles.choiceHelp}>
                {help}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
