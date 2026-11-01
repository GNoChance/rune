import type {
  Effort,
  ExerciseSheet,
  MovementPattern,
  NextAdjustment,
  PainLevel,
  ProgramTemplate,
  SessionProfile,
  SessionStatus,
  SetKind,
  SyncOp,
  WeekType,
} from '@rune/contracts';
import { grantConsent } from '../../src/privacy/consent';
import { sheetFixture } from './catalog';
import type { TestContext } from './context';
import { insertFixtureRow } from './factories';
import { seqIds } from './ids';
import { rebuild, seedSheet } from './review';
import { makeOp } from './sync-fixtures';

/*
 * Séances poussées par la synchro pour les tests du programme (spec brique 3 §5.3) : une instance insérée en base
 * avec son `snapshot`, et les opérations `create` d'une séance, de ses exercices et de ses séries.
 */

const ids = seqIds(9100);
/** UUIDv7 déterministe, comme ceux du téléphone. */
export const newId = (): string => ids.uuidv7();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 1er septembre 2026 à 17 h UTC : bien avant l'horloge des tests (6 octobre 2026, 10 h UTC). */
const T0 = Date.UTC(2026, 8, 1, 17);
/** Instant ISO `day` jours (et `hours` heures) après T0. */
export const dayAt = (day: number, hours = 0): string =>
  new Date(T0 + day * DAY + hours * HOUR).toISOString();

/** Inscription : instance active (ou `status`) dont le `snapshot` est `template`. Rend son identifiant. */
export async function enroll(
  ctx: TestContext,
  ownerId: string,
  template: ProgramTemplate,
  o: { status?: 'active' | 'ended'; revision?: number } = {},
): Promise<string> {
  const row = await insertFixtureRow(ctx.deps.db, 'program_instance', {
    ownerId,
    templateId: template.id,
    templateVersion: template.version,
    snapshot: JSON.stringify(template),
    status: o.status ?? 'active',
    revision: o.revision ?? 0,
    ...(o.status === 'ended' ? { endedAt: '2026-10-01T10:00:00.000Z' } : {}),
  });
  return row.id as string;
}

/** Consentement santé actif (texte 1.0). */
export async function grantHealth(ctx: TestContext, userId: string): Promise<void> {
  await grantConsent(ctx.deps.db, ctx.deps, userId, 'health', '1.0', null);
}

export interface SetSpec {
  kind?: SetKind;
  loadG?: number | null;
  reps?: number | null;
  durationS?: number | null;
  effort?: Effort | null;
  /** Série faite (`logged_at` renseigné) ; vrai par défaut. */
  logged?: boolean;
}

export interface ExerciseSpec {
  slotId?: string | null;
  exerciseId?: string;
  position?: number;
  painLevel?: PainLevel | null;
  nextAdjustment?: NextAdjustment | null;
  /** Séries ; par défaut 3 × 10 à 20 kg, effort `ok` sur la dernière. */
  sets?: SetSpec[];
}

export interface SessionSpec {
  id?: string;
  instanceId?: string | null;
  workoutId?: string | null;
  placeId?: string | null;
  startedAt?: string;
  /** Par défaut une heure après le début. */
  endedAt?: string | null;
  status?: SessionStatus;
  weekType?: WeekType;
  profile?: SessionProfile;
  rulesVersion?: string;
  exercises?: ExerciseSpec[];
}

const DEFAULT_SETS: SetSpec[] = [{}, {}, { effort: 'ok' }];

/** Opérations `create` d'une séance entière, parents d'abord ; identifiants rendus pour les assertions. */
export function sessionOps(
  userId: string,
  s: SessionSpec = {},
): { ops: SyncOp[]; sessionId: string; exerciseIds: string[]; setIds: string[][] } {
  const sessionId = s.id ?? newId();
  const startedAt = s.startedAt ?? dayAt(0);
  const endedAt = s.endedAt === undefined ? new Date(Date.parse(startedAt) + HOUR).toISOString() : s.endedAt;
  const ops: SyncOp[] = [
    makeOp({
      userId,
      entity: 'workout_session',
      id: sessionId,
      kind: 'create',
      fields: {
        instanceId: s.instanceId ?? null,
        workoutId: s.workoutId === undefined ? 'A' : s.workoutId,
        placeId: s.placeId ?? null,
        deviceId: 'device-1',
        startedAt,
        endedAt,
        status: s.status ?? 'completed',
        weekType: s.weekType ?? 'normal',
        templateVersion: 1,
        rulesVersion: s.rulesVersion ?? '1',
        appVersion: '0.3.0',
        profile: s.profile ?? 'adult',
      },
    }),
  ];
  const exerciseIds: string[] = [];
  const setIds: string[][] = [];
  for (const [i, e] of (s.exercises ?? []).entries()) {
    const exerciseId = newId();
    exerciseIds.push(exerciseId);
    const fields: Record<string, unknown> = {
      sessionId,
      slotId: e.slotId === undefined ? `A${i + 1}` : e.slotId,
      plannedExerciseId: e.exerciseId ?? 'goblet-squat',
      exerciseId: e.exerciseId ?? 'goblet-squat',
      position: e.position ?? i + 1,
    };
    if (e.painLevel !== undefined) fields.painLevel = e.painLevel;
    if (e.nextAdjustment !== undefined) fields.nextAdjustment = e.nextAdjustment;
    ops.push(makeOp({ userId, entity: 'performed_exercise', id: exerciseId, kind: 'create', fields }));
    const ids: string[] = [];
    for (const [j, set] of (e.sets ?? DEFAULT_SETS).entries()) {
      const setId = newId();
      ids.push(setId);
      ops.push(
        makeOp({
          userId,
          entity: 'performed_set',
          id: setId,
          kind: 'create',
          fields: {
            performedExerciseId: exerciseId,
            position: j + 1,
            kind: set.kind ?? 'work',
            loadMode: 'dumbbell',
            loadG: set.loadG === undefined ? 20_000 : set.loadG,
            reps: set.reps === undefined ? (set.durationS == null ? 10 : null) : set.reps,
            durationS: set.durationS ?? null,
            effort: set.effort ?? null,
            loggedAt: set.logged === false ? null : startedAt,
          },
        }),
      );
    }
    setIds.push(ids);
  }
  return { ops, sessionId, exerciseIds, setIds };
}

// ---------------------------------------------------------------------------------------------------------------
// API du programme (spec brique 3 §6)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Fiches publiées du modèle `programTemplate` : une par groupe de couverture (05 §5, règle 4), dont un tirage à la
 * machine (pas de machine), plus une presse à cuisses pour les remplacements.
 */
export const PROGRAM_SHEETS: readonly ExerciseSheet[] = [
  sheetFixture('goblet-squat'),
  sheetFixture('dumbbell-romanian-deadlift', {
    movement_pattern: 'hip_hinge',
    primary_muscles: ['hamstrings', 'glutes'],
    secondary_muscles: ['lower_back'],
    equipment_options: [['dumbbells']],
  }),
  sheetFixture('dumbbell-bench-press', {
    movement_pattern: 'horizontal_push',
    primary_muscles: ['chest', 'triceps'],
    secondary_muscles: ['front_delts'],
    equipment_options: [['dumbbells', 'flat_bench']],
  }),
  sheetFixture('seated-cable-row', {
    movement_pattern: 'horizontal_pull',
    primary_muscles: ['lats'],
    secondary_muscles: ['rear_delts', 'biceps'],
    equipment_options: [['seated_row']],
    load_mode: 'machine',
  }),
  sheetFixture('dead-bug', {
    movement_pattern: 'core_anti_extension',
    mechanics: 'isolation',
    primary_muscles: ['abs'],
    secondary_muscles: [],
    equipment_options: [[]],
    load_mode: 'bodyweight',
  }),
  sheetFixture('leg-press', { equipment_options: [['leg_press']], load_mode: 'machine' }),
];

const work = { kind: 'work', count: 3, reps: { min: 8, max: 12 }, targetRir: 2, restS: 120 } as const;

/**
 * Modèle de salle, débutant, une séance `A` qui couvre les 5 groupes : A1 squat, A2 charnière, A3 poussée, A4 tirage
 * à la machine (progression linéaire), A5 gainage. `days` : jours permis, 2 à 3 (3 par défaut) sinon.
 */
export function programTemplate(
  id = 'test-program',
  o: { version?: number; days?: { min: number; max: number; default: number }; exercises?: string[] } = {},
): ProgramTemplate {
  const slot = (n: number, movementPattern: MovementPattern, exercise: string) => ({
    id: `A${n}`,
    movementPattern,
    role: n <= 2 ? ('main' as const) : ('secondary' as const),
    exercises: [o.exercises?.[n - 1] ?? exercise],
    sets: [{ ...work, reps: { ...work.reps } }],
    progression: n === 4 ? { type: 'linear' as const, incrementG: 5000 } : { type: 'double' as const },
  });
  return {
    schemaVersion: 1,
    id,
    version: o.version ?? 1,
    name: `Modèle ${id}`,
    description: 'Modèle de test.',
    context: 'gym',
    level: 'beginner',
    daysPerWeek: o.days ?? { min: 2, max: 3, default: 3 },
    estimatedMinutes: 45,
    block: { mode: 'reactive' },
    workouts: [
      {
        id: 'A',
        name: 'Séance A',
        slots: [
          slot(1, 'squat', 'goblet-squat'),
          slot(2, 'hip_hinge', 'dumbbell-romanian-deadlift'),
          slot(3, 'horizontal_push', 'dumbbell-bench-press'),
          slot(4, 'horizontal_pull', 'seated-cable-row'),
          slot(5, 'core_anti_extension', 'dead-bug'),
        ],
      },
    ],
  };
}

/** Fiches de `PROGRAM_SHEETS` en base, puis bloc servi reconstruit avec `templates` (comme le chargeur). */
export async function seedProgramCatalog(
  ctx: TestContext,
  templates: readonly ProgramTemplate[],
): Promise<void> {
  for (const sheet of PROGRAM_SHEETS) await seedSheet(ctx, sheet);
  await rebuild(ctx, templates);
}
