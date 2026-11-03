import { z } from 'zod';
import { EXERCISE_ID_RE } from '../exercise';
import {
  CHANGE_AUTHORS,
  CHANGE_REASON_CODES,
  CHANGE_STATUSES,
  InstanceChangeOperationSchema,
  MAX_CHANGE_OPERATIONS,
  REASON_CODES,
  SLOT_MODES,
} from '../program';

/* Routes `/api/program/*` (spec brique 3 §6). Toutes en ligne, session exigée. */

const Slug = z.string().max(60).regex(EXERCISE_ID_RE);
const IsoDateTime = z.iso.datetime();

export const EnrollRequest = z.strictObject({
  templateId: Slug,
  daysPerWeek: z.number().int().min(2).max(4),
});
export type EnrollRequest = z.infer<typeof EnrollRequest>;

export const CreateChangeRequest = z.strictObject({
  baseRevision: z.number().int().min(0),
  operations: z.array(InstanceChangeOperationSchema).min(1).max(MAX_CHANGE_OPERATIONS),
});
export type CreateChangeRequest = z.infer<typeof CreateChangeRequest>;

export const DecideChangeRequest = z.strictObject({ baseRevision: z.number().int().min(0) });
export type DecideChangeRequest = z.infer<typeof DecideChangeRequest>;

/** Pas de machine en grammes (500 à 10 000), ou `null` pour revenir au pas du lieu. */
export const MachineStepRequest = z.strictObject({
  stepG: z.number().int().min(500).max(10_000).nullable(),
});
export type MachineStepRequest = z.infer<typeof MachineStepRequest>;

/** Raisons de refus d'une opération (422 `invalid_change`), une entrée par opération fautive. */
export const CHANGE_ERROR_CODES = [
  'slot_unknown',
  'workout_unknown',
  'exercise_unusable',
  'pattern_mismatch',
  'sets_out_of_bounds',
  'reps_out_of_bounds',
  'rir_out_of_bounds',
  'rest_out_of_bounds',
  'coverage_lost',
  'volume_out_of_range',
  'slot_limit',
  'forbidden_for_author',
  'forbidden_cautious',
  'days_out_of_range',
  'template_unavailable',
  'template_unchanged',
  'not_suspended',
  'already_suspended',
] as const;
export const ChangeErrorCodeSchema = z.enum(CHANGE_ERROR_CODES);
export type ChangeErrorCode = z.infer<typeof ChangeErrorCodeSchema>;

export const ChangeErrorsBody = z.strictObject({
  error: z.literal('invalid_change'),
  errors: z.array(z.strictObject({ op: z.number().int().min(0), code: ChangeErrorCodeSchema })).min(1),
});
export type ChangeErrorsBody = z.infer<typeof ChangeErrorsBody>;

export const ProgramInstanceView = z.strictObject({
  id: z.string(),
  templateId: Slug,
  templateVersion: z.number().int().min(1),
  daysPerWeek: z.number().int().min(2).max(4),
  status: z.enum(['active', 'ended']),
  revision: z.number().int().min(0),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.nullable(),
});
export type ProgramInstanceView = z.infer<typeof ProgramInstanceView>;

export const InstanceChangeView = z.strictObject({
  id: z.string(),
  instanceId: z.string(),
  baseRevision: z.number().int().min(0),
  author: z.enum(CHANGE_AUTHORS),
  operations: z.array(InstanceChangeOperationSchema).min(1).max(MAX_CHANGE_OPERATIONS),
  reasonCode: z.enum([...REASON_CODES, ...CHANGE_REASON_CODES]),
  /** Texte libre (C2) : nul sans consentement santé. */
  reason: z.string().nullable(),
  status: z.enum(CHANGE_STATUSES),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime.nullable(),
  decidedAt: IsoDateTime.nullable(),
  /** Proposition du coach IA (spec brique 4 §12.3) : modèle de l'itération qui l'a faite, fil d'origine s'il existe. */
  aiGenerated: z.boolean(),
  aiModel: z.string().nullable(),
  coachThreadId: z.string().nullable(),
});
export type InstanceChangeView = z.infer<typeof InstanceChangeView>;

export const SlotStateView = z.strictObject({
  id: z.string(),
  instanceId: z.string(),
  slotId: z.string(),
  exerciseId: z.string(),
  mode: z.enum(SLOT_MODES),
  loadG: z.number().int().nullable(),
  targetReps: z.number().int().nullable(),
  variantRank: z.number().int().nullable(),
  durationS: z.number().int().nullable(),
  machineStepGOverride: z.number().int().nullable(),
  calibrationLeft: z.number().int(),
  noProgressCount: z.number().int(),
  stallRank: z.number().int(),
  suspended: z.boolean(),
});
export type SlotStateView = z.infer<typeof SlotStateView>;
