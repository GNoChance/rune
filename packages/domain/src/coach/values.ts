export type UnitFamily = 'mass' | 'percent' | 'nutrition' | 'duration';

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

const UNIT_FAMILIES: Readonly<Record<string, UnitFamily>> = {
  kg: 'mass',
  kilo: 'mass',
  kilos: 'mass',
  kilogramme: 'mass',
  kilogrammes: 'mass',
  '%': 'percent',
  'pour cent': 'percent',
  pourcent: 'percent',
  kcal: 'nutrition',
  cal: 'nutrition',
  calorie: 'nutrition',
  calories: 'nutrition',
  g: 'nutrition',
  gr: 'nutrition',
  gramme: 'nutrition',
  min: 'duration',
  mn: 'duration',
  minute: 'duration',
  minutes: 'duration',
  grammes: 'nutrition',
};

const NUMBER = `\\d+(?:${SP}\\d{3})*(?:[.,]\\d+)?`;
// « 8 à 10 », « 10-15 », « 10–15 », « 10−15 », « entre 8 et 10 », « 60 ou 62,5 », « 60/62,5 » : les deux nombres
// sont contrôlés. Tirets : trait d'union-moins, U+2010 à U+2015, signe moins U+2212.
const RANGE_SEPARATOR = `${SP}*(?:[-/\\u2010-\\u2015\\u2212]|à|et|ou)${SP}*`;
// Nombre (ou fourchette) puis unité en fin de mot. Le nombre n'est précédé ni d'un chiffre,
// ni d'un chiffre suivi d'un séparateur décimal.
const QUANTITY = new RegExp(
  `(?<!\\d)(?<!\\d[.,])(?:(${NUMBER})${RANGE_SEPARATOR})?(${NUMBER})${SP}*` +
    `(kilogrammes?|kilos?|kg|kcal|calories?|cal|grammes?|gr|g|minutes?|min|mn|%|pour${SP}*cent|pourcent)(?![\\p{L}\\d])`,
  'giud',
);

export function normalizeNumber(raw: string): string {
  const compact = raw.replace(SPACES, '').replace(',', '.');
  if (!compact.includes('.')) return compact;
  return compact.replace(/0+$/, '').replace(/\.$/, '');
}

export function findQuantities(text: string): Quantity[] {
  const found: Quantity[] = [];
  for (const match of text.matchAll(QUANTITY)) {
    const unit = match[3] as string;
    const family = UNIT_FAMILIES[unit.toLowerCase().replace(SPACES, ' ')];
    if (!family) continue;
    for (const group of [1, 2]) {
      const raw = match[group];
      const at = match.indices?.[group];
      if (raw === undefined || at === undefined) continue;
      found.push({ value: normalizeNumber(raw), unit, family, index: at[0] });
    }
  }
  return found;
}

function familyOfKey(key: string | undefined): UnitFamily | undefined {
  if (key === undefined) return undefined;
  if (key.endsWith('_kg')) return 'mass';
  if (key.endsWith('_pct')) return 'percent';
  if (key.endsWith('_min') || key.endsWith('_minutes')) return 'duration';
  if (key.endsWith('_kcal') || key.endsWith('_g')) return 'nutrition';
  return undefined;
}

const NUMERIC_STRING = new RegExp(`^[-+]?${NUMBER}$`);

export function allowedValues(sources: {
  brief: unknown;
  toolResults: readonly unknown[];
  constants: readonly number[];
  nutritionFull: boolean;
  /** Durées (minutes) que le message de la personne autorise, par exemple celles d'un parcours guidé. */
  durationsMin?: readonly number[];
}): AllowedValues {
  const sets: Record<UnitFamily, Set<string>> = {
    mass: new Set(),
    percent: new Set(),
    nutrition: new Set(),
    duration: new Set(),
  };
  // Le signe est ignoré (comme dans `findQuantities`) ; arrondi à 3 décimales (0.1 + 0.2 -> 0.3).
  const addNumber = (family: UnitFamily, value: number) => {
    if (family === 'nutrition' && !sources.nutritionFull) return;
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
  for (const minutes of sources.durationsMin ?? []) addNumber('duration', minutes);
  return sets;
}
