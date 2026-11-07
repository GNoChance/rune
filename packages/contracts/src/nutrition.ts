import { z } from 'zod';

export const NUTRITION_MODES = ['full', 'qualitative', 'disabled'] as const;
export const NutritionModeSchema = z.enum(NUTRITION_MODES);
export type NutritionMode = z.infer<typeof NutritionModeSchema>;

export const MODE_REASONS = ['choice', 'safety'] as const;
export const ModeReasonSchema = z.enum(MODE_REASONS);
export type ModeReason = z.infer<typeof ModeReasonSchema>;

export const MODE_CAUSES = [
  'stored',
  'minor',
  'over_max_age',
  'no_health_consent',
  'screen_outdated',
  'full_closed',
] as const;
export const ModeCauseSchema = z.enum(MODE_CAUSES);
export type ModeCause = z.infer<typeof ModeCauseSchema>;

export const SEX_FOR_CALC = ['male', 'female', 'unspecified'] as const;
export const SexForCalcSchema = z.enum(SEX_FOR_CALC);
export type SexForCalc = z.infer<typeof SexForCalcSchema>;

export const NUTRITION_GOALS = ['lose', 'maintain', 'gain'] as const;
export const NutritionGoalSchema = z.enum(NUTRITION_GOALS);
export type NutritionGoal = z.infer<typeof NutritionGoalSchema>;

export const ACTIVITY_LEVELS = [1, 2, 3, 4] as const;
export const ActivityLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export const TARGET_REASONS = [
  'initial',
  'checkin',
  'weight_recalibration',
  'profile_change',
  'low_bmi_safety',
  'new_algo_version',
] as const;
export const TargetReasonSchema = z.enum(TARGET_REASONS);
export type TargetReason = z.infer<typeof TargetReasonSchema>;

export const APPLIED_RULES = [
  'no_deficit_low_bmi',
  'deficit_cap_25',
  'surplus_cap_15',
  'maintenance_band',
  'bmr_floor',
  'ref_weight_bmi25',
] as const;
export const AppliedRuleSchema = z.enum(APPLIED_RULES);
export type AppliedRule = z.infer<typeof AppliedRuleSchema>;

export const CHECKIN_DECISIONS = [
  'insufficient_data',
  'non_representative_week',
  'in_band',
  'out_of_band_pending',
  'proposal',
  'rapid_loss',
  'limit_reached',
  'safety_pause',
] as const;
export const CheckinDecisionSchema = z.enum(CHECKIN_DECISIONS);
export type CheckinDecision = z.infer<typeof CheckinDecisionSchema>;

export const CHECKIN_POSITIONS = ['above', 'in', 'below'] as const;
export const CheckinPositionSchema = z.enum(CHECKIN_POSITIONS);
export type CheckinPosition = z.infer<typeof CheckinPositionSchema>;

export const NUTRITION_NEEDS = ['consent', 'screen', 'setup', 'weigh_in'] as const;
export const NutritionNeedSchema = z.enum(NUTRITION_NEEDS);
export type NutritionNeed = z.infer<typeof NutritionNeedSchema>;

export const ADVICE_AUDIENCES = ['adults', 'minors', 'all'] as const;
export const AdviceAudienceSchema = z.enum(ADVICE_AUDIENCES);
export type AdviceAudience = z.infer<typeof AdviceAudienceSchema>;

export const ADVICE_STATUSES = ['draft', 'reviewed', 'published', 'retired'] as const;
export const AdviceStatusSchema = z.enum(ADVICE_STATUSES);
export type AdviceStatus = z.infer<typeof AdviceStatusSchema>;

export const ADVICE_DRAFT_ORIGINS = ['ai', 'human'] as const;

/** Orientation affichée selon l'issue de l'écran de sécurité (07 §5.4). */
export const ORIENTATIONS = ['midwife', 'doctor', 'dietitian', 'eating_disorder_line'] as const;
export const OrientationSchema = z.enum(ORIENTATIONS);
export type Orientation = z.infer<typeof OrientationSchema>;

/** Codes d'erreur de la nutrition et leur statut (spec brique 5 §7) ; ils figurent aussi dans `ApiErrorCode`. */
export const NUTRITION_ERROR_CODES = {
  mode_not_allowed: 422,
  setup_required: 422,
  screen_required: 422,
  weigh_in_required: 409,
  goal_not_allowed: 422,
  checkin_not_actionable: 409,
} as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const intField = z.number().int();

export const SCREEN_ANSWER_VALUES = ['yes', 'no', 'prefer_not'] as const;
export const ScreenAnswerSchema = z.enum(SCREEN_ANSWER_VALUES);
export const ScreenAnswersSchema = z.strictObject({
  pregnancy: ScreenAnswerSchema,
  eating_disorder: ScreenAnswerSchema,
  medical: ScreenAnswerSchema,
});
export type ScreenAnswers = z.infer<typeof ScreenAnswersSchema>;

/** Sortie de l'algorithme `nutri-1` (07 §5.6.4). */
export const NutritionTargetsSchema = z.strictObject({
  bmr_kcal: z.number(),
  tdee_kcal: z.number(),
  kcal_target: intField,
  kcal_min: intField,
  kcal_max: intField,
  protein_g_min: intField,
  protein_g_max: intField,
  fat_g_min: intField,
  carbs_g: intField,
  fiber_g: intField,
  water_ml: intField,
  effective_goal: NutritionGoalSchema,
  applied_rules: z.array(AppliedRuleSchema),
  algo_version: z.string().min(1),
});
export type NutritionTargets = z.infer<typeof NutritionTargetsSchema>;

export const NutritionSettingsSchema = z.strictObject({
  sex_for_calc: SexForCalcSchema.nullable(),
  height_cm: z.number().int().min(120).max(220).nullable(),
  activity_level: ActivityLevelSchema.nullable(),
  goal: NutritionGoalSchema.nullable(),
});

export const WeighInSetupSchema = z.strictObject({
  id: z.string().min(1),
  date: isoDate,
  weight_g: z.number().int().min(30000).max(250000).multipleOf(100),
});

export const NutritionSetupSchema = z.strictObject({
  sex_for_calc: SexForCalcSchema,
  height_cm: z.number().int().min(120).max(220),
  activity_level: ActivityLevelSchema,
  goal: NutritionGoalSchema,
  weigh_in: WeighInSetupSchema,
});

export const ScreenRequestSchema = z.strictObject({
  answers: ScreenAnswersSchema,
  mode: NutritionModeSchema,
  setup: NutritionSetupSchema.optional(),
});
export type ScreenRequest = z.infer<typeof ScreenRequestSchema>;

export const ModeRequestSchema = z.strictObject({
  mode: z.enum(['qualitative', 'disabled']),
});
export type ModeRequest = z.infer<typeof ModeRequestSchema>;

export const SettingsChangesSchema = z.strictObject({
  sex_for_calc: SexForCalcSchema.optional(),
  height_cm: z.number().int().min(120).max(220).optional(),
  activity_level: ActivityLevelSchema.optional(),
  goal: NutritionGoalSchema.optional(),
});
export type SettingsChanges = z.infer<typeof SettingsChangesSchema>;

export const SettingsPreviewRequestSchema = z.strictObject({ changes: SettingsChangesSchema });

export const CheckinResponseSchema = z.strictObject({
  response: z.enum(['accepted', 'declined']),
});
export type CheckinResponse = z.infer<typeof CheckinResponseSchema>;

export const AdminNutritionSchema = z.strictObject({ full_open: z.boolean() });
export type AdminNutrition = z.infer<typeof AdminNutritionSchema>;

export const NutritionCheckinSchema = z.strictObject({
  week_start: isoDate,
  weigh_in_count: intField,
  mean_weight_g: intField.nullable(),
  change_pct: z.number().nullable(),
  representative: z.boolean(),
  decision: CheckinDecisionSchema,
  position: CheckinPositionSchema.nullable(),
  proposed_delta_kcal: z.union([z.literal(-100), z.literal(100)]).nullable(),
  response: z.enum(['accepted', 'declined']).nullable(),
});
export type NutritionCheckin = z.infer<typeof NutritionCheckinSchema>;

export const WeeklyMeanSchema = z.strictObject({
  week_start: isoDate,
  weigh_in_count: intField,
  mean_weight_g: intField.nullable(),
  change_pct: z.number().nullable(),
});

const reducedShape = {
  cause: ModeCauseSchema,
  stored_mode: NutritionModeSchema,
  full_open: z.boolean(),
  screen_version_current: intField,
  needs: NutritionNeedSchema.nullable(),
};

const ReducedNutritionStateSchema = z.strictObject({
  effective_mode: z.enum(['qualitative', 'disabled']),
  ...reducedShape,
  mode_reason: z.literal('choice').nullable(),
});

const FullNutritionStateSchema = z.strictObject({
  effective_mode: z.literal('full'),
  ...reducedShape,
  mode_reason: ModeReasonSchema.nullable(),
  settings: NutritionSettingsSchema,
  safety_pause: z.boolean(),
  target: NutritionTargetsSchema.extend({ valid_from: isoDate, reason: TargetReasonSchema }).nullable(),
  last_checkin: NutritionCheckinSchema.nullable(),
  checkin: NutritionCheckinSchema.nullable(),
  weekly_means: z.array(WeeklyMeanSchema).max(12),
  reference_weight_g: intField.nullable(),
});

/** État rendu (spec brique 5 §7), discriminé par le mode effectif : rien d'autre que les champs réduits hors `full`. */
export const NutritionStateSchema = z.discriminatedUnion('effective_mode', [
  FullNutritionStateSchema,
  ReducedNutritionStateSchema,
]);
export type NutritionState = z.infer<typeof NutritionStateSchema>;

const AdviceSourceSchema = z.strictObject({
  title: z.string().min(1),
  /** Adresse web seulement : la fiche en fait un lien (`javascript:`, `data:`… refusés). */
  url: z.url({ protocol: /^https?$/ }),
  accessed_on: isoDate,
});

export const ADVICE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Fichier `data/advice/<id>.json` (spec brique 5 §10.1). */
export const AdviceSheetFileSchema = z.strictObject({
  id: z.string().regex(ADVICE_ID_PATTERN),
  title: z.string().min(1),
  body_md: z.string().min(1),
  audience: AdviceAudienceSchema,
  visible_modes: z.array(z.enum(['full', 'qualitative'])).min(1),
  tags: z.array(z.string().min(1)),
  sources: z.array(AdviceSourceSchema),
  draft_origin: z.enum(ADVICE_DRAFT_ORIGINS),
});
export type AdviceSheetFile = z.infer<typeof AdviceSheetFileSchema>;

export const ServedAdviceSheetSchema = z.strictObject({
  id: z.string().regex(ADVICE_ID_PATTERN),
  title: z.string().min(1),
  body_md: z.string().min(1),
  audience: AdviceAudienceSchema,
  visible_modes: z.array(z.enum(['full', 'qualitative'])).min(1),
  tags: z.array(z.string().min(1)),
  sources: z.array(AdviceSourceSchema),
  version: z.number().int().min(1),
  reviewed_at: z.string().nullable(),
});
export type ServedAdviceSheet = z.infer<typeof ServedAdviceSheetSchema>;
