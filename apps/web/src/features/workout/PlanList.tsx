import type { PlannedWorkout } from '@rune/domain';
import { useLive } from '../../app-services';
import { useRepos } from '../../repos';
import { BottomSheet } from '../../ui';
import { HowToPanel, SafetyBox, SheetIllustrations, SheetPills } from '../exercises/SheetContent';
import styles from './workout.module.css';
import { nameOf, resolutionNote, targetSummary } from './workout-labels';

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      className={styles.chevron}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/**
 * Exercices de la séance du jour (spec brique 3 §7.2), un par slot : nom, cible résumée et mention de résolution
 * (« Remplace… », « Pas faisable ici : sauté », « Suspendu »). Un exercice du jour est un bouton qui ouvre sa
 * fiche ; un slot sauté ou suspendu n'en a pas et reste une ligne d'information.
 */
export function PlanList(p: {
  plan: PlannedWorkout;
  names: ReadonlyMap<string, string>;
  onOpen(exerciseId: string): void;
}) {
  return (
    <ul aria-label="Exercices de la séance" className={`stagger ${styles.planList}`}>
      {p.plan.exercises.map((exercise) => {
        const note = resolutionNote(exercise, p.names);
        const summary = targetSummary(exercise);
        const body = (
          <>
            <span className={styles.exerciseText}>
              <span className={styles.exerciseName}>
                {nameOf(p.names, exercise.exerciseId ?? exercise.plannedExerciseId)}
              </span>
              {summary ? <span className={styles.exerciseTarget}>{summary}</span> : null}
              {note ? <span className={styles.exerciseNote}>{note}</span> : null}
            </span>
            {exercise.exerciseId !== null ? <Chevron /> : null}
          </>
        );
        const { exerciseId } = exercise;
        return (
          <li key={exercise.slotId} className={styles.planItem}>
            {exerciseId !== null ? (
              <button type="button" className={styles.planRow} onClick={() => p.onOpen(exerciseId)}>
                {body}
              </button>
            ) : (
              <div className={styles.planRow}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Fiche d'un exercice en feuille du bas, lue dans le catalogue local (hors ligne comprise) : caractéristiques,
 * illustrations, sécurité, puis comment faire.
 */
export function ExerciseSheetSheet(p: { exerciseId: string; name: string; onClose(): void }) {
  const repos = useRepos();
  const view = useLive(() => repos.catalog.getSheetView(p.exerciseId), [repos, p.exerciseId]);
  return (
    <BottomSheet open title={p.name} onClose={p.onClose}>
      {view?.usable ? (
        <div className={styles.sheetStack}>
          <SheetPills sheet={view.sheet} equipment={view.place?.equipment ?? null} />
          <SheetIllustrations name={view.sheet.name} illustrations={view.illustrations} />
          <SafetyBox safety={view.sheet.safety} />
          <HowToPanel sheet={view.sheet} />
        </div>
      ) : null}
    </BottomSheet>
  );
}
