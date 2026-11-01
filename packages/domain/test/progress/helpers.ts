import type { LoadMode } from '@rune/contracts';
import type { CatalogSheet } from '../../src/catalog/usable';
import type { ExerciseRecord, SessionRecord, SetRecord } from '../../src/program/types';

let n = 0;
export const wset = (over: Partial<SetRecord> = {}): SetRecord => ({
  id: `s${++n}`,
  position: n,
  kind: 'work',
  loadMode: 'barbell',
  loadG: 60000,
  reps: 8,
  durationS: null,
  side: null,
  effort: null,
  targetRepsMin: null,
  targetRepsMax: null,
  targetDurationS: null,
  targetLoadG: null,
  targetRir: null,
  targetVariant: null,
  loggedAt: 1000,
  ...over,
});

export const sets = (count: number, over: Partial<SetRecord> = {}): SetRecord[] =>
  Array.from({ length: count }, () => wset(over));

export const ex = (exerciseId: string, s: SetRecord[]): ExerciseRecord => ({
  id: `e${++n}`,
  slotId: null,
  plannedExerciseId: null,
  exerciseId,
  position: 1,
  swapReason: null,
  painLevel: null,
  nextAdjustment: null,
  sets: s,
});

export const session = (exercises: ExerciseRecord[], over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: `S${++n}`,
  instanceId: null,
  workoutId: null,
  placeId: null,
  startedAt: Date.UTC(2026, 0, 5, 10),
  endedAt: null,
  status: 'completed',
  weekType: 'normal',
  profile: 'adult',
  rulesVersion: '1',
  exercises,
  ...over,
});

export const sheet = (
  id: string,
  primary: CatalogSheet['primary_muscles'],
  secondary: CatalogSheet['secondary_muscles'] = [],
  loadMode: LoadMode = 'barbell',
): CatalogSheet =>
  ({
    id,
    status: 'published',
    level: 'beginner',
    not_for_minors: false,
    equipment_options: [],
    movement_pattern: 'push',
    primary_muscles: primary,
    secondary_muscles: secondary,
    unilateral: false,
    load_mode: loadMode,
    chain_id: null,
    easier_id: null,
    harder_id: null,
  }) as unknown as CatalogSheet;
