import { type ProgressSummary, progressSummary } from '@rune/domain';
import { useMemo } from 'react';
import { useCatalog, useHistory, type WorkoutSessionView } from '../../repos';

export interface Progress {
  /** XP, rangs, compteurs : tout recalculé depuis l'historique local (spec brique 3 §8). */
  summary: ProgressSummary;
  /** Séances terminées ou abandonnées, la plus récente d'abord. */
  history: WorkoutSessionView[];
  /** Nom de chaque fiche du catalogue local, par identifiant. */
  names: ReadonlyMap<string, string>;
}

/**
 * Progression du membre, observée ; `undefined` tant que l'historique et le catalogue locaux n'ont pas répondu
 * (jamais un rang E affiché en attendant). Catalogue absent : les séances comptent pour l'XP, pas pour les groupes.
 */
export function useProgress(): Progress | undefined {
  const history = useHistory();
  const catalog = useCatalog();
  const loading = history === undefined || catalog.state === 'loading';
  const sheets = catalog.sheets;
  return useMemo(
    () =>
      loading
        ? undefined
        : {
            summary: progressSummary(history, sheets),
            history,
            names: new Map(sheets.map((s) => [s.id, s.name])),
          },
    [loading, history, sheets],
  );
}
