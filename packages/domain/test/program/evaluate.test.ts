/*
 * `evaluateExercise` par tableaux de cas (spec brique 3 §10.1) : chaque primitive de 05 §8, chaque étape de
 * 05 §9 dans son ordre strict, et les précisions §4.3.1 à §4.3.12 de la spec de la brique 3.
 */
import {
  type DecisionResult,
  defaultLoadSettings,
  type Effort,
  type ExerciseSheet,
  type NextAdjustment,
  type PainLevel,
  type ReasonCode,
  type SessionProfile,
  type SetSpec,
  type Side,
  type SlotSpec,
  type WeekType,
} from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { type EngineState, type EvaluateResult, evaluateExercise } from '../../src/program/evaluate';
import { type LoadGrid, loadGrid } from '../../src/program/loads';
import { rulesFor } from '../../src/program/rules';
import type { SetRecord } from '../../src/program/types';
import { linkChain, PUSH_UP_CHAIN, sheet } from '../fixtures/catalog';

const fail = (): never => {
  throw new Error('règles 1 absentes');
};
const rules = rulesFor('1') ?? fail();

// ---------------------------------------------------------------------------------------------------------------
// Matériel, fiches et slots
// ---------------------------------------------------------------------------------------------------------------

const gym = defaultLoadSettings('gym');
/** Barre de 20 kg, plus petit disque 1,25 kg : charges de 2,5 kg en 2,5 kg. */
const BAR = loadGrid('barbell', gym);
/** Haltères de 2 à 40 kg, de 2 kg en 2 kg. */
const DUMBBELLS = loadGrid('dumbbell', gym);
const MACHINE_10 = loadGrid('machine', { ...gym, machineStepG: 10000 });
const NONE = loadGrid('bodyweight', gym);

const SQUAT = sheet({ id: 'back-squat', load_mode: 'barbell', equipment_options: [['barbell']] });
const LUNGE = sheet({
  id: 'barbell-lunge',
  load_mode: 'barbell',
  movement_pattern: 'lunge',
  unilateral: true,
});
const CURL = sheet({ id: 'dumbbell-curl', load_mode: 'dumbbell', movement_pattern: 'elbow_flexion' });
const LEG_EXT = sheet({ id: 'leg-extension', load_mode: 'machine', movement_pattern: 'knee_extension' });
const plankSheet = (id: string, level: 1 | 2 | 3) =>
  sheet({
    id,
    level,
    load_mode: 'bodyweight',
    measure: 'duration',
    movement_pattern: 'core_anti_extension',
    equipment_options: [[]],
  });
const PLANK_CHAIN: readonly ExerciseSheet[] = linkChain('front-plank', [
  plankSheet('knee-plank', 1),
  plankSheet('front-plank', 1),
  plankSheet('long-lever-plank', 2),
]);
const at = <T>(list: readonly T[], i: number): T => list[i] ?? fail();
const INCLINE = at(PUSH_UP_CHAIN, 1);
const PUSH_UP = at(PUSH_UP_CHAIN, 2);
const FEET_ELEVATED = at(PUSH_UP_CHAIN, 3);
const ARCHER = at(PUSH_UP_CHAIN, 4);
const FRONT_PLANK = at(PLANK_CHAIN, 1);

const work = (o: Partial<SetSpec>): SetSpec => ({ kind: 'work', count: 3, targetRir: 2, restS: 120, ...o });

const LINEAR: SlotSpec = {
  id: 'A1',
  movementPattern: 'squat',
  role: 'main',
  exercises: ['back-squat'],
  sets: [
    { kind: 'warmup', count: 2, reps: { min: 5, max: 5 }, pctWorkLoad: 50 },
    work({ reps: { min: 6, max: 6 } }),
  ],
  progression: { type: 'linear', incrementG: 5000 },
};
const LINEAR_MACHINE: SlotSpec = { ...LINEAR, progression: { type: 'linear', incrementG: 2500 } };
const DOUBLE: SlotSpec = {
  id: 'A4',
  movementPattern: 'elbow_flexion',
  role: 'accessory',
  exercises: ['dumbbell-curl'],
  sets: [work({ reps: { min: 8, max: 12 } })],
  progression: { type: 'double' },
};
const CHAIN: SlotSpec = {
  id: 'H1',
  movementPattern: 'horizontal_push',
  role: 'main',
  chain: 'push-up',
  sets: [work({ reps: { min: 8, max: 12 } })],
  progression: { type: 'chain' },
};
const DURATION: SlotSpec = {
  id: 'A5',
  movementPattern: 'core_anti_extension',
  role: 'accessory',
  exercises: ['front-plank'],
  sets: [work({ durationS: { min: 20, max: 60 }, restS: 60 })],
  progression: { type: 'duration', stepS: 5 },
};
const DURATION_CHAIN: SlotSpec = { ...DURATION, id: 'A6', exercises: undefined, chain: 'front-plank' };

// ---------------------------------------------------------------------------------------------------------------
// Séances
// ---------------------------------------------------------------------------------------------------------------

let seq = 0;
type SetOptions = {
  /** Charge de chaque série, ou la même pour toutes. */
  load?: number | readonly (number | null)[] | null;
  /** Effort noté sur la dernière série ; `ok` par défaut. */
  effort?: Effort | null;
  measure?: 'reps' | 'duration';
};

/** Séries de travail faites, une par valeur (répétitions ou secondes), positions 1, 2, 3… */
function sets(values: readonly number[], o: SetOptions = {}): SetRecord[] {
  const effort = 'effort' in o ? (o.effort ?? null) : 'ok';
  const measure = o.measure ?? 'reps';
  return values.map((v, i) => ({
    id: `set-${++seq}`,
    position: i + 1,
    kind: 'work',
    loadMode: 'barbell',
    loadG: Array.isArray(o.load) ? (o.load[i] ?? null) : ((o.load as number | null | undefined) ?? null),
    reps: measure === 'reps' ? v : null,
    durationS: measure === 'duration' ? v : null,
    side: null,
    effort: i === values.length - 1 ? effort : null,
    targetRepsMin: null,
    targetRepsMax: null,
    targetDurationS: null,
    targetLoadG: null,
    targetRir: null,
    targetVariant: null,
    loggedAt: 1000 + i,
  }));
}
const secs = (values: readonly number[], o: Omit<SetOptions, 'measure'> = {}) =>
  sets(values, { ...o, measure: 'duration' });

/** Séries unilatérales : répétitions à gauche, puis à droite, par position ; `null` = côté droit non fait. */
function pairs(left: readonly number[], right: readonly (number | null)[], o: SetOptions = {}): SetRecord[] {
  const effort = 'effort' in o ? (o.effort ?? null) : 'ok';
  return left.flatMap((l, i) => {
    const line = (side: Side, reps: number, last: boolean): SetRecord => ({
      ...at(sets([reps], { load: o.load ?? null, effort: null }), 0),
      position: i + 1,
      side,
      effort: last ? effort : null,
    });
    const last = i === left.length - 1;
    const r = right[i] ?? null;
    return r === null ? [line('left', l, last)] : [line('left', l, false), line('right', r, last)];
  });
}

interface Scenario {
  slot: SlotSpec;
  exercise: ExerciseSheet;
  grid: LoadGrid;
  chainSteps?: readonly ExerciseSheet[];
  profile?: SessionProfile;
}
interface SessionOptions {
  adj?: NextAdjustment;
  pain?: PainLevel;
  weekType?: WeekType;
  resumeGapDays?: number;
  exercise?: ExerciseSheet;
}

/** Enchaîne les séances d'un slot en passant l'état d'une évaluation à la suivante, comme le rejeu. */
function scenario(sc: Scenario, initial: EngineState | null = null) {
  let state = initial;
  let n = 0;
  const run = (lines: SetRecord[], o: SessionOptions = {}): EvaluateResult => {
    n += 1;
    const exercise = o.exercise ?? sc.exercise;
    const out = evaluateExercise({
      state,
      slot: sc.slot,
      exercise,
      chainSteps: sc.chainSteps ?? null,
      performed: {
        id: `pe-${n}`,
        slotId: sc.slot.id,
        plannedExerciseId: exercise.id,
        exerciseId: exercise.id,
        position: 1,
        swapReason: null,
        painLevel: o.pain ?? null,
        nextAdjustment: o.adj ?? null,
        sets: lines,
      },
      session: {
        id: `session-${n}`,
        instanceId: 'instance-1',
        weekType: o.weekType ?? 'normal',
        profile: sc.profile ?? 'adult',
        rulesVersion: '1',
        resumeGapDays: o.resumeGapDays ?? null,
      },
      grid: sc.grid,
      rules,
    });
    state = out.state;
    return out;
  };
  return {
    run,
    /** Exécute la même séance `times` fois et rend la dernière décision. */
    repeat(times: number, lines: () => SetRecord[], o: SessionOptions = {}): EvaluateResult {
      let last: EvaluateResult | null = null;
      for (let i = 0; i < times; i++) last = run(lines(), o);
      return last ?? fail();
    },
    get state(): EngineState {
      return state ?? fail();
    },
  };
}

/** Scénario dont la calibration est déjà finie : une première séance notée « correct ». */
function calibrated(sc: Scenario, first: SetRecord[]) {
  const s = scenario(sc);
  const out = s.run(first);
  expect(out.decision.reasonCode).toBe('CALIBRATION_DONE');
  expect(s.state.calibrationLeft).toBe(0);
  return s;
}

type Expect = [DecisionResult, ReasonCode];
const outcome = (r: EvaluateResult): Expect => [r.decision.result, r.decision.reasonCode];

// ---------------------------------------------------------------------------------------------------------------
// Primitives (05 §8)
// ---------------------------------------------------------------------------------------------------------------

describe('linear, r = 6, incrementG 5 000, barre 20 kg / disque 1,25 kg (05 §8)', () => {
  const sc: Scenario = { slot: LINEAR, exercise: SQUAT, grid: BAR };
  const ready = () => calibrated(sc, sets([6, 6, 6], { load: 60000 }));

  it.each<[string, SetRecord[], DecisionResult, ReasonCode, number]>([
    ['3 × 6 + correct', sets([6, 6, 6], { load: 60000 }), 'PROGRESS', 'LOAD_UP', 65000],
    ['sans effort', sets([6, 6, 6], { load: 60000, effort: null }), 'HOLD', 'EFFORT_MISSING', 60000],
    [
      'difficile, targetRir 2',
      sets([6, 6, 6], { load: 60000, effort: 'hard' }),
      'PROGRESS',
      'LOAD_UP',
      65000,
    ],
    ['échec noté', sets([6, 6, 6], { load: 60000, effort: 'failed' }), 'HOLD', 'EFFORT_NOT_VALIDATED', 60000],
    ['une série à 5', sets([6, 6, 5], { load: 60000 }), 'FAIL', 'REPS_UNDER_MIN', 60000],
    ['2 séries faites sur 3, toutes à 6', sets([6, 6], { load: 60000 }), 'HOLD', 'SETS_MISSING', 60000],
    ['2 séries sur 3 dont une à 5 : échec', sets([6, 5], { load: 60000 }), 'FAIL', 'REPS_UNDER_MIN', 60000],
    [
      'charges 60, 60, 57,5 sans effort',
      sets([6, 6, 6], { load: [60000, 60000, 57500], effort: null }),
      'HOLD',
      'EFFORT_MISSING',
      57500,
    ],
    [
      'charges 60, 60, 57,5 + correct',
      sets([6, 6, 6], { load: [60000, 60000, 57500] }),
      'PROGRESS',
      'LOAD_UP',
      62500,
    ],
  ])('%s', (_, lines, result, code, loadG) => {
    const out = ready().run(lines);
    expect(outcome(out)).toEqual([result, code]);
    expect(out.decision.nextTarget).toMatchObject({
      mode: 'linear',
      loadG,
      repsMin: 6,
      repsMax: 6,
      workSets: 3,
    });
    expect(out.state.loadG).toBe(loadG);
  });

  it('une série ajoutée en cours de séance compte comme les autres (§4.3.1)', () => {
    expect(outcome(ready().run(sets([6, 6, 6, 5], { load: 60000 })))).toEqual(['FAIL', 'REPS_UNDER_MIN']);
    expect(outcome(ready().run(sets([6, 6, 6, 6], { load: 60000 })))).toEqual(['PROGRESS', 'LOAD_UP']);
  });

  it('séries non faites et échauffement ignorés (§4.3.1)', () => {
    const lines = [
      ...sets([6, 6, 6], { load: 60000 }),
      { ...at(sets([2], { load: 60000, effort: 'failed' }), 0), position: 4, loggedAt: null },
      { ...at(sets([5], { load: 30000, effort: null }), 0), kind: 'warmup' as const },
    ];
    expect(outcome(ready().run(lines))).toEqual(['PROGRESS', 'LOAD_UP']);
  });

  it('machine au pas de 10 000 à 40 kg (incrementG 2 500) : passage en double, LINEAR_TO_DOUBLE', () => {
    const s = calibrated(
      { slot: LINEAR_MACHINE, exercise: LEG_EXT, grid: MACHINE_10 },
      sets([6, 6, 6], { load: 40000 }),
    );
    const out = s.run(sets([6, 6, 6], { load: 40000 }));
    expect(outcome(out)).toEqual(['HOLD', 'LINEAR_TO_DOUBLE']);
    expect(out.state.mode).toBe('double');
    expect(out.decision.nextTarget).toMatchObject({ mode: 'double', loadG: 40000, repsMin: 6, repsMax: 10 });
  });

  it('décision : identifiants, profil et version de règles', () => {
    const out = ready().run(sets([6, 6, 6], { load: 60000 }));
    expect(out.decision).toMatchObject({
      id: 'pe-2',
      instanceId: 'instance-1',
      slotId: 'A1',
      exerciseId: 'back-squat',
      profile: 'adult',
      rulesVersion: '1',
    });
    expect(out.state).toMatchObject({
      id: 'instance-1:A1:back-squat',
      lastSessionId: 'session-2',
      rulesVersion: '1',
    });
    expect(out.stalled).toBeNull();
  });
});

describe('double [8, 12] × 3 (05 §8)', () => {
  const sc: Scenario = { slot: DOUBLE, exercise: SQUAT, grid: BAR };
  const ready = () => calibrated(sc, sets([9, 9, 9], { load: 60000 }));

  it('12, 12, 12 + correct : LOAD_UP, un pas, répétitions à 8', () => {
    const out = ready().run(sets([12, 12, 12], { load: 60000 }));
    expect(outcome(out)).toEqual(['PROGRESS', 'LOAD_UP']);
    expect(out.decision.nextTarget).toMatchObject({ mode: 'double', loadG: 62500, repsMin: 8, repsMax: 12 });
  });

  it.each<[string, number[], DecisionResult, ReasonCode, number]>([
    ['10, 10, 9 après 9, 9, 9', [10, 10, 9], 'PROGRESS', 'REPS_UP', 10],
    ['total égal', [9, 9, 9], 'HOLD', 'NO_PROGRESS', 8],
    ['total en baisse', [9, 9, 8], 'HOLD', 'NO_PROGRESS', 8],
    ['une série à 7', [12, 12, 7], 'FAIL', 'REPS_UNDER_MIN', 8],
  ])('%s', (_, reps, result, code, repsMin) => {
    const out = ready().run(sets(reps, { load: 60000 }));
    expect(outcome(out)).toEqual([result, code]);
    expect(out.decision.nextTarget).toMatchObject({ loadG: 60000, repsMin, repsMax: 12 });
  });

  it('sommet sans effort ou effort non validé : pas de hausse', () => {
    expect(outcome(ready().run(sets([12, 12, 12], { load: 60000, effort: null })))).toEqual([
      'HOLD',
      'EFFORT_MISSING',
    ]);
    expect(outcome(ready().run(sets([12, 12, 12], { load: 60000, effort: 'failed' })))).toEqual([
      'HOLD',
      'EFFORT_NOT_VALIDATED',
    ]);
  });

  it('les répétitions comptent sans effort (05 §7) : REPS_UP sans hausse de charge', () => {
    const out = ready().run(sets([10, 10, 9], { load: 60000, effort: null }));
    expect(outcome(out)).toEqual(['PROGRESS', 'REPS_UP']);
    expect(out.state.loadG).toBe(60000);
  });

  it('sommet sans charge plus lourde ici : REPS_MAX_REACHED', () => {
    const s = calibrated({ slot: DOUBLE, exercise: CURL, grid: DUMBBELLS }, sets([9, 9, 9], { load: 40000 }));
    const out = s.run(sets([12, 12, 12], { load: 40000 }));
    expect(outcome(out)).toEqual(['PROGRESS', 'REPS_UP']);
    expect(outcome(s.run(sets([12, 12, 12], { load: 40000 })))).toEqual(['HOLD', 'REPS_MAX_REACHED']);
    expect(s.state.loadG).toBe(40000);
  });

  describe('mode somme (haltères 14 kg : pas de 2 kg > 10 %)', () => {
    const dsc: Scenario = { slot: DOUBLE, exercise: CURL, grid: DUMBBELLS };
    const readySum = () => calibrated(dsc, sets([10, 10, 10], { load: 14000 }));

    it('le slot passe en somme', () => {
      expect(readySum().state.mode).toBe('sum');
    });

    it('13, 13, 13 + correct (= 3 × 12 + 3) : SUM_LOAD_UP vers 16 000', () => {
      const out = readySum().run(sets([13, 13, 13], { load: 14000 }));
      expect(outcome(out)).toEqual(['PROGRESS', 'SUM_LOAD_UP']);
      expect(out.decision.nextTarget).toMatchObject({ mode: 'sum', loadG: 16000, repsMin: 8, repsMax: 12 });
    });

    it('12, 12, 12 en somme : pas encore de hausse', () => {
      const out = readySum().run(sets([12, 12, 12], { load: 14000 }));
      expect(outcome(out)).toEqual(['PROGRESS', 'REPS_UP']);
      expect(out.state.loadG).toBe(14000);
    });

    it('après la hausse, une série à 6 (min − 2) ne compte pas comme un échec ; à 5, si', () => {
      const s = readySum();
      s.run(sets([13, 13, 13], { load: 14000 }));
      const after = s.state;
      expect(outcome(s.run(sets([9, 8, 6], { load: 16000 })))).toEqual(['HOLD', 'NO_PROGRESS']);
      expect(outcome(scenario(dsc, after).run(sets([9, 8, 5], { load: 16000 })))).toEqual([
        'FAIL',
        'REPS_UNDER_MIN',
      ]);
    });

    it('sans hausse juste avant, min − 2 reste un échec', () => {
      expect(outcome(readySum().run(sets([9, 8, 6], { load: 14000 })))).toEqual(['FAIL', 'REPS_UNDER_MIN']);
    });
  });
});

describe('chain [8, 12] (05 §8)', () => {
  const sc: Scenario = { slot: CHAIN, exercise: INCLINE, grid: NONE, chainSteps: PUSH_UP_CHAIN };
  const ready = () => {
    const s = calibrated(sc, sets([10, 10, 10]));
    expect(s.state).toMatchObject({ exerciseId: 'push-up', mode: 'chain', variantRank: 2 });
    return s;
  };

  it('sommet tenu 2 séances de suite : CHAIN_NEXT, variantRank + 1, répétitions à 8', () => {
    const s = ready();
    expect(outcome(s.run(sets([12, 12, 12])))).toEqual(['PROGRESS', 'REPS_UP']);
    const out = s.run(sets([12, 12, 12]));
    expect(outcome(out)).toEqual(['PROGRESS', 'CHAIN_NEXT']);
    expect(out.state.variantRank).toBe(3);
    expect(out.decision.nextTarget).toMatchObject({
      mode: 'chain',
      variantId: 'push-up',
      repsMin: 8,
      repsMax: 12,
      loadG: null,
    });
    expect(out.decision.exerciseId).toBe('push-up');
  });

  it('sommet interrompu : le compte repart', () => {
    const s = ready();
    s.run(sets([12, 12, 12]));
    s.run(sets([12, 12, 11]));
    expect(outcome(s.run(sets([12, 12, 12])))).toEqual(['HOLD', 'NO_PROGRESS']);
    expect(outcome(s.run(sets([12, 12, 12])))).toEqual(['PROGRESS', 'CHAIN_NEXT']);
  });

  it('sommet sans effort validé : pas de variante suivante', () => {
    const s = ready();
    s.run(sets([12, 12, 12]));
    expect(outcome(s.run(sets([12, 12, 12], { effort: null })))).toEqual(['HOLD', 'EFFORT_MISSING']);
    expect(s.state.variantRank).toBe(2);
  });

  it('2 échecs de suite sur la nouvelle variante : CHAIN_BACK', () => {
    const s = ready();
    s.run(sets([12, 12, 12]));
    s.run(sets([12, 12, 12]));
    expect(outcome(s.run(sets([7, 6, 6]), { exercise: PUSH_UP }))).toEqual(['FAIL', 'REPS_UNDER_MIN']);
    const out = s.run(sets([6, 6, 5]), { exercise: PUSH_UP });
    expect(outcome(out)).toEqual(['FAIL', 'CHAIN_BACK']);
    expect(out.state.variantRank).toBe(2);
    expect(out.decision.nextTarget).toMatchObject({ variantId: 'incline-push-up', repsMin: 8 });
  });

  it('2 échecs de suite sur la variante de départ : pas de retour', () => {
    const s = ready();
    s.run(sets([7, 7, 7]));
    expect(outcome(s.run(sets([7, 7, 7])))).toEqual(['FAIL', 'REPS_UNDER_MIN']);
    expect(s.state.variantRank).toBe(2);
  });

  it('dernière variante : max 25 (15 en prudent), au-delà rien', () => {
    const last = calibrated({ ...sc, exercise: ARCHER }, sets([10, 10, 10]));
    expect(last.state.variantRank).toBe(5);
    expect(last.run(sets([12, 12, 12])).decision.nextTarget).toMatchObject({ repsMin: 13, repsMax: 25 });
    last.run(sets([25, 25, 25]));
    expect(outcome(last.run(sets([25, 25, 25])))).toEqual(['HOLD', 'REPS_MAX_REACHED']);
    expect(last.state.variantRank).toBe(5);

    const cautious = calibrated(
      { ...sc, exercise: FEET_ELEVATED, chainSteps: PUSH_UP_CHAIN.slice(0, 4), profile: 'cautious' },
      sets([10, 10, 10]),
    );
    expect(cautious.run(sets([12, 12, 12])).decision.nextTarget).toMatchObject({ repsMin: 13, repsMax: 15 });
  });

  it('état de chaîne évalué sans chainSteps : la variante est gardée', () => {
    const out = scenario({ ...sc, chainSteps: undefined }, ready().state).run(sets([10, 10, 10]));
    expect(out.state).toMatchObject({ exerciseId: 'push-up', mode: 'chain', variantRank: 2 });
  });

  it('remplaçant hors chaîne : son propre état (slot, exercice), en double', () => {
    const out = scenario({ ...sc, exercise: CURL, grid: DUMBBELLS }).run(sets([10, 10, 10], { load: 20000 }));
    expect(out.state).toMatchObject({ exerciseId: 'dumbbell-curl', mode: 'double', variantRank: null });
  });
});

describe('duration [20, 60] pas 5 (05 §8)', () => {
  const plank = plankSheet('front-plank', 1);
  const sc: Scenario = { slot: DURATION, exercise: plank, grid: NONE };
  const ready = () => {
    const s = calibrated(sc, secs([30, 30, 30]));
    expect(s.state).toMatchObject({ mode: 'duration', durationS: 20, targetReps: null });
    return s;
  };

  it('séries tenues + correct : DURATION_UP (+5 s)', () => {
    const out = ready().run(secs([30, 30, 30]));
    expect(outcome(out)).toEqual(['PROGRESS', 'DURATION_UP']);
    expect(out.decision.nextTarget).toMatchObject({ mode: 'duration', durationS: 25, repsMin: null });
  });

  it.each<[string, number[], Effort | null, DecisionResult, ReasonCode]>([
    ['une série sous la cible − 5 s', [25, 25, 19], 'ok', 'FAIL', 'DURATION_UNDER'],
    ['une série sous la cible, dans la marge', [25, 25, 21], 'ok', 'HOLD', 'DURATION_UNDER'],
    ['tenues sans effort', [25, 25, 25], null, 'HOLD', 'EFFORT_MISSING'],
    ['tenues, échec noté', [25, 25, 25], 'failed', 'HOLD', 'EFFORT_NOT_VALIDATED'],
    ['tenues + correct', [25, 25, 25], 'ok', 'PROGRESS', 'DURATION_UP'],
  ])('cible 25 s : %s', (_, values, effort, result, code) => {
    const s = ready();
    s.run(secs([25, 25, 25]));
    expect(s.state.durationS).toBe(25);
    expect(outcome(s.run(secs(values, { effort })))).toEqual([result, code]);
  });

  it('jamais au-delà de max', () => {
    const s = ready();
    for (let i = 0; i < 9; i++) s.run(secs([60, 59, 59]));
    expect(s.state.durationS).toBe(60);
  });

  it('max tenu 2 séances sur un slot à chaîne : CHAIN_NEXT, durée à min', () => {
    const s = calibrated(
      { slot: DURATION_CHAIN, exercise: FRONT_PLANK, grid: NONE, chainSteps: PLANK_CHAIN },
      secs([60, 60, 60]),
    );
    expect(s.state).toMatchObject({ exerciseId: 'front-plank', variantRank: 2, durationS: 20 });
    expect(outcome(s.run(secs([60, 60, 60])))).toEqual(['PROGRESS', 'DURATION_UP']);
    const out = s.run(secs([60, 60, 60]));
    expect(outcome(out)).toEqual(['PROGRESS', 'CHAIN_NEXT']);
    expect(out.decision.nextTarget).toMatchObject({ variantId: 'long-lever-plank', durationS: 20 });
  });

  it('max tenu sans chaîne : pas de variante', () => {
    const s = ready();
    for (let i = 0; i < 8; i++) s.run(secs([60, 60, 60]));
    expect(s.state).toMatchObject({ durationS: 60, variantRank: null });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Ordre strict de 05 §9
// ---------------------------------------------------------------------------------------------------------------

describe('ordre de 05 §9', () => {
  const sc: Scenario = { slot: LINEAR, exercise: SQUAT, grid: BAR };
  const ready = () => calibrated(sc, sets([6, 6, 6], { load: 60000 }));

  it('aucune série faite : IGNORED / NO_DATA, état inchangé', () => {
    const s = ready();
    const before = s.state;
    const notDone = sets([6, 6, 6], { load: 60000 }).map((x) => ({ ...x, loggedAt: null }));
    const out = s.run(notDone, { weekType: 'deload', adj: 'lighten' });
    expect(outcome(out)).toEqual(['IGNORED', 'NO_DATA']);
    expect(out.state).toEqual(before);
    expect(outcome(s.run([]))).toEqual(['IGNORED', 'NO_DATA']);
    expect(outcome(s.run(sets([6, 6, 6], { load: 60000 }).map((x) => ({ ...x, reps: null }))))).toEqual([
      'IGNORED',
      'NO_DATA',
    ]);
  });

  it('aucune série faite sur un nouvel exercice : état neuf', () => {
    const out = scenario(sc).run([]);
    expect(outcome(out)).toEqual(['IGNORED', 'NO_DATA']);
    expect(out.state).toMatchObject({
      calibrationLeft: 3,
      loadG: null,
      noProgressCount: 0,
      lastSessionId: null,
    });
  });

  it('semaine allégée : DELOAD / DELOAD_WEEK, état inchangé', () => {
    const s = ready();
    const out = s.run(sets([6, 6, 6], { load: 60000 }), { weekType: 'deload' });
    expect(outcome(out)).toEqual(['DELOAD', 'DELOAD_WEEK']);
    expect(out.state.loadG).toBe(60000);
    expect(out.state.noProgressCount).toBe(0);
  });

  it("semaine allégée : un next_adjustment = lighten s'applique quand même", () => {
    const out = ready().run(sets([6, 6, 6], { load: 60000 }), { weekType: 'deload', adj: 'lighten' });
    expect(outcome(out)).toEqual(['DELOAD', 'DELOAD_WEEK']);
    expect(out.decision.nextTarget?.loadG).toBe(52500);
  });

  it.each<[NextAdjustment, PainLevel | undefined, DecisionResult, ReasonCode, number]>([
    ['hold', undefined, 'ADJUSTED_HOLD', 'USER_HOLD', 60000],
    ['hold', 'none', 'ADJUSTED_HOLD', 'USER_HOLD', 60000],
    ['hold', 'discomfort', 'ADJUSTED_HOLD', 'PAIN_HOLD', 60000],
    ['lighten', undefined, 'ADJUSTED_LIGHTEN', 'USER_LIGHTEN', 52500],
    ['lighten', 'pain', 'ADJUSTED_LIGHTEN', 'PAIN_LIGHTEN', 52500],
  ])('ajustement %s, douleur %s : %s / %s', (adj, pain, result, code, loadG) => {
    // Séance réussie, effort facile : sans ajustement, la charge monterait.
    const out = ready().run(sets([6, 6, 6], { load: 60000, effort: 'easy' }), { adj, pain });
    expect(outcome(out)).toEqual([result, code]);
    expect(out.decision.nextTarget?.loadG).toBe(loadG);
  });

  it("allègement : roundDown(c × 0,9) au moins un pas sous c (60 kg → 52 500 ; 54 000 n'existe pas)", () => {
    const lighten = (load: number, grid: LoadGrid, exercise: ExerciseSheet) =>
      scenario({ slot: LINEAR, exercise, grid }).run(sets([6, 6, 6], { load }), { adj: 'lighten' }).decision
        .nextTarget?.loadG;
    expect(lighten(60000, BAR, SQUAT)).toBe(52500);
    expect(lighten(22500, BAR, SQUAT)).toBe(20000);
    expect(lighten(21000, BAR, SQUAT)).toBe(20000);
    expect(lighten(20000, BAR, SQUAT)).toBe(20000);
    expect(lighten(14000, DUMBBELLS, CURL)).toBe(12000);
    expect(lighten(2000, DUMBBELLS, CURL)).toBe(2000);
  });

  it('allègement à la charge minimale : on la garde et le slot linear passe en double', () => {
    const out = scenario(sc).run(sets([6, 6, 6], { load: 20000 }), { adj: 'lighten' });
    expect(out.state).toMatchObject({ loadG: 20000, mode: 'double' });
  });

  it('allègement sans charge : variante en moins, −10 % de durée, retour à min', () => {
    const chain = calibrated(
      { slot: CHAIN, exercise: PUSH_UP, grid: NONE, chainSteps: PUSH_UP_CHAIN },
      sets([10, 10, 10]),
    );
    expect(chain.run(sets([10, 10, 10]), { adj: 'lighten' }).state.variantRank).toBe(2);

    const plank = calibrated({ slot: DURATION, exercise: FRONT_PLANK, grid: NONE }, secs([60, 60, 60]));
    for (let i = 0; i < 4; i++) plank.run(secs([60, 60, 59]));
    expect(plank.state.durationS).toBe(40);
    expect(plank.run(secs([40, 40, 40]), { adj: 'lighten' }).state.durationS).toBe(36);

    const bw = calibrated({ slot: DOUBLE, exercise: INCLINE, grid: NONE }, sets([10, 10, 10]));
    bw.run(sets([11, 11, 11]));
    expect(bw.state.targetReps).toBe(12);
    expect(bw.run(sets([11, 11, 11]), { adj: 'lighten' }).state.targetReps).toBe(8);
  });

  it('un ajustement ne compte pas pour la stagnation', () => {
    const s = ready();
    s.run(sets([6, 6, 5], { load: 60000 }));
    expect(s.state.noProgressCount).toBe(1);
    s.run(sets([6, 6, 5], { load: 60000 }), { adj: 'hold' });
    s.run(sets([6, 6, 5], { load: 60000 }), { adj: 'hold' });
    expect(s.state.noProgressCount).toBe(1);
    expect(outcome(s.run(sets([6, 6, 5], { load: 60000 })))).toEqual(['FAIL', 'REPS_UNDER_MIN']);
    expect(s.state.noProgressCount).toBe(2);
  });

  it('un ajustement passe avant la calibration', () => {
    const out = scenario(sc).run(sets([6, 6, 6], { load: 60000, effort: 'easy' }), { adj: 'hold' });
    expect(outcome(out)).toEqual(['ADJUSTED_HOLD', 'USER_HOLD']);
    expect(out.state).toMatchObject({ loadG: 60000, calibrationLeft: 3 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Calibration (05 §9.4, spec §4.3.5)
// ---------------------------------------------------------------------------------------------------------------

describe('calibration', () => {
  const sc: Scenario = { slot: LINEAR, exercise: SQUAT, grid: BAR };

  it.each<[Effort | null, ReasonCode, number, number]>([
    ['easy', 'CALIBRATION_UP', 65000, 2],
    ['ok', 'CALIBRATION_DONE', 60000, 0],
    ['hard', 'CALIBRATION_HOLD', 60000, 2],
    ['failed', 'CALIBRATION_DOWN', 52500, 2],
    [null, 'CALIBRATION_HOLD', 60000, 2],
  ])('première séance, effort %s : %s', (effort, code, loadG, calibrationLeft) => {
    const out = scenario(sc).run(sets([6, 6, 6], { load: 60000, effort }));
    expect(outcome(out)).toEqual(['CALIBRATION', code]);
    expect(out.state).toMatchObject({ loadG, calibrationLeft, noProgressCount: 0 });
  });

  it('une série sous le minimum compte comme un échec', () => {
    expect(outcome(scenario(sc).run(sets([6, 6, 4], { load: 60000, effort: 'ok' })))).toEqual([
      'CALIBRATION',
      'CALIBRATION_DOWN',
    ]);
  });

  it('3e séance : CALIBRATION_END, puis progression normale', () => {
    const s = scenario(sc);
    expect(outcome(s.run(sets([6, 6, 6], { load: 60000, effort: 'hard' })))).toEqual([
      'CALIBRATION',
      'CALIBRATION_HOLD',
    ]);
    s.run(sets([6, 6, 6], { load: 60000, effort: 'hard' }));
    const out = s.run(sets([6, 6, 6], { load: 60000, effort: 'hard' }));
    expect(outcome(out)).toEqual(['CALIBRATION', 'CALIBRATION_END']);
    expect(out.state.calibrationLeft).toBe(0);
    expect(outcome(s.run(sets([6, 6, 6], { load: 60000 })))).toEqual(['PROGRESS', 'LOAD_UP']);
  });

  it('facile en double : +2 pas plafonnés à 10 % sans incrementG', () => {
    const out = scenario({ slot: DOUBLE, exercise: SQUAT, grid: BAR }).run(
      sets([10, 10, 10], { load: 60000, effort: 'easy' }),
    );
    expect(out.state.loadG).toBe(65000);
    const light = scenario({ slot: DOUBLE, exercise: SQUAT, grid: BAR }).run(
      sets([10, 10, 10], { load: 22500, effort: 'easy' }),
    );
    expect(light.state.loadG).toBe(25000);
  });

  it('prudent : facile → +1 pas, aucune hausse avant la 3e séance', () => {
    const s = scenario({ ...sc, profile: 'cautious' });
    expect(outcome(s.run(sets([6, 6, 6], { load: 60000, effort: 'easy' })))).toEqual([
      'CALIBRATION',
      'CALIBRATION_HOLD',
    ]);
    expect(s.state.loadG).toBe(60000);
    s.run(sets([6, 6, 6], { load: 60000, effort: 'easy' }));
    expect(s.state.loadG).toBe(60000);
    const third = s.run(sets([6, 6, 6], { load: 60000, effort: 'easy' }));
    expect(outcome(third)).toEqual(['CALIBRATION', 'CALIBRATION_UP']);
    expect(third.state).toMatchObject({ loadG: 62500, calibrationLeft: 0 });
  });

  it('prudent : correct termine la calibration', () => {
    const out = scenario({ ...sc, profile: 'cautious' }).run(sets([6, 6, 6], { load: 60000, effort: 'ok' }));
    expect(outcome(out)).toEqual(['CALIBRATION', 'CALIBRATION_DONE']);
  });

  it('séance de reprise (resumeGapDays ≥ 14) : règle de calibration', () => {
    const ready = () => calibrated(sc, sets([6, 6, 6], { load: 60000 }));
    // Reprise à 60 × 0,9 arrondi au matériel : 52,5 kg.
    const resume = ready().run(sets([6, 6, 6], { load: 52500, effort: 'easy' }), { resumeGapDays: 14 });
    expect(outcome(resume)).toEqual(['CALIBRATION', 'CALIBRATION_UP']);
    expect(resume.state).toMatchObject({ loadG: 57500, calibrationLeft: 0 });
    const hard = ready().run(sets([6, 6, 6], { load: 52500, effort: 'hard' }), { resumeGapDays: 30 });
    expect(outcome(hard)).toEqual(['CALIBRATION', 'CALIBRATION_END']);
    expect(outcome(ready().run(sets([6, 6, 6], { load: 60000 }), { resumeGapDays: 13 }))).toEqual([
      'PROGRESS',
      'LOAD_UP',
    ]);
  });

  it('sans charge : la première séance fixe le niveau de départ', () => {
    const out = scenario({ slot: CHAIN, exercise: PUSH_UP, grid: NONE, chainSteps: PUSH_UP_CHAIN }).run(
      sets([11, 10, 10], { effort: null }),
    );
    expect(outcome(out)).toEqual(['CALIBRATION', 'CALIBRATION_DONE']);
    expect(out.state).toMatchObject({ variantRank: 3, targetReps: 8, calibrationLeft: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Stagnation (05 §9.6, spec §4.3.11 et §4.3.12)
// ---------------------------------------------------------------------------------------------------------------

describe('stagnation', () => {
  it('linear : k = 1 allègement, k = 2 double [6, 10], k = 3 proposition, puis proposition et allègement', () => {
    const s = calibrated({ slot: LINEAR, exercise: SQUAT, grid: BAR }, sets([6, 6, 6], { load: 60000 }));
    const failAt = (load: number) => () => sets([6, 6, 5], { load });
    s.run(failAt(60000)());
    expect(s.state.noProgressCount).toBe(1);
    s.run(failAt(60000)());
    expect(s.state.noProgressCount).toBe(2);

    const k1 = s.run(failAt(60000)());
    expect(outcome(k1)).toEqual(['STALL', 'STALL_1_LIGHTEN']);
    expect(k1.stalled).toEqual({ rank: 1, propose: false });
    expect(k1.state).toMatchObject({ loadG: 52500, noProgressCount: 0, stallRank: 1, mode: 'linear' });

    const k2 = s.repeat(3, () => sets([5, 5, 5], { load: 52500 }));
    expect(outcome(k2)).toEqual(['STALL', 'STALL_2_DOUBLE']);
    expect(k2.stalled).toEqual({ rank: 2, propose: false });
    expect(k2.decision.nextTarget).toMatchObject({ mode: 'double', loadG: 52500, repsMin: 6, repsMax: 10 });

    const k3 = s.repeat(3, () => sets([5, 5, 5], { load: 52500 }));
    expect(outcome(k3)).toEqual(['STALL', 'STALL_REPLACE_PROPOSED']);
    expect(k3.stalled).toEqual({ rank: 3, propose: true });
    expect(k3.state).toMatchObject({ loadG: 52500, stallRank: 3, noProgressCount: 0 });

    const beyond = s.repeat(3, () => sets([5, 5, 5], { load: 52500 }));
    expect(outcome(beyond)).toEqual(['STALL', 'STALL_REPLACE_PROPOSED']);
    expect(beyond.stalled).toEqual({ rank: 3, propose: true });
    expect(beyond.state).toMatchObject({ loadG: 45000, stallRank: 3, noProgressCount: 0 });
  });

  it('double : k = 1 allègement et retour à min, k = 2 proposition, puis proposition et allègement', () => {
    const s = calibrated({ slot: DOUBLE, exercise: SQUAT, grid: BAR }, sets([9, 9, 9], { load: 60000 }));
    expect(outcome(s.run(sets([10, 10, 9], { load: 60000 })))).toEqual(['PROGRESS', 'REPS_UP']);
    const k1 = s.repeat(3, () => sets([10, 10, 9], { load: 60000 }));
    expect(outcome(k1)).toEqual(['STALL', 'STALL_1_LIGHTEN']);
    expect(k1.stalled).toEqual({ rank: 1, propose: false });
    expect(k1.decision.nextTarget).toMatchObject({ loadG: 52500, repsMin: 8 });

    const k2 = s.repeat(3, () => sets([10, 10, 9], { load: 52500 }));
    expect(outcome(k2)).toEqual(['STALL', 'STALL_REPLACE_PROPOSED']);
    expect(k2.stalled).toEqual({ rank: 2, propose: true });
    expect(k2.state.loadG).toBe(52500);

    const beyond = s.repeat(3, () => sets([10, 10, 9], { load: 52500 }));
    expect(beyond.stalled).toEqual({ rank: 2, propose: true });
    expect(beyond.state).toMatchObject({ loadG: 45000, stallRank: 2, noProgressCount: 0 });
  });

  it('chain : k = 1 STALL_RESET_MIN dans la même variante, k = 2 proposition, au-delà sans allègement', () => {
    const s = calibrated(
      { slot: CHAIN, exercise: INCLINE, grid: NONE, chainSteps: PUSH_UP_CHAIN },
      sets([10, 10, 10]),
    );
    s.run(sets([11, 11, 11]));
    expect(s.state.targetReps).toBe(12);
    const k1 = s.repeat(3, () => sets([11, 11, 11]));
    expect(outcome(k1)).toEqual(['STALL', 'STALL_RESET_MIN']);
    expect(k1.stalled).toEqual({ rank: 1, propose: false });
    expect(k1.state).toMatchObject({ variantRank: 2, targetReps: 8 });
    const k2 = s.repeat(3, () => sets([11, 11, 11]));
    expect(outcome(k2)).toEqual(['STALL', 'STALL_REPLACE_PROPOSED']);
    expect(k2.stalled).toEqual({ rank: 2, propose: true });
    const beyond = s.repeat(3, () => sets([11, 11, 11]));
    expect(beyond.stalled).toEqual({ rank: 2, propose: true });
    expect(beyond.state).toMatchObject({ variantRank: 2, targetReps: 8 });
  });

  it('duration : k = 1 STALL_RESET_MIN, k = 2 proposition', () => {
    const s = calibrated({ slot: DURATION, exercise: FRONT_PLANK, grid: NONE }, secs([30, 30, 30]));
    s.run(secs([30, 30, 30]));
    expect(s.state.durationS).toBe(25);
    const k1 = s.repeat(3, () => secs([25, 25, 22]));
    expect(outcome(k1)).toEqual(['STALL', 'STALL_RESET_MIN']);
    expect(k1.state.durationS).toBe(20);
    const k2 = s.repeat(3, () => secs([20, 20, 16]));
    expect(outcome(k2)).toEqual(['STALL', 'STALL_REPLACE_PROPOSED']);
    expect(k2.stalled).toEqual({ rank: 2, propose: true });
  });

  it('un record du moteur remet le compteur et k à 0 ; un simple progrès ne remet que le compteur', () => {
    const s = calibrated({ slot: LINEAR, exercise: SQUAT, grid: BAR }, sets([6, 6, 6], { load: 60000 }));
    s.repeat(3, () => sets([6, 6, 5], { load: 60000 }));
    expect(s.state).toMatchObject({ loadG: 52500, stallRank: 1 });
    s.run(sets([6, 6, 5], { load: 52500 }));
    expect(s.state.noProgressCount).toBe(1);
    s.run(sets([6, 6, 6], { load: 52500 }));
    expect(s.state).toMatchObject({ loadG: 57500, stallRank: 1, noProgressCount: 0 });
    s.run(sets([6, 6, 6], { load: 57500 }));
    expect(s.state).toMatchObject({ loadG: 62500, stallRank: 1 });
    s.run(sets([6, 6, 5], { load: 62500 }));
    expect(s.state).toMatchObject({ stallRank: 0, noProgressCount: 0 });
  });

  it('record en répétitions à la meilleure charge', () => {
    const s = calibrated({ slot: DOUBLE, exercise: SQUAT, grid: BAR }, sets([9, 9, 9], { load: 60000 }));
    s.repeat(3, () => sets([9, 9, 9], { load: 60000 }));
    expect(s.state).toMatchObject({ stallRank: 1, loadG: 52500 });
    s.run(sets([10, 10, 10], { load: 60000 }));
    expect(s.state).toMatchObject({ stallRank: 0, noProgressCount: 0 });
  });

  it('les séances non valides ne comptent pas (IGNORED, DELOAD, ajustement, calibration)', () => {
    const s = calibrated({ slot: LINEAR, exercise: SQUAT, grid: BAR }, sets([6, 6, 6], { load: 60000 }));
    s.run(sets([6, 6, 5], { load: 60000 }));
    s.run([]);
    s.run(sets([6, 6, 5], { load: 60000 }), { weekType: 'deload' });
    s.run(sets([6, 6, 5], { load: 60000 }), { adj: 'hold' });
    s.run(sets([6, 6, 5], { load: 54000, effort: 'hard' }), { resumeGapDays: 20 });
    expect(s.state.noProgressCount).toBe(1);
  });

  it('une progression fixed ne stagne jamais', () => {
    const s = scenario({ slot: { ...LINEAR, progression: { type: 'fixed' } }, exercise: SQUAT, grid: BAR });
    const last = s.repeat(6, () => sets([6, 6, 5], { load: 40000 }));
    expect(outcome(last)).toEqual(['HOLD', 'NO_PROGRESS']);
    expect(s.state).toMatchObject({ noProgressCount: 0, stallRank: 0, loadG: 40000 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Profil prudent (05 §14) et unilatéral (§4.3.3)
// ---------------------------------------------------------------------------------------------------------------

describe('profil prudent', () => {
  it("hausse d'un seul pas", () => {
    const s = calibrated(
      { slot: LINEAR, exercise: SQUAT, grid: BAR, profile: 'cautious' },
      sets([6, 6, 6], { load: 60000 }),
    );
    const out = s.run(sets([6, 6, 6], { load: 60000 }));
    expect(outcome(out)).toEqual(['PROGRESS', 'LOAD_UP']);
    expect(out.state.loadG).toBe(62500);
  });

  it('targetRir ≥ 3 : difficile ne valide pas', () => {
    const s = calibrated(
      { slot: LINEAR, exercise: SQUAT, grid: BAR, profile: 'cautious' },
      sets([6, 6, 6], { load: 60000 }),
    );
    expect(outcome(s.run(sets([6, 6, 6], { load: 60000, effort: 'hard' })))).toEqual([
      'HOLD',
      'EFFORT_NOT_VALIDATED',
    ]);
  });

  it.each<[string, SlotSpec, number, number]>([
    ['linear 3 × 5 → 6', { ...LINEAR, sets: [work({ reps: { min: 5, max: 5 } })] }, 6, 6],
    ['double 4–6 → 6–8', { ...DOUBLE, sets: [work({ reps: { min: 4, max: 6 } })] }, 6, 8],
    ['double 10–20 → 10–15', { ...DOUBLE, sets: [work({ reps: { min: 10, max: 20 } })] }, 10, 15],
    ['double 14–16 → 13–15', { ...DOUBLE, sets: [work({ reps: { min: 14, max: 16 } })] }, 13, 15],
  ])('répétitions ramenées dans [6, 15] : %s', (_, slot, repsMin, repsMax) => {
    const out = scenario({ slot, exercise: SQUAT, grid: BAR, profile: 'cautious' }).run(
      sets([6, 6, 6], { load: 40000 }),
    );
    expect(out.decision.nextTarget).toMatchObject({ repsMin, repsMax });
  });

  it('au plus 3 séries de travail : 3 séries faites ne manquent pas', () => {
    const slot = { ...LINEAR, sets: [work({ count: 5, reps: { min: 6, max: 6 } })] };
    const s = calibrated(
      { slot, exercise: SQUAT, grid: BAR, profile: 'cautious' },
      sets([6, 6, 6], { load: 60000 }),
    );
    const out = s.run(sets([6, 6, 6], { load: 60000 }));
    expect(outcome(out)).toEqual(['PROGRESS', 'LOAD_UP']);
    expect(out.decision.nextTarget?.workSets).toBe(3);
    const adult = calibrated({ slot, exercise: SQUAT, grid: BAR }, sets([6, 6, 6, 6, 6], { load: 60000 }));
    expect(outcome(adult.run(sets([6, 6, 6], { load: 60000 })))).toEqual(['HOLD', 'SETS_MISSING']);
  });
});

describe('unilatéral : une série = une paire gauche / droite (§4.3.3)', () => {
  const sc: Scenario = { slot: LINEAR, exercise: LUNGE, grid: BAR };
  const ready = () => calibrated(sc, pairs([6, 6, 6], [6, 6, 6], { load: 40000 }));
  const run = (left: number[], right: (number | null)[], o: SetOptions = {}) =>
    outcome(ready().run(pairs(left, right, { load: 40000, ...o })));

  it('répétitions = minimum des deux côtés', () => {
    expect(run([6, 6, 6], [6, 5, 6])).toEqual(['FAIL', 'REPS_UNDER_MIN']);
    expect(run([6, 7, 6], [6, 6, 6])).toEqual(['PROGRESS', 'LOAD_UP']);
  });

  it('une paire incomplète ne compte pas : SETS_MISSING', () => {
    expect(run([6, 6, 6], [6, 6, null])).toEqual(['HOLD', 'SETS_MISSING']);
  });

  it("l'effort peut être noté sur l'une ou l'autre ligne", () => {
    const lines = pairs([6, 6, 6], [6, 6, 6], { load: 40000, effort: null }).map((l, i) =>
      i === 4 ? { ...l, effort: 'ok' as const } : l,
    );
    expect(outcome(ready().run(lines))).toEqual(['PROGRESS', 'LOAD_UP']);
  });
});

describe('douleur : painStreak (05 §13.7)', () => {
  it('compte les séances de suite en douleur, seulement quand painLevel est stocké', () => {
    const s = calibrated({ slot: LINEAR, exercise: SQUAT, grid: BAR }, sets([6, 6, 6], { load: 60000 }));
    expect(s.run(sets([6, 6, 6], { load: 60000 }), { pain: 'pain', adj: 'lighten' }).painStreak).toBe(1);
    expect(s.run(sets([6, 6, 6], { load: 52500 }), { pain: 'pain', adj: 'lighten' }).painStreak).toBe(2);
    expect(s.state.painStreak).toBe(2);
    expect(s.run(sets([6, 6, 6], { load: 47500 }), { pain: 'discomfort', adj: 'hold' }).painStreak).toBe(0);
    expect(s.run([], { pain: 'pain' }).painStreak).toBe(1);
    const unknown = s.run(sets([6, 6, 6], { load: 47500 }), { adj: 'lighten' });
    expect(unknown.painStreak).toBeNull();
    expect(unknown.state.painStreak).toBe(0);
  });

  it("sans painLevel, même état qu'avec (retrait du consentement, spec §4.4.3), hors codes PAIN_*", () => {
    const run = (pain: PainLevel | undefined) => {
      const s = calibrated({ slot: LINEAR, exercise: SQUAT, grid: BAR }, sets([6, 6, 6], { load: 60000 }));
      const out = s.run(sets([6, 6, 6], { load: 60000 }), { pain, adj: 'lighten' });
      return { out, state: { ...s.state, painStreak: 0 } };
    };
    const withPain = run('pain');
    const without = run(undefined);
    expect(without.state).toEqual(withPain.state);
    expect(withPain.out.decision.reasonCode).toBe('PAIN_LIGHTEN');
    expect(without.out.decision.reasonCode).toBe('USER_LIGHTEN');
  });
});
