import type { ProgramTemplate } from '@rune/contracts';
import type { AppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { seedCatalog, seedTrainingProfile } from '../support/catalog';
import { createTestLocalDb } from '../support/local-db';
import { seedMirror } from '../support/seed';
import { WORKOUT_SHEETS } from '../support/workout';

export const LOAD_SETTINGS = {
  barG: 20_000,
  smallestPlateG: 1250,
  dumbbellsG: [10_000, 12_000, 14_000, 16_000],
  machineStepG: 5000,
};

const slot = (id: string, exercise: string, movementPattern: 'squat' | 'lunge') => ({
  id,
  movementPattern,
  role: 'main' as const,
  exercises: [exercise],
  sets: [{ kind: 'work' as const, count: 3, reps: { min: 8, max: 12 }, targetRir: 2, restS: 120 }],
  progression: { type: 'double' as const },
});

export const TEMPLATE: ProgramTemplate = {
  schemaVersion: 1,
  id: 'test-full-body',
  version: 1,
  name: 'Corps entier',
  description: 'Modèle de test.',
  context: 'home',
  level: 'beginner',
  daysPerWeek: { min: 2, max: 3, default: 3 },
  estimatedMinutes: 45,
  block: { mode: 'reactive' },
  workouts: [
    { id: 'A', name: 'Séance A', slots: [slot('A1', 'goblet-squat', 'squat')] },
    { id: 'B', name: 'Séance B', slots: [slot('B1', 'dumbbell-lunge', 'lunge')] },
    { id: 'C', name: 'Séance C', slots: [slot('C1', 'leg-press', 'squat')] },
  ],
};

/** Base locale d'un membre u-1 avec catalogue, profil, lieux (Garage principal, Salle) et appareil `dev-A`. */
export async function seedBase(o: { template?: ProgramTemplate | null } = {}): Promise<AppDb> {
  const db = createTestLocalDb();
  await setMeta(db, 'deviceId', 'dev-A');
  await seedCatalog(db, WORKOUT_SHEETS);
  await seedTrainingProfile(db);
  await seedMirror(db, 'place', [
    {
      id: 'p-1',
      ownerId: 'u-1',
      kind: 'home',
      gymId: null,
      name: 'Garage',
      isPrimary: true,
      visibleAtGym: null,
      loadSettings: LOAD_SETTINGS,
    },
    {
      id: 'p-2',
      ownerId: 'u-1',
      kind: 'home',
      gymId: null,
      name: 'Salon',
      isPrimary: false,
      visibleAtGym: null,
      loadSettings: LOAD_SETTINGS,
    },
  ]);
  await seedMirror(db, 'home_equipment', [
    { id: 'p-1:dumbbells', ownerId: 'u-1', placeId: 'p-1', equipmentCode: 'dumbbells' },
    { id: 'p-2:dumbbells', ownerId: 'u-1', placeId: 'p-2', equipmentCode: 'dumbbells' },
  ]);
  const template = o.template === undefined ? TEMPLATE : o.template;
  if (template) {
    await db.table('programTemplates').put({ id: template.id, template, available: true });
    await seedMirror(db, 'program_instance', [
      {
        id: 'i-1',
        ownerId: 'u-1',
        templateId: template.id,
        templateVersion: template.version,
        snapshot: template,
        daysPerWeek: 3,
        status: 'active',
        revision: 1,
        startedAt: '2026-09-01T08:00:00.000Z',
        endedAt: null,
        createdAt: '2026-09-01T08:00:00.000Z',
      },
    ]);
  }
  return db;
}

/** Séance du miroir : terminée (séance A à 12 kg), ou en cours sur l'appareil `deviceId`. */
export async function seedSession(
  db: AppDb,
  o: { id: string; status: 'completed' | 'in_progress'; deviceId: string; startedAt: string },
): Promise<void> {
  if (o.status === 'in_progress' && o.deviceId === 'dev-A') await setMeta(db, 'activeSessionId', o.id);
  await seedMirror(db, 'workout_session', [
    {
      id: o.id,
      ownerId: 'u-1',
      instanceId: 'i-1',
      workoutId: 'A',
      placeId: 'p-1',
      deviceId: o.deviceId,
      startedAt: o.startedAt,
      endedAt: o.status === 'completed' ? o.startedAt : null,
      status: o.status,
      weekType: 'normal',
      templateVersion: 1,
      rulesVersion: '1',
      appVersion: 'dev',
      profile: 'adult',
      note: null,
    },
  ]);
  await seedMirror(db, 'performed_exercise', [
    {
      id: `${o.id}-pe`,
      ownerId: 'u-1',
      sessionId: o.id,
      slotId: 'A1',
      plannedExerciseId: 'goblet-squat',
      exerciseId: 'goblet-squat',
      swapReason: null,
      position: 1,
      painLevel: null,
      nextAdjustment: null,
      note: null,
    },
  ]);
  if (o.status === 'completed') {
    await seedMirror(
      db,
      'performed_set',
      [1, 2, 3].map((position) => ({
        id: `${o.id}-set-${position}`,
        ownerId: 'u-1',
        performedExerciseId: `${o.id}-pe`,
        position,
        kind: 'work',
        loadMode: 'dumbbell',
        loadG: 12_000,
        reps: 12,
        durationS: null,
        side: null,
        effort: position === 3 ? 'ok' : null,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetDurationS: null,
        targetLoadG: null,
        targetRir: 2,
        targetVariant: null,
        loggedAt: o.startedAt,
      })),
    );
  }
}
