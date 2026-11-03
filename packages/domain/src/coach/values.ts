export type UnitFamily = 'mass' | 'percent' | 'nutrition';

export interface Quantity {
  value: string;
  unit: string;
  family: UnitFamily;
  index: number;
}

export type AllowedValues = Readonly<Record<UnitFamily, ReadonlySet<string>>>;

const THOUSANDS_SPACES = /[    ]/g;

const UNIT_FAMILIES: Readonly<Record<string, UnitFamily>> = {
  kg: 'mass',
  kilo: 'mass',
  kilos: 'mass',
  kilogramme: 'mass',
  kilogrammes: 'mass',
  '%': 'percent',
  'pour cent': 'percent',
  kcal: 'nutrition',
  cal: 'nutrition',
  calorie: 'nutrition',
  calories: 'nutrition',
  g: 'nutrition',
  gr: 'nutrition',
  gramme: 'nutrition',
  grammes: 'nutrition',
};

// Nombre (milliers par espaces, décimale « , » ou « . »), puis unité en fin de mot.
const QUANTITY =
  /(?<![\d.,])(\d+(?:[    ]\d{3})*(?:[.,]\d+)?)[    ]?(kilogrammes?|kilos?|kg|kcal|calories?|cal|grammes?|gr|g|%|pour[  ]cent)(?![\p{L}\d])/giu;

export function normalizeNumber(raw: string): string {
  const compact = raw.replace(THOUSANDS_SPACES, '').replace(',', '.');
  if (!compact.includes('.')) return compact;
  return compact.replace(/0+$/, '').replace(/\.$/, '');
}

export function findQuantities(text: string): Quantity[] {
  const found: Quantity[] = [];
  for (const match of text.matchAll(QUANTITY)) {
    const unit = match[2] as string;
    const family = UNIT_FAMILIES[unit.toLowerCase().replace(/[ ]/g, ' ')];
    if (!family) continue;
    found.push({ value: normalizeNumber(match[1] as string), unit, family, index: match.index });
  }
  return found;
}

function familyOfKey(key: string | undefined): UnitFamily | undefined {
  if (key === undefined) return undefined;
  if (key.endsWith('_kg')) return 'mass';
  if (key.endsWith('_pct')) return 'percent';
  if (key.endsWith('_kcal') || key.endsWith('_g')) return 'nutrition';
  return undefined;
}

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
  };
  const add = (family: UnitFamily, value: number | string) => {
    if (family === 'nutrition' && !sources.nutritionFull) return;
    sets[family].add(normalizeNumber(String(value)));
  };

  // `key` est la clé la plus proche, transmise à travers les tableaux.
  const walk = (node: unknown, key: string | undefined): void => {
    if (typeof node === 'number') {
      const family = familyOfKey(key);
      if (family) add(family, node);
    } else if (typeof node === 'string') {
      for (const quantity of findQuantities(node)) add(quantity.family, quantity.value);
    } else if (Array.isArray(node)) {
      for (const item of node) {
        // Série en tuple [load_kg, reps, duration_s, effort] : seule la position 0 est une masse.
        if (key === 'sets' && Array.isArray(item)) {
          if (typeof item[0] === 'number') add('mass', item[0]);
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
  for (const constant of sources.constants) add('percent', constant);
  return sets;
}
