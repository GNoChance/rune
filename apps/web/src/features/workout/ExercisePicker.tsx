import { useState } from 'react';
import { useLive } from '../../app-services';
import { useRepos } from '../../repos';
import { BottomSheet, Field, plural } from '../../ui';
import { FeasibleFilter } from '../exercises/ExercisesHome';
import { useFeasibleOnly } from '../exercises/exercise-nav';
import styles from './live.module.css';

/*
 * Choix d'un exercice pour la séance libre (spec brique 3 §7.5) : la recherche du catalogue de la brique 2 (nom et
 * alias, sans accents ni casse) avec l'interrupteur « Faisable : <lieu> » au lieu de la séance, le même que celui de
 * l'onglet Exercices (spec brique 2 §4.1). Toucher un résultat l'ajoute à la séance. Tout est lu en local, hors ligne
 * compris.
 */

const countText = (n: number) => `${n} ${plural(n, 'exercice', 'exercices')}`;

export function ExercisePicker(p: {
  /** Lieu de la séance ; null (ou lieu supprimé depuis) : le filtre n'a pas de lieu et ne masque rien. */
  placeId: string | null;
  /** Ajout en cours : les résultats ne répondent plus. */
  pending: boolean;
  onPick(exerciseId: string): void;
  onClose(): void;
}) {
  const repos = useRepos();
  const [text, setText] = useState('');
  const [feasibleOnly, setFeasibleOnly] = useFeasibleOnly();
  const context = useLive(() => repos.catalog.context(p.placeId), [repos, p.placeId]);
  const query = text.trim();
  const found = useLive(
    async () =>
      query === ''
        ? null
        : { query, ...(await repos.catalog.searchExercises(query, { feasibleOnly, placeId: p.placeId })) },
    [repos, query, feasibleOnly, p.placeId],
  );
  // Résultats de la recherche affichée seulement (la précédente reste le temps que la nouvelle arrive).
  const shown = found && found.query === query ? found : null;
  const n = shown?.results.length ?? 0;
  const hidden = shown?.hiddenByFeasible ?? 0;

  return (
    <BottomSheet open title="Ajouter un exercice" onClose={p.onClose}>
      <div className={styles.picker}>
        <Field label="Rechercher un exercice">
          <input
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <FeasibleFilter place={context?.place ?? null} value={feasibleOnly} onChange={setFeasibleOnly} />
        {shown ? (
          <>
            <p role="status" className={n > 0 ? styles.srOnly : styles.sheetDetail}>
              {n > 0 ? `${countText(n)} ${plural(n, 'trouvé', 'trouvés')}` : 'Aucun exercice ne correspond.'}
            </p>
            {n > 0 ? (
              <ul className={styles.menuList} aria-label="Résultats">
                {shown.results.map((sheet) => (
                  <li key={sheet.id}>
                    <button
                      type="button"
                      className={styles.menuItem}
                      disabled={p.pending}
                      onClick={() => p.onPick(sheet.id)}
                    >
                      {sheet.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {n === 0 && hidden > 0 ? (
              <p className={styles.sheetDetail}>
                {`${hidden} ${plural(hidden, 'exercice masqué', 'exercices masqués')} par le filtre Faisable`}
                {' · '}
                <button type="button" className={styles.textButton} onClick={() => setFeasibleOnly(false)}>
                  Les voir
                </button>
              </p>
            ) : null}
            {shown.hiddenByCautious ? (
              <p className={styles.sheetDetail}>Certains exercices sont masqués par le mode prudent.</p>
            ) : null}
          </>
        ) : null}
      </div>
    </BottomSheet>
  );
}
