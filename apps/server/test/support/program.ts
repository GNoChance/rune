import type {
  Effort,
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
import type { TestContext } from './context';
import { insertFixtureRow } from './factories';
import { seqIds } from './ids';
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
