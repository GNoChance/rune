export type UnitFamily = 'mass' | 'percent' | 'nutrition' | 'volume';

export interface Quantity {
  value: string;
  unit: string;
  family: UnitFamily;
  index: number;
}

export type AllowedValues = Readonly<Record<UnitFamily, ReadonlySet<string>>>;

// Espaces admises : normale, insécable, fine insécable, fine.
const SPACES = /[    ]+/g;
const SP = '[ \\u00a0\\u202f\\u2009]';

/** Unité normalisée rendue par `findUnitNumbers` ; les volumes sont convertis en mL. */
export type UnitCode = 'kcal' | 'g' | 'kg' | 'pct' | 'ml';

interface UnitInfo {
  family: UnitFamily;
  code: UnitCode;
  /** Facteur vers l'unité du code (L → mL : 1000). */
  factor: number;
}

const info = (family: UnitFamily, code: UnitCode, factor = 1): UnitInfo => ({ family, code, factor });

const UNITS: Readonly<Record<string, UnitInfo>> = {
  kg: info('mass', 'kg'),
  kilo: info('mass', 'kg'),
  kilos: info('mass', 'kg'),
  kilogramme: info('mass', 'kg'),
  kilogrammes: info('mass', 'kg'),
  '%': info('percent', 'pct'),
  'pour cent': info('percent', 'pct'),
  pourcent: info('percent', 'pct'),
  kcal: info('nutrition', 'kcal'),
  cal: info('nutrition', 'kcal'),
  calorie: info('nutrition', 'kcal'),
  calories: info('nutrition', 'kcal'),
  g: info('nutrition', 'g'),
  gr: info('nutrition', 'g'),
  gramme: info('nutrition', 'g'),
  grammes: info('nutrition', 'g'),
  l: info('volume', 'ml', 1000),
  litre: info('volume', 'ml', 1000),
  litres: info('volume', 'ml', 1000),
  ml: info('volume', 'ml'),
  cl: info('volume', 'ml', 10),
};

const unitInfo = (unit: string): UnitInfo | undefined => UNITS[unit.toLowerCase().replace(SPACES, ' ')];

const NUMBER = `\\d+(?:${SP}\\d{3})*(?:[.,]\\d+)?`;
// « 8 à 10 », « 10-15 », « 10–15 », « 10−15 », « entre 8 et 10 », « 60 ou 62,5 », « 60/62,5 » : les deux nombres
// sont contrôlés. Tirets : trait d'union-moins, U+2010 à U+2015, signe moins U+2212.
const RANGE_SEPARATOR = `${SP}*(?:[-/\\u2010-\\u2015\\u2212]|à|et|ou)${SP}*`;
// Nombre (ou fourchette) puis unité en fin de mot. Le nombre n'est précédé ni d'un chiffre,
// ni d'un chiffre suivi d'un séparateur décimal.
const QUANTITY = new RegExp(
  `(?<!\\d)(?<!\\d[.,])(?:(${NUMBER})${RANGE_SEPARATOR})?(${NUMBER})${SP}*` +
    `(kilogrammes?|kilos?|kg|kcal|calories?|cal|grammes?|gr|g|litres?|ml|cl|l|%|pour${SP}*cent|pourcent)(?![\\p{L}\\d])`,
  'giud',
);

/** Valeur multipliée par `factor`, arrondie à 3 décimales (2,25 L → 2250 mL). */
function convert(value: string, factor: number): string {
  if (factor === 1) return value;
  return normalizeNumber(String(Math.round(Number(value) * factor * 1000) / 1000));
}

export function normalizeNumber(raw: string): string {
  const compact = raw.replace(SPACES, '').replace(',', '.');
  if (!compact.includes('.')) return compact;
  return compact.replace(/0+$/, '').replace(/\.$/, '');
}

export function findQuantities(text: string): Quantity[] {
  const found: Quantity[] = [];
  for (const match of text.matchAll(QUANTITY)) {
    const unit = match[3] as string;
    const meta = unitInfo(unit);
    if (!meta) continue;
    const { family, factor } = meta;
    for (const group of [1, 2]) {
      const raw = match[group];
      const at = match.indices?.[group];
      if (raw === undefined || at === undefined) continue;
      found.push({ value: convert(normalizeNumber(raw), factor), unit, family, index: at[0] });
    }
  }
  return found;
}

/**
 * Nombres suivis d'une unité (kcal, g, kg, %, volumes), valeur normalisée et unité ramenée à un code ; volumes en mL.
 * Expression partagée par le filtre du coach et le contrôle des fiches conseils (brique 5 §11.4).
 */
export function findUnitNumbers(text: string): { value: string; unit: UnitCode; index: number }[] {
  return findQuantities(text).map(({ value, unit, index }) => ({
    value,
    unit: (unitInfo(unit) as UnitInfo).code,
    index,
  }));
}

function familyOfKey(key: string | undefined): UnitFamily | undefined {
  if (key === undefined) return undefined;
  if (key.endsWith('_kg')) return 'mass';
  if (key.endsWith('_pct')) return 'percent';
  if (key.endsWith('_kcal') || key.endsWith('_g')) return 'nutrition';
  if (key.endsWith('_ml')) return 'volume';
  return undefined;
}

const NUMERIC_STRING = new RegExp(`^[-+]?${NUMBER}$`);

export function allowedValues(sources: {
  brief: unknown;
  toolResults: readonly unknown[];
  constants: readonly number[];
  nutritionFull: boolean;
}): AllowedValues {
  const sets: Record<UnitFamily, Set<string>> = {
    mass: new Set(),
    percent: new Set(),
    nutrition: new Set(),
    volume: new Set(),
  };
  // Le signe est ignoré (comme dans `findQuantities`) ; arrondi à 3 décimales (0.1 + 0.2 -> 0.3).
  const addNumber = (family: UnitFamily, value: number) => {
    if ((family === 'nutrition' || family === 'volume') && !sources.nutritionFull) return;
    sets[family].add(normalizeNumber(String(Math.abs(Math.round(value * 1000) / 1000))));
  };

  // `key` est la clé la plus proche, transmise à travers les tableaux.
  const walk = (node: unknown, key: string | undefined): void => {
    if (typeof node === 'number') {
      const family = familyOfKey(key);
      if (family) addNumber(family, node);
    } else if (typeof node === 'string') {
      const family = familyOfKey(key);
      const text = node.trim();
      if (family && NUMERIC_STRING.test(text)) {
        addNumber(family, Number(normalizeNumber(text)));
      } else {
        for (const quantity of findQuantities(node)) {
          addNumber(quantity.family, Number(quantity.value));
        }
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        // Série en tuple [load_kg, reps, duration_s, effort] : seule la position 0 est une masse.
        if (key === 'sets' && Array.isArray(item)) {
          if (typeof item[0] === 'number') addNumber('mass', item[0]);
        } else {
          walk(item, key);
        }
      }
    } else if (node !== null && typeof node === 'object') {
      for (const [childKey, child] of Object.entries(node)) walk(child, childKey);
    }
  };

  walk(sources.brief, undefined);
  for (const result of sources.toolResults) walk(result, undefined);
  for (const constant of sources.constants) addNumber('percent', constant);
  return sets;
}
