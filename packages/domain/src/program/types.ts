import type {
  ChangeAuthor,
  DecisionResult,
  Effort,
  EquipmentCode,
  InstanceChangeOperation,
  LoadMode,
  LoadSettings,
  NextAdjustment,
  PainLevel,
  ReasonCode,
  SessionProfile,
  SessionStatus,
  SetKind,
  Side,
  SlotMode,
  SwapReason,
  WeekType,
} from '@rune/contracts';

/** Série telle que le moteur la lit (spec brique 3 §4.2). Les instants sont des millisecondes Unix. */
export interface SetRecord {
  id: string;
  position: number;
  kind: SetKind;
  loadMode: LoadMode;
  loadG: number | null;
  reps: number | null;
  durationS: number | null;
  side: Side | null;
  effort: Effort | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationS: number | null;
  targetLoadG: number | null;
  targetRir: number | null;
  targetVariant: string | null;
  loggedAt: number | null;
}

/** Une série est faite quand elle a été enregistrée. */
export const isDone = (set: SetRecord): boolean => set.loggedAt !== null;

export interface ExerciseRecord {
  id: string;
  slotId: string | null;
  plannedExerciseId: string | null;
  exerciseId: string;
  position: number;
  swapReason: SwapReason | null;
  painLevel: PainLevel | null;
  nextAdjustment: NextAdjustment | null;
  sets: SetRecord[];
}

export interface SessionRecord {
  id: string;
  instanceId: string | null;
  workoutId: string | null;
  placeId: string | null;
  startedAt: number;
  endedAt: number | null;
  status: SessionStatus;
  weekType: WeekType;
  profile: SessionProfile;
  rulesVersion: string;
  exercises: ExerciseRecord[];
}

export interface AcceptedChange {
  id: string;
  author: ChangeAuthor;
  reasonCode: string;
  decidedAt: number;
  operations: InstanceChangeOperation[];
}

export interface PlaceContext {
  id: string;
  equipment: ReadonlySet<EquipmentCode>;
  loadSettings: LoadSettings;
}

export interface SlotState {
  id: string;
  instanceId: string;
  slotId: string;
  exerciseId: string;
  mode: SlotMode;
  loadG: number | null;
  targetReps: number | null;
  variantRank: number | null;
  durationS: number | null;
  machineStepGOverride: number | null;
  calibrationLeft: number;
  noProgressCount: number;
  stallRank: number;
  painStreak: number;
  suspended: boolean;
  lastSessionId: string | null;
  rulesVersion: string;
}

export const slotStateId = (instanceId: string, slotId: string, exerciseId: string): string =>
  `${instanceId}:${slotId}:${exerciseId}`;

export interface NextTarget {
  mode: SlotMode;
  loadG: number | null;
  repsMin: number | null;
  repsMax: number | null;
  durationS: number | null;
  variantId: string | null;
  workSets: number;
}

export interface EngineDecision {
  id: string;
  instanceId: string;
  slotId: string;
  exerciseId: string;
  result: DecisionResult;
  reasonCode: ReasonCode;
  nextTarget: NextTarget | null;
  profile: SessionProfile;
  rulesVersion: string;
}
