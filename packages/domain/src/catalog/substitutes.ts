import { SUBSTITUTE_LIMIT } from '@rune/contracts';
import { type CatalogContext, type CatalogSheet, compareIds, isUsable } from './usable';

/** Poids du score des remplaçants (04 §6.4). Réglables. */
const WEIGHTS = { primary: 3, secondary: 1, levelGap: 2, sameUnilateral: 1, sameLoadMode: 1 } as const;

const common = (a: readonly string[], b: readonly string[]) => a.filter((m) => b.includes(m)).length;

function score(ex: CatalogSheet, c: CatalogSheet): number {
  return (
    WEIGHTS.primary * common(ex.primary_muscles, c.primary_muscles) +
    WEIGHTS.secondary * common(ex.secondary_muscles, c.secondary_muscles) -
    WEIGHTS.levelGap * Math.abs(ex.level - c.level) +
    (ex.unilateral === c.unilateral ? WEIGHTS.sameUnilateral : 0) +
    (ex.load_mode === c.load_mode ? WEIGHTS.sameLoadMode : 0)
  );
}

/**
 * Remplaçants de `ex` (04 §6.4), seul algorithme de remplacement de l'appli.
 * 1. Candidats : fiches ≠ `ex`, `isUsable`, `level ≤ maxLevel`, même `movement_pattern` ou même `chain_id` non
 *    vide, au moins un muscle principal commun.
 * 2. Score : 3 × principaux communs + 1 × secondaires communs − 2 × |écart de niveau| + 1 si même `unilateral`
 *    + 1 si même `load_mode`.
 * 3. Score décroissant, puis `id` en ordre binaire ; au plus `SUBSTITUTE_LIMIT`.
 * `ex` peut être retirée ou non utilisable (lien « Voir des exercices proches », spec brique 2 §4.2).
 */
export function substitutes<S extends CatalogSheet>(ex: CatalogSheet, ctx: CatalogContext<S>): S[] {
  const sameChain = (c: CatalogSheet) => Boolean(ex.chain_id) && c.chain_id === ex.chain_id;
  return ctx.catalog
    .filter(
      (c) =>
        c.id !== ex.id &&
        isUsable(c, ctx) &&
        c.level <= ctx.maxLevel &&
        (c.movement_pattern === ex.movement_pattern || sameChain(c)) &&
        common(c.primary_muscles, ex.primary_muscles) > 0,
    )
    .map((sheet) => ({ sheet, score: score(ex, sheet) }))
    .sort((a, b) => b.score - a.score || compareIds(a.sheet, b.sheet))
    .slice(0, SUBSTITUTE_LIMIT)
    .map(({ sheet }) => sheet);
}
