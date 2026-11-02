import type { NextAdjustment } from '@rune/contracts';
import { useState } from 'react';
import { useRepos, type WorkoutExerciseView } from '../../repos';
import { Banner, BottomSheet, CheckGlyph } from '../../ui';
import styles from './live.module.css';

/*
 * « La prochaine fois » (05 §13.6, spec brique 3 §7.3) : l'ajustement neutre `nextAdjustment`, ouvert à tous et sans
 * rien de santé : « ne pas augmenter » (`hold`) ou « alléger » (`lighten`) à la séance suivante, ou rien. Le moteur le
 * lit à l'évaluation (05 §9, étape 3).
 */

/** Ligne de la carte quand un ajustement est choisi (libellés de la spec, neutres). */
export const ADJUSTMENT_NOTES: Record<NextAdjustment, string> = {
  hold: 'La prochaine fois : ne pas augmenter',
  lighten: 'La prochaine fois : alléger',
};

const CHOICES: readonly { value: NextAdjustment | null; label: string }[] = [
  { value: 'hold', label: 'Ne pas augmenter' },
  { value: 'lighten', label: 'Alléger' },
  { value: null, label: "Pas d'ajustement" },
];

const NOT_SAVED = "L'ajustement n'a pas été enregistré.";

export function AdjustSheet(p: { exercise: WorkoutExerciseView; name: string; onClose(): void }) {
  const repos = useRepos();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = p.exercise.nextAdjustment;

  const pick = async (value: NextAdjustment | null) => {
    setPending(true);
    setError(null);
    try {
      await repos.workouts.setAdjustment(p.exercise.id, value);
      p.onClose();
    } catch {
      setError(NOT_SAVED);
      setPending(false);
    }
  };

  return (
    <BottomSheet open title="La prochaine fois" onClose={p.onClose}>
      <p className={styles.sheetDetail}>{p.name}</p>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <ul className={styles.effortList}>
        {CHOICES.map(({ value, label }) => (
          <li key={label}>
            <button
              type="button"
              className={styles.effortChoice}
              aria-pressed={current === value}
              disabled={pending}
              onClick={() => void pick(value)}
            >
              <span>{label}</span>
              {current === value ? <CheckGlyph /> : null}
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
