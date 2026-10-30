import {
  CATALOG_MAX_SHEETS,
  type DraftSheet,
  DraftSheetSchema,
  ExerciseSheetSchema,
  type ExerciseStatus,
  PUBLISH_BLOCKERS,
  type PublishBlocker,
} from '@rune/contracts';
import { isSensitive } from './review';

/** Clés obligatoires de la fiche complète (04 §4) : celles que le schéma refuse absentes. */
const REQUIRED_KEYS: readonly string[] = Object.entries(ExerciseSheetSchema.shape)
  .filter(([, schema]) => !schema.safeParse(undefined).success)
  .map(([key]) => key);

/**
 * Clés obligatoires de la fiche complète absentes de `record`, dans l'ordre de 04 §4 (R-FIC-1). Même règle pour
 * `incomplete` ici et pour une fiche `reviewed` ou `published` incomplète dans le validateur du catalogue.
 */
export function missingRequiredKeys(record: Readonly<Record<string, unknown>>): string[] {
  return REQUIRED_KEYS.filter((key) => record[key] === undefined);
}

/**
 * Entrée de `transitionBlockers`, lue par le serveur avant d'écrire.
 * - `sheet` : la fiche telle qu'elle serait enregistrée, encore à son statut actuel (le départ de la transition).
 * - `to` : statut visé ; égal au statut actuel pour un enregistrement (`PUT`).
 * - `comments` : commentaires de la fiche, toutes révisions confondues.
 * - `greenLight` : `healthGreenLight` de la fiche.
 * - `reviewChecked`, `minorsConfirmed` : cases cochées par l'admin pour l'entrée en `reviewed` (depuis `draft`
 *   ou `retired`).
 * - `manifestIds` : `id` des illustrations du manifeste.
 * - `templateRefs` : `id` des fiches que citent les modèles de programmes chargés, directement (liste de slot) ou
 *   par leur chaîne : l'appelant développe les chaînes.
 * - `catalog` : toutes les fiches de la base, tous statuts (la fiche elle-même peut y être).
 */
export type TransitionInput = {
  sheet: DraftSheet;
  to: ExerciseStatus;
  comments: readonly { resolvedAt: string | null }[];
  greenLight: boolean;
  reviewChecked: boolean;
  minorsConfirmed: boolean;
  manifestIds: ReadonlySet<string>;
  templateRefs: ReadonlySet<string>;
  catalog: readonly Pick<DraftSheet, 'id' | 'status' | 'easier_id' | 'harder_id'>[];
};

/**
 * Circuit éditorial (04 §8) : statuts atteignables depuis chaque statut. `draft → reviewed`, `reviewed → draft`
 * (renvoi en rédaction), `reviewed → published`, tout statut → `retired`, `retired → reviewed` (réactivation).
 * Un enregistrement (`PUT`) garde le statut : ce n'est pas une transition.
 */
export const EXERCISE_TRANSITIONS: { readonly [S in ExerciseStatus]: readonly ExerciseStatus[] } = {
  draft: ['reviewed', 'retired'],
  reviewed: ['draft', 'published', 'retired'],
  published: ['retired'],
  retired: ['reviewed'],
};

/** Vrai si `from → to` est une transition du circuit (04 §8) ; `transitionBlockers` ne le vérifie pas. */
export function isExerciseTransition(from: ExerciseStatus, to: ExerciseStatus): boolean {
  return EXERCISE_TRANSITIONS[from].includes(to);
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/**
 * `id` des fiches que citent des modèles de programmes (05 §4), pour `TransitionInput.templateRefs` : listes
 * `workouts[].slots[].exercises[]`, et chaînes `workouts[].slots[].chain` développées en leurs membres
 * (`chain_id`) parmi `catalog`, tous statuts. Les modèles sont lus sans hypothèse sur leur forme : ce qui n'a pas
 * le bon type est ignoré, le reste relève du validateur de Programmes.
 */
export function templateExerciseIds(
  templates: readonly unknown[],
  catalog: readonly Pick<DraftSheet, 'id' | 'chain_id'>[],
): Set<string> {
  const ids = new Set<string>();
  const slots = templates
    .flatMap((t) => (isRecord(t) ? listOf(t.workouts) : []))
    .flatMap((w) => (isRecord(w) ? listOf(w.slots) : []))
    .filter(isRecord);
  for (const slot of slots) {
    for (const id of listOf(slot.exercises)) if (typeof id === 'string') ids.add(id);
    const chain = slot.chain;
    if (typeof chain !== 'string') continue;
    for (const s of catalog) if (s.chain_id === chain) ids.add(s.id);
  }
  return ids;
}

type Move = { from: ExerciseStatus; to: ExerciseStatus };

/** Enregistrement (`PUT`) d'une fiche `reviewed` ou `published` : elle doit rester complète et valide. */
const savesCheckedSheet = ({ from, to }: Move) =>
  from === to && (from === 'reviewed' || from === 'published');
/** Entrée en `reviewed` : depuis `draft`, ou réactivation depuis `retired`. */
const entersReview = ({ from, to }: Move) => to === 'reviewed' && (from === 'draft' || from === 'retired');
const publishes = ({ from, to }: Move) => from === 'reviewed' && to === 'published';
const retires = ({ from, to }: Move) => from !== 'retired' && to === 'retired';
const reactivates = ({ from, to }: Move) => from === 'retired' && to === 'reviewed';

/** Contrôle de la fiche seule, calculé une fois et seulement si une règle le demande. */
type SheetCheck = {
  /** Clés obligatoires absentes (R-FIC-1). */
  missing: readonly string[];
  /** Vrai si un champ présent sort de ses bornes, ou si une règle entre champs n'est pas tenue. */
  invalidField: boolean;
};

function checkSheet(sheet: DraftSheet): SheetCheck {
  const missing = missingRequiredKeys(sheet);
  // Au statut `draft`, le schéma des brouillons tolère les champs IA absents : une clé absente n'empêche donc pas
  // les règles entre champs (muscles disjoints) d'être vérifiées. Les erreurs sur les clés absentes sont écartées.
  const result = DraftSheetSchema.safeParse({ ...sheet, status: 'draft' });
  const invalidField =
    !result.success &&
    result.error.issues.some(
      (issue) => !(issue.path.length === 1 && missing.includes(String(issue.path[0]))),
    );
  return { missing, invalidField };
}

type Rule = (input: TransitionInput, move: Move, check: () => SheetCheck) => boolean;

/**
 * Une règle par code (spec brique 2 §3.6) : vraie si le code s'applique à la transition et qu'il bloque.
 *
 * Interprétation : `incomplete` et `invalid_sheet` s'appliquent aussi à `retired → reviewed`. Le tableau du §3.6
 * ne les cite que pour `draft → reviewed`, mais R-FIC-1 (04 §4) rend les champs IA obligatoires à partir de
 * `reviewed`, et 04 §13 (critère 1) refuse une fiche `reviewed` incomplète : sans eux, un brouillon retiré
 * reviendrait en `reviewed` incomplet ou invalide. De même pour `review_unchecked` et `minors_unconfirmed` : une
 * fiche retirée s'enregistre sans contrôle, et sans les deux cases elle repartirait vers la publication avec des
 * consignes que personne n'a revues.
 *
 * Quand `incomplete` s'applique, il porte seul les champs absents ; `invalid_sheet` ne signale que le reste. À
 * l'enregistrement d'une fiche `reviewed` ou `published`, où `incomplete` ne s'applique pas, un champ absent rend
 * la fiche invalide (`ExerciseSheetSchema`).
 */
const RULES: { readonly [B in PublishBlocker]: Rule } = {
  incomplete: (_, move, check) => entersReview(move) && check().missing.length > 0,
  invalid_sheet: (_, move, check) =>
    (entersReview(move) && check().invalidField) ||
    (savesCheckedSheet(move) && (check().missing.length > 0 || check().invalidField)),
  review_unchecked: (input, move) => entersReview(move) && !input.reviewChecked,
  minors_unconfirmed: (input, move) => entersReview(move) && !input.minorsConfirmed,
  open_comments: (input, move) => publishes(move) && input.comments.some((c) => c.resolvedAt === null),
  health_validation_missing: (input, move) =>
    publishes(move) && isSensitive(input.sheet) && !input.greenLight,
  illustrations_missing: (input, move) =>
    publishes(move) &&
    (input.sheet.illustrations ?? []).some((i) => !input.manifestIds.has(i.illustration_id)),
  referenced_by_template: (input, move) => retires(move) && input.templateRefs.has(input.sheet.id),
  // R-CH-6 : une autre fiche non retirée pointe encore vers celle-ci ; il faut d'abord relier ses voisines.
  chain_break: (input, move) =>
    retires(move) &&
    input.catalog.some(
      (s) =>
        s.id !== input.sheet.id &&
        s.status !== 'retired' &&
        (s.easier_id === input.sheet.id || s.harder_id === input.sheet.id),
    ),
  // Plafond de fiches non retirées, tous statuts confondus (spec brique 2 §2) : la réactivation en ajoute une.
  catalog_full: (input, move) =>
    reactivates(move) &&
    input.catalog.filter((s) => s.status !== 'retired' && s.id !== input.sheet.id).length >=
      CATALOG_MAX_SHEETS,
};

/**
 * Blocages d'une transition de `input.sheet.status` vers `input.to` (spec brique 2 §3.6), dans l'ordre fixe de
 * `PUBLISH_BLOCKERS`, sans doublon ; `[]` si elle peut se faire. `to` égal au statut actuel vaut enregistrement
 * (`PUT`) : seul `invalid_sheet` s'y applique, pour une fiche `reviewed` ou `published`.
 *
 * Ne juge pas si la transition existe (04 §8) : une transition absente du circuit (`published → draft`) rend `[]`
 * et l'appelant la refuse à part. `invalid_sheet` porte sur la fiche seule (`ExerciseSheetSchema`) ; les règles
 * entre fiches de 04 §13 (alias, chaînes, manifeste) relèvent du validateur du catalogue.
 */
export function transitionBlockers(input: TransitionInput): PublishBlocker[] {
  const move: Move = { from: input.sheet.status, to: input.to };
  let cached: SheetCheck | undefined;
  const check = () => {
    cached ??= checkSheet(input.sheet);
    return cached;
  };
  return PUBLISH_BLOCKERS.filter((code) => RULES[code](input, move, check));
}
