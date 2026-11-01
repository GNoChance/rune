import type { Effort } from '@rune/contracts';
import { BottomSheet, Button, CheckGlyph } from '../../ui';
import styles from './live.module.css';

/*
 * Effort d'une série (05 §7, spec brique 3 §7.3) : demandé en un tap après la dernière série de travail d'un exercice,
 * facultatif sur les autres (pastille « Effort »). Les quatre libellés sont ceux de 05 §7, mot pour mot.
 */

export const EFFORT_ORDER: readonly Effort[] = ['easy', 'ok', 'hard', 'failed'];

/** Libellés des boutons (05 §7, colonne « Libellé »). */
export const EFFORT_LABELS: Record<Effort, string> = {
  easy: "J'aurais pu en faire 4 de plus, ou plus",
  ok: 'Encore 2 ou 3',
  hard: 'Encore 1, pas plus',
  failed: "La dernière n'est pas passée",
};

/** Noms courts (05 §7, colonne « Bouton »), sur la pastille d'une série notée. */
export const EFFORT_SHORT: Record<Effort, string> = {
  easy: 'Facile',
  ok: 'Correct',
  hard: 'Difficile',
  failed: 'Échec',
};

export function EffortSheet(p: {
  open: boolean;
  /** « Squat barre · série 3 ». */
  detail: string;
  current: Effort | null;
  pending: boolean;
  onPick(effort: Effort): void;
  /** « Plus tard » : rien n'est écrit. */
  onLater(): void;
}) {
  return (
    <BottomSheet
      open={p.open}
      title="Effort"
      onClose={p.onLater}
      actions={
        <Button variant="secondary" block onClick={p.onLater}>
          Plus tard
        </Button>
      }
    >
      <p className={styles.sheetDetail}>{p.detail}</p>
      <ul className={styles.effortList}>
        {EFFORT_ORDER.map((effort) => (
          <li key={effort}>
            <button
              type="button"
              className={styles.effortChoice}
              aria-pressed={p.current === effort}
              disabled={p.pending}
              onClick={() => p.onPick(effort)}
            >
              <span>{EFFORT_LABELS[effort]}</span>
              {p.current === effort ? <CheckGlyph /> : null}
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
