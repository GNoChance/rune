import { SWAP_REASONS, type SwapReason } from '@rune/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { type SwapCandidate, useRepos, useSwapCandidates, type WorkoutExerciseView } from '../../repos';
import { Banner, BottomSheet } from '../../ui';
import styles from './live.module.css';
import { PainAdvice } from './PainSheet';

/*
 * « Changer d'exercice » en séance (05 §11.4, spec brique 3 §7.3) : les candidats du slot (`swapCandidates`), puis la
 * raison (matériel, occupé, douleur, préférence). Après « Douleur » (05 §13.6), la même feuille s'ouvre sous le titre
 * « Douleur » : le conseil de sécurité en tête, seulement les exercices du même type de mouvement, et la raison
 * « douleur » sans la demander ; sans accord santé, le dépôt ne la garde pas (raison vide).
 */

export const SWAP_REASON_LABELS: Record<SwapReason, string> = {
  equipment: 'Matériel',
  busy: 'Occupé',
  pain: 'Douleur',
  preference: 'Préférence',
};

const NONE = "Aucun autre exercice n'est faisable ici.";
const NOT_SWAPPED = "L'exercice n'a pas été changé.";

export function SwapSheet(p: {
  exercise: WorkoutExerciseView;
  name: string;
  /** Après « Douleur » : conseil (mineur, barre) et candidats du même type de mouvement. */
  pain: { minor: boolean; barbell: boolean } | null;
  /** Il reste des séries à faire : un autre exercice peut prendre la suite. */
  swappable: boolean;
  onClose(): void;
}) {
  const repos = useRepos();
  const candidates = useSwapCandidates(p.exercise.id);
  const [picked, setPicked] = useState<SwapCandidate | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adviceId = useId();
  const firstReason = useRef<HTMLButtonElement>(null);
  const list = p.pain ? candidates?.filter((c) => c.sameMovement) : candidates;

  // Le candidat touché disparaît avec la liste : le focus passe à la première raison.
  useEffect(() => {
    if (picked !== null) firstReason.current?.focus();
  }, [picked]);

  const swap = async (exerciseId: string, reason: SwapReason) => {
    setPending(true);
    setError(null);
    try {
      await repos.workouts.swapExercise(p.exercise.id, exerciseId, reason);
      p.onClose();
    } catch {
      setError(NOT_SWAPPED);
      setPending(false);
    }
  };

  const choose = (candidate: SwapCandidate) => {
    if (p.pain) void swap(candidate.id, 'pain');
    else setPicked(candidate);
  };

  return (
    <BottomSheet
      open
      title={p.pain ? 'Douleur' : "Changer d'exercice"}
      onClose={p.onClose}
      describedBy={p.pain ? adviceId : undefined}
    >
      {p.pain ? <PainAdvice id={adviceId} minor={p.pain.minor} barbell={p.pain.barbell} /> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {!p.swappable ? null : picked === null ? (
        <>
          {p.pain ? (
            <h3 className={styles.sheetSubtitle}>Changer d'exercice</h3>
          ) : (
            <p className={styles.sheetDetail}>{`À la place de ${p.name}`}</p>
          )}
          {list === undefined ? null : list.length === 0 ? (
            <p className={styles.sheetDetail}>{NONE}</p>
          ) : (
            <ul className={styles.menuList}>
              {list.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className={styles.menuItem}
                    disabled={pending}
                    onClick={() => choose(candidate)}
                  >
                    {candidate.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className={styles.sheetDetail}>{`${picked.name} à la place de ${p.name}`}</p>
          <fieldset className={styles.reasons}>
            <legend className={styles.sheetSubtitle}>Pourquoi ?</legend>
            <ul className={styles.menuList}>
              {SWAP_REASONS.map((reason, i) => (
                <li key={reason}>
                  <button
                    ref={i === 0 ? firstReason : undefined}
                    type="button"
                    className={styles.menuItem}
                    disabled={pending}
                    onClick={() => void swap(picked.id, reason)}
                  >
                    {SWAP_REASON_LABELS[reason]}
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
        </>
      )}
    </BottomSheet>
  );
}
