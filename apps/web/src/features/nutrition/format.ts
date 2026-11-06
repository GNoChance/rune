/*
 * Nombres de la nutrition au format français (spec brique 5 §12.6) : espace fine insécable des milliers, virgule
 * décimale. Aucune unité : le texte qui les porte la dit. Sans `Intl`, dont les séparateurs varient d'un moteur à l'autre.
 */

const NARROW_NBSP = ' ';
const MINUS = '−';

/** Entier avec une espace fine insécable tous les trois chiffres. */
function groupThousands(n: number): string {
  const digits = String(Math.abs(Math.round(n)));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
  return n < 0 && Math.round(n) !== 0 ? `${MINUS}${grouped}` : grouped;
}

/** Énergie en kcal : `2100` → « 2 100 ». */
export const formatKcal = (n: number): string => groupThousands(n);

/** Masse en grammes (macronutriments) : `1250` → « 1 250 ». */
export const formatGrams = (n: number): string => groupThousands(n);

/** Eau en litres, à 0,05 L près, zéros de fin retirés : `2250` → « 2,25 », `2000` → « 2 ». */
export function formatLitres(ml: number): string {
  const hundredths = Math.round(ml / 50) * 5;
  const whole = Math.floor(hundredths / 100);
  const rest = hundredths % 100;
  if (rest === 0) return String(whole);
  return `${whole},${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

/** Poids en kilogrammes, une décimale : `70500` g → « 70,5 ». */
export function formatKg(g: number): string {
  const tenths = Math.round(g / 100);
  return `${groupThousands(Math.floor(tenths / 10))},${tenths % 10}`;
}

/** Variation en pourcents, une décimale, signe explicite (moins typographique) : `-0.45` → « −0,5 », `0.3` → « +0,3 ». */
export function formatPct(x: number): string {
  const tenths = Math.round(Math.abs(x) * 10);
  const body = `${Math.floor(tenths / 10)},${tenths % 10}`;
  if (tenths === 0) return body;
  return `${x < 0 ? MINUS : '+'}${body}`;
}

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

/** Date civile en toutes lettres : `2026-11-07` → « 7 novembre 2026 » (« 1er » le premier du mois). */
export function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const month = MONTHS[(m ?? 1) - 1];
  if (!y || !d || !month) return iso;
  return `${d === 1 ? '1er' : String(d)} ${month} ${y}`;
}
