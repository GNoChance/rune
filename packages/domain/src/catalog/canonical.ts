import { ExerciseSheetSchema } from '@rune/contracts';

const SHAPE = ExerciseSheetSchema.shape;

/** Ordre des clés de la fiche : celui de `ExerciseSheetSchema`, donc de 04 §4 (`batch` juste après `status`). */
const SHEET_KEYS: readonly string[] = Object.keys(SHAPE);

/** Ordre des clés des objets imbriqués, repris de leurs schémas. */
const NESTED_KEYS: Readonly<Record<string, readonly string[]>> = {
  mistakes: Object.keys(SHAPE.mistakes.element.shape),
  illustrations: Object.keys(SHAPE.illustrations.element.shape),
  drafting: Object.keys(SHAPE.drafting.unwrap().shape),
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Copie de `record` dont les clés suivent `keys`, puis les autres en ordre binaire (tri par défaut des chaînes).
 * Une valeur `undefined` n'est pas écrite : facultatif = clé absente.
 */
function ordered(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  child: (key: string, value: unknown) => unknown,
): Record<string, unknown> {
  const others = Object.keys(record)
    .filter((k) => !keys.includes(k))
    .sort();
  const out: Record<string, unknown> = {};
  for (const key of [...keys, ...others]) {
    const value = record[key];
    if (value !== undefined) out[key] = child(key, value);
  }
  return out;
}

/** Objets imbriqués : `keys` pour ceux de la fiche, ordre binaire au-delà. */
function nested(value: unknown, keys: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => nested(item, keys));
  if (isRecord(value)) return ordered(value, keys, (_, v) => nested(v, []));
  return value;
}

/**
 * Forme canonique d'une fiche (04 §10) : JSON UTF-8, clés dans l'ordre de 04 §4 (et des sous-objets selon leur
 * schéma), indentation de 2 espaces, fins de ligne LF, un LF final. Seule fonction de sérialisation des fiches :
 * fichiers de `data/exercises/`, export, contenu des révisions. Accepte aussi un contenu partiel (`contentOf`) ;
 * une clé hors 04 §4 est gardée, après les autres, en ordre binaire. `canonicalJson(JSON.parse(t)) === t`.
 */
export function canonicalJson(sheet: Readonly<Record<string, unknown>>): string {
  const root = ordered(sheet, SHEET_KEYS, (key, value) => nested(value, NESTED_KEYS[key] ?? []));
  return `${JSON.stringify(root, null, 2)}\n`;
}
