import { z } from 'zod';
import { EXERCISE_ID_RE } from './exercise';
import { MovementPatternSchema } from './taxonomy';

/*
 * Modèles de programmes, opérations de modification et codes du moteur (spec brique 3 §4 et §6, 05 §4, §7, §15).
 * Ce fichier ne contient que des schémas et des constantes : aucune règle de progression.
 */

// ---------------------------------------------------------------------------------------------------------------
// Énumérations partagées avec les tables (09) et le moteur
// ---------------------------------------------------------------------------------------------------------------

/** Effort d'une série (05 §7). */
export const EFFORTS = ['easy', 'ok', 'hard', 'failed'] as const;
export type Effort = (typeof EFFORTS)[number];

/** Douleur déclarée sur un exercice (C2, 09). */
export const PAIN_LEVELS = ['none', 'discomfort', 'pain'] as const;
export type PainLevel = (typeof PAIN_LEVELS)[number];

/** Ajustement neutre écrit par le bouton douleur sans consentement santé (C1). */
export const NEXT_ADJUSTMENTS = ['hold', 'lighten'] as const;
export type NextAdjustment = (typeof NEXT_ADJUSTMENTS)[number];

export const SWAP_REASONS = ['equipment', 'busy', 'pain', 'preference'] as const;
export type SwapReason = (typeof SWAP_REASONS)[number];

export const SESSION_STATUSES = ['in_progress', 'completed', 'abandoned'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const WEEK_TYPES = ['normal', 'deload'] as const;
export type WeekType = (typeof WEEK_TYPES)[number];

/** Profil appliqué par le moteur : `cautious` = mineur, mode prudent manuel ou indicateur de prudence. */
export const SESSION_PROFILES = ['adult', 'cautious'] as const;
export type SessionProfile = (typeof SESSION_PROFILES)[number];

export const SET_KINDS = ['warmup', 'work'] as const;
export type SetKind = (typeof SET_KINDS)[number];

export const SIDES = ['left', 'right'] as const;
export type Side = (typeof SIDES)[number];

/** Mode de progression tenu par un `slot_state`. */
export const SLOT_MODES = ['linear', 'double', 'sum', 'chain', 'duration'] as const;
export type SlotMode = (typeof SLOT_MODES)[number];

export const DECISION_RESULTS = [
  'PROGRESS',
  'HOLD',
  'FAIL',
  'IGNORED',
  'DELOAD',
  'ADJUSTED_HOLD',
  'ADJUSTED_LIGHTEN',
  'CALIBRATION',
  'STALL',
] as const;
export type DecisionResult = (typeof DECISION_RESULTS)[number];

export const CHANGE_AUTHORS = ['user', 'coach', 'engine'] as const;
export type ChangeAuthor = (typeof CHANGE_AUTHORS)[number];

export const CHANGE_STATUSES = ['proposed', 'accepted', 'rejected', 'expired'] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/** Nombre maximal d'opérations dans un changement (05 §15.6). */
export const MAX_CHANGE_OPERATIONS = 5;

// ---------------------------------------------------------------------------------------------------------------
// Codes raison
// ---------------------------------------------------------------------------------------------------------------

/** Codes de décision du moteur (spec brique 3 §4.3.13). */
export const REASON_CODES = [
  'NO_DATA',
  'NOT_FEASIBLE_HERE',
  'SLOT_SUSPENDED',
  'DELOAD_WEEK',
  'USER_HOLD',
  'USER_LIGHTEN',
  'PAIN_HOLD',
  'PAIN_LIGHTEN',
  'CALIBRATION_UP',
  'CALIBRATION_DONE',
  'CALIBRATION_HOLD',
  'CALIBRATION_DOWN',
  'CALIBRATION_END',
  'LOAD_UP',
  'REPS_UP',
  'REPS_MAX_REACHED',
  'SUM_LOAD_UP',
  'CHAIN_NEXT',
  'CHAIN_BACK',
  'DURATION_UP',
  'EFFORT_MISSING',
  'EFFORT_NOT_VALIDATED',
  'SETS_MISSING',
  'NO_PROGRESS',
  'REPS_UNDER_MIN',
  'DURATION_UNDER',
  'LINEAR_TO_DOUBLE',
  'STALL_1_LIGHTEN',
  'STALL_2_DOUBLE',
  'STALL_RESET_MIN',
  'STALL_REPLACE_PROPOSED',
  'RESUME_14',
  'RESUME_28',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** Codes raison des changements de programme (`instance_change.reason_code`). */
export const CHANGE_REASON_CODES = [
  'USER_CHANGE',
  'ENGINE_STALL_REPLACE',
  'ENGINE_REACTIVE_DELOAD',
  'PAIN_SUSPEND',
  'USER_SUSPEND',
] as const;
export type ChangeReasonCode = (typeof CHANGE_REASON_CODES)[number];

/** Réécriture des codes liés à la douleur au retrait du consentement santé (05 §13.9). */
export const PAIN_CODE_REWRITES = {
  PAIN_HOLD: 'USER_HOLD',
  PAIN_LIGHTEN: 'USER_LIGHTEN',
  PAIN_SUSPEND: 'USER_SUSPEND',
} as const satisfies Record<string, ReasonCode | ChangeReasonCode>;

/** Une phrase par code, tutoiement, apostrophe droite, sans chiffre de charge. À relire par le propriétaire. */
export const REASON_TEXTS: Record<ReasonCode | ChangeReasonCode, string> = {
  NO_DATA: 'Pas encore de séance faite sur cet exercice : tu choisis ta charge de départ.',
  NOT_FEASIBLE_HERE: "Cet exercice n'est pas faisable ici : on prend une alternative.",
  SLOT_SUSPENDED: 'Cet exercice est mis de côté : il reste en pause tant que tu ne le reprends pas.',
  DELOAD_WEEK: "C'est une semaine allégée : on baisse la charge pour récupérer.",
  USER_HOLD: 'Tu as demandé de garder la même charge.',
  USER_LIGHTEN: 'Tu as demandé une séance plus légère.',
  PAIN_HOLD: 'Tu as signalé une gêne : on garde la même charge à la prochaine séance.',
  PAIN_LIGHTEN: 'Tu as signalé une douleur : on allège à la prochaine séance.',
  CALIBRATION_UP: 'La charge de départ était légère : elle monte pour trouver ton niveau.',
  CALIBRATION_DONE: 'Ton point de départ est bien choisi : on le garde.',
  CALIBRATION_HOLD: 'On reste sur la même charge le temps de trouver ton niveau.',
  CALIBRATION_DOWN: 'La charge de départ était lourde : elle baisse pour trouver ton niveau.',
  CALIBRATION_END: 'Ta charge de départ est trouvée : la progression normale commence.',
  LOAD_UP: 'Toutes les séries passées avec de la marge : la charge monte.',
  REPS_UP: 'Tu as fait plus de répétitions que jamais à ce niveau : on en vise une de plus par série.',
  REPS_MAX_REACHED:
    "Tu es en haut de la fourchette et il n'y a rien de plus lourd ni de plus dur ici : on garde le même repère.",
  SUM_LOAD_UP: 'Le total de répétitions est atteint avec de la marge : la charge monte.',
  CHAIN_NEXT: 'Tu maîtrises cette variante : on passe à la suivante, plus difficile.',
  CHAIN_BACK: "Cette variante est trop dure pour l'instant : on revient à la précédente.",
  DURATION_UP: 'Tenue réussie avec de la marge : la durée augmente un peu.',
  EFFORT_MISSING: "Tu n'as pas noté l'effort : on ne monte pas cette fois.",
  EFFORT_NOT_VALIDATED: "L'effort était trop proche de ta limite : on garde la même charge.",
  SETS_MISSING: 'Il manque des séries par rapport au repère : on garde la même charge.',
  NO_PROGRESS: 'Pas de progrès cette fois : on garde le même repère.',
  REPS_UNDER_MIN: 'Tu es resté sous le minimum de répétitions : on garde la même charge.',
  DURATION_UNDER: 'La tenue était plus courte que prévu : on garde le même repère.',
  LINEAR_TO_DOUBLE: "La progression linéaire s'essouffle : on passe à la progression par répétitions.",
  STALL_1_LIGHTEN: 'Plusieurs séances sans progrès : on allège pour repartir plus propre.',
  STALL_2_DOUBLE: 'Toujours bloqué : on passe à la progression par répétitions.',
  STALL_RESET_MIN:
    'Plusieurs séances sans progrès : on repart du bas de la fourchette, en répétitions ou en durée.',
  STALL_REPLACE_PROPOSED: 'Toujours bloqué : on te propose de remplacer cet exercice.',
  RESUME_14: "Tu reprends après deux semaines d'absence : la charge est un peu réduite.",
  RESUME_28: "Tu reprends après un mois d'absence : la charge est réduite et la variante simplifiée.",
  USER_CHANGE: 'Tu as modifié ton programme.',
  ENGINE_STALL_REPLACE: 'On te propose de remplacer un exercice qui ne progresse plus.',
  ENGINE_REACTIVE_DELOAD: 'On te propose une semaine allégée pour récupérer.',
  PAIN_SUSPEND: 'Tu as signalé une douleur : cet exercice est mis de côté.',
  USER_SUSPEND: 'Tu as mis cet exercice de côté.',
};

// ---------------------------------------------------------------------------------------------------------------
// Format d'un modèle (05 §4)
// ---------------------------------------------------------------------------------------------------------------

const Slug = z.string().max(60).regex(EXERCISE_ID_RE);
const LocalId = z.string().min(1).max(40);
const text = (max: number) => z.string().min(1).max(max);

const RangeSchema = z
  .strictObject({ min: z.number().int().min(1).max(600), max: z.number().int().min(1).max(600) })
  .refine((r) => r.min <= r.max, { message: 'min doit être inférieur ou égal à max' });

export const SetSpecSchema = z
  .strictObject({
    kind: z.enum(SET_KINDS),
    count: z.number().int().min(1).max(5),
    reps: RangeSchema.optional(),
    durationS: RangeSchema.optional(),
    targetRir: z.number().int().min(1).max(5).optional(),
    restS: z.number().int().min(0).max(600).optional(),
    pctWorkLoad: z.number().int().min(1).max(100).optional(),
  })
  .refine((s) => (s.reps === undefined) !== (s.durationS === undefined), {
    message: 'Exactement un de reps ou durationS',
  });
export type SetSpec = z.infer<typeof SetSpecSchema>;

export const ProgressionSpecSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('fixed') }),
  z.strictObject({ type: z.literal('linear'), incrementG: z.number().int().min(1).max(50_000) }),
  z.strictObject({ type: z.literal('double') }),
  z.strictObject({ type: z.literal('chain') }),
  z.strictObject({ type: z.literal('duration'), stepS: z.number().int().min(1).max(60) }),
]);
export type ProgressionSpec = z.infer<typeof ProgressionSpecSchema>;

export const SlotSpecSchema = z
  .strictObject({
    id: LocalId,
    movementPattern: MovementPatternSchema,
    role: z.enum(['main', 'secondary', 'accessory']),
    exercises: z.array(Slug).min(1).max(12).optional(),
    chain: Slug.optional(),
    sets: z.array(SetSpecSchema).min(1).max(4),
    progression: ProgressionSpecSchema,
  })
  .refine((s) => (s.exercises === undefined) !== (s.chain === undefined), {
    message: 'Exactement un de exercises ou chain',
  });
export type SlotSpec = z.infer<typeof SlotSpecSchema>;

export const WorkoutSpecSchema = z.strictObject({
  id: LocalId,
  name: text(80),
  slots: z.array(SlotSpecSchema).min(1).max(12),
});
export type WorkoutSpec = z.infer<typeof WorkoutSpecSchema>;

export const PROGRAM_SCHEMA_VERSION = 1;
export const PROGRAM_CONTEXTS = ['gym', 'home', 'sport'] as const;
export const PROGRAM_LEVELS = ['beginner', 'intermediate'] as const;

export const BlockSpecSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('reactive') }),
  z.strictObject({ mode: z.literal('planned'), weeks: z.literal(5), deloadWeek: z.literal(5) }),
]);

const DaysPerWeek = z.number().int().min(2).max(4);

export const ProgramTemplateSchema = z
  .strictObject({
    schemaVersion: z.literal(PROGRAM_SCHEMA_VERSION),
    id: Slug,
    version: z.number().int().min(1),
    name: text(80),
    description: text(300),
    context: z.enum(PROGRAM_CONTEXTS),
    level: z.enum(PROGRAM_LEVELS),
    daysPerWeek: z
      .strictObject({ min: DaysPerWeek, max: DaysPerWeek, default: DaysPerWeek })
      .refine((d) => d.min <= d.default && d.default <= d.max, { message: 'min <= default <= max attendu' }),
    estimatedMinutes: z.number().int().min(10).max(180),
    block: BlockSpecSchema,
    workouts: z.array(WorkoutSpecSchema).min(1).max(6),
  })
  .refine(
    (t) => {
      const ids = t.workouts.map((w) => w.id);
      const slots = t.workouts.flatMap((w) => w.slots.map((s) => s.id));
      return new Set(ids).size === ids.length && new Set(slots).size === slots.length;
    },
    { message: 'Identifiants de séance ou de slot en double' },
  );
export type ProgramTemplate = z.infer<typeof ProgramTemplateSchema>;

/** Modèle servi par `GET /api/program/templates` : `available` dit si le catalogue permet de le suivre. */
export const ServedProgramTemplateSchema = z.strictObject({
  template: ProgramTemplateSchema,
  available: z.boolean(),
});
export type ServedProgramTemplate = z.infer<typeof ServedProgramTemplateSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Opérations de modification (05 §15). Les bornes (volume, profil prudent, auteur) sont celles du validateur.
// ---------------------------------------------------------------------------------------------------------------

const SlotRef = LocalId;

export const InstanceChangeOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('replace_exercise'), slot: SlotRef, exercise: Slug }),
  z.strictObject({
    op: z.literal('change_sets'),
    slot: SlotRef,
    delta: z.union([z.literal(-1), z.literal(1)]),
  }),
  z.strictObject({
    op: z.literal('set_rep_range'),
    slot: SlotRef,
    min: z.number().int().min(1).max(100),
    max: z.number().int().min(1).max(100),
  }),
  z.strictObject({ op: z.literal('set_target_rir'), slot: SlotRef, value: z.number().int().min(0).max(10) }),
  z.strictObject({ op: z.literal('set_rest'), slot: SlotRef, seconds: z.number().int().min(0).max(3600) }),
  z.strictObject({ op: z.literal('lighten_exercise'), slot: SlotRef }),
  z.strictObject({ op: z.literal('start_deload') }),
  z.strictObject({ op: z.literal('suspend_slot'), slot: SlotRef }),
  z.strictObject({ op: z.literal('resume_slot'), slot: SlotRef }),
  z.strictObject({ op: z.literal('remove_slot'), slot: SlotRef }),
  z.strictObject({
    op: z.literal('add_slot'),
    workout: LocalId,
    movementPattern: MovementPatternSchema,
    exercises: z.array(Slug).min(1).max(12),
  }),
  z.strictObject({ op: z.literal('set_days_per_week'), days: z.number().int().min(1).max(7) }),
  z.strictObject({
    op: z.literal('switch_template'),
    templateId: Slug,
    daysPerWeek: z.number().int().min(1).max(7).optional(),
  }),
]);
export type InstanceChangeOperation = z.infer<typeof InstanceChangeOperationSchema>;
