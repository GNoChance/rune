import { useRef, useState } from 'react';
import { useRepos, type WorkoutSessionView } from '../../repos';
import { Banner, Button, UNEXPECTED_ERROR_MESSAGE } from '../../ui';
import { ExercisePicker } from './ExercisePicker';
import styles from './live.module.css';

/*
 * Séance libre sur l'écran de séance (spec brique 3 §7.5) : « Ajouter un exercice » ouvre la recherche du catalogue
 * (`ExercisePicker`) ; l'exercice choisi arrive avec une première série sans cible (`addFreeExercise`), et chaque carte
 * d'un exercice libre garde « Ajouter une série » à portée de main (`AddSetButton`) : sans plan, les séries se créent
 * une à une. Même saisie que pour un programme ; pas de décision du moteur (D7), pas de minuteur de repos (ruling R45 :
 * le repos est celui d'un slot).
 */

const ADD_FAILED = "L'exercice n'a pas été ajouté.";

export function FreeWorkout(p: {
  session: WorkoutSessionView;
  /** L'exercice vient d'être ajouté : sa carte s'ouvre. */
  onAdded(performedExerciseId: string): void;
}) {
  const repos = useRepos();
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Deux touchers dans la même image : un seul ajout (l'état `pending` n'est vu qu'au rendu suivant).
  const busy = useRef(false);

  const add = (exerciseId: string) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const done = (failed: boolean) => {
      busy.current = false;
      setPending(false);
      setPicking(false);
      if (failed) setError(ADD_FAILED);
    };
    repos.workouts.addFreeExercise(p.session.id, exerciseId).then(
      (id) => {
        done(false);
        p.onAdded(id);
      },
      () => done(true),
    );
  };

  return (
    <div className={styles.free}>
      {p.session.exercises.length === 0 ? (
        <p className={styles.freeHint}>Ajoute un exercice pour commencer.</p>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      <Button variant="secondary" block onClick={() => setPicking(true)}>
        Ajouter un exercice
      </Button>
      {picking ? (
        <ExercisePicker
          placeId={p.session.placeId}
          pending={pending}
          onPick={add}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * « Ajouter une série » sous les lignes d'un exercice de séance libre : une série de travail de plus, sans cible
 * (`addSet`). Un second toucher pendant l'écriture est ignoré ; le bouton n'est jamais désactivé (le focus reste).
 */
export function AddSetButton(p: { performedExerciseId: string }) {
  const repos = useRepos();
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    repos.workouts
      .addSet(p.performedExerciseId)
      .catch(() => setError(UNEXPECTED_ERROR_MESSAGE))
      .finally(() => {
        busy.current = false;
      });
  };
  return (
    <>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <button type="button" className={styles.addSet} onClick={add}>
        Ajouter une série
      </button>
    </>
  );
}
