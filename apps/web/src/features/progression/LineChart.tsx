import styles from './progression.module.css';

const W = 320;
const H = 150;
const PAD = { left: 12, right: 12, top: 14, bottom: 14 };

/**
 * Courbe d'une valeur par séance, en SVG, sans axe gradué : le dessin est décoratif (`aria-hidden`), le tableau
 * équivalent qui l'accompagne porte toute l'information (la couleur ne porte rien seule). Les points sont
 * répartis également ; une seule séance donne un point. La courbe se trace à l'arrivée, d'un trait, sauf en
 * mouvement réduit (feuille de style).
 */
export function LineChart({ values }: { values: readonly number[] }) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) =>
    values.length === 1 ? W / 2 : PAD.left + (i * (W - PAD.left - PAD.right)) / (values.length - 1);
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
      {values.length > 1 ? <path className={styles.chartLine} d={path} pathLength={1} /> : null}
      {values.map((v, i) => (
        // L'ordre des points est celui des séances : aucun autre identifiant, la liste ne bouge pas.
        // biome-ignore lint/suspicious/noArrayIndexKey: liste fixe, jamais réordonnée
        <circle key={i} className={styles.chartDot} cx={x(i)} cy={y(v)} r={4} />
      ))}
    </svg>
  );
}
