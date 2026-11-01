/*
 * Propriétés de `evaluateExercise` (spec brique 3 §10.2, 05 §17.2), sur des historiques tirés au hasard : chaque
 * historique est rejoué séance par séance, puis la dernière évaluation est contrôlée.
 */
import {
  defaultLoadSettings,
  type Effort,
  type ExerciseSheet,
  type NextAdjustment,
  type PainLevel,
  type SessionProfile,
  type SetSpec,
  type SlotSpec,
  type WeekType,
} from '@rune/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type EngineState, type EvaluateInput, evaluateExercise } from '../../src/program/evaluate';
import { type LoadGrid, loadGrid, next } from '../../src/program/loads';
import { rulesFor } from '../../src/program/rules';
import type { SetRecord } from '../../src/program/types';
import { linkChain, PUSH_UP_CHAIN, sheet } from '../fixtures/catalog';

const fail = (): never => {
  throw new Error('règles 1 absentes');
};
const rules = rulesFor('1') ?? fail();

const gym = defaultLoadSettings('gym');
const BAR = loadGrid('barbell', gym);
const DUMBBELLS = loadGrid('dumbbell', gym);
const MACHINE_10 = loadGrid('machine', { ...gym, machineStepG: 10000 });
const NONE = loadGrid('bodyweight', gym);

const work = (o: Partial<SetSpec>): SetSpec => ({ kind: 'work', count: 3, targetRir: 2, restS: 120, ...o });
const slot = (sets: SetSpec[], progression: SlotSpec['progression'], chain?: string): SlotSpec => ({
  id: 'S1',
  movementPattern: 'squat',
  role: 'main',
  ...(chain === undefined ? { exercises: ['x'] } : { chain }),
  sets,
  progression,
});
const range = (from: number, to: number, step: number) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

const plank = (id: string) =>
  sheet({ id, load_mode: 'bodyweight', measure: 'duration', movement_pattern: 'core_anti_extension' });
const PLANK_CHAIN = linkChain('plank', [
  plank('knee-plank'),
  plank('front-plank'),
  plank('long-lever-plank'),
]);

interface Case {
  name: string;
  slot: SlotSpec;
  grid: LoadGrid;
  exercises: readonly ExerciseSheet[];
  chainSteps: readonly ExerciseSheet[] | null;
  /** Charges réalisées possibles ; vide sans charge. */
  loads: readonly number[];
  measure: 'reps' | 'duration';
  values: [number, number];
  incrementG: number | null;
}

const SQUAT = sheet({ id: 'back-squat', load_mode: 'barbell' });
const CURL = sheet({ id: 'dumbbell-curl', load_mode: 'dumbbell' });
const LEG_EXT = sheet({ id: 'leg-extension', load_mode: 'machine' });
const BW_SQUAT = sheet({ id: 'bodyweight-squat', load_mode: 'bodyweight' });

const CASES: readonly Case[] = [
  {
    name: 'linear barre',
    slot: slot([work({ reps: { min: 6, max: 6 } })], { type: 'linear', incrementG: 5000 }),
    grid: BAR,
    exercises: [SQUAT],
    chainSteps: null,
    loads: [...range(20000, 100000, 2500), 21000, 61000, 33300],
    measure: 'reps',
    values: [3, 9],
    incrementG: 5000,
  },
  {
    name: 'linear machine au pas de 10 kg',
    slot: slot([work({ reps: { min: 8, max: 8 } })], { type: 'linear', incrementG: 2500 }),
    grid: MACHINE_10,
    exercises: [LEG_EXT],
    chainSteps: null,
    loads: [...range(10000, 120000, 10000), 45000],
    measure: 'reps',
    values: [5, 12],
    incrementG: 2500,
  },
  {
    name: 'linear haltères, 5 séries',
    slot: slot([work({ count: 5, reps: { min: 5, max: 5 } })], { type: 'linear', incrementG: 2500 }),
    grid: DUMBBELLS,
    exercises: [CURL],
    chainSteps: null,
    loads: range(2000, 40000, 2000),
    measure: 'reps',
    values: [2, 8],
    incrementG: 2500,
  },
  {
    name: 'linear au poids du corps',
    slot: slot([work({ reps: { min: 10, max: 10 } })], { type: 'linear', incrementG: 5000 }),
    grid: NONE,
    exercises: [BW_SQUAT],
    chainSteps: null,
    loads: [],
    measure: 'reps',
    values: [6, 16],
    incrementG: 5000,
  },
  {
    name: 'double barre [8, 12]',
    slot: slot([work({ reps: { min: 8, max: 12 } })], { type: 'double' }),
    grid: BAR,
    exercises: [SQUAT],
    chainSteps: null,
    loads: [...range(20000, 80000, 2500), 61000],
    measure: 'reps',
    values: [5, 15],
    incrementG: null,
  },
  {
    name: 'double haltères [4, 6] (somme)',
    slot: slot([work({ count: 4, reps: { min: 4, max: 6 } })], { type: 'double' }),
    grid: DUMBBELLS,
    exercises: [CURL],
    chainSteps: null,
    loads: range(2000, 40000, 2000),
    measure: 'reps',
    values: [1, 10],
    incrementG: null,
  },
  {
    name: 'chaîne de pompes [8, 12]',
    slot: slot([work({ reps: { min: 8, max: 12 } })], { type: 'chain' }, 'push-up'),
    grid: NONE,
    exercises: PUSH_UP_CHAIN,
    chainSteps: PUSH_UP_CHAIN,
    loads: [],
    measure: 'reps',
    values: [5, 27],
    incrementG: null,
  },
  {
    name: 'gainage [20, 60]',
    slot: slot([work({ durationS: { min: 20, max: 60 } })], { type: 'duration', stepS: 5 }),
    grid: NONE,
    exercises: [plank('side-plank')],
    chainSteps: null,
    loads: [],
    measure: 'duration',
    values: [10, 70],
    incrementG: null,
  },
  {
    name: 'gainage en chaîne [20, 60]',
    slot: slot([work({ durationS: { min: 20, max: 60 } })], { type: 'duration', stepS: 5 }, 'plank'),
    grid: NONE,
    exercises: PLANK_CHAIN,
    chainSteps: PLANK_CHAIN,
    loads: [],
    measure: 'duration',
    values: [10, 70],
    incrementG: null,
  },
];

/** Séance tirée au hasard. Le plus souvent, le membre suit les cibles de l'appli, à quelques répétitions près. */
interface SessionDraw {
  follow: boolean;
  /** Nombre de séries faites ; null = les séries prévues. */
  count: number | null;
  /** Écart commun à la cible (en répétitions, ou en pas de 5 s), puis écart propre à chaque série. */
  shift: number;
  jitter: number[];
  /** Valeurs quand le membre ne suit pas la cible. */
  absolute: number[];
  load: number | null;
  lighterLast: boolean;
  effort: Effort | null;
  adj: NextAdjustment | null;
  pain: PainLevel | null;
  weekType: WeekType;
  resumeGapDays: number | null;
  profile: SessionProfile;
  exercise: number;
}

const weighted = <T>(...choices: [number, T][]): fc.Arbitrary<T> =>
  fc.oneof(...choices.map(([weight, value]) => ({ weight, arbitrary: fc.constant(value) })));

const arbSession = (c: Case, profile: SessionProfile): fc.Arbitrary<SessionDraw> =>
  fc
    .record({
      follow: weighted([4, true], [1, false]),
      count: fc.oneof(
        { weight: 6, arbitrary: fc.constant(null) },
        { weight: 1, arbitrary: fc.integer({ min: 0, max: 6 }) },
      ),
      shift: weighted([1, -3], [2, -1], [4, 0], [3, 1], [2, 2], [1, 5]),
      jitter: fc.array(weighted([5, 0], [2, -1], [1, 1]), { minLength: 6, maxLength: 6 }),
      absolute: fc.array(fc.integer({ min: c.values[0], max: c.values[1] }), { minLength: 6, maxLength: 6 }),
      load: c.loads.length === 0 ? fc.constant(null) : fc.constantFrom(...c.loads),
      lighterLast: weighted([6, false], [1, true]),
      effort: weighted<Effort | null>([5, 'ok'], [2, 'easy'], [2, 'hard'], [1, 'failed'], [1, null]),
      adj: weighted<NextAdjustment | null>([10, null], [1, 'hold'], [1, 'lighten']),
      pain: weighted<PainLevel | null>([10, null], [2, 'none'], [1, 'discomfort'], [1, 'pain']),
      weekType: weighted<WeekType>([14, 'normal'], [1, 'deload']),
      resumeGapDays: fc.oneof(
        { weight: 12, arbitrary: fc.constant(null) },
        { weight: 2, arbitrary: fc.integer({ min: 0, max: 40 }) },
      ),
      flip: weighted([14, false], [1, true]),
      exercise: fc.nat({ max: c.exercises.length - 1 }),
    })
    .map(({ flip, ...d }) => ({
      ...d,
      profile: flip ? (profile === 'adult' ? 'cautious' : 'adult') : profile,
      // Le bouton douleur écrit toujours l'ajustement neutre (05 §13.6) : gêne → maintien, douleur → allègement.
      adj: d.pain === 'discomfort' ? (d.adj ?? 'hold') : d.pain === 'pain' ? (d.adj ?? 'lighten') : d.adj,
    }));

const plannedOf = (c: Case) => c.slot.sets.reduce((n, s) => (s.kind === 'work' ? n + s.count : n), 0);

let seq = 0;
function lines(c: Case, d: SessionDraw, state: EngineState | null): SetRecord[] {
  const n = d.count ?? plannedOf(c);
  const unit = c.measure === 'duration' ? 5 : 1;
  const target = c.measure === 'duration' ? state?.durationS : state?.targetReps;
  const values =
    d.follow && target !== null && target !== undefined
      ? Array.from({ length: n }, (_, i) => Math.max(0, target + unit * (d.shift + (d.jitter[i] ?? 0))))
      : d.absolute.slice(0, n);
  const load = d.follow && state?.loadG != null && c.loads.length > 0 ? state.loadG : d.load;
  return values.map((v, i) => {
    const last = i === values.length - 1;
    const lighter =
      last && d.lighterLast && load !== null ? ([...c.loads].reverse().find((l) => l < load) ?? null) : null;
    return {
      id: `set-${++seq}`,
      position: i + 1,
      kind: 'work',
      loadMode: 'barbell',
      loadG: lighter ?? load,
      reps: c.measure === 'reps' ? v : null,
      durationS: c.measure === 'duration' ? v : null,
      side: null,
      effort: last ? d.effort : null,
      targetRepsMin: null,
      targetRepsMax: null,
      targetDurationS: null,
      targetLoadG: null,
      targetRir: null,
      targetVariant: null,
      loggedAt: 1000 + i,
    };
  });
}

function input(c: Case, state: EngineState | null, d: SessionDraw, n: number): EvaluateInput {
  const drawn = c.exercises[d.exercise] ?? fail();
  const followed =
    d.follow && state?.variantRank != null && c.chainSteps !== null
      ? c.chainSteps[state.variantRank - 1]
      : undefined;
  const exercise = followed ?? drawn;
  return {
    state,
    slot: c.slot,
    exercise,
    chainSteps: c.chainSteps,
    performed: {
      id: `pe-${n}`,
      slotId: c.slot.id,
      plannedExerciseId: exercise.id,
      exerciseId: exercise.id,
      position: 1,
      swapReason: null,
      painLevel: d.pain,
      nextAdjustment: d.adj,
      sets: lines(c, d, state),
    },
    session: {
      id: `session-${n}`,
      instanceId: 'instance-1',
      weekType: d.weekType,
      profile: d.profile,
      rulesVersion: '1',
      resumeGapDays: d.resumeGapDays,
    },
    grid: c.grid,
    rules,
  };
}

/** Un cas, un historique rejoué séance par séance, et l'entrée de la dernière évaluation. */
const arbRun = fc
  .tuple(fc.constantFrom(...CASES), fc.constantFrom<SessionProfile>('adult', 'cautious'))
  .chain(([c, profile]) =>
    fc.record({
      c: fc.constant(c),
      history: fc.array(arbSession(c, profile), { maxLength: 20 }),
      last: arbSession(c, profile),
    }),
  )
  .map(({ c, history, last }) => {
    let state: EngineState | null = null;
    history.forEach((d, i) => {
      state = evaluateExercise(input(c, state, d, i)).state;
    });
    return { c, prev: state as EngineState | null, last, input: input(c, state, last, history.length) };
  });

const realizedLoad = (sets: readonly SetRecord[]): number | null => {
  const loads = sets.flatMap((s) => (s.loadG === null ? [] : [s.loadG]));
  return loads.length === 0 ? null : Math.min(...loads);
};
const maxOf = (...xs: (number | null | undefined)[]): number => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length === 0 ? Number.NEGATIVE_INFINITY : Math.max(...v);
};

function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

const RUNS = { numRuns: 400 };

describe('evaluateExercise : propriétés', () => {
  it('jamais de hausse avec un ajustement, une douleur ou un effort manquant', () => {
    fc.assert(
      fc.property(arbRun, ({ c, prev, last, input: inp }) => {
        if (last.adj === null && last.effort !== null) return;
        const out = evaluateExercise(inp);
        const performedRank = c.chainSteps?.findIndex((s) => s.id === inp.exercise.id) ?? -1;
        const durationMin = c.measure === 'duration' ? 20 : null;
        expect(out.state.loadG ?? Number.NEGATIVE_INFINITY).toBeLessThanOrEqual(
          maxOf(prev?.loadG, realizedLoad(inp.performed.sets)),
        );
        expect(out.state.variantRank ?? Number.NEGATIVE_INFINITY).toBeLessThanOrEqual(
          maxOf(prev?.variantRank, performedRank === -1 ? null : performedRank + 1),
        );
        expect(out.state.durationS ?? Number.NEGATIVE_INFINITY).toBeLessThanOrEqual(
          maxOf(prev?.durationS, durationMin),
        );
        if (last.adj !== null) expect(out.decision.result).not.toBe('PROGRESS');
      }),
      RUNS,
    );
  });

  it("jamais au-delà de max(incrementG, 10 %) pour un adulte, ni plus d'un pas en prudent", () => {
    fc.assert(
      fc.property(arbRun, ({ c, last, input: inp }) => {
        const out = evaluateExercise(inp);
        const realized = realizedLoad(inp.performed.sets);
        const newLoad = out.state.loadG;
        if (out.decision.result === 'DELOAD' || realized === null || newLoad === null || newLoad <= realized)
          return;
        const oneStep = next(c.grid, realized);
        if (last.profile === 'cautious') {
          expect(newLoad).toBeLessThanOrEqual(oneStep ?? realized);
        } else {
          // Un pas reste toujours permis : c'est la hausse minimale (mode somme, 05 §8).
          const cap = Math.max(
            c.incrementG ?? 0,
            (realized * rules.raiseCapPct) / 100,
            (oneStep ?? realized) - realized,
          );
          expect(newLoad - realized).toBeLessThanOrEqual(cap);
        }
      }),
      RUNS,
    );
  });

  it('jamais de cible hors des bornes prudentes avec profile = cautious', () => {
    fc.assert(
      fc.property(arbRun, ({ last, input: inp }) => {
        if (last.profile !== 'cautious') return;
        const target = evaluateExercise(inp).decision.nextTarget ?? fail();
        expect(target.workSets).toBeLessThanOrEqual(rules.cautious.maxWorkSets);
        for (const reps of [target.repsMin, target.repsMax]) {
          if (reps === null) continue;
          expect(reps).toBeGreaterThanOrEqual(rules.cautious.repsMin);
          expect(reps).toBeLessThanOrEqual(rules.cautious.repsMax);
        }
      }),
      RUNS,
    );
  });

  it("le moteur n'ajoute jamais de séries ; compteurs dans leurs bornes", () => {
    fc.assert(
      fc.property(arbRun, ({ c, input: inp }) => {
        const out = evaluateExercise(inp);
        const planned = c.slot.sets.filter((s) => s.kind === 'work').reduce((n, s) => n + s.count, 0);
        expect(out.decision.nextTarget?.workSets).toBeLessThanOrEqual(planned);
        expect(out.state.noProgressCount).toBeLessThan(rules.stallSessions);
        expect(out.state.stallRank).toBeLessThanOrEqual(3);
        expect(out.state.calibrationLeft).toBeGreaterThanOrEqual(0);
        const t = out.decision.nextTarget ?? fail();
        if (t.repsMin !== null && t.repsMax !== null) expect(t.repsMin).toBeLessThanOrEqual(t.repsMax);
      }),
      RUNS,
    );
  });

  it("même entrée, même sortie, sans toucher à l'entrée", () => {
    fc.assert(
      fc.property(arbRun, ({ input: inp }) => {
        const copy = structuredClone(inp);
        const first = evaluateExercise(deepFreeze(structuredClone(inp)));
        const second = evaluateExercise(copy);
        expect(first).toEqual(second);
        expect(copy).toEqual(inp);
      }),
      RUNS,
    );
  });
});
