import {
  EFFORTS,
  LOAD_MODES,
  NEXT_ADJUSTMENTS,
  PAIN_LEVELS,
  SESSION_PROFILES,
  SESSION_STATUSES,
  SET_KINDS,
  SIDES,
  SWAP_REASONS,
  WEEK_TYPES,
} from '@rune/contracts';
import type { ExerciseRecord, SessionRecord, SetRecord } from '@rune/domain';
import type { AppDb, MirrorRow } from '../local-db/db';
import { isLive, oneOf, text } from './rows';

/*
 * Séances du miroir lues comme le domaine les attend (`SessionRecord`, spec brique 3 §4.2) : instants en
 * millisecondes, lignes supprimées écartées, exercices et séries dans l'ordre de la séance. Le rejeu local, la
 * séance en cours, l'historique, l'XP et les records partent tous de ces vues.
 */

/** Série d'une séance ; `loggedAt` non nul = faite (D2). */
export interface WorkoutSetView extends SetRecord {
  performedExerciseId: string;
}

export interface WorkoutExerciseView extends ExerciseRecord {
  sessionId: string;
  note: string | null;
  /** Échauffement puis travail, par position, gauche avant droite. */
  sets: WorkoutSetView[];
}

export interface WorkoutSessionView extends SessionRecord {
  deviceId: string;
  templateVersion: number | null;
  appVersion: string;
  note: string | null;
  /**
   * Tenue par cet appareil (`device_id`) ; faux pour une séance en cours reprise ailleurs, montrée alors en lecture
   * seule : « Cette séance continue sur un autre appareil. » (spec §7.1).
   */
  heldHere: boolean;
  /** Par position, puis `id`. */
  exercises: WorkoutExerciseView[];
}

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const instant = (v: unknown): number | null => {
  const ms = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return Number.isNaN(ms) ? null : ms;
};
/** Ordre binaire des `id`, comme le domaine. */
const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const KIND_ORDER = { warmup: 0, work: 1 } as const;
const sideOrder = (side: string | null) => (side === 'left' ? 1 : side === 'right' ? 2 : 0);

const setOrder = (a: WorkoutSetView, b: WorkoutSetView): number =>
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
  a.position - b.position ||
  sideOrder(a.side) - sideOrder(b.side) ||
  binary(a.id, b.id);

const exerciseOrder = (a: { position: number; id: string }, b: { position: number; id: string }): number =>
  a.position - b.position || binary(a.id, b.id);

function setView(r: MirrorRow): WorkoutSetView | null {
  const kind = oneOf(SET_KINDS, r.kind);
  const loadMode = oneOf(LOAD_MODES, r.loadMode);
  const position = int(r.position);
  const performedExerciseId = text(r.performedExerciseId);
  if (kind === null || loadMode === null || position === null || performedExerciseId === null) return null;
  return {
    id: r.id,
    performedExerciseId,
    position,
    kind,
    loadMode,
    loadG: int(r.loadG),
    reps: int(r.reps),
    durationS: int(r.durationS),
    side: oneOf(SIDES, r.side),
    effort: oneOf(EFFORTS, r.effort),
    targetRepsMin: int(r.targetRepsMin),
    targetRepsMax: int(r.targetRepsMax),
    targetDurationS: int(r.targetDurationS),
    targetLoadG: int(r.targetLoadG),
    targetRir: int(r.targetRir),
    targetVariant: text(r.targetVariant),
    loggedAt: instant(r.loggedAt),
  };
}

function exerciseView(r: MirrorRow, sets: WorkoutSetView[]): WorkoutExerciseView | null {
  const sessionId = text(r.sessionId);
  const exerciseId = text(r.exerciseId);
  const position = int(r.position);
  if (sessionId === null || exerciseId === null || position === null) return null;
  return {
    id: r.id,
    sessionId,
    slotId: text(r.slotId),
    plannedExerciseId: text(r.plannedExerciseId),
    exerciseId,
    position,
    swapReason: oneOf(SWAP_REASONS, r.swapReason),
    painLevel: oneOf(PAIN_LEVELS, r.painLevel),
    nextAdjustment: oneOf(NEXT_ADJUSTMENTS, r.nextAdjustment),
    note: text(r.note),
    sets: sets.sort(setOrder),
  };
}

function sessionView(
  r: MirrorRow,
  exercises: WorkoutExerciseView[],
  deviceId: string | null,
): WorkoutSessionView | null {
  const startedAt = instant(r.startedAt);
  const status = oneOf(SESSION_STATUSES, r.status);
  const weekType = oneOf(WEEK_TYPES, r.weekType);
  const profile = oneOf(SESSION_PROFILES, r.profile);
  const rulesVersion = text(r.rulesVersion);
  if (
    startedAt === null ||
    status === null ||
    weekType === null ||
    profile === null ||
    rulesVersion === null
  ) {
    return null;
  }
  const device = text(r.deviceId) ?? '';
  return {
    id: r.id,
    instanceId: text(r.instanceId),
    workoutId: text(r.workoutId),
    placeId: text(r.placeId),
    deviceId: device,
    startedAt,
    endedAt: instant(r.endedAt),
    status,
    weekType,
    profile,
    rulesVersion,
    templateVersion: int(r.templateVersion),
    appVersion: text(r.appVersion) ?? '',
    note: text(r.note),
    heldHere: deviceId !== null && device === deviceId,
    exercises: exercises.sort(exerciseOrder),
  };
}

/**
 * Vues des séances `rows` (déjà choisies par l'appelant) de `ownerId` : leurs exercices et séries vivants, lus par
 * les index `sessionId` et `performedExerciseId`. Une ligne illisible est écartée ; `deviceId` (celui de cet
 * appareil, null s'il n'en a pas encore) donne `heldHere`.
 */
export async function composeSessions(
  db: AppDb,
  rows: readonly MirrorRow[],
  ownerId: string,
  deviceId: string | null,
): Promise<WorkoutSessionView[]> {
  const owned = (r: MirrorRow) => isLive(r) && r.ownerId === ownerId;
  const sessions = rows.filter(owned);
  if (sessions.length === 0) return [];
  const exerciseRows = await db
    .mirror('performed_exercise')
    .where('sessionId')
    .anyOf(sessions.map((s) => s.id))
    .filter(owned)
    .toArray();
  const setRows = await db
    .mirror('performed_set')
    .where('performedExerciseId')
    .anyOf(exerciseRows.map((e) => e.id))
    .filter(owned)
    .toArray();

  const setsByExercise = new Map<string, WorkoutSetView[]>();
  for (const row of setRows) {
    const set = setView(row);
    if (set === null) continue;
    const list = setsByExercise.get(set.performedExerciseId) ?? [];
    list.push(set);
    setsByExercise.set(set.performedExerciseId, list);
  }
  const exercisesBySession = new Map<string, WorkoutExerciseView[]>();
  for (const row of exerciseRows) {
    const exercise = exerciseView(row, setsByExercise.get(row.id) ?? []);
    if (exercise === null) continue;
    const list = exercisesBySession.get(exercise.sessionId) ?? [];
    list.push(exercise);
    exercisesBySession.set(exercise.sessionId, list);
  }
  return sessions.flatMap((row) => {
    const view = sessionView(row, exercisesBySession.get(row.id) ?? [], deviceId);
    return view === null ? [] : [view];
  });
}

/** Plus récente d'abord (début, puis `id`). */
export const latestFirst = (a: SessionRecord, b: SessionRecord): number =>
  b.startedAt - a.startedAt || binary(b.id, a.id);
