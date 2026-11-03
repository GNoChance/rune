/*
 * `planWorkout` (spec brique 3 §4.2, §4.3.5 à §4.3.10, §7.2) : séance prévue à partir du rejeu, exercices résolus
 * selon le lieu, séries d'échauffement et de travail avec leurs cibles figées, disques et avis.
 */
import {
  type EquipmentCode,
  type ExerciseLevel,
  REFERENCE_PROFILES,
  type SetSpec,
  type SlotSpec,
} from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import {
  type PlanInput,
  type PlannedExercise,
  type PlannedSet,
  type PlannedWorkout,
  planWorkout,
} from '../../src/program/plan';
import { initialProgramState, type ProgramState } from '../../src/program/program-state';
import { type ReplayResult, replayInstance } from '../../src/program/replay';
import type { PlanSheet } from '../../src/program/resolve';
import { type SessionRecord, type SetRecord, type SlotState, slotStateId } from '../../src/program/types';
import { GYM_AB, gymAb, PROGRAM_CATALOG, place, programSheet } from '../fixtures/program';

const fail = (what: string): never => {
  throw new Error(`${what} absent`);
};

const INSTANCE = 'inst-1';

/** Catalogue des programmes avec sa mesure : les gainages se tiennent en secondes, le reste se compte en répétitions. */
const CATALOG: PlanSheet[] = PROGRAM_CATALOG.map((s) => ({
  ...s,
  measure: s.movement_pattern === 'core_anti_extension' ? 'duration' : 'reps',
}));

const GYM = place('gym', REFERENCE_PROFILES.gym_reference);
const HOME = place('home', REFERENCE_PROFILES.home_bodyweight, 'home');
const gymWithout = (...codes: EquipmentCode[]) =>
  place(
    'gym-2',
    REFERENCE_PROFILES.gym_reference.filter((c) => !codes.includes(c)),
  );

function slotState(slotId: string, exerciseId: string, over: Partial<SlotState> = {}): SlotState {
  return {
    id: slotStateId(INSTANCE, slotId, exerciseId),
    instanceId: INSTANCE,
    slotId,
    exerciseId,
    mode: 'linear',
    loadG: null,
    targetReps: null,
    variantRank: null,
    durationS: null,
    machineStepGOverride: null,
    calibrationLeft: 0,
    noProgressCount: 0,
    stallRank: 0,
    painStreak: 0,
    suspended: false,
    lastSessionId: 's-0',
    rulesVersion: '1',
    ...over,
  };
}

/** Squat à la barre à 60 kg, calibration finie. */
const SQUAT_60 = slotState('A1', 'back-squat', { loadG: 60_000, targetReps: 6 });

type ReplayOptions = { states?: SlotState[]; state?: Partial<ProgramState>; suspended?: string[] };

/** Rejeu fabriqué : programme sans changement, état du programme et `slot_state` donnés. */
function replayOf(template = GYM_AB, o: ReplayOptions = {}): ReplayResult {
  const program = { template, daysPerWeek: 3, suspended: new Set(o.suspended ?? []) };
  return {
    slotStates: o.states ?? [],
    decisions: [],
    events: [],
    program,
    state: { ...initialProgramState(program), ...o.state },
  };
}

function plan(over: Partial<PlanInput> = {}): PlannedWorkout {
  return planWorkout({
    replay: replayOf(),
    workoutId: 'A',
    place: GYM,
    catalog: CATALOG,
    profile: 'adult',
    ageBand: 'adult',
    context: 'gym',
    today: '2026-11-01',
    lastLoadByExercise: new Map(),
    maxLevel: 1,
    ...over,
  });
}

const exerciseOf = (p: PlannedWorkout, slotId: string): PlannedExercise =>
  p.exercises.find((e) => e.slotId === slotId) ?? fail(`slot ${slotId}`);
const workSets = (e: PlannedExercise) => e.sets.filter((s) => s.kind === 'work');
const warmups = (e: PlannedExercise) => e.sets.filter((s) => s.kind === 'warmup');

/** Séance A réduite à un slot de mollets par nombre de séries de travail et RIR (05 §10.3). */
function calfWorkout(...groups: { id: string; set: SetSpec }[]) {
  return gymAb((t) => {
    const [a] = t.workouts;
    if (a === undefined) return;
    a.slots = groups.map(
      ({ id, set }): SlotSpec => ({
        id,
        movementPattern: 'calf_raise',
        role: 'accessory',
        exercises: ['calf-raise'],
        sets: [set],
        progression: { type: 'double' },
      }),
    );
  });
}
const calf = (id: string, count: number, targetRir: number, min = 10, max = 15) => ({
  id,
  set: { kind: 'work', count, reps: { min, max }, targetRir, restS: 60 } satisfies SetSpec,
});

const workLine = (position: number, over: Partial<PlannedSet> = {}): PlannedSet => ({
  kind: 'work',
  position,
  side: null,
  targetRepsMin: null,
  targetRepsMax: null,
  targetReps: null,
  targetDurationS: null,
  targetLoadG: null,
  targetRir: null,
  targetVariant: null,
  ...over,
});

describe('planWorkout : séance et cibles de travail', () => {
  it("séance, type de semaine et version des règles de l'appli", () => {
    const p = plan({ replay: replayOf(GYM_AB, { states: [SQUAT_60] }) });
    expect(p.workoutId).toBe('A');
    expect(p.weekType).toBe('normal');
    expect(p.rulesVersion).toBe('1');
    expect(p.notices).toEqual([]);
    expect(p.exercises.map((e) => e.slotId)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
  });

  it('cibles du slot_state : 3 × 6 à 60 kg, RIR 2, repos 150 s, disques par côté', () => {
    const e = exerciseOf(plan({ replay: replayOf(GYM_AB, { states: [SQUAT_60] }) }), 'A1');
    expect(e).toMatchObject({
      slotId: 'A1',
      plannedExerciseId: 'back-squat',
      exerciseId: 'back-squat',
      resolution: 'planned',
      loadMode: 'barbell',
      measure: 'reps',
      unilateral: false,
      restS: 150,
      platesPerSide: [20_000],
      calibration: false,
      suggestionG: null,
    });
    expect(workSets(e)).toEqual(
      [1, 2, 3].map((n) =>
        workLine(n, { targetRepsMin: 6, targetRepsMax: 6, targetLoadG: 60_000, targetRir: 2 }),
      ),
    );
  });

  it("slot double : la fourchette du modèle, et la visée par série de l'état (ruling R57)", () => {
    const row = slotState('A3', 'barbell-row', { mode: 'double', loadG: 50_000, targetReps: 10 });
    const e = exerciseOf(plan({ replay: replayOf(GYM_AB, { states: [row] }) }), 'A3');
    expect(workSets(e).map((s) => [s.targetRepsMin, s.targetRepsMax, s.targetReps, s.targetLoadG])).toEqual(
      Array(3).fill([8, 12, 10, 50_000]),
    );
  });

  it('cible faite ailleurs : ramenée par roundDown à la grille du lieu du jour (§4.3.10)', () => {
    const squat = { ...SQUAT_60, loadG: 61_000 };
    const e = exerciseOf(plan({ replay: replayOf(GYM_AB, { states: [squat] }) }), 'A1');
    expect(workSets(e).map((s) => s.targetLoadG)).toEqual([60_000, 60_000, 60_000]);
    expect(e.platesPerSide).toEqual([20_000]);
  });

  it("grille sans charge plus légère : la plus légère du lieu, avec l'avis lightest_load", () => {
    const lunge = slotState('B4', 'dumbbell-lunge', { mode: 'double', loadG: 1000 });
    const p = plan({ replay: replayOf(GYM_AB, { states: [lunge] }), workoutId: 'B' });
    expect(workSets(exerciseOf(p, 'B4')).map((s) => s.targetLoadG)).toEqual([2000, 2000, 2000, 2000]);
    expect(p.notices).toEqual([{ code: 'lightest_load', exerciseId: 'dumbbell-lunge' }]);
  });

  it('pas de machine corrigé (slot_state) : la grille de cette machine', () => {
    const press = slotState('A1', 'leg-press', { mode: 'double', loadG: 47_500, machineStepGOverride: 2500 });
    const place = gymWithout('barbell', 'dumbbells');
    const e = exerciseOf(plan({ replay: replayOf(GYM_AB, { states: [press] }), place }), 'A1');
    expect(e.exerciseId).toBe('leg-press');
    expect(e.resolution).toBe('replaced_not_feasible');
    expect(workSets(e).map((s) => s.targetLoadG)).toEqual([47_500, 47_500, 47_500]);
    expect(e.platesPerSide).toBeNull();
  });

  it("slot linear sans charge au lieu du jour : fourchette double [r, r + 4], pas d'échauffement", () => {
    const e = exerciseOf(plan({ place: HOME }), 'A1');
    expect(e.exerciseId).toBe('bodyweight-squat');
    expect(e.loadMode).toBe('bodyweight');
    expect(warmups(e)).toEqual([]);
    expect(workSets(e).map((s) => [s.targetRepsMin, s.targetRepsMax, s.targetLoadG])).toEqual([
      [6, 10, null],
      [6, 10, null],
      [6, 10, null],
    ]);
  });

  it("chaîne en durée : variante de l'état, durée visée, variante figée sur chaque ligne", () => {
    const plank = slotState('A5', 'front-plank', { mode: 'duration', durationS: 40, variantRank: 2 });
    const e = exerciseOf(plan({ replay: replayOf(GYM_AB, { states: [plank] }) }), 'A5');
    expect(e).toMatchObject({
      exerciseId: 'front-plank',
      resolution: 'planned',
      measure: 'duration',
      loadMode: 'bodyweight',
      restS: 60,
    });
    expect(workSets(e)).toEqual(
      [1, 2, 3].map((n) => workLine(n, { targetDurationS: 40, targetRir: 2, targetVariant: 'front-plank' })),
    );
  });
});

describe('planWorkout : échauffement', () => {
  it('50 % de 60 kg → 30 000, 2 × 5 avant les séries de travail', () => {
    const e = exerciseOf(plan({ replay: replayOf(GYM_AB, { states: [SQUAT_60] }) }), 'A1');
    expect(e.sets.map((s) => s.kind)).toEqual(['warmup', 'warmup', 'work', 'work', 'work']);
    expect(warmups(e)).toEqual(
      [1, 2].map((position) => ({
        kind: 'warmup',
        position,
        side: null,
        targetRepsMin: 5,
        targetRepsMax: 5,
        targetReps: null,
        targetDurationS: null,
        targetLoadG: 30_000,
        targetRir: null,
        targetVariant: null,
      })),
    );
  });

  it('50 % de 25 kg → 20 000 : au moins la barre', () => {
    const squat = { ...SQUAT_60, loadG: 25_000 };
    const e = exerciseOf(plan({ replay: replayOf(GYM_AB, { states: [squat] }) }), 'A1');
    expect(warmups(e).map((s) => s.targetLoadG)).toEqual([20_000, 20_000]);
  });

  it('charge de travail inconnue (calibration) : échauffement sans charge', () => {
    const e = exerciseOf(plan(), 'A1');
    expect(warmups(e).map((s) => s.targetLoadG)).toEqual([null, null]);
  });
});

describe('planWorkout : semaine allégée (05 §10.3)', () => {
  const T = calfWorkout(calf('C3', 3, 2), calf('C4', 4, 4), calf('C5', 5, 2));

  it('séries de travail divisées par deux arrondi au-dessus : 3 → 2, 4 → 2, 5 → 3', () => {
    const p = plan({ replay: replayOf(T, { state: { deloadSessionsLeft: 3 } }) });
    expect(p.weekType).toBe('deload');
    expect(p.exercises.map((e) => workSets(e).length)).toEqual([2, 2, 3]);
    expect(p.notices).toEqual([{ code: 'deload' }]);
  });

  it('RIR + 2 plafonné à 5 : 2 → 4, 4 → 5', () => {
    const p = plan({ replay: replayOf(T, { state: { deloadSessionsLeft: 3 } }) });
    expect(p.exercises.map((e) => workSets(e)[0]?.targetRir)).toEqual([4, 5, 4]);
  });

  it('semaine normale : séries et RIR du modèle', () => {
    const p = plan({ replay: replayOf(T) });
    expect(p.exercises.map((e) => workSets(e).length)).toEqual([3, 4, 5]);
    expect(p.exercises.map((e) => workSets(e)[0]?.targetRir)).toEqual([2, 4, 2]);
  });

  it('charges inchangées, échauffement inchangé', () => {
    const p = plan({ replay: replayOf(GYM_AB, { states: [SQUAT_60], state: { deloadSessionsLeft: 1 } }) });
    const e = exerciseOf(p, 'A1');
    expect(workSets(e).map((s) => [s.targetLoadG, s.targetRir])).toEqual([
      [60_000, 4],
      [60_000, 4],
    ]);
    expect(warmups(e).map((s) => s.targetLoadG)).toEqual([30_000, 30_000]);
  });

  it('semaine allégée planifiée du bloc (5e semaine)', () => {
    const planned = calfWorkout(calf('C3', 3, 2));
    planned.block = { mode: 'planned', weeks: 5, deloadWeek: 5 };
    expect(plan({ replay: replayOf(planned, { state: { blockWeek: 5 } }) }).weekType).toBe('deload');
    expect(plan({ replay: replayOf(planned, { state: { blockWeek: 4 } }) }).weekType).toBe('normal');
  });
});

describe('planWorkout : profil prudent (05 §14)', () => {
  const T = calfWorkout(calf('C5', 5, 2, 4, 6));

  it('4–6 → 6–8, 5 séries → 3, RIR 2 → 3', () => {
    const e = exerciseOf(plan({ replay: replayOf(T), profile: 'cautious' }), 'C5');
    expect(workSets(e).map((s) => [s.targetRepsMin, s.targetRepsMax, s.targetRir])).toEqual([
      [6, 8, 3],
      [6, 8, 3],
      [6, 8, 3],
    ]);
  });

  it('adulte : bornes du modèle', () => {
    const e = exerciseOf(plan({ replay: replayOf(T) }), 'C5');
    expect(workSets(e).map((s) => [s.targetRepsMin, s.targetRepsMax, s.targetRir])).toEqual(
      Array(5).fill([4, 6, 2]),
    );
  });

  it('3 × 6 reste valable', () => {
    const p = plan({ replay: replayOf(GYM_AB, { states: [SQUAT_60] }), profile: 'cautious' });
    const e = exerciseOf(p, 'A1');
    expect(workSets(e).map((s) => [s.targetRepsMin, s.targetRepsMax, s.targetRir])).toEqual(
      Array(3).fill([6, 6, 3]),
    );
  });

  it('prudent en semaine allégée : 5 → 3 → 2 séries, RIR 3 + 2 = 5', () => {
    const p = plan({ replay: replayOf(T, { state: { deloadSessionsLeft: 3 } }), profile: 'cautious' });
    expect(workSets(exerciseOf(p, 'C5')).map((s) => s.targetRir)).toEqual([5, 5]);
  });
});

describe('planWorkout : reprise après absence (05 §10.4, spec §4.3.9)', () => {
  const after = (lastCompletedStartedAt: string, states: SlotState[] = [SQUAT_60]) =>
    plan({ replay: replayOf(GYM_AB, { states, state: { lastCompletedStartedAt } }) });

  it('14 jours : 60 kg → 52 500 (−10 % puis roundDown), avis resume', () => {
    const p = after('2026-10-18T17:00:00.000Z');
    const e = exerciseOf(p, 'A1');
    expect(workSets(e).map((s) => s.targetLoadG)).toEqual([52_500, 52_500, 52_500]);
    expect(warmups(e).map((s) => s.targetLoadG)).toEqual([25_000, 25_000]);
    expect(p.notices).toEqual([{ code: 'resume', days: 14, pct: 10 }]);
  });

  it("séance de reprise : pas de calibration à l'écran, la cible réduite est proposée", () => {
    for (const last of ['2026-10-18T17:00:00.000Z', '2026-10-04T17:00:00.000Z']) {
      const e = exerciseOf(
        plan({
          replay: replayOf(GYM_AB, { states: [SQUAT_60], state: { lastCompletedStartedAt: last } }),
          lastLoadByExercise: new Map([['back-squat', 60_000]]),
        }),
        'A1',
      );
      expect(e.calibration).toBe(false);
      expect(e.suggestionG).toBeNull();
      expect(workSets(e)[0]?.targetLoadG).not.toBeNull();
    }
  });

  it('13 jours : rien ne change', () => {
    const p = after('2026-10-19T17:00:00.000Z');
    expect(workSets(exerciseOf(p, 'A1')).map((s) => s.targetLoadG)).toEqual([60_000, 60_000, 60_000]);
    expect(p.notices).toEqual([]);
  });

  it('28 jours : −20 % et une variante de chaîne en moins', () => {
    const plank = slotState('A5', 'front-plank', { mode: 'duration', durationS: 40, variantRank: 2 });
    const p = after('2026-10-04T17:00:00.000Z', [SQUAT_60, plank]);
    expect(workSets(exerciseOf(p, 'A1')).map((s) => s.targetLoadG)).toEqual([47_500, 47_500, 47_500]);
    const e = exerciseOf(p, 'A5');
    expect(e).toMatchObject({
      plannedExerciseId: 'kneeling-plank',
      exerciseId: 'kneeling-plank',
      resolution: 'planned',
    });
    expect(workSets(e).map((s) => [s.targetDurationS, s.targetVariant])).toEqual(
      Array(3).fill([32, 'kneeling-plank']),
    );
    expect(p.notices).toEqual([{ code: 'resume', days: 28, pct: 20 }]);
  });

  it("écart négatif (dernière séance datée après aujourd'hui) : ramené à 0, ni avis ni baisse", () => {
    const p = after('2026-11-20T10:00:00.000Z');
    expect(workSets(exerciseOf(p, 'A1')).map((s) => s.targetLoadG)).toEqual([60_000, 60_000, 60_000]);
    expect(p.notices).toEqual([]);
  });
});

describe('planWorkout : répétitions visées par série (ruling R57)', () => {
  const ROW = slotState('A3', 'barbell-row', { mode: 'double', loadG: 50_000, targetReps: 10 });

  it("la visée sur chaque série de travail, aucune sur l'échauffement", () => {
    // Squat passé en double : fourchette [6, 10], visée 7, échauffement à 50 % de 60 kg.
    const squat = { ...SQUAT_60, mode: 'double' as const, targetReps: 7 };
    const e = exerciseOf(plan({ replay: replayOf(GYM_AB, { states: [squat] }) }), 'A1');
    expect(warmups(e).map((s) => [s.targetRepsMin, s.targetReps])).toEqual([
      [5, null],
      [5, null],
    ]);
    expect(workSets(e).map((s) => [s.targetRepsMin, s.targetRepsMax, s.targetReps])).toEqual(
      Array(3).fill([6, 10, 7]),
    );
  });

  it('ramenée dans la fourchette du jour : 15 → 12, 6 → 8', () => {
    for (const [targetReps, aim] of [
      [15, 12],
      [6, 8],
    ]) {
      const row = { ...ROW, targetReps };
      const e = exerciseOf(plan({ replay: replayOf(GYM_AB, { states: [row] }) }), 'A3');
      expect(workSets(e).map((s) => s.targetReps)).toEqual([aim, aim, aim]);
    }
  });

  it("aucune visée sans état, sans visée dans l'état, ni pour un nombre fixe (3 × 6)", () => {
    expect(workSets(exerciseOf(plan(), 'A3')).map((s) => s.targetReps)).toEqual([null, null, null]);
    const empty = { ...ROW, targetReps: null };
    const e = exerciseOf(plan({ replay: replayOf(GYM_AB, { states: [empty] }) }), 'A3');
    expect(workSets(e).map((s) => s.targetReps)).toEqual([null, null, null]);
    const squat = exerciseOf(plan({ replay: replayOf(GYM_AB, { states: [SQUAT_60] }) }), 'A1');
    expect(workSets(squat).map((s) => [s.targetRepsMin, s.targetRepsMax, s.targetReps])).toEqual(
      Array(3).fill([6, 6, null]),
    );
  });

  it('aucune visée en semaine allégée ni à la reprise : la fourchette suffit', () => {
    const deload = plan({ replay: replayOf(GYM_AB, { states: [ROW], state: { deloadSessionsLeft: 1 } }) });
    expect(deload.weekType).toBe('deload');
    expect(workSets(exerciseOf(deload, 'A3')).map((s) => s.targetReps)).toEqual([null, null]);
    const resume = plan({
      replay: replayOf(GYM_AB, {
        states: [ROW],
        state: { lastCompletedStartedAt: '2026-10-18T17:00:00.000Z' },
      }),
    });
    expect(resume.notices).toContainEqual({ code: 'resume', days: 14, pct: 10 });
    expect(workSets(exerciseOf(resume, 'A3')).map((s) => s.targetReps)).toEqual([null, null, null]);
  });

  it('en durée : aucune visée de répétitions', () => {
    const plank = slotState('A5', 'front-plank', { mode: 'duration', durationS: 40, variantRank: 2 });
    const e = exerciseOf(plan({ replay: replayOf(GYM_AB, { states: [plank] }) }), 'A5');
    expect(workSets(e).map((s) => s.targetReps)).toEqual([null, null, null]);
  });

  describe('chaîne en répétitions', () => {
    // Pompes de test : à genoux (rang 1), sur un banc (rang 2, banc requis), archer (rang 3, la dernière).
    const step = (id: string, extra: Partial<PlanSheet>): PlanSheet => ({
      ...programSheet(id, 'horizontal_push', { primary: ['chest', 'triceps'] }, [[]], {
        chain_id: 'push-chain',
        ...extra,
      }),
      measure: 'reps',
    });
    const catalog = [
      ...CATALOG,
      step('knee-push-up', { harder_id: 'bench-push-up' }),
      step('bench-push-up', {
        easier_id: 'knee-push-up',
        harder_id: 'archer-push-up',
        equipment_options: [['flat_bench']],
      }),
      step('archer-push-up', { easier_id: 'bench-push-up', not_for_minors: true }),
    ];
    const template = gymAb((t) => {
      const [a] = t.workouts;
      if (a === undefined) return;
      a.slots = [
        {
          id: 'P1',
          movementPattern: 'horizontal_push',
          role: 'main',
          chain: 'push-chain',
          sets: [{ kind: 'work', count: 3, reps: { min: 8, max: 12 }, targetRir: 2, restS: 90 }],
          progression: { type: 'chain' },
        },
      ];
    });
    const onChain = (variantRank: number, targetReps: number, over: Partial<PlanInput> = {}) => {
      const state = slotState('P1', 'push-chain', { mode: 'chain', variantRank, targetReps });
      return exerciseOf(plan({ replay: replayOf(template, { states: [state] }), catalog, ...over }), 'P1');
    };
    const targets = (e: PlannedExercise) =>
      workSets(e).map((s) => [s.targetRepsMin, s.targetRepsMax, s.targetReps, s.targetVariant]);

    it("variante de l'état faisable : la visée de l'état", () => {
      const e = onChain(2, 10);
      expect(e.exerciseId).toBe('bench-push-up');
      expect(targets(e)).toEqual(Array(3).fill([8, 12, 10, 'bench-push-up']));
    });

    it("variante de l'état pas faisable ici, variante plus facile prise : la fourchette seule", () => {
      const e = onChain(2, 10, { place: HOME });
      expect(e.exerciseId).toBe('knee-push-up');
      expect(targets(e)).toEqual(Array(3).fill([8, 12, null, 'knee-push-up']));
    });

    it('dernière variante : fourchette prolongée à 25 pour un adulte, visée ramenée dedans', () => {
      expect(targets(onChain(3, 18))).toEqual(Array(3).fill([8, 25, 18, 'archer-push-up']));
      expect(targets(onChain(3, 30))).toEqual(Array(3).fill([8, 25, 25, 'archer-push-up']));
    });

    it("profil prudent, chaîne coupée avant l'archer : rang de l'état ramené dans la chaîne, visée gardée", () => {
      const e = onChain(3, 10, { profile: 'cautious' });
      expect(e.exerciseId).toBe('bench-push-up');
      expect(workSets(e).map((s) => s.targetReps)).toEqual([10, 10, 10]);
    });
  });
});

describe('planWorkout : unilatéral', () => {
  it('exercice unilatéral 3 séries → 6 lignes, gauche puis droite à chaque position', () => {
    const t = gymAb((x) => {
      const b4 = x.workouts[1]?.slots[3];
      if (b4 !== undefined) b4.sets = [{ kind: 'work', count: 3, reps: { min: 8, max: 12 }, restS: 90 }];
    });
    const e = exerciseOf(plan({ replay: replayOf(t), workoutId: 'B' }), 'B4');
    expect(e.unilateral).toBe(true);
    expect(e.sets.map((s) => [s.position, s.side])).toEqual([
      [1, 'left'],
      [1, 'right'],
      [2, 'left'],
      [2, 'right'],
      [3, 'left'],
      [3, 'right'],
    ]);
  });
});

describe('planWorkout : calibration (spec §4.3.5)', () => {
  it('exercice nouveau dans le slot : suggestion = dernière charge faite, aucune cible de charge', () => {
    const e = exerciseOf(plan({ lastLoadByExercise: new Map([['back-squat', 60_000]]) }), 'A1');
    expect(e.calibration).toBe(true);
    expect(e.suggestionG).toBe(60_000);
    expect(workSets(e).map((s) => s.targetLoadG)).toEqual([null, null, null]);
    expect(e.platesPerSide).toBeNull();
  });

  it('suggestion ramenée à la grille du lieu', () => {
    const e = exerciseOf(plan({ lastLoadByExercise: new Map([['back-squat', 61_000]]) }), 'A1');
    expect(e.suggestionG).toBe(60_000);
  });

  it("jamais fait : pas de suggestion, l'utilisateur choisit", () => {
    const e = exerciseOf(plan(), 'A1');
    expect(e.calibration).toBe(true);
    expect(e.suggestionG).toBeNull();
  });

  it("calibration en cours : cible de l'état, pas de suggestion", () => {
    const squat = { ...SQUAT_60, loadG: 65_000, calibrationLeft: 2 };
    const e = exerciseOf(
      plan({
        replay: replayOf(GYM_AB, { states: [squat] }),
        lastLoadByExercise: new Map([['back-squat', 40_000]]),
      }),
      'A1',
    );
    expect(e.calibration).toBe(true);
    expect(e.suggestionG).toBeNull();
    expect(workSets(e).map((s) => s.targetLoadG)).toEqual([65_000, 65_000, 65_000]);
  });
});

describe('planWorkout : niveau maximal (05 §11.2)', () => {
  it("celui du membre, pas celui du modèle : un débutant sur un modèle intermédiaire n'a aucun remplaçant de niveau 2", () => {
    const catalog: PlanSheet[] = [
      ...CATALOG.filter((s) => s.id !== 'bodyweight-squat' && s.id !== 'jump-squat'),
      {
        ...programSheet('pistol-squat', 'squat', { primary: ['quadriceps', 'glutes'] }, [[]], { level: 2 }),
        measure: 'reps',
      },
    ];
    const at = (level: 'beginner' | 'intermediate', maxLevel: ExerciseLevel) => {
      const template = gymAb((t) => {
        t.level = level;
      });
      return exerciseOf(plan({ replay: replayOf(template), catalog, place: HOME, maxLevel }), 'A1');
    };
    expect(at('intermediate', 1)).toMatchObject({ exerciseId: null, resolution: 'not_feasible_here' });
    expect(at('beginner', 2)).toMatchObject({
      exerciseId: 'pistol-squat',
      resolution: 'replaced_not_feasible',
    });
  });
});

describe('planWorkout : avis', () => {
  it('mineur, exercice à la barre : minor_barbell', () => {
    const p = plan({ profile: 'cautious', ageBand: 'minor' });
    expect(p.notices).toEqual([
      { code: 'minor_barbell', exerciseId: 'back-squat' },
      { code: 'minor_barbell', exerciseId: 'bench-press' },
      { code: 'minor_barbell', exerciseId: 'barbell-row' },
    ]);
    expect(plan({ profile: 'cautious', ageBand: 'adult' }).notices).toEqual([]);
  });

  it('modèle sport : sport_gap', () => {
    expect(plan({ context: 'sport' }).notices).toEqual([{ code: 'sport_gap' }]);
  });

  it('tous les slots sautés : all_skipped', () => {
    const p = plan({ catalog: [] });
    expect(p.notices).toEqual([{ code: 'all_skipped' }]);
    expect(p.exercises.every((e) => e.exerciseId === null && e.sets.length === 0)).toBe(true);
    expect(p.exercises.map((e) => e.resolution)).toEqual(Array(5).fill('not_feasible_here'));
  });

  it("séance sans slot (tous retirés) : rien à faire, pas d'avis all_skipped", () => {
    const empty = gymAb((t) => {
      const [a] = t.workouts;
      if (a !== undefined) a.slots = [];
    });
    const p = plan({ replay: replayOf(empty) });
    expect(p.exercises).toEqual([]);
    expect(p.notices).toEqual([]);
  });

  it('slot suspendu : marqué, sans séries ; tous suspendus → all_skipped', () => {
    const one = plan({ replay: replayOf(GYM_AB, { suspended: ['A1'] }) });
    expect(exerciseOf(one, 'A1')).toMatchObject({
      plannedExerciseId: 'back-squat',
      exerciseId: null,
      resolution: 'suspended',
      sets: [],
      loadMode: null,
      platesPerSide: null,
    });
    expect(one.notices).toEqual([]);
    const all = plan({ replay: replayOf(GYM_AB, { suspended: ['A1', 'A2', 'A3', 'A4', 'A5'] }) });
    expect(all.notices).toEqual([{ code: 'all_skipped' }]);
  });

  it('séance absente du programme : erreur', () => {
    expect(() => plan({ workoutId: 'Z' })).toThrow(RangeError);
  });
});

describe('planWorkout : après un rejeu', () => {
  it('reprend les cibles du rejeu : état tenu par (slot, exercice), calibration finie', () => {
    const startedAt = Date.UTC(2026, 9, 28, 17);
    const sets: SetRecord[] = [1, 2, 3].map((position) => ({
      id: `set-${position}`,
      position,
      kind: 'work',
      loadMode: 'barbell',
      loadG: 60_000,
      reps: 6,
      durationS: null,
      side: null,
      effort: position === 3 ? 'ok' : null,
      targetRepsMin: 6,
      targetRepsMax: 6,
      targetReps: null,
      targetDurationS: null,
      targetLoadG: null,
      targetRir: 2,
      targetVariant: null,
      loggedAt: startedAt,
    }));
    const session: SessionRecord = {
      id: 's-1',
      instanceId: INSTANCE,
      workoutId: 'A',
      placeId: 'gym',
      startedAt,
      endedAt: startedAt + 3_600_000,
      status: 'completed',
      weekType: 'normal',
      profile: 'adult',
      rulesVersion: '1',
      exercises: [
        {
          id: 'pe-1',
          slotId: 'A1',
          plannedExerciseId: 'back-squat',
          exerciseId: 'back-squat',
          position: 1,
          swapReason: null,
          painLevel: null,
          nextAdjustment: null,
          sets,
        },
      ],
    };
    const replay = replayInstance({
      instance: { id: INSTANCE, snapshot: GYM_AB, daysPerWeek: 3, startedAt },
      sessions: [session],
      changes: [],
      catalog: CATALOG,
      places: new Map([['gym', GYM]]),
      overrides: new Map(),
    });
    expect(replay.state.nextWorkoutId).toBe('B');
    const e = exerciseOf(plan({ replay }), 'A1');
    expect(e.calibration).toBe(false);
    expect(workSets(e).map((s) => s.targetLoadG)).toEqual([60_000, 60_000, 60_000]);
  });
});
