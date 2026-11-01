import type { ProgramTemplate } from '@rune/contracts';
import { BottomSheet } from '../../ui';
import styles from './workout.module.css';

/**
 * Séances du modèle en feuille du bas (« Changer », spec brique 3 §7.2) : la séance affichée porte
 * `aria-current`, choisir en prend une autre et referme la feuille.
 */
export function WorkoutPicker(p: {
  open: boolean;
  workouts: ProgramTemplate['workouts'];
  currentId: string;
  onPick(workoutId: string): void;
  onClose(): void;
}) {
  return (
    <BottomSheet open={p.open} title="Choisir la séance" onClose={p.onClose}>
      <ul className={styles.pickerList}>
        {p.workouts.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              className={styles.pickerItem}
              aria-current={w.id === p.currentId ? 'true' : undefined}
              onClick={() => p.onPick(w.id)}
            >
              {w.name}
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
