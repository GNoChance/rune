import { add, cmp, type Q, q, roundHalfUpTo, sub } from './exact';

/** Une pesée vivante (non supprimée), date de Paris `YYYY-MM-DD`, poids en grammes. */
export type WeighIn = { date: string; weightG: number };

const SUSPICIOUS_GAP_G = 3_000;
const REFERENCE_MAX_AGE_DAYS = 14;
const MIN_WEEK_COUNT = 3;

/** Nombre de jours depuis 1970-01-01 (calendrier grégorien, entiers seulement). */
function toDayNumber(day: string): number {
  const y0 = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDayNumber(z0: number): string {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Nombre de jours civils de `from` à `to` (négatif si `to` précède `from`). */
export function daysBetween(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from);
}

export function addDays(day: string, n: number): string {
  return fromDayNumber(toDayNumber(day) + n);
}

/** Lundi de la semaine qui contient `day`. */
export function mondayOf(day: string): string {
  const z = toDayNumber(day);
  // 1970-01-01 était un jeudi
  const sinceMonday = (((z + 3) % 7) + 7) % 7;
  return fromDayNumber(z - sinceMonday);
}

function meanBetween(w: WeighIn[], from: string, to: string): { count: number; mean: Q | null } {
  let sum = 0;
  let count = 0;
  for (const x of w) {
    if (x.date >= from && x.date <= to) {
      sum += x.weightG;
      count += 1;
    }
  }
  return { count, mean: count === 0 ? null : q(sum, count) };
}

const toGrams = (x: Q): number => Number(roundHalfUpTo(x, 1n));

/** Moyenne des pesées de d-6 à d, arrondie au gramme. */
export function movingAverage7(w: WeighIn[], day: string): number | null {
  const { mean } = meanBetween(w, addDays(day, -6), day);
  return mean === null ? null : toGrams(mean);
}

/** Moyenne glissante, sinon dernière pesée de moins de 14 jours ; arrondie à 100 g. */
export function referenceWeight(w: WeighIn[], day: string): number | null {
  const { mean } = meanBetween(w, addDays(day, -6), day);
  if (mean !== null) return Number(roundHalfUpTo(mean, 100n));
  let last: WeighIn | null = null;
  for (const x of w) {
    if (
      x.date <= day &&
      x.date > addDays(day, -REFERENCE_MAX_AGE_DAYS) &&
      (last === null || x.date >= last.date)
    ) {
      last = x;
    }
  }
  return last === null ? null : Number(roundHalfUpTo(q(last.weightG), 100n));
}

/** M(S) : moyenne du lundi au dimanche, définie à partir de 3 pesées. */
export function weekMean(w: WeighIn[], monday: string): { count: number; meanG: number | null } {
  const { count, mean } = meanBetween(w, monday, addDays(monday, 6));
  return { count, meanG: count >= MIN_WEEK_COUNT && mean !== null ? toGrams(mean) : null };
}

/** Plus de 3 000 g d'écart avec la moyenne des 7 jours précédents. */
export function isSuspiciousEntry(w: WeighIn[], weightG: number, day: string): boolean {
  const { mean } = meanBetween(w, addDays(day, -7), addDays(day, -1));
  if (mean === null) return false;
  const gap = sub(q(weightG), mean);
  const abs = cmp(gap, q(0)) < 0 ? sub(q(0), gap) : add(gap, q(0));
  return cmp(abs, q(SUSPICIOUS_GAP_G)) > 0;
}
