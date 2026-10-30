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
 * Entrée de `transitionBlockers`, lue par le serveur avant d'écrire.
 * - `sheet` : la fiche telle qu'elle serait enregistrée, encore à son statut actuel (le départ de la transition).
 * - `to` : statut visé ; égal au statut actuel pour un enregistrement (`PUT`).
 * - `comments` : commentaires de la fiche, toutes révisions confondues.
 * - `greenLight` : `healthGreenLight` de la fiche.
 * - `reviewChecked`, `minorsConfirmed` : cases cochées par l'admin pour `draft → reviewed`.
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

type Move = { from: ExerciseStatus; to: ExerciseStatus };

/** Enregistrement (`PUT`) d'une fiche `reviewed` ou `published` : elle doit rester complète et valide. */
const savesCheckedSheet = ({ from, to }: Move) =>
  from === to && (from === 'reviewed' || from === 'published');
/** Entrée en `reviewed` : depuis `draft`, ou réactivation depuis `retired`. */
const entersReview = ({ from, to }: Move) => to === 'reviewed' && (from === 'draft' || from === 'retired');
const leavesDraft = ({ from, to }: Move) => from === 'draft' && to === 'reviewed';
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
  const record: Readonly<Record<string, unknown>> = sheet;
  const missing = REQUIRED_KEYS.filter((key) => record[key] === undefined);
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
 * reviendrait en `reviewed` incomplet ou invalide.
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
  review_unchecked: (input, move) => leavesDraft(move) && !input.reviewChecked,
  minors_unconfirmed: (input, move) => leavesDraft(move) && !input.minorsConfirmed,
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
