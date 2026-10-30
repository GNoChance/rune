import { z } from 'zod';
import {
  EquipmentCodeSchema,
  EXERCISE_LEVELS,
  JointSchema,
  LoadModeSchema,
  MovementPatternSchema,
  MuscleSchema,
} from './taxonomy';

/** Statuts d'une fiche (04 §8) : `draft` → `reviewed` → `published` → `retired`. */
export const EXERCISE_STATUSES = ['draft', 'reviewed', 'published', 'retired'] as const;
export const ExerciseStatusSchema = z.enum(EXERCISE_STATUSES);
export type ExerciseStatus = z.infer<typeof ExerciseStatusSchema>;

/** Version du format des fiches (`schema_version`, 04 §4). */
export const EXERCISE_SCHEMA_VERSION = 1;

/** Slug ASCII en kebab-case (04 §2) : id d'une fiche, d'une chaîne, et pointeurs `easier_id` / `harder_id`. */
export const EXERCISE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Id d'une illustration : la partie `<id>` du fichier servi `<id>.<hash8>.<ext>` (`ILLUSTRATION_FILE_RE`). */
const ILLUSTRATION_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Lot d'une fiche (spec brique 2 §2) : `A`, `B` ou un lot d'extension `E1` à `E99`. */
export const BatchSchema = z.string().regex(/^(A|B|E([1-9][0-9]?))$/);
export type Batch = z.infer<typeof BatchSchema>;

export const MECHANICS = ['compound', 'isolation'] as const;
export const MEASURES = ['reps', 'duration'] as const;
export const ILLUSTRATION_ROLES = ['start', 'mid', 'end'] as const;
export const DRAFTING_ORIGINS = ['ai', 'human'] as const;

/** Longueur maximale d'une entrée de `safety` (spec brique 2 §4.2, guide de style). */
export const SAFETY_ENTRY_MAX = 120;

/** Longueur maximale du nom d'une fiche (04 §4), recoupée par le CHECK de `exercise.name`. */
export const EXERCISE_NAME_MAX = 60;

const Slug = z.string().max(60).regex(EXERCISE_ID_RE);
const IsoDateTime = z.iso.datetime();
const text = (max: number) => z.string().min(1).max(max);
const distinct = (values: readonly unknown[]) => new Set(values).size === values.length;
const distinctList = <T extends z.ZodType>(item: T, min: number, max: number) =>
  z.array(item).min(min).max(max).refine(distinct, { message: 'Valeur en double' });

/** Vrai si chaque code de `a` est dans `b` : `a` en double de `b`, ou incluse dans `b`. */
const includedIn = (a: readonly string[], b: readonly string[]) => a.every((code) => b.includes(code));

/**
 * `equipment_options` (04 §4) : OU d'ensembles ET, `[[]]` = sans matériel. Pas d'option en double ni d'option
 * qui en contient une autre (sinon la plus grande ne sert à rien).
 */
const EquipmentOptionsSchema = z
  .array(distinctList(EquipmentCodeSchema, 0, 3))
  .min(1)
  .max(4)
  .refine((options) => options.every((a, i) => options.every((b, j) => i === j || !includedIn(a, b))), {
    message: 'Option de matériel en double ou incluse dans une autre',
  });

const MistakeSchema = z.strictObject({ mistake: text(160), fix: text(160) });

const IllustrationUseSchema = z.strictObject({
  illustration_id: z.string().regex(ILLUSTRATION_ID_RE),
  role: z.enum(ILLUSTRATION_ROLES),
});

const IllustrationsSchema = z
  .array(IllustrationUseSchema)
  .max(3)
  .refine((list) => distinct(list.map((i) => i.role)) && distinct(list.map((i) => i.illustration_id)), {
    message: 'Pose ou illustration en double',
  });

const DraftingSchema = z
  .strictObject({
    origin: z.enum(DRAFTING_ORIGINS),
    model: z.string().min(1).max(100).optional(),
    prompt_version: z.number().int().min(1).optional(),
    generated_at: IsoDateTime,
  })
  .refine((d) => d.origin !== 'ai' || (d.model !== undefined && d.prompt_version !== undefined), {
    message: 'Un brouillon IA porte son modèle et sa version de prompt',
  });

/**
 * Champs de la fiche dans l'ordre de 04 §4, `batch` (spec brique 2 §2, champ squelette) juste après `status`.
 * Cet ordre est celui de la forme canonique des fichiers (04 §10) : ne pas le changer sans migration.
 * Facultatif = clé absente (jamais `null`). `chain_rank` est calculé, jamais stocké (R-FIC-2).
 */
const SheetObject = z.strictObject({
  id: Slug,
  schema_version: z.literal(EXERCISE_SCHEMA_VERSION),
  revision: z.number().int().min(1),
  status: ExerciseStatusSchema,
  batch: BatchSchema,
  name: text(EXERCISE_NAME_MAX),
  aliases: distinctList(text(60), 0, 6),
  movement_pattern: MovementPatternSchema,
  mechanics: z.enum(MECHANICS),
  unilateral: z.boolean(),
  measure: z.enum(MEASURES),
  load_mode: LoadModeSchema,
  primary_muscles: distinctList(MuscleSchema, 1, 3),
  secondary_muscles: distinctList(MuscleSchema, 0, 4),
  equipment_options: EquipmentOptionsSchema,
  level: z.literal(EXERCISE_LEVELS),
  not_for_minors: z.boolean(),
  stressed_joints: distinctList(JointSchema, 0, 3),
  instructions: z.array(text(160)).min(3).max(7),
  key_points: z.array(text(120)).min(2).max(4),
  mistakes: z.array(MistakeSchema).min(2).max(4),
  safety: z.array(text(SAFETY_ENTRY_MAX)).min(1).max(3),
  breathing: text(160),
  setup: text(240).optional(),
  chain_id: Slug.optional(),
  easier_id: Slug.optional(),
  harder_id: Slug.optional(),
  easier_tip: text(160).optional(),
  harder_tip: text(160).optional(),
  illustrations: IllustrationsSchema,
  review_notes: z.string().max(2000).optional(),
  drafting: DraftingSchema.optional(),
  reviewed_by: z.string().min(1).max(200).optional(),
  reviewed_at: IsoDateTime.optional(),
  published_at: IsoDateTime.optional(),
  retired_at: IsoDateTime.optional(),
  updated_at: IsoDateTime.optional(),
});

/** Champs rédigés par l'IA (04 §4, colonne « Rempli par ») : les seuls que `exercises:draft` touche. */
export const EXERCISE_AI_FIELDS = [
  'aliases',
  'primary_muscles',
  'secondary_muscles',
  'stressed_joints',
  'instructions',
  'key_points',
  'mistakes',
  'safety',
  'breathing',
  'setup',
  'easier_tip',
  'harder_tip',
  'review_notes',
] as const satisfies readonly (keyof typeof SheetObject.shape)[];

/** Facultatifs dans un brouillon : les champs IA (R-FIC-1) et les illustrations, absentes d'un squelette. */
const DRAFT_OPTIONAL = [...EXERCISE_AI_FIELDS, 'illustrations'] as const;

/** Obligatoires dans la fiche complète mais pas dans un brouillon (les autres champs IA restent facultatifs). */
const REQUIRED_WHEN_COMPLETE = [
  'aliases',
  'primary_muscles',
  'secondary_muscles',
  'stressed_joints',
  'instructions',
  'key_points',
  'mistakes',
  'safety',
  'breathing',
  'illustrations',
] as const satisfies readonly (typeof DRAFT_OPTIONAL)[number][];

/** Statuts où la fiche doit être complète (R-FIC-1 : « à partir de reviewed » ; un brouillon retiré reste vide). */
const COMPLETE_STATUSES: readonly ExerciseStatus[] = ['reviewed', 'published'];

type SheetChecked = {
  primary_muscles?: readonly string[] | undefined;
  secondary_muscles?: readonly string[] | undefined;
};

function checkMuscles(sheet: SheetChecked, ctx: z.RefinementCtx) {
  const primary = sheet.primary_muscles ?? [];
  if (sheet.secondary_muscles?.some((m) => primary.includes(m))) {
    ctx.addIssue({
      code: 'custom',
      path: ['secondary_muscles'],
      message: 'Les muscles secondaires sont disjoints des principaux',
    });
  }
}

/**
 * Fiche complète (04 §4 et spec brique 2 §2) : exigée à partir de `reviewed`, et pour passer `draft → reviewed`.
 * Elle accepte tous les statuts. Les règles qui portent sur plusieurs fiches (alias uniques après `normalize`,
 * chaînes, mode de charge du matériel, manifeste) sont celles du validateur du catalogue.
 */
export const ExerciseSheetSchema = SheetObject.superRefine(checkMuscles);
export type ExerciseSheet = z.infer<typeof ExerciseSheetSchema>;

/**
 * Fiche dont les champs IA peuvent manquer (R-FIC-1), comme un squelette de 04 §8 étape 1 : accepte tout
 * statut, mais exige la fiche complète en `reviewed` et `published`. Un champ présent garde ses bornes.
 */
export const DraftSheetSchema = SheetObject.partial(
  Object.fromEntries(DRAFT_OPTIONAL.map((k) => [k, true])) as {
    [K in (typeof DRAFT_OPTIONAL)[number]]: true;
  },
).superRefine((sheet, ctx) => {
  checkMuscles(sheet, ctx);
  if (!COMPLETE_STATUSES.includes(sheet.status)) return;
  for (const key of REQUIRED_WHEN_COMPLETE) {
    if (sheet[key] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `Obligatoire au statut ${sheet.status} (R-FIC-1)`,
      });
    }
  }
});
export type DraftSheet = z.infer<typeof DraftSheetSchema>;

/**
 * Clés hors du contenu d'une révision (spec brique 2 §3.2) : champs système et éditoriaux. `contentOf` les
 * retire ; changer l'une d'elles ne périme aucun feu vert santé.
 */
export const CONTENT_EXCLUDED_KEYS = [
  'schema_version',
  'revision',
  'status',
  'review_notes',
  'drafting',
  'reviewed_by',
  'reviewed_at',
  'published_at',
  'retired_at',
  'updated_at',
  'exported_revision',
  'batch',
] as const;

/**
 * Clés de la fiche jamais servies aux téléphones (spec brique 2 §7, critère 9 modifié) : `batch` (spec brique 2
 * §2) et les colonnes éditoriales de 04 « Modèle de données », réservées à l'admin. `exported_revision`, colonne
 * de base sans champ de fichier, ne l'est pas non plus.
 */
export const SERVED_EXCLUDED_KEYS = [
  'batch',
  'review_notes',
  'drafting',
  'reviewed_by',
  'reviewed_at',
  'published_at',
  'retired_at',
  'updated_at',
] as const satisfies readonly (keyof typeof SheetObject.shape)[];

/** Statuts servis par `GET /api/catalog` : une fiche `retired` ne l'est que si elle a été publiée (spec §3.6). */
export const SERVED_STATUSES = ['published', 'retired'] as const;

/**
 * Fiche servie aux téléphones (`CatalogBundle.exercises`, 04 §11) : la fiche complète, sans `SERVED_EXCLUDED_KEYS`,
 * au statut `published` ou `retired`. Les fonctions du catalogue de `packages/domain` l'acceptent telle quelle.
 */
export const ServedSheetSchema = SheetObject.omit(
  Object.fromEntries(SERVED_EXCLUDED_KEYS.map((k) => [k, true])) as {
    [K in (typeof SERVED_EXCLUDED_KEYS)[number]]: true;
  },
)
  .extend({ status: z.enum(SERVED_STATUSES) })
  .superRefine(checkMuscles);
export type ServedSheet = z.infer<typeof ServedSheetSchema>;

/** Parties d'une fiche qu'on peut commenter (spec brique 2 §3.3), dans l'ordre d'affichage des commentaires. */
export const COMMENT_PARTS = [
  'general',
  'name',
  'muscles',
  'equipment',
  'level',
  'not_for_minors',
  'stressed_joints',
  'instructions',
  'key_points',
  'mistakes',
  'safety',
  'breathing',
  'setup',
  'variants',
  'illustrations',
] as const;
export const CommentPartSchema = z.enum(COMMENT_PARTS);
export type CommentPart = z.infer<typeof CommentPartSchema>;

/** Longueur d'un commentaire après nettoyage (spec brique 2 §3.3), recoupée par le CHECK de `exercise_comment.body`. */
export const COMMENT_BODY_MIN = 1;
export const COMMENT_BODY_MAX = 1000;

/**
 * Blocages d'une transition (spec brique 2 §3.6), dans l'ordre fixe du tableau : la liste `blockers` d'un refus
 * 422 `transition_blocked` les rend toujours dans cet ordre. Jamais renvoyés comme `error`.
 */
export const PUBLISH_BLOCKERS = [
  'incomplete',
  'invalid_sheet',
  'review_unchecked',
  'minors_unconfirmed',
  'open_comments',
  'health_validation_missing',
  'illustrations_missing',
  'referenced_by_template',
  'chain_break',
  'catalog_full',
] as const;
export const PublishBlockerSchema = z.enum(PUBLISH_BLOCKERS);
export type PublishBlocker = z.infer<typeof PublishBlockerSchema>;

/**
 * JSON Schema de la fiche complète (04 §2 principe 5, §9 sortie structurée), dérivé de Zod. Les règles écrites
 * en `refine` (doublons, inclusion des options, muscles disjoints) n'y figurent pas : la réponse est toujours
 * revalidée par `ExerciseSheetSchema`.
 */
export function exerciseJsonSchema() {
  return z.toJSONSchema(ExerciseSheetSchema);
}
