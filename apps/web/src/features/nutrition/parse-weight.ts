export type ParsedWeight =
  | { ok: true; weightG: number }
  | { ok: false; reason: 'empty' | 'format' | 'decimals' | 'range' };

const MIN_G = 30_000;
const MAX_G = 250_000;

/** Poids saisi en kg à 0,1 près, virgule ou point, de 30 à 250 kg ; rend des grammes (multiple de 100). */
export function parseWeight(text: string): ParsedWeight {
  const t = text.trim();
  if (t === '') return { ok: false, reason: 'empty' };
  const m = /^(\d{1,3})(?:[.,](\d+))?$/.exec(t);
  if (!m) return { ok: false, reason: 'format' };
  const [, whole = '', decimals = ''] = m;
  if (decimals.length > 1) return { ok: false, reason: 'decimals' };
  const weightG = Number(whole) * 1000 + (decimals === '' ? 0 : Number(decimals) * 100);
  if (weightG < MIN_G || weightG > MAX_G) return { ok: false, reason: 'range' };
  return { ok: true, weightG };
}
