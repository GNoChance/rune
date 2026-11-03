import {
  type ChangeAuthor,
  type ChangeStatus,
  type CoachId,
  type CommentPart,
  type DecisionResult,
  type Effort,
  type ExerciseStatus,
  type Experience,
  type Goal,
  type ILLUSTRATION_LICENSES,
  type ILLUSTRATION_MEDIA_TYPES,
  type ILLUSTRATION_SOURCES,
  type LoadMode,
  type MEASURES,
  type MECHANICS,
  type NextAdjustment,
  type PainLevel,
  type RejectionCode,
  type SessionProfile,
  type SessionStatus,
  type SetKind,
  type Side,
  type SlotMode,
  type SwapReason,
  snakeToCamel,
  type WeekType,
} from '@rune/contracts';
import type { Generated, Kysely, Transaction } from 'kysely';

/** Gabarit +SYNC des tables à propriétaire (09 §0). */
interface SyncColumns {
  ownerId: string;
  rev: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

interface SoftDelete {
  deletedAt: string | null;
}

export interface ServerMetaTable {
  id: number;
  serverEpoch: string;
  epochStartedAt: string;
  epochBaseRev: Generated<number>;
  syncCounter: Generated<number>;
  tombstonePurgeRev: Generated<number>;
  catalogVersion: string | null;
  catalogUpdatedAt: string | null;
}

export interface SchemaMigrationsTable {
  id: string;
  breaking: number;
  appliedAt: string;
}

export interface AppliedOpTable {
  opId: string;
  userId: string;
  entity: string;
  rowId: string;
  status: 'applied' | 'applied_partial' | 'duplicate' | 'rejected';
  assignedRev: number | null;
  appliedAt: string;
}

export interface SyncRejectionTable extends SyncColumns, SoftDelete {
  id: string;
  opId: string;
  entity: string;
  rowId: string;
  code: RejectionCode;
  detailJson: string | null;
  dismissedAt: string | null;
}

export interface UserTable {
  id: string;
  username: string;
  usernameKey: string;
  passwordHash: string;
  role: 'admin' | 'member';
  status: Generated<'active' | 'disabled'>;
  birthDate: string;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  onboardingStep:
    | 'goal'
    | 'sport'
    | 'place_kind'
    | 'place'
    | 'experience'
    | 'availability'
    | 'health'
    | 'ready'
    | null;
  onboardingCompletedAt: string | null;
  invitationId: string | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  /** Migration 0003_catalog (spec brique 2 §3.1) : 0/1, écrits par l'admin seulement. */
  catalogReviewer: Generated<number>;
  healthProfessional: Generated<number>;
}

export interface InvitationTable {
  id: string;
  codeHash: string;
  note: string | null;
  birthDate: string | null;
  isAdminBootstrap: Generated<number>;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  revokedAt: string | null;
}

export interface PasswordResetTable {
  id: string;
  userId: string;
  codeHash: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
}

export interface SessionTable {
  id: string;
  tokenHash: string;
  userId: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  mustChangePassword: Generated<number>;
  revokedAt: string | null;
  revokedReason:
    | 'logout'
    | 'logout_all'
    | 'password_change'
    | 'password_reset'
    | 'admin'
    | 'account_deleted'
    | null;
}

export interface ConsentEventTable extends SyncColumns {
  id: string;
  type: 'health' | 'ai_coach';
  action: 'grant' | 'withdraw';
  textVersion: string;
}

export interface SecurityEventTable {
  id: string;
  at: string;
  type: string;
  actorId: string | null;
  targetId: string | null;
  tailnetIp: string | null;
  outcome: 'success' | 'failure' | 'blocked';
  details: string | null;
}

export interface TrainingProfileTable extends SyncColumns, SoftDelete {
  id: string;
  goal: Goal | null;
  experience: Experience | null;
  daysPerWeek: number | null;
  sessionMinutes: number | null;
  sportCode: string | null;
  sportOtherLabel: string | null;
  cautiousMode: Generated<number>;
  /** Migration 0002_coach ; null tant que l'onboarding n'a pas passé l'étape du coach. */
  coach: CoachId | null;
}

export interface HealthScreeningTable extends SyncColumns, SoftDelete {
  id: string;
  caution: number | null;
  questionnaireVersion: string | null;
  answeredAt: string | null;
}

export interface LimitationTable extends SyncColumns, SoftDelete {
  id: string;
  bodyArea:
    | 'shoulder'
    | 'elbow'
    | 'wrist_hand'
    | 'neck'
    | 'upper_back'
    | 'lower_back'
    | 'hip'
    | 'knee'
    | 'ankle_foot'
    | 'other'
    | null;
  side: 'left' | 'right' | 'both' | 'not_applicable' | null;
  severity: 'mild' | 'severe' | null;
  note: string | null;
  active: number | null;
}

export interface GymTable extends SoftDelete {
  id: string;
  name: string;
  nameKey: string;
  city: string;
  cityKey: string;
  loadSettings: string;
  createdBy: string | null;
  updatedBy: string | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
}

export interface GymEquipmentTable extends SoftDelete {
  id: string;
  gymId: string;
  equipmentCode: string;
  addedBy: string | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
}

export interface GymHistoryTable {
  id: string;
  gymId: string;
  authorId: string | null;
  at: string;
  action: 'create' | 'update_info' | 'add_equipment' | 'remove_equipment' | 'update_load_settings';
  detail: string;
}

export interface PlaceTable extends SyncColumns, SoftDelete {
  id: string;
  kind: 'gym' | 'home';
  gymId: string | null;
  name: string | null;
  isPrimary: Generated<number>;
  visibleAtGym: Generated<number>;
  loadSettings: string | null;
}

export interface HomeEquipmentTable extends SyncColumns, SoftDelete {
  id: string;
  placeId: string;
  equipmentCode: string;
}

/**
 * Fiche d'exercice (migration 0003_catalog, 04 « Modèle de données »). Colonnes JSON en texte ; champs IA à
 * null tant qu'un brouillon ne les a pas (R-FIC-1). Booléens 0/1.
 */
export interface ExerciseTable {
  id: string;
  schemaVersion: number;
  revision: number;
  status: ExerciseStatus;
  batch: string;
  name: string;
  aliases: string | null;
  movementPattern: string;
  mechanics: (typeof MECHANICS)[number];
  unilateral: number;
  measure: (typeof MEASURES)[number];
  loadMode: LoadMode;
  level: number;
  notForMinors: number;
  primaryMuscles: string | null;
  secondaryMuscles: string | null;
  equipmentOptions: string;
  stressedJoints: string | null;
  content: string;
  chainId: string | null;
  easierId: string | null;
  harderId: string | null;
  illustrations: string | null;
  reviewNotes: string | null;
  drafting: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  retiredAt: string | null;
  updatedAt: string | null;
  exportedRevision: number | null;
}

/** Fichier d'illustration retenu (migration 0003_catalog) ; `creators` en JSON. */
export interface IllustrationTable {
  id: string;
  file: string;
  sha256: string;
  bytes: number;
  mediaType: (typeof ILLUSTRATION_MEDIA_TYPES)[number];
  source: (typeof ILLUSTRATION_SOURCES)[number];
  sourceUrl: string;
  creators: string;
  license: (typeof ILLUSTRATION_LICENSES)[number];
  licenseUrl: string;
  modifications: string | null;
  replaceBeforePublic: Generated<number>;
}

/** Tables de la relecture (spec brique 2 §3.3 à §3.5) ; auteurs à null après suppression du compte. */
export interface ExerciseCommentTable {
  id: string;
  exerciseId: string;
  authorId: string | null;
  part: CommentPart;
  body: string;
  revision: number;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface ExerciseValidationTable {
  id: string;
  exerciseId: string;
  reviewerId: string | null;
  revision: number;
  health: number;
  createdAt: string;
}

export interface ExerciseRevisionTable {
  exerciseId: string;
  revision: number;
  content: string;
  status: ExerciseStatus;
  savedBy: string | null;
  savedAt: string;
}

/** Programmes et séances (migration 0004_program, spec brique 3 §5.1). JSON en texte, booléens 0/1. */
export interface ProgramInstanceTable extends SyncColumns, SoftDelete {
  id: string;
  templateId: string;
  templateVersion: number;
  snapshot: string;
  daysPerWeek: number;
  status: 'active' | 'ended';
  revision: Generated<number>;
  startedAt: string;
  endedAt: string | null;
}

export interface InstanceChangeTable extends SyncColumns, SoftDelete {
  id: string;
  instanceId: string;
  baseRevision: number;
  author: ChangeAuthor;
  operations: string;
  reasonCode: string;
  reason: string | null;
  status: ChangeStatus;
  expiresAt: string | null;
  decidedAt: string | null;
  aiGenerated: Generated<number>;
  aiModel: string | null;
  promptVersion: string | null;
  coachThreadId: string | null;
}

export interface SlotStateTable extends SyncColumns, SoftDelete {
  id: string;
  instanceId: string;
  slotId: string;
  exerciseId: string;
  mode: SlotMode;
  loadG: number | null;
  targetReps: number | null;
  variantRank: number | null;
  durationS: number | null;
  /**
   * Clé rendue par `selectAll` : le CamelCasePlugin écrirait `machine_step_goverride`. Pour filtrer ou écrire la
   * colonne, passer par `sql.ref('machine_step_g_override')`.
   */
  machineStepGOverride: number | null;
  calibrationLeft: Generated<number>;
  noProgressCount: Generated<number>;
  stallRank: Generated<number>;
  painStreak: number | null;
  suspended: Generated<number>;
  lastSessionId: string | null;
  rulesVersion: string;
}

export interface WorkoutSessionTable extends SyncColumns, SoftDelete {
  id: string;
  instanceId: string | null;
  workoutId: string | null;
  placeId: string | null;
  deviceId: string;
  startedAt: string;
  endedAt: string | null;
  status: SessionStatus;
  weekType: WeekType;
  templateVersion: number | null;
  rulesVersion: string;
  appVersion: string;
  profile: SessionProfile;
  note: string | null;
}

export interface PerformedExerciseTable extends SyncColumns, SoftDelete {
  id: string;
  sessionId: string;
  slotId: string | null;
  plannedExerciseId: string | null;
  exerciseId: string;
  swapReason: SwapReason | null;
  position: number;
  painLevel: PainLevel | null;
  nextAdjustment: NextAdjustment | null;
  note: string | null;
}

export interface EngineDecisionTable extends SyncColumns, SoftDelete {
  id: string;
  instanceId: string | null;
  slotId: string | null;
  exerciseId: string;
  result: DecisionResult;
  reasonCode: string;
  nextTarget: string | null;
  profile: SessionProfile;
  rulesVersion: string;
}

export interface PerformedSetTable extends SyncColumns, SoftDelete {
  id: string;
  performedExerciseId: string;
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
  targetReps: number | null;
  targetDurationS: number | null;
  targetLoadG: number | null;
  targetRir: number | null;
  targetVariant: string | null;
  loggedAt: string | null;
}

export interface Database {
  serverMeta: ServerMetaTable;
  schemaMigrations: SchemaMigrationsTable;
  appliedOp: AppliedOpTable;
  syncRejection: SyncRejectionTable;
  user: UserTable;
  invitation: InvitationTable;
  passwordReset: PasswordResetTable;
  session: SessionTable;
  consentEvent: ConsentEventTable;
  securityEvent: SecurityEventTable;
  trainingProfile: TrainingProfileTable;
  healthScreening: HealthScreeningTable;
  limitation: LimitationTable;
  gym: GymTable;
  gymEquipment: GymEquipmentTable;
  gymHistory: GymHistoryTable;
  place: PlaceTable;
  homeEquipment: HomeEquipmentTable;
  exercise: ExerciseTable;
  illustration: IllustrationTable;
  exerciseComment: ExerciseCommentTable;
  exerciseValidation: ExerciseValidationTable;
  exerciseRevision: ExerciseRevisionTable;
  programInstance: ProgramInstanceTable;
  instanceChange: InstanceChangeTable;
  slotState: SlotStateTable;
  workoutSession: WorkoutSessionTable;
  performedExercise: PerformedExerciseTable;
  engineDecision: EngineDecisionTable;
  performedSet: PerformedSetTable;
}

export type DbExecutor = Kysely<Database> | Transaction<Database>;

/** Nom de table SQL (snake_case) vers clé de `Database` (camelCase) : 'training_profile' → 'trainingProfile'. */
export function tableKey(sqlTable: string): keyof Database {
  return snakeToCamel(sqlTable) as keyof Database;
}
