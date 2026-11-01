import {
  type DecisionResult,
  EFFORTS,
  type Effort,
  type ProgressionSpec,
  type ReasonCode,
  type SessionProfile,
  type SlotMode,
  type SlotSpec,
  type WeekType,
} from '@rune/contracts';
import type { CatalogSheet } from '../catalog/usable';
import { effortValidated, rirEval } from './effort';
import type { LoadGrid } from './loads';
import {
  calibrationRaise,
  type ExercisePerformance,
  lightenTargets,
  type PrimitiveInput,
  type PrimitiveOutcome,
  progressChain,
  progressDouble,
  progressDuration,
  progressLinear,
  readPerformance,
  repRange,
  type SlotShape,
  type SlotTargets,
  slotShape,
  sumOrDouble,
} from './primitives';
import type { RulesSet } from './rules';
import {
  EMPTY_BEST,
  type EngineBest,
  type EngineLevel,
  enterLevel,
  isRecord,
  leaveLevel,
  recordPoint,
  stallLadder,
  stallResponse,
  withRecord,
} from './stall';
import {
  type EngineDecision,
  type ExerciseRecord,
  type NextTarget,
  type SlotState,
  slotStateId,
} from './types';

/*
 * Évaluation d'un exercice réalisé après une séance, dans l'ordre strict de 05 §9 : données insuffisantes, semaine
 * allégée, ajustement demandé, calibration, primitive, stagnation. Précisions : spec brique 3 §4.3.1 à §4.3.12.
 */

/** État (slot, exercice) tel que le rejeu le tient : `SlotState` et la mémoire interne du moteur. */
export type EngineState = SlotState & { best: EngineBest };

/** La séance évaluée, avec ses entrées figées (spec §4.4.2). */
export interface EvaluatedSession {
  id: string;
  instanceId: string;
  weekType: WeekType;
  profile: SessionProfile;
  rulesVersion: string;
  /** Jours civils depuis la dernière séance terminée de l'instance (spec §4.3.9) ; null pour la première. */
  resumeGapDays: number | null;
}

export interface EvaluateInput {
  /** État avant la séance ; null pour un exercice (ou une chaîne) nouveau dans ce slot. */
  state: EngineState | null;
  slot: SlotSpec;
  /** Fiche de l'exercice réalisé. */
  exercise: CatalogSheet;
  /** Variantes de la chaîne du slot, de la plus facile à la plus dure ; null pour un slot sans chaîne. */
  chainSteps: readonly CatalogSheet[] | null;
  performed: ExerciseRecord;
  session: EvaluatedSession;
  /** Charges réalisables pour cet exercice au lieu de la séance (pas de machine corrigé compris). */
  grid: LoadGrid;
  rules: RulesSet;
}

export interface EvaluateResult {
  decision: EngineDecision;
  state: EngineState;
  /** Stagnation décidée par cette séance : rang k, et s'il faut proposer un remplacement. */
  stalled: { rank: number; propose: boolean } | null;
  /** Séances de suite en douleur sur cet état, seulement si `painLevel` est stocké (05 §13.7) ; null sinon. */
  painStreak: number | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const targetsOf = (s: SlotTargets): SlotTargets => ({
  mode: s.mode,
  loadG: s.loadG,
  targetReps: s.targetReps,
  variantRank: s.variantRank,
  durationS: s.durationS,
});

/**
 * Cibles ramenées dans les bornes du mode et du profil : variante dans la chaîne (gardée telle quelle si la chaîne
 * n'est pas connue), répétitions, durée.
 */
function normalize(t: SlotTargets, shape: SlotShape): SlotTargets {
  const variantRank =
    t.variantRank === null || shape.chainLength === null
      ? t.variantRank
      : clamp(t.variantRank, 1, shape.chainLength);
  if (t.mode === 'duration') {
    const { min, max } = shape.durations;
    return { ...t, variantRank, targetReps: null, durationS: clamp(t.durationS ?? min, min, max) };
  }
  const r = repRange(shape, t.mode, variantRank);
  const targetReps = t.mode === 'linear' ? r.min : clamp(t.targetReps ?? r.min, r.min, r.max);
  return { ...t, variantRank, targetReps, durationS: null };
}

function nextTarget(t: SlotTargets, shape: SlotShape, steps: readonly CatalogSheet[] | null): NextTarget {
  const reps = t.mode === 'duration' ? null : repRange(shape, t.mode, t.variantRank);
  return {
    mode: t.mode,
    loadG: t.loadG,
    repsMin: reps === null ? null : t.targetReps,
    repsMax: reps === null ? null : reps.max,
    durationS: t.mode === 'duration' ? t.durationS : null,
    variantId: t.variantRank === null || steps === null ? null : (steps[t.variantRank - 1]?.id ?? null),
    workSets: shape.planned,
  };
}

function initialMode(type: ProgressionSpec['type'], shape: SlotShape, chained: boolean): SlotMode {
  if (shape.measure === 'duration') return 'duration';
  if (type === 'chain' && chained) return 'chain';
  if (type === 'linear' && shape.grid.kind !== 'none') return 'linear';
  return 'double';
}

/** État neuf (spec §4.3.5) : calibration à faire ; pour une chaîne, tenu par (slot, chaîne) (§4.3.6). */
function newState(
  input: EvaluateInput,
  shape: SlotShape,
  steps: readonly CatalogSheet[] | null,
  variantRank: number | null,
): EngineState {
  const { slot, exercise, session, rules } = input;
  const exerciseId = steps !== null && slot.chain !== undefined ? slot.chain : exercise.id;
  const mode = initialMode(slot.progression.type, shape, steps !== null);
  return {
    id: slotStateId(session.instanceId, slot.id, exerciseId),
    instanceId: session.instanceId,
    slotId: slot.id,
    exerciseId,
    ...normalize({ mode, loadG: null, targetReps: null, variantRank, durationS: null }, shape),
    machineStepGOverride: null,
    calibrationLeft: rules.calibrationSessions,
    noProgressCount: 0,
    stallRank: 0,
    painStreak: 0,
    suspended: false,
    lastSessionId: null,
    rulesVersion: session.rulesVersion,
    best: EMPTY_BEST,
  };
}

const effortOf = (rir: number | null, rules: RulesSet): Effort | null =>
  rir === null ? null : (EFFORTS.find((e) => rules.rirByEffort[e] === rir) ?? null);

/**
 * Calibration (05 §9.4) : facile → +2 pas (prudent : +1 pas, et aucune hausse avant la 3e séance) ; correct → fin ;
 * difficile ou effort manquant → maintien ; échec, ou une série sous le minimum → −10 %. Elle s'arrête au premier
 * « correct » ou au bout de 3 séances ; une séance de reprise en suit la règle, une fois. Sans charge, la première
 * séance fixe seulement le niveau de départ (variante choisie, 05 §8).
 */
function calibrate(
  shape: SlotShape,
  perf: ExercisePerformance,
  base: SlotTargets,
  left: number,
): { targets: SlotTargets; left: number; code: ReasonCode } {
  const { rules } = shape;
  const loaded =
    shape.grid.kind !== 'none' && (base.mode === 'linear' || base.mode === 'double' || base.mode === 'sum');
  if (!loaded) return { targets: base, left: 0, code: 'CALIBRATION_DONE' };
  const underMin = perf.lowest < repRange(shape, base.mode, base.variantRank).min;
  const effort = underMin ? 'failed' : effortOf(perf.rir, rules);
  const c = perf.loadG;
  let targets = base;
  if (c !== null && effort === 'easy') {
    const sessionNo = left > 0 ? rules.calibrationSessions - left + 1 : Number.POSITIVE_INFINITY;
    const up =
      shape.cautious && sessionNo < rules.cautious.noRaiseBeforeSession ? null : calibrationRaise(shape, c);
    if (up !== null) targets = { ...base, loadG: up };
  } else if (c !== null && effort === 'failed') {
    targets = lightenTargets(base, shape);
  }
  const nextLeft = effort === 'ok' ? 0 : Math.max(0, left - 1);
  const moved = c === null || targets.loadG === null ? 0 : targets.loadG - c;
  const code: ReasonCode =
    effort === 'ok'
      ? 'CALIBRATION_DONE'
      : moved > 0
        ? 'CALIBRATION_UP'
        : moved < 0
          ? 'CALIBRATION_DOWN'
          : nextLeft === 0
            ? 'CALIBRATION_END'
            : 'CALIBRATION_HOLD';
  return { targets, left: nextLeft, code };
}

function runPrimitive(input: PrimitiveInput): PrimitiveOutcome {
  switch (input.base.mode) {
    case 'linear':
      return progressLinear(input);
    case 'chain':
      return progressChain(input);
    case 'duration':
      return progressDuration(input);
    default:
      return progressDouble(input);
  }
}

/** Une décision selon l'ordre strict de 05 §9, et l'état qui en résulte. Fonction pure. */
export function evaluateExercise(input: EvaluateInput): EvaluateResult {
  const { slot, exercise, chainSteps, performed, session, grid, rules } = input;
  const index = chainSteps?.findIndex((s) => s.id === exercise.id) ?? -1;
  const steps = slot.chain !== undefined && chainSteps !== null && index >= 0 ? chainSteps : null;
  const performedRank = steps === null ? null : index + 1;
  const shape = slotShape(slot, session.profile, grid, rules, steps === null ? null : steps.length);
  const prev = input.state ?? newState(input, shape, steps, performedRank);

  const painStreak =
    performed.painLevel === null ? null : performed.painLevel === 'pain' ? prev.painStreak + 1 : 0;
  const finish = (
    state: EngineState,
    result: DecisionResult,
    reasonCode: ReasonCode,
    stalled: EvaluateResult['stalled'] = null,
  ): EvaluateResult => ({
    decision: {
      id: performed.id,
      instanceId: state.instanceId,
      slotId: state.slotId,
      exerciseId: state.exerciseId,
      result,
      reasonCode,
      nextTarget: nextTarget(normalize(targetsOf(state), shape), shape, steps),
      profile: session.profile,
      rulesVersion: session.rulesVersion,
    },
    state,
    stalled,
    painStreak,
  });

  const perf = readPerformance(performed.sets, {
    measure: shape.measure,
    unilateral: exercise.unilateral,
    loaded: grid.kind !== 'none',
    variantRank: performedRank,
    rir: rirEval(performed.sets, rules),
  });

  // 1. Données insuffisantes : ni échec ni stagnation, l'état ne change pas.
  if (perf.values.length === 0) return finish({ ...prev, painStreak: painStreak ?? 0 }, 'IGNORED', 'NO_DATA');

  const touched: EngineState = {
    ...prev,
    painStreak: painStreak ?? 0,
    lastSessionId: session.id,
    rulesVersion: session.rulesVersion,
  };

  // 2. Semaine allégée : l'état ne change pas, mais l'ajustement demandé s'applique quand même.
  if (session.weekType === 'deload') {
    if (performed.nextAdjustment !== 'lighten') return finish(touched, 'DELOAD', 'DELOAD_WEEK');
    const lightened = normalize(lightenTargets(targetsOf(prev), shape), shape);
    return finish({ ...touched, ...lightened }, 'DELOAD', 'DELOAD_WEEK');
  }

  // La séance compte : record du moteur, niveau de la séance, cibles partant de ce qui a été fait (§4.3.2).
  const point = recordPoint(perf, shape.measure);
  const record = isRecord(prev.best, point);
  const best = withRecord(prev.best, point);
  const level = enterLevel(prev.best, perf);
  const base: SlotTargets = {
    mode: sumOrDouble(prev.mode, perf.loadG, shape),
    loadG: perf.loadG ?? prev.loadG,
    targetReps: prev.targetReps,
    variantRank: performedRank ?? prev.variantRank,
    durationS: prev.durationS,
  };
  const save = (t: SlotTargets, after: EngineLevel, over: Partial<SlotState> = {}): EngineState => ({
    ...touched,
    ...normalize(t, shape),
    ...over,
    best: { ...best, level: after },
  });
  const keep = { atTop: level.atTop, fails: level.fails, raised: level.raised };

  // 3. Ajustement demandé (bouton douleur ou choix manuel, 05 §13) : ne compte pas pour la stagnation.
  if (performed.nextAdjustment !== null) {
    const pain = performed.painLevel === 'discomfort' || performed.painLevel === 'pain';
    const after = leaveLevel(level, perf, keep);
    if (performed.nextAdjustment === 'hold') {
      return finish(save(base, after), 'ADJUSTED_HOLD', pain ? 'PAIN_HOLD' : 'USER_HOLD');
    }
    return finish(
      save(lightenTargets(base, shape), after),
      'ADJUSTED_LIGHTEN',
      pain ? 'PAIN_LIGHTEN' : 'USER_LIGHTEN',
    );
  }

  // 4. Calibration : premières séances de l'exercice dans ce slot, ou première séance de reprise (05 §10.4).
  const resume = session.resumeGapDays !== null && session.resumeGapDays >= rules.resume.days14.days;
  if (slot.progression.type !== 'fixed' && (prev.calibrationLeft > 0 || resume)) {
    const c = calibrate(shape, perf, base, prev.calibrationLeft);
    const after = leaveLevel(level, perf, { atTop: 0, fails: 0, raised: false });
    return finish(save(c.targets, after, { calibrationLeft: c.left }), 'CALIBRATION', c.code);
  }

  // 5. Primitive. `fixed` ne change rien et ne stagne pas.
  if (slot.progression.type === 'fixed') {
    return finish(save(base, leaveLevel(level, perf, keep)), 'HOLD', 'NO_PROGRESS');
  }
  const validated = effortValidated(perf.rir, shape.targetRir);
  const o = runPrimitive({ shape, perf, base, level, validated });

  // 6. Stagnation : séances valides consécutives sans progrès ; un record remet le compteur et k à zéro.
  const noProgressCount = record || o.result === 'PROGRESS' ? 0 : prev.noProgressCount + 1;
  const stallRank = record ? 0 : prev.stallRank;
  if (noProgressCount >= rules.stallSessions) {
    const s = stallResponse(stallLadder(slot.progression.type, o.targets.mode), stallRank, o.targets, shape);
    const after = leaveLevel(level, perf, { atTop: 0, fails: 0, raised: level.raised });
    return finish(save(s.targets, after, { noProgressCount: 0, stallRank: s.rank }), 'STALL', s.code, {
      rank: s.rank,
      propose: s.propose,
    });
  }
  const after = leaveLevel(level, perf, {
    atTop: o.atTop,
    fails: o.fails,
    raised: o.result === 'PROGRESS' ? false : level.raised,
  });
  return finish(save(o.targets, after, { noProgressCount, stallRank }), o.result, o.code);
}
