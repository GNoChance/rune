import { z } from 'zod';
import {
  BatchSchema,
  COMMENT_BODY_MAX,
  COMMENT_BODY_MIN,
  CommentPartSchema,
  DraftSheetSchema,
  ExerciseStatusSchema,
} from '../exercise';
import { JointSchema, MovementPatternSchema } from '../taxonomy';

/*
 * Relecture des fiches d'exercices (spec brique 2 §3.2 à §3.4, §3.8, §3.9) : routes `/api/review/*`, gardées par
 * « relecteur effectif » (drapeau `catalog_reviewer` ou admin). Visibilité (§3.1) : `drafting`, `reviewed_by`,
 * `exported_revision` et l'auteur des validations ne sortent que pour l'admin ; une relectrice voit l'état agrégé
 * du feu vert santé, jamais qui l'a donné.
 */

/**
 * Files de relecture (spec brique 2 §3.8), valeurs du paramètre `queue` et des pastilles d'une ligne :
 * `to_review` (relue, contenu pas encore validé par l'appelant), `drafts` (« Brouillons à commenter »),
 * `health_pending` (relue sensible sans feu vert santé à jour), `revalidate` (publiée sensible sans feu vert à
 * jour), `mine` (au moins un commentaire ouvert de l'appelant), `ready_to_publish` (relue, aucun blocage de
 * `reviewed → published`).
 */
export const REVIEW_QUEUES = [
  'to_review',
  'drafts',
  'health_pending',
  'revalidate',
  'mine',
  'ready_to_publish',
] as const;
export const ReviewQueueSchema = z.enum(REVIEW_QUEUES);
export type ReviewQueue = z.infer<typeof ReviewQueueSchema>;

/**
 * État agrégé du feu vert santé (spec brique 2 §3.1 et §3.2), sans auteur : `ok` (à jour), `stale` (donné, mais
 * plus sur le contenu courant : « à refaire »), `missing` (aucun feu vert qui compte encore).
 */
export const GREEN_LIGHT_STATES = ['ok', 'stale', 'missing'] as const;
export const GreenLightSchema = z.enum(GREEN_LIGHT_STATES);
export type GreenLight = z.infer<typeof GreenLightSchema>;

const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;
const CONTROLS_BUT_NEWLINE = /(?!\n)\p{Cc}/gu;

/**
 * Nettoyage d'un commentaire (spec brique 2 §3.3) : `\r\n` ramené à `\n`, puis retrait des autres caractères de
 * contrôle (le retour à la ligne est gardé) et des caractères d'inversion de sens (U+202A à U+202E, U+2066 à
 * U+2069), puis des blancs du début et de la fin. Le texte reste brut : ni Markdown, ni HTML. Même fonction pour
 * le serveur et le compteur « n / 1000 » de l'écran.
 */
export function cleanCommentBody(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(CONTROLS_BUT_NEWLINE, '').replace(BIDI_CONTROLS, '').trim();
}

/** Longueur d'un commentaire en caractères (points de code), comme `length()` du CHECK de `exercise_comment.body`. */
export function commentBodyLength(body: string): number {
  return [...body].length;
}

/** Commentaire d'une fiche vu par un relecteur ; trié dans l'ordre de la spec brique 2 §3.3. */
export const ReviewCommentView = z.object({
  id: z.string(),
  part: CommentPartSchema,
  /** Texte brut, à afficher tel quel. */
  body: z.string(),
  /** Révision vue par l'auteur au moment d'écrire (`baseRevision`). */
  revision: z.number().int(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  /** Pseudo de l'auteur ; `null` une fois son compte supprimé (« Ancien relecteur »). */
  authorName: z.string().nullable(),
  /** Écrit par l'appelant : il peut le marquer traité (l'admin peut tous les marquer). */
  mine: z.boolean(),
});
export type ReviewCommentView = z.infer<typeof ReviewCommentView>;

/** Ligne de la liste de relecture (spec brique 2 §3.9 et §4.5). */
export const ReviewListItem = z.object({
  id: z.string(),
  name: z.string(),
  status: ExerciseStatusSchema,
  batch: z.string(),
  revision: z.number().int(),
  movementPattern: MovementPatternSchema,
  /** Valeurs qui décident de la sensibilité (`isSensitive`), à écrire en clair. */
  level: z.number().int(),
  notForMinors: z.boolean(),
  stressedJoints: z.array(JointSchema),
  sensitive: z.boolean(),
  openComments: z.number().int(),
  greenLight: GreenLightSchema,
  /** L'appelant a validé le contenu courant (« validée par toi »), même si des transitions ont suivi. */
  validatedByMe: z.boolean(),
  illustrationCount: z.number().int(),
  /** Files où se trouve la fiche pour l'appelant, dans l'ordre de `REVIEW_QUEUES`. */
  queues: z.array(ReviewQueueSchema),
});
export type ReviewListItem = z.infer<typeof ReviewListItem>;

/** `GET /api/review/exercises` : filtres facultatifs, cumulés. */
export const ReviewListQuery = z.object({
  queue: ReviewQueueSchema.optional(),
  batch: BatchSchema.optional(),
  status: ExerciseStatusSchema.optional(),
});
export type ReviewListQuery = z.infer<typeof ReviewListQuery>;

/** Avancement d'un lot (spec brique 2 §3.8) : `A` et `B` toujours, puis les lots d'extension non vides. */
export const ReviewBatchProgress = z.object({
  batch: z.string(),
  published: z.number().int(),
  total: z.number().int(),
});
export type ReviewBatchProgress = z.infer<typeof ReviewBatchProgress>;

/**
 * Réponse de `GET /api/review/exercises` :
 * - `items` : fiches qui passent les filtres, triées par nom (`Intl.Collator('fr', {sensitivity: 'base'})`) puis
 *   par `id` en ordre binaire ;
 * - `counts` : taille de chaque file parmi les fiches qui passent `batch` et `status` (le filtre `queue` n'y
 *   joue pas) ;
 * - `progress` : avancement par lot, sur tout le catalogue ;
 * - `admin` (admin seulement) : fiches dont la révision n'est pas encore exportée, illustrations du manifeste
 *   « à remplacer avant publication ».
 */
export const ReviewListResponse = z.object({
  items: z.array(ReviewListItem),
  counts: z.record(ReviewQueueSchema, z.number().int()),
  progress: z.array(ReviewBatchProgress),
  admin: z.object({ toExport: z.number().int(), replaceBeforePublic: z.number().int() }).optional(),
});
export type ReviewListResponse = z.infer<typeof ReviewListResponse>;

/** Validation nominative, vue de l'admin seulement (spec brique 2 §3.1). */
export const ReviewValidationView = z.object({
  id: z.string(),
  /** `null` une fois le compte supprimé. */
  reviewerId: z.string().nullable(),
  reviewerName: z.string().nullable(),
  revision: z.number().int(),
  /** Drapeau santé effectif au moment de valider (historique). */
  health: z.boolean(),
  /** Remplit encore les conditions 1 et 2 du feu vert (§3.2), quel que soit le contenu validé. */
  standing: z.boolean(),
  createdAt: z.string(),
});
export type ReviewValidationView = z.infer<typeof ReviewValidationView>;

/**
 * Réponse de `GET /api/review/exercises/:id` :
 * - `sheet` : la fiche, sans `drafting` ni `reviewed_by` pour une relectrice ;
 * - `greenLight`, `sensitive`, `validatedByMe`, `queues` : comme une ligne de la liste ;
 * - `diff` : clés de contenu changées depuis la dernière validation de l'appelant (pour l'admin : depuis la
 *   dernière validation santé qui remplit encore les conditions 1 et 2), `null` sans validation, `[]` sans
 *   changement ; `diffBase` : la révision de départ et ses anciennes valeurs pour ces clés (clé absente = champ
 *   absent à cette révision) ;
 * - `comments` : tous les commentaires de la fiche, triés (§3.3) ;
 * - `validations`, `exportedRevision` : admin seulement (clés absentes sinon).
 */
export const ReviewSheetResponse = z.object({
  sheet: DraftSheetSchema,
  sensitive: z.boolean(),
  greenLight: GreenLightSchema,
  validatedByMe: z.boolean(),
  queues: z.array(ReviewQueueSchema),
  diff: z.array(z.string()).nullable(),
  diffBase: z.object({ revision: z.number().int(), values: z.record(z.string(), z.unknown()) }).nullable(),
  comments: z.array(ReviewCommentView),
  validations: z.array(ReviewValidationView).optional(),
  exportedRevision: z.number().int().nullable().optional(),
});
export type ReviewSheetResponse = z.infer<typeof ReviewSheetResponse>;

/** Plafond du texte brut reçu, avant nettoyage : la borne de 1000 porte sur le texte nettoyé. */
const COMMENT_RAW_MAX = COMMENT_BODY_MAX * 4;

/**
 * `POST /api/review/exercises/:id/comments` : `part` dans `COMMENT_PARTS` ; `body` nettoyé par
 * `cleanCommentBody`, puis de 1 à 1000 caractères ; `baseRevision` = révision affichée (une révision dépassée est
 * acceptée et gardée, une révision future refusée). Réponse 201 : `ReviewCommentView`. Fiche `retired` : 409
 * `not_reviewable`.
 */
export const CreateCommentRequest = z.object({
  part: CommentPartSchema,
  body: z
    .string()
    .max(COMMENT_RAW_MAX)
    .transform(cleanCommentBody)
    .refine(
      (body) => commentBodyLength(body) >= COMMENT_BODY_MIN && commentBodyLength(body) <= COMMENT_BODY_MAX,
      { message: `De ${COMMENT_BODY_MIN} à ${COMMENT_BODY_MAX} caractères après nettoyage` },
    ),
  baseRevision: z.number().int().min(1),
});
export type CreateCommentRequest = z.input<typeof CreateCommentRequest>;

/**
 * `POST /api/review/exercises/:id/validations` : `baseRevision` = révision affichée, qui doit être la courante
 * (sinon 409 `revision_conflict` avec `current`). Fiche ni `reviewed` ni `published` : 409 `not_reviewable`.
 */
export const ValidateRequest = z.object({ baseRevision: z.number().int().min(1) });
export type ValidateRequest = z.infer<typeof ValidateRequest>;

/** Validation enregistrée : 201 à la création, 200 avec la même validation si elle existait déjà. */
export const ValidationResponse = z.object({
  id: z.string(),
  revision: z.number().int(),
  createdAt: z.string(),
});
export type ValidationResponse = z.infer<typeof ValidationResponse>;

/**
 * Corps d'un 409 `revision_conflict` (spec brique 2 §3.5) : la fiche courante, telle que l'appelant a le droit de
 * la voir.
 */
export const RevisionConflictBody = z.object({
  error: z.literal('revision_conflict'),
  current: DraftSheetSchema,
});
export type RevisionConflictBody = z.infer<typeof RevisionConflictBody>;
