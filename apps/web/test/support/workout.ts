import type { ServedSheet } from '@rune/contracts';
import type { PlannedExercise, PlannedSet, PlannedWorkout } from '@rune/domain';
import type { AppDb } from '../../src/local-db/db';
import { served } from './catalog';
import { seedMirror } from './seed';

const planned = (o: Pick<PlannedSet, 'kind' | 'position'> & Partial<PlannedSet>): PlannedSet => ({
  side: null,
  targetRepsMin: null,
  targetRepsMax: null,
  targetDurationS: null,
  targetLoadG: null,
  targetRir: null,
  targetVariant: null,
  ...o,
});

/** Squat barre : un échauffement à 30 kg, puis 3 × 6 à 60 kg, RIR 2. */
export const SQUAT: PlannedExercise = {
  slotId: 'A1',
  plannedExerciseId: 'back-squat',
  exerciseId: 'back-squat',
  resolution: 'planned',
  loadMode: 'barbell',
  measure: 'reps',
  unilateral: false,
  sets: [
    planned({ kind: 'warmup', position: 1, targetRepsMin: 8, targetRepsMax: 8, targetLoadG: 30_000 }),
    ...[1, 2, 3].map((position) =>
      planned({
        kind: 'work',
        position,
        targetRepsMin: 6,
        targetRepsMax: 6,
        targetLoadG: 60_000,
        targetRir: 2,
      }),
    ),
  ],
  restS: 180,
  platesPerSide: [20_000],
  calibration: false,
  suggestionG: null,
};

/** Fente aux haltères, unilatérale : 2 séries de 8 à 12, gauche puis droite, 14 kg par main. */
export const LUNGE: PlannedExercise = {
  slotId: 'A2',
  plannedExerciseId: 'dumbbell-lunge',
  exerciseId: 'dumbbell-lunge',
  resolution: 'planned',
  loadMode: 'dumbbell',
  measure: 'reps',
  unilateral: true,
  sets: [1, 2].flatMap((position) =>
    (['left', 'right'] as const).map((side) =>
      planned({
        kind: 'work',
        position,
        side,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetLoadG: 14_000,
        targetRir: 2,
      }),
    ),
  ),
  restS: 90,
  platesPerSide: null,
  calibration: false,
  suggestionG: null,
};

/** Slot sauté (rien de faisable ici) : aucune ligne n'est créée. */
export const SKIPPED: PlannedExercise = {
  slotId: 'A3',
  plannedExerciseId: 'nordic-curl',
  exerciseId: null,
  resolution: 'not_feasible_here',
  loadMode: null,
  measure: 'reps',
  unilateral: false,
  sets: [],
  restS: 90,
  platesPerSide: null,
  calibration: false,
  suggestionG: null,
};

/** Séance A : 1 séance + 2 exercices + 8 séries = 11 lignes. */
export const PLAN: PlannedWorkout = {
  workoutId: 'A',
  weekType: 'normal',
  rulesVersion: '1',
  notices: [],
  exercises: [SQUAT, LUNGE, SKIPPED],
};

export const PLAN_ROWS = 11;

/** Fiches du plan, plus deux remplaçants (goblet bilatéral, fente bulgare unilatérale) et une chaîne de pompes. */
export const WORKOUT_SHEETS: ServedSheet[] = [
  served({ id: 'back-squat', name: 'Squat barre', load_mode: 'barbell', equipment_options: [['barbell']] }),
  served({
    id: 'dumbbell-lunge',
    name: 'Fente aux haltères',
    movement_pattern: 'lunge',
    unilateral: true,
    load_mode: 'dumbbell',
  }),
  served({ id: 'goblet-squat', name: 'Squat goblet', load_mode: 'dumbbell' }),
  served({
    id: 'bulgarian-split-squat',
    name: 'Squat bulgare',
    movement_pattern: 'lunge',
    unilateral: true,
    load_mode: 'dumbbell',
  }),
  served({
    id: 'bodyweight-squat',
    name: 'Squat au poids du corps',
    load_mode: 'bodyweight',
    equipment_options: [[]],
  }),
  served({
    id: 'leg-press',
    name: 'Presse à cuisses',
    load_mode: 'machine',
    equipment_options: [['leg_press']],
  }),
];

/**
 * Événement de consentement santé du miroir : avec `meta.me` (posé par l'appelant), un `grant` fait l'accord actif
 * dans le cache ; un `revoke`, plus récent, le retire.
 */
export async function seedHealthConsent(db: AppDb, action: 'grant' | 'revoke' = 'grant'): Promise<void> {
  await seedMirror(db, 'consent_event', [
    {
      id: `ce-${action}`,
      ownerId: 'u-1',
      type: 'health',
      action,
      textVersion: 'v1',
      createdAt: action === 'grant' ? '2026-10-01T10:00:00.000Z' : '2026-10-02T10:00:00.000Z',
    },
  ]);
}
