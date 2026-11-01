import type { ServedSheet } from '@rune/contracts';
import type { AppDb } from '../../src/local-db/db';
import { seedCatalog, seedGarage, seedTrainingProfile, served } from '../support/catalog';
import { seedMirror } from '../support/seed';

/** Une série du miroir (faite par défaut) ; seules les valeurs utiles sont à dire. */
export interface SetSpec {
  loadG?: number | null;
  reps?: number | null;
  durationS?: number | null;
  effort?: string | null;
  loadMode?: string;
}

export interface ExerciseSpec {
  exerciseId: string;
  sets: SetSpec[];
}

export interface SessionSpec {
  id: string;
  startedAt: string;
  status?: string;
  exercises: ExerciseSpec[];
}

export const repeat = (n: number, spec: SetSpec): SetSpec[] => Array.from({ length: n }, () => spec);

export const SHEETS: ServedSheet[] = [
  served({ id: 'back-squat', name: 'Squat barre', load_mode: 'barbell', equipment_options: [['barbell']] }),
  served({
    id: 'lat-pulldown',
    name: 'Tirage vertical',
    aliases: [],
    movement_pattern: 'vertical_pull',
    load_mode: 'machine',
    primary_muscles: ['lats'],
    secondary_muscles: ['biceps'],
    equipment_options: [['lat_pulldown']],
  }),
  served({
    id: 'plank',
    name: 'Gainage',
    aliases: [],
    measure: 'duration',
    load_mode: 'bodyweight',
    primary_muscles: ['abs'],
    secondary_muscles: [],
    equipment_options: [[]],
  }),
];

/**
 * Cinq séances terminées : 3 de tirage vertical (28 séries chacune, 300 XP plafonnées), 2 de squat barre
 * (20 puis 10 séries). Total : 1 240 XP (rang D), 9 480 kg, 4 semaines civiles, Dos et Quadriceps au rang D.
 */
export const FIVE_SESSIONS: SessionSpec[] = [
  {
    id: 's1',
    startedAt: '2026-09-07T08:00:00.000Z',
    exercises: [{ exerciseId: 'lat-pulldown', sets: repeat(28, { loadG: 10_000, reps: 5 }) }],
  },
  {
    id: 's2',
    startedAt: '2026-09-14T08:00:00.000Z',
    exercises: [{ exerciseId: 'lat-pulldown', sets: repeat(28, { loadG: 10_000, reps: 5 }) }],
  },
  {
    id: 's3',
    startedAt: '2026-09-21T08:00:00.000Z',
    exercises: [{ exerciseId: 'lat-pulldown', sets: repeat(28, { loadG: 12_000, reps: 5 }) }],
  },
  {
    id: 's4',
    startedAt: '2026-09-28T08:00:00.000Z',
    exercises: [{ exerciseId: 'back-squat', sets: repeat(20, { loadG: 30_000, reps: 5 }) }],
  },
  {
    id: 's5',
    startedAt: '2026-09-29T08:00:00.000Z',
    exercises: [{ exerciseId: 'back-squat', sets: repeat(10, { loadG: 40_000, reps: 5 }) }],
  },
];

export async function seedSession(db: AppDb, s: SessionSpec): Promise<void> {
  const started = Date.parse(s.startedAt);
  await seedMirror(db, 'workout_session', [
    {
      id: s.id,
      ownerId: 'u-1',
      instanceId: null,
      workoutId: null,
      placeId: 'p-1',
      deviceId: 'dev-A',
      startedAt: s.startedAt,
      endedAt: new Date(started + 50 * 60_000).toISOString(),
      status: s.status ?? 'completed',
      weekType: 'normal',
      templateVersion: null,
      rulesVersion: '1',
      appVersion: 'test',
      profile: 'adult',
      note: null,
    },
  ]);
  await seedMirror(
    db,
    'performed_exercise',
    s.exercises.map((e, i) => ({
      id: `${s.id}-e${i + 1}`,
      ownerId: 'u-1',
      sessionId: s.id,
      slotId: null,
      plannedExerciseId: null,
      exerciseId: e.exerciseId,
      position: i + 1,
      swapReason: null,
      painLevel: null,
      nextAdjustment: null,
      note: null,
    })),
  );
  await seedMirror(
    db,
    'performed_set',
    s.exercises.flatMap((e, i) =>
      e.sets.map((set, j) => ({
        id: `${s.id}-e${i + 1}-s${j + 1}`,
        ownerId: 'u-1',
        performedExerciseId: `${s.id}-e${i + 1}`,
        kind: 'work',
        loadMode: 'barbell',
        loadG: null,
        reps: null,
        durationS: null,
        side: null,
        effort: null,
        targetRepsMin: null,
        targetRepsMax: null,
        targetDurationS: null,
        targetLoadG: null,
        targetRir: null,
        targetVariant: null,
        position: j + 1,
        loggedAt: s.startedAt,
        ...set,
      })),
    ),
  );
}

/** Base locale du membre u-1 : profil, Garage, catalogue d'essai et ces séances. */
export async function seedProgress(db: AppDb, sessions: SessionSpec[], sheets: unknown[] = SHEETS) {
  await seedTrainingProfile(db);
  await seedGarage(db);
  await seedCatalog(db, sheets);
  for (const s of sessions) await seedSession(db, s);
}
