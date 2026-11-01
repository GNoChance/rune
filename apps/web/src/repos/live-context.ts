import {
  defaultLoadSettings,
  type LoadSettings,
  ProgramTemplateSchema,
  ServedSheetSchema,
} from '@rune/contracts';
import { slotStateId } from '@rune/domain';
import type { AppDb, MirrorRow } from '../local-db/db';
import { getMeta } from '../local-db/meta';
import { placeView } from './places-repo';
import { currentUserId, isLive, parseJsonColumn, text } from './rows';
import { composeSessions, type WorkoutSetView } from './session-records';

/*
 * Ce que l'écran de séance lit en plus de la séance elle-même (spec brique 3 §7.3) : le nom de la séance du modèle,
 * les réglages de charge du lieu (pas réalisables de − / +), le pas fixé des machines et « Préc. ». Lecture seule.
 */

export interface LiveContext {
  /** Nom de la séance dans le modèle de l'instance (`snapshot`) ; null pour une séance libre ou un modèle illisible. */
  workoutName: string | null;
  /** Réglages de charge du lieu de la séance (les siens, sinon ceux de sa salle), sinon ceux par défaut. */
  loadSettings: LoadSettings;
  /** Pas de machine fixé pour l'exercice (`slot_state.machine_step_g_override`), par id d'exercice réalisé. */
  machineStepG: Record<string, number>;
  /**
   * « Préc. » : par fiche, les séries faites de la dernière séance close où elle a été faite (libre ou de programme),
   * échauffement puis travail, par position, gauche avant droite. Absente si la fiche n'a jamais été faite.
   */
  previous: Record<string, WorkoutSetView[]>;
}

const CLOSED = new Set(['completed', 'abandoned']);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

async function workoutName(db: AppDb, session: MirrorRow, ownerId: string): Promise<string | null> {
  const instanceId = text(session.instanceId);
  const workoutId = text(session.workoutId);
  if (instanceId === null || workoutId === null) return null;
  const instance = await db.mirror('program_instance').get(instanceId);
  if (!instance || instance.ownerId !== ownerId) return null;
  const snapshot = parseJsonColumn(instance.snapshot, ProgramTemplateSchema);
  return snapshot?.workouts.find((w) => w.id === workoutId)?.name ?? null;
}

/** Lieu supprimé compris : une séance peut citer un lieu retiré depuis. */
async function loadSettingsOf(db: AppDb, session: MirrorRow, ownerId: string): Promise<LoadSettings> {
  const placeId = text(session.placeId);
  const row = placeId === null ? undefined : await db.mirror('place').get(placeId);
  if (!row || row.ownerId !== ownerId) return defaultLoadSettings('gym');
  const place = await placeView(db, row);
  return place.loadSettings ?? defaultLoadSettings(place.kind);
}

/** Pas fixé de l'état du slot : clé par fiche, ou par chaîne pour une variante (spec §4.3.6). */
async function machineSteps(
  db: AppDb,
  session: MirrorRow,
  exercises: readonly MirrorRow[],
  ownerId: string,
): Promise<Record<string, number>> {
  const instanceId = text(session.instanceId);
  if (instanceId === null) return {};
  const out: Record<string, number> = {};
  for (const exercise of exercises) {
    const slotId = text(exercise.slotId);
    const exerciseId = text(exercise.exerciseId);
    if (slotId === null || exerciseId === null) continue;
    const sheet = ServedSheetSchema.safeParse(await db.table('exercises').get(exerciseId));
    const keys = [exerciseId, ...(sheet.success && sheet.data.chain_id ? [sheet.data.chain_id] : [])];
    const states = await db.mirror('slot_state').bulkGet(keys.map((k) => slotStateId(instanceId, slotId, k)));
    for (const state of states) {
      const step =
        state && isLive(state) && state.ownerId === ownerId ? int(state.machineStepGOverride) : null;
      if (step !== null && step > 0) {
        out[exercise.id] = step;
        break;
      }
    }
  }
  return out;
}

/**
 * Dernière séance close de chaque fiche où elle a au moins une série faite : les séances candidates sont lues de la
 * plus récente à la plus ancienne, jusqu'à ce que chaque fiche ait la sienne.
 */
async function previousSets(
  db: AppDb,
  sessionId: string,
  exerciseIds: ReadonlySet<string>,
  ownerId: string,
  deviceId: string | null,
): Promise<Record<string, WorkoutSetView[]>> {
  if (exerciseIds.size === 0) return {};
  const candidates = await db
    .mirror('performed_exercise')
    .filter(
      (r) =>
        isLive(r) &&
        r.ownerId === ownerId &&
        r.sessionId !== sessionId &&
        exerciseIds.has(String(r.exerciseId)),
    )
    .toArray();
  const sessionIds = [...new Set(candidates.map((r) => String(r.sessionId)))];
  const sessions = (await db.mirror('workout_session').bulkGet(sessionIds)).filter(
    (r): r is MirrorRow =>
      r !== undefined && isLive(r) && r.ownerId === ownerId && CLOSED.has(String(r.status)),
  );
  // La plus récente d'abord (début, puis `id`), comme l'historique.
  const ordered = sessions
    .map((row) => ({ row, id: row.id, startedAt: Date.parse(String(row.startedAt)) }))
    .filter((s) => !Number.isNaN(s.startedAt))
    .sort((a, b) => b.startedAt - a.startedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

  const out: Record<string, WorkoutSetView[]> = {};
  for (const { row } of ordered) {
    if (Object.keys(out).length === exerciseIds.size) break;
    const [view] = await composeSessions(db, [row], ownerId, deviceId);
    for (const exerciseId of exerciseIds) {
      if (out[exerciseId] || !view) continue;
      // Séance close : `composeSessions` n'en garde que les séries faites.
      const sets = view.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets);
      if (sets.length > 0) out[exerciseId] = sets;
    }
  }
  return out;
}

/** Contexte de la séance `sessionId` du membre connecté ; null si elle n'existe pas (ou plus) ici. */
export async function readLiveContext(db: AppDb, sessionId: string): Promise<LiveContext | null> {
  const ownerId = await currentUserId(db);
  if (ownerId === null) return null;
  const session = await db.mirror('workout_session').get(sessionId);
  if (!session || !isLive(session) || session.ownerId !== ownerId) return null;
  const deviceId = (await getMeta(db, 'deviceId')) ?? null;
  const exercises = (
    await db.mirror('performed_exercise').where('sessionId').equals(sessionId).toArray()
  ).filter((r) => isLive(r) && r.ownerId === ownerId);
  const exerciseIds = new Set(
    exercises.flatMap((e) => (typeof e.exerciseId === 'string' ? [e.exerciseId] : [])),
  );
  return {
    workoutName: await workoutName(db, session, ownerId),
    loadSettings: await loadSettingsOf(db, session, ownerId),
    machineStepG: await machineSteps(db, session, exercises, ownerId),
    previous: await previousSets(db, sessionId, exerciseIds, ownerId, deviceId),
  };
}
