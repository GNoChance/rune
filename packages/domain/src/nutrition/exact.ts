/** Rationnels exacts en `bigint` : aucun flottant dans le calcul des repères (07 §5.6). */
export type Q = { readonly n: bigint; readonly d: bigint };

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

/** Construit n/d, réduit, dénominateur strictement positif. */
export const q = (n: bigint | number, d: bigint | number = 1n): Q => {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new Error('dénominateur nul');
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd) || 1n;
  return { n: nn / g, d: dd / g };
};

export const add = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Q, b: Q): Q => q(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
export const div = (a: Q, b: Q): Q => q(a.n * b.d, a.d * b.n);
/** -1, 0 ou 1. */
export const cmp = (a: Q, b: Q): -1 | 0 | 1 => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};
export const max = (a: Q, b: Q): Q => (cmp(a, b) >= 0 ? a : b);

/** Division entière arrondie vers le bas (d > 0). */
const floorDiv = (n: bigint, d: bigint): bigint => {
  const r = n / d;
  return n % d !== 0n && n < 0n ? r - 1n : r;
};

const checkStep = (step: bigint): void => {
  if (step <= 0n) throw new Error('pas invalide');
};

/** Multiple de `step` le plus proche, moitié vers le haut. */
export const roundHalfUpTo = (x: Q, step: bigint): bigint => {
  checkStep(step);
  return floorDiv(2n * x.n + x.d * step, 2n * x.d * step) * step;
};

/** Plus petit multiple de `step` supérieur ou égal à x. */
export const ceilTo = (x: Q, step: bigint): bigint => {
  checkStep(step);
  return -floorDiv(-x.n, x.d * step) * step;
};

/** Plus grand multiple de `step` inférieur ou égal à x. */
export const floorTo = (x: Q, step: bigint): bigint => {
  checkStep(step);
  return floorDiv(x.n, x.d * step) * step;
};

/** Nombre à `decimals` décimales au plus (moitié vers le haut), pour l'affichage seulement. */
export const toNumber = (x: Q, decimals: number): number => {
  const scale = 10n ** BigInt(decimals);
  const scaled = roundHalfUpTo(mul(x, q(scale)), 1n);
  return Number(scaled) / Number(scale);
};
