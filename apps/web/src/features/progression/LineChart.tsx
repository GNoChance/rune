import { daysBetween } from '@rune/domain';
import styles from './progression.module.css';

const W = 320;
const H = 150;
const PAD = { left: 12, right: 12, top: 14, bottom: 14 };

/**
 * Courbe d'une valeur par séance, en SVG, sans axe gradué : le dessin est décoratif (`aria-hidden`), le tableau
 * équivalent qui l'accompagne porte toute l'information (la couleur ne porte rien seule). Les points sont
 * répartis également ; une seule séance donne un point. La courbe se trace à l'arrivée, d'un trait, sauf en
 * mouvement réduit (feuille de style).
 *
 * `points` (facultatif, un par valeur, `null` : aucun) : mesures brutes dessinées en points discrets autour du
 * trait ; le trait n'a alors plus ses propres cercles. Sans `points`, le dessin est celui d'origine.
 *
 * `dates` (facultatif, une par valeur, `AAAA-MM-JJ` croissantes) : les abscisses suivent l'écart en jours au lieu
 * du rang (courbe du poids : deux pesées d'une semaine d'écart ne sont pas voisines). `neutral` : tracé à la durée
 * d'un changement d'écran, jamais celle d'une célébration (aucune célébration liée au poids).
 */
export function LineChart({
  values,
  points,
  dates,
  neutral = false,
}: {
  values: readonly number[];
  points?: readonly (number | null)[];
  dates?: readonly string[];
  neutral?: boolean;
}) {
  const raw = (points ?? []).filter((v): v is number => v !== null);
  const lo = Math.min(...values, ...raw);
  const hi = Math.max(...values, ...raw);
  const first = dates?.[0];
  const span = first === undefined ? 0 : daysBetween(first, dates?.at(-1) ?? first);
  // Position dans [0 ; 1] : écart en jours si `dates` est donné et couvre plus d'un jour, sinon rang.
  const at = (i: number) =>
    first !== undefined && span > 0
      ? daysBetween(first, dates?.[i] ?? first) / span
      : i / (values.length - 1);
  const x = (i: number) => (values.length === 1 ? W / 2 : PAD.left + at(i) * (W - PAD.left - PAD.right));
  const y = (v: number) =>
    hi === lo ? H / 2 : PAD.top + ((hi - v) * (H - PAD.top - PAD.bottom)) / (hi - lo);
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <svg
      data-chart=""
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${W} ${H}`}
      className={styles.chart}
    >
      <line className={styles.chartBase} x1={PAD.left} x2={W - PAD.right} y1={H - 4} y2={H - 4} />
      {values.length > 1 ? (
        <path
          className={neutral ? `${styles.chartLine} ${styles.chartLineNeutral}` : styles.chartLine}
          d={path}
          pathLength={1}
        />
      ) : null}
      {(points ?? values).map((v, i) =>
        v === null || v === undefined ? null : (
          // L'ordre des points est celui des séances : aucun autre identifiant, la liste ne bouge pas.
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: liste fixe, jamais réordonnée
            key={i}
            className={points ? styles.chartPoint : styles.chartDot}
            cx={x(i)}
            cy={y(v)}
            r={points ? 3 : 4}
          />
        ),
      )}
    </svg>
  );
}
