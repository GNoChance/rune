/*
 * Propriétés de `changePreview` (spec brique 4 §12.2 étape 6, choix C6), sur des historiques de salle et des suites
 * de 1 à 3 opérations du coach tirés au hasard, sur les slots et les fiches de la fixture :
 * - un changement du coach accepté par `validateChange` et sans hausse selon `loadIncreases` ne fait monter aucune
 *   charge de travail du plan recalculé sans l'aperçu (`effectiveProgram`, `replayInstance`, `planWorkout`) ;
 * - `changePreview` ne lève jamais et rend deux fois la même sortie.
 */
import {
  CoachOperationSchema,
  type Effort,
  type InstanceChangeOperation,
  type LoadMode,
  type ServedProgramTemplate,
  type SessionProfile,
  type SlotSpec,
} from '@rune/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parisDate } from '../../src/age';
import { feasible } from '../../src/catalog/equipment';
import type { CatalogSheet } from '../../src/catalog/usable';
import { effectiveProgram } from '../../src/program/effective';
import { type PlanInput, planWorkout } from '../../src/program/plan';
import {
  type ChangePreviewInput,
  changePreview,
  lastLoadsOf,
  loadIncreases,
  type SlotLoadPreview,
} from '../../src/program/preview';
import { type ReplayInput, replayInstance } from '../../src/program/replay';
import type { PlanSheet } from '../../src/program/resolve';
import type { AcceptedChange, ExerciseRecord, SessionRecord, SetRecord } from '../../src/program/types';
import { validateChange } from '../../src/program/validate-change';
import { GYM_AB, gymAb, PLACES, PROGRAM_CATALOG } from '../fixtures/program';

const fail = (what: string): never => {
  throw new Error(`${what} absent`);
};

const INSTANCE = 'inst-p';
const CHANGE = 'chg-p';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Lundi 2 novembre 2026, 18 h à Paris (UTC+1). */
const T0 = Date.UTC(2026, 10, 2, 17);
const RUNS = { numRuns: 100 };

/** Catalogue des programmes avec sa mesure : les gainages se tiennent en secondes, le reste se compte en répétitions. */
const CATALOG: PlanSheet[] = PROGRAM_CATALOG.map((s) => ({
  ...s,
  measure: s.movement_pattern === 'core_anti_extension' ? 'duration' : 'reps',
}));
const GYM = PLACES.find((p) => p.id === 'gym') ?? fail('lieu gym');
const PLACE_MAP = new Map(PLACES.map((p) => [p.id, p]));
const SLOTS = GYM_AB.workouts.flatMap((w) => w.slots);
const SLOT_IDS = SLOTS.map((s) => s.id);
const SHEET_IDS = PROGRAM_CATALOG.map((s) => s.id);
const PATTERNS = [...new Set(PROGRAM_CATALOG.map((s) => s.movement_pattern))];
const sheetsOf = (pattern: string) =>
  PROGRAM_CATALOG.filter((s) => s.movement_pattern === pattern).map((s) => s.id);
const patternOf = (slotId: string) => SLOTS.find((s) => s.id === slotId)?.movementPattern ?? fail(slotId);

const SERVED: ServedProgramTemplate[] = [
  { template: GYM_AB, available: true },
  {
    template: gymAb((t) => {
      t.id = 'gym-other';
    }),
    available: true,
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Historiques : séances de salle, chaque slot fait avec l'une de ses fiches (« Changer d'exercice » compris)
// ---------------------------------------------------------------------------------------------------------------

const weighted = <T>(...entries: [T, number][]) =>
  fc.oneof(...entries.map(([v, weight]) => ({ arbitrary: fc.constant(v), weight })));

/** `pick` : rang de la fiche faite dans le slot, la tête de liste ou une autre (« Changer d'exercice »). */
const arbDone = fc.record({
  skipped: weighted<boolean>([false, 4], [true, 1]),
  pick: weighted<number>([0, 2], [1, 2], [2, 2], [3, 1]),
  load: fc.nat({ max: 3 }),
  effort: weighted<Effort>(['ok', 3], ['easy', 1], ['hard', 1]),
});
type DoneSeed = typeof arbDone extends fc.Arbitrary<infer T> ? T : never;

const arbSession = fc.record({
  workoutId: fc.constantFrom('A', 'B'),
  gapDays: fc.integer({ min: 1, max: 3 }),
  done: fc.array(arbDone, { minLength: 5, maxLength: 5 }),
});

const arbHistory = fc.record({
  profile: weighted<SessionProfile>(['adult', 4], ['cautious', 1]),
  sessions: fc.array(arbSession, { maxLength: 8 }),
});
type HistorySeed = typeof arbHistory extends fc.Arbitrary<infer T> ? T : never;

/** Fiches faisables à la salle d'un slot, dans l'ordre : sa liste, ou les variantes de sa chaîne. */
function sheetsFor(slot: SlotSpec): CatalogSheet[] {
  const sheets =
    slot.chain === undefined
      ? (slot.exercises ?? []).map((id) => PROGRAM_CATALOG.find((s) => s.id === id) ?? fail(`fiche ${id}`))
      : PROGRAM_CATALOG.filter((s) => s.chain_id === slot.chain);
  return sheets.filter((s) => feasible(s, GYM.equipment));
}

/** Charges faites par mode de charge, sur les grilles par défaut de la salle. */
function loadsFor(mode: LoadMode): readonly (number | null)[] {
  switch (mode) {
    case 'barbell':
    case 'machine':
      return [30_000, 45_000, 60_000, 75_000];
    case 'dumbbell':
      return [10_000, 20_000, 30_000, 40_000];
    default:
      return [null];
  }
}

function performed(slot: SlotSpec, seed: DoneSeed, sessionId: string, startedAt: number, position: number) {
  const choices = sheetsFor(slot);
  const sheet = choices[seed.pick % choices.length];
  if (seed.skipped || sheet === undefined) return null;
  const spec = slot.sets.find((s) => s.kind === 'work');
  const duration = spec?.durationS !== undefined;
  const loadG = loadsFor(sheet.load_mode)[seed.load] ?? null;
  const sets = [1, 2, 3].map(
    (n): SetRecord => ({
      id: `${sessionId}-${slot.id}-${n}`,
      position: n,
      kind: 'work',
      loadMode: sheet.load_mode,
      loadG,
      reps: duration ? null : (spec?.reps?.max ?? 8),
      durationS: duration ? 30 : null,
      side: null,
      effort: n === 3 ? seed.effort : null,
      targetRepsMin: null,
      targetRepsMax: null,
      targetReps: null,
      targetDurationS: null,
      targetLoadG: null,
      targetRir: null,
      targetVariant: null,
      loggedAt: startedAt + (position * 3 + n) * 60_000,
    }),
  );
  const exercise: ExerciseRecord = {
    id: `${sessionId}-${slot.id}`,
    slotId: slot.id,
    plannedExerciseId: sheet.id,
    exerciseId: sheet.id,
    position,
    swapReason: null,
    painLevel: null,
    nextAdjustment: null,
    sets,
  };
  return exercise;
}

function sessionsOf(h: HistorySeed): SessionRecord[] {
  let startedAt = T0;
  return h.sessions.map((seed, i) => {
    startedAt += seed.gapDays * DAY;
    const id = `s-${i}`;
    const slots = GYM_AB.workouts.find((w) => w.id === seed.workoutId)?.slots ?? [];
    const exercises = slots.flatMap((slot, k) => {
      const e = performed(slot, seed.done[k] ?? fail(`graine ${k}`), id, startedAt, k + 1);
      return e === null ? [] : [e];
    });
    return {
      id,
      instanceId: INSTANCE,
      workoutId: seed.workoutId,
      placeId: 'gym',
      startedAt,
      endedAt: startedAt + HOUR,
      status: 'completed',
      weekType: 'normal',
      profile: h.profile,
      rulesVersion: '1',
      exercises,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Opérations du coach, dans les bornes de `CoachOperationSchema`
// ---------------------------------------------------------------------------------------------------------------

const arbSlot = fc.constantFrom(...SLOT_IDS);

/** Une génération par opération ouverte au coach (le premier test vérifie qu'il n'en manque aucune). */
const OPERATIONS: Readonly<Record<string, fc.Arbitrary<InstanceChangeOperation>>> = {
  replace_exercise: arbSlot.chain((slot) =>
    fc
      .oneof(
        { arbitrary: fc.constantFrom(...sheetsOf(patternOf(slot))), weight: 4 },
        { arbitrary: fc.constantFrom(...SHEET_IDS), weight: 1 },
      )
      .map((exercise) => ({ op: 'replace_exercise', slot, exercise }) as const),
  ),
  change_sets: fc
    .tuple(arbSlot, fc.constantFrom<-1 | 1>(-1, 1))
    .map(([slot, delta]) => ({ op: 'change_sets', slot, delta }) as const),
  set_rep_range: fc
    .tuple(arbSlot, fc.integer({ min: 3, max: 15 }), fc.integer({ min: 0, max: 10 }))
    .map(([slot, min, gap]) => ({ op: 'set_rep_range', slot, min, max: min + gap }) as const),
  set_target_rir: fc
    .tuple(arbSlot, fc.integer({ min: 0, max: 5 }))
    .map(([slot, value]) => ({ op: 'set_target_rir', slot, value }) as const),
  set_rest: fc
    .tuple(arbSlot, fc.constantFrom(30, 60, 90, 120, 180, 300))
    .map(([slot, seconds]) => ({ op: 'set_rest', slot, seconds }) as const),
  lighten_exercise: arbSlot.map((slot) => ({ op: 'lighten_exercise', slot }) as const),
  start_deload: fc.constant({ op: 'start_deload' } as const),
  suspend_slot: arbSlot.map((slot) => ({ op: 'suspend_slot', slot }) as const),
  remove_slot: arbSlot.map((slot) => ({ op: 'remove_slot', slot }) as const),
  add_slot: fc
    .tuple(fc.constantFrom('A', 'B'), fc.constantFrom(...PATTERNS))
    .chain(([workout, movementPattern]) =>
      fc
        .subarray(sheetsOf(movementPattern), { minLength: 1 })
        .map((exercises) => ({ op: 'add_slot', workout, movementPattern, exercises }) as const),
    ),
  set_days_per_week: fc
    .integer({ min: 1, max: 7 })
    .map((days) => ({ op: 'set_days_per_week', days }) as const),
  switch_template: fc.record(
    {
      op: fc.constant('switch_template' as const),
      templateId: fc.constantFrom(...SERVED.map((s) => s.template.id)),
      daysPerWeek: fc.integer({ min: 1, max: 7 }),
    },
    { requiredKeys: ['op', 'templateId'] },
  ),
};

const headOf = (slotId: string) => SLOTS.find((s) => s.id === slotId)?.exercises?.[0];

/**
 * Suite d'opérations pour un historique. En plus des générations par opération, `replace_exercise` vise souvent une
 * fiche déjà faite dans le slot, autre que sa tête de liste : un retour à une charge peut-être plus lourde, le cas
 * que la garde arrête.
 */
function arbOperationsFor(history: HistorySeed): fc.Arbitrary<InstanceChangeOperation[]> {
  const pairs = sessionsOf(history).flatMap((s) =>
    s.exercises.flatMap((e) =>
      e.slotId === null || e.exerciseId === headOf(e.slotId) ? [] : [`${e.slotId}|${e.exerciseId}`],
    ),
  );
  const back = [...new Set(pairs)].map((pair) => {
    const [slot = '', exercise = ''] = pair.split('|');
    return { op: 'replace_exercise', slot, exercise } as const;
  });
  const arbBack = back.length === 0 ? [] : [{ arbitrary: fc.constantFrom(...back), weight: 16 }];
  return fc.array(fc.oneof(...Object.values(OPERATIONS), ...arbBack), { minLength: 1, maxLength: 3 });
}

const arbCase = arbHistory.chain((history) =>
  arbOperationsFor(history).map((operations) => ({ history, operations })),
);
type Case = typeof arbCase extends fc.Arbitrary<infer T> ? T : never;

// ---------------------------------------------------------------------------------------------------------------
// Aperçu, validation et plan recalculé
// ---------------------------------------------------------------------------------------------------------------

interface Built {
  replay: ReplayInput;
  plan: Omit<PlanInput, 'replay' | 'workoutId'>;
  decidedAt: number;
  profile: SessionProfile;
  operations: InstanceChangeOperation[];
}

function build(c: Case): Built {
  const sessions = sessionsOf(c.history);
  const last = sessions.at(-1)?.startedAt ?? T0;
  const { profile } = c.history;
  return {
    replay: {
      instance: { id: INSTANCE, snapshot: GYM_AB, daysPerWeek: 3, startedAt: T0 },
      sessions,
      changes: [],
      catalog: CATALOG,
      places: PLACE_MAP,
      overrides: new Map(),
    },
    plan: {
      place: GYM,
      catalog: CATALOG,
      profile,
      ageBand: profile === 'cautious' ? 'minor' : 'adult',
      context: 'gym',
      today: parisDate(new Date(last + 2 * DAY)),
      lastLoadByExercise: lastLoadsOf(sessions),
      maxLevel: 2,
    },
    decidedAt: last + DAY,
    profile,
    operations: c.operations,
  };
}

const previewInput = (b: Built): ChangePreviewInput => ({
  replay: b.replay,
  change: { id: CHANGE, author: 'coach', operations: b.operations },
  decidedAt: b.decidedAt,
  plan: b.plan,
});

const acceptedByValidator = (b: Built): boolean =>
  validateChange({
    program: effectiveProgram(b.replay.instance.snapshot, b.replay.instance.daysPerWeek, b.replay.changes),
    revision: 0,
    change: { id: CHANGE, author: 'coach', baseRevision: 0, operations: b.operations },
    catalog: PROGRAM_CATALOG,
    places: PLACES,
    profile: b.profile,
    level: 'beginner',
    servedTemplates: SERVED,
    instanceTemplateVersion: 1,
  }).ok;

/** Charges de travail prévues de chaque slot, toutes séances du programme, calculées sans l'aperçu. */
function workLoads(b: Built, changes: readonly AcceptedChange[]): Map<string, number[]> {
  const { snapshot, daysPerWeek } = b.replay.instance;
  const replay = replayInstance({ ...b.replay, changes });
  const loads = new Map<string, number[]>();
  for (const workout of effectiveProgram(snapshot, daysPerWeek, changes).template.workouts) {
    for (const e of planWorkout({ ...b.plan, replay, workoutId: workout.id }).exercises) {
      const work = e.sets.flatMap((s) =>
        s.kind === 'work' && s.targetLoadG !== null ? [s.targetLoadG] : [],
      );
      loads.set(e.slotId, work);
    }
  }
  return loads;
}

type Verdict = 'refused' | 'increase' | 'passed';

/** Aperçu (deux fois, comparés) et verdict du gestionnaire : validateur, puis garde de hausse. */
function judge(b: Built): { previews: SlotLoadPreview[]; verdict: Verdict } {
  const previews = changePreview(previewInput(b));
  expect(changePreview(previewInput(b))).toEqual(previews);
  if (!acceptedByValidator(b)) return { previews, verdict: 'refused' };
  return { previews, verdict: loadIncreases(previews).length > 0 ? 'increase' : 'passed' };
}

describe('changePreview : propriétés de la garde de hausse', () => {
  it('chaque opération ouverte au coach a sa génération, et rien d’autre', () => {
    expect(Object.keys(OPERATIONS).sort()).toEqual(
      CoachOperationSchema.options.map((o) => o.shape.op.value).sort(),
    );
  });

  it('accepté et sans hausse selon l’aperçu : aucune charge de travail recalculée au-dessus de celle d’avant', () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        for (const op of c.operations) expect(CoachOperationSchema.safeParse(op).success, op.op).toBe(true);
        const b = build(c);
        if (judge(b).verdict !== 'passed') return;
        // `switch_template` termine l'instance : la suivante part en calibration, il n'y a pas de séance d'après.
        if (b.operations.some((op) => op.op === 'switch_template')) return;
        const change: AcceptedChange = {
          id: CHANGE,
          author: 'coach',
          reasonCode: 'COACH_PROPOSAL',
          decidedAt: b.decidedAt,
          operations: b.operations,
        };
        const before = workLoads(b, []);
        for (const [slotId, after] of workLoads(b, [change])) {
          const was = before.get(slotId) ?? [];
          if (after.length === 0 || was.length === 0) continue;
          expect(Math.max(...after), slotId).toBeLessThanOrEqual(Math.min(...was));
        }
      }),
      RUNS,
    );
  });

  it('les cas tirés sont refusés par le validateur, arrêtés par la garde ou acceptés', () => {
    const seen: Record<Verdict, number> = { refused: 0, increase: 0, passed: 0 };
    fc.assert(
      fc.property(arbCase, (c) => {
        seen[judge(build(c)).verdict] += 1;
      }),
      { numRuns: 200, seed: 20261103 },
    );
    expect(seen.refused).toBeGreaterThan(0);
    expect(seen.increase).toBeGreaterThan(0);
    expect(seen.passed).toBeGreaterThan(0);
  });
});
