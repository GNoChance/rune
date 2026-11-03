import { z } from 'zod';
import { AgeBandSchema } from './api/auth';
import { BodyArea, LimitationSeverity, LimitationSide } from './api/consent';
import { PlaceKindSchema } from './api/places';
import { DAYS_PER_WEEK, Goal, SESSION_MINUTES } from './api/profile';
import { COACH_AGE_BANDS } from './coach';
import { EXERCISE_ID_RE } from './exercise';
import {
  CHANGE_AUTHORS,
  DECISION_RESULTS,
  EFFORTS,
  InstanceChangeOperationSchema,
  MAX_CHANGE_OPERATIONS,
  PAIN_LEVELS,
  PROGRAM_CONTEXTS,
  PROGRAM_LEVELS,
  REASON_CODES,
  SESSION_PROFILES,
  SLOT_MODES,
  SlotSpecSchema,
} from './program';
import { SportCodeSchema } from './sports';
import { EquipmentCodeSchema, MovementPatternSchema } from './taxonomy';

/*
 * Dossier envoyé au coach (`coach-brief/1`, spec brique 4 §9), produit par `buildCoachBrief` (domaine). Zod strict,
 * clés en snake_case : une clé hors du schéma (pseudo, identifiant, date de naissance, nom de lieu…) est refusée.
 * Seule `today` est une date absolue ; le reste en jours écoulés (`days_ago`). Charges en kg, durées et repos en
 * secondes, unité dans la clé (`_kg`, `_s`) pour le filtre (§11.2). Fichier à part de `coach.ts` : il lit les
 * valeurs du profil (`api/profile.ts`), qui importe déjà `coach.ts`.
 */

const Slug = z.string().max(60).regex(EXERCISE_ID_RE);
const LocalId = z.string().min(1).max(40);
const Count = z.number().int().min(0);
const Kg = z.number().min(0);
const Range = z.strictObject({ min: z.number().int().min(1), max: z.number().int().min(1) });
/** Nom neutre d'un lieu vivant : `lieu_1` (principal), `lieu_2`… ; jamais le nom donné par la personne. */
const PlaceName = z.string().regex(/^lieu_[1-9]\d*$/);
/** Texte libre de la personne, nettoyé (`cleanCoachText`), 200 caractères au plus (choix C24). */
const FreeText = z.string().max(200);

const BriefProfile = z.strictObject({
  level: z.enum(PROGRAM_LEVELS).nullable(),
  goal: Goal.nullable(),
  days_per_week: z.literal(DAYS_PER_WEEK).nullable(),
  session_minutes: z.literal(SESSION_MINUTES).nullable(),
  cautious_mode: z.boolean(),
  engine_profile: z.enum(SESSION_PROFILES),
  context: z.strictObject({ kind: z.enum(PROGRAM_CONTEXTS), sport_code: SportCodeSchema.nullable() }),
});

/** `load_settings` pour le lieu principal seulement (choix C23). */
const BriefPlace = z.strictObject({
  name: PlaceName,
  kind: PlaceKindSchema,
  primary: z.boolean(),
  equipment: z.array(EquipmentCodeSchema),
  load_settings: z.strictObject({ bar_kg: Kg, smallest_plate_kg: Kg, machine_step_kg: Kg }).optional(),
});

/**
 * Cibles de l'état du slot, sans `planWorkout` (choix C23). Slot compact (écart au §9, taille du dossier) : un champ
 * nul n'est pas écrit (exercice introuvable, `reps` d'un slot en durée, `duration_s` d'un slot en répétitions,
 * `rest_s` absent du modèle, slot sans état ni décision, valeurs nulles de l'état), ni une valeur par défaut de l'état
 * (`calibration_left` 0, `suspended` faux) : le schéma refuse ces formes, la sortie n'en a qu'une.
 */
const BriefSlot = z.strictObject({
  id: LocalId,
  role: SlotSpecSchema.shape.role,
  movement_pattern: MovementPatternSchema,
  exercise: z.strictObject({ id: Slug, name: z.string() }).optional(),
  sets: Count,
  reps: Range.optional(),
  duration_s: Range.optional(),
  target_rir: z.number().int().min(0).max(10),
  rest_s: Count.optional(),
  engine: z
    .strictObject({
      mode: z.enum(SLOT_MODES),
      load_kg: Kg.optional(),
      target_reps: Count.optional(),
      variant_rank: Count.optional(),
      duration_s: Count.optional(),
      calibration_left: z.number().int().min(1).optional(),
      suspended: z.literal(true).optional(),
    })
    .optional(),
  /** Le code seul : le prompt donne une fois la table `REASON_TEXTS`, mise en cache (écart au §9, taille du dossier). */
  last_decision: z
    .strictObject({
      days_ago: Count,
      result: z.enum(DECISION_RESULTS),
      reason_code: z.enum(REASON_CODES),
    })
    .optional(),
});

const BriefProgram = z.strictObject({
  template: z.strictObject({ id: Slug, name: z.string(), version: z.number().int().min(1) }),
  revision: Count,
  week: z.number().int().min(1),
  /** Nul pour un bloc `reactive`. */
  block_week: z.number().int().min(1).nullable(),
  next_workout_id: LocalId,
  days_per_week: z.number().int().min(1).max(7),
  workouts: z.array(z.strictObject({ id: LocalId, name: z.string(), slots: z.array(BriefSlot) })),
  pending_proposals: z.array(
    z.strictObject({
      author: z.enum(CHANGE_AUTHORS),
      operations: z.array(InstanceChangeOperationSchema).min(1).max(MAX_CHANGE_OPERATIONS),
      days_left: Count,
    }),
  ),
  templates: z.array(
    z.strictObject({
      id: Slug,
      name: z.string(),
      summary: z.string(),
      context: z.enum(PROGRAM_CONTEXTS),
      level: z.enum(PROGRAM_LEVELS),
      days_min: z.number().int().min(1),
      days_max: z.number().int().min(1),
    }),
  ),
});

/** Série en tuple `[load_kg, reps, duration_s, effort]`, pour l'économie de jetons (ruling P12). */
const BriefSet = z.tuple([Kg.nullable(), Count.nullable(), Count.nullable(), z.enum(EFFORTS).nullable()]);

/** Séance `completed` des 28 derniers jours ; `place` nul : sans lieu, ou dans un lieu qui n'est plus vivant. */
const BriefSession = z.strictObject({
  days_ago: Count,
  name: z.string(),
  place: PlaceName.nullable(),
  exercises: z.array(
    z.strictObject({
      id: Slug,
      name: z.string(),
      sets: z.array(BriefSet),
      /** C2 : avec l'accord santé et l'accord coach seulement. */
      pain: z.enum(PAIN_LEVELS).optional(),
    }),
  ),
  user_notes: FreeText.optional(),
});

/** `e1rm_kg` pour un adulte seulement (brique 3 D9). */
const BriefRecord = z.strictObject({
  exercise_id: Slug,
  name: z.string(),
  best_set: z.strictObject({ load_kg: Kg, reps: z.number().int().min(1) }).nullable(),
  most_reps: Count.nullable(),
  longest_s: Count.nullable(),
  e1rm_kg: Kg.optional(),
});

export const CoachBriefSchema = z.strictObject({
  schema: z.literal('coach-brief/1'),
  today: z.iso.date(),
  audience: AgeBandSchema,
  age_band: z.enum(COACH_AGE_BANDS),
  profile: BriefProfile,
  places: z.array(BriefPlace),
  program: BriefProgram.nullable(),
  history: z.strictObject({ sessions: z.array(BriefSession), truncated: z.boolean() }),
  records: z.array(BriefRecord),
  /** C2 : avec l'accord santé et l'accord coach seulement. */
  health: z
    .strictObject({
      limitations: z.array(
        z.strictObject({
          area: BodyArea,
          side: LimitationSide,
          severity: LimitationSeverity,
          note: FreeText.nullable(),
        }),
      ),
    })
    .optional(),
  /** Rien avant la brique 5. */
  nutrition: z.null(),
});
export type CoachBrief = z.infer<typeof CoachBriefSchema>;

/**
 * `GET /api/coach/brief` (§7.1, §16.5) : le dossier stocké du fil du jour, analysé (`null` après le retrait santé),
 * ou, sans fil, un aperçu calculé à l'instant (`preview: true`, `threadId` nul, rien d'écrit).
 */
export const CoachBriefResponse = z.strictObject({
  brief: CoachBriefSchema.nullable(),
  threadId: z.string().nullable(),
  day: z.iso.date(),
  preview: z.boolean(),
});
export type CoachBriefResponse = z.infer<typeof CoachBriefResponse>;
