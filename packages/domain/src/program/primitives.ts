import type { MEASURES, ReasonCode, SessionProfile, SetSpec, SlotMode, SlotSpec } from '@rune/contracts';
import { type LoadGrid, lightest, next, roundDown } from './loads';
import type { RulesSet } from './rules';
import type { EngineLevel } from './stall';
import { isDone, type SetRecord } from './types';

/*
 * Primitives de progression (05 §8) et ce qu'elles partagent : séries prises en compte (spec brique 3 §4.3.1 à
 * §4.3.3), fourchettes et profil prudent (05 §14), hausses plafonnées et allègement standard (05 §12).
 */

/** RIR cible d'un slot dont le modèle n'en donne pas (05 §1.3 : 2 à 3 RIR en réserve). */
export const DEFAULT_TARGET_RIR = 2;
/** Fourchette d'un slot `linear` passé en `double` : [r, r + 4] (05 §9.6). */
export const LINEAR_DOUBLE_SPAN = 4;

export type Measure = (typeof MEASURES)[number];

export interface Bounds {
  min: number;
  max: number;
}

/** Cibles d'un `slot_state` : ce que les primitives lisent et réécrivent. */
export interface SlotTargets {
  mode: SlotMode;
  loadG: number | null;
  targetReps: number | null;
  variantRank: number | null;
  durationS: number | null;
}

/** Ce que le slot impose à la séance évaluée, pour son profil et son lieu. */
export interface SlotShape {
  slot: SlotSpec;
  grid: LoadGrid;
  rules: RulesSet;
  cautious: boolean;
  measure: Measure;
  /** Nombre de variantes de la chaîne du slot ; null hors chaîne. */
  chainLength: number | null;
  durations: Bounds;
  stepS: number;
  /** Séries de travail prévues ; au plus 3 en profil prudent. Le moteur n'en ajoute jamais (05 §13.3). */
  planned: number;
  targetRir: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function workSpec(slot: SlotSpec): SetSpec | undefined {
  return slot.sets.find((s) => s.kind === 'work') ?? slot.sets[0];
}

export function slotShape(
  slot: SlotSpec,
  profile: SessionProfile,
  grid: LoadGrid,
  rules: RulesSet,
  chainLength: number | null,
): SlotShape {
  const cautious = profile === 'cautious';
  const spec = workSpec(slot);
  const work = slot.sets.reduce((n, s) => (s.kind === 'work' ? n + s.count : n), 0);
  const rir = spec?.targetRir ?? DEFAULT_TARGET_RIR;
  return {
    slot,
    grid,
    rules,
    cautious,
    measure: spec?.durationS === undefined ? 'reps' : 'duration',
    chainLength,
    durations: spec?.durationS ?? { min: 1, max: 1 },
    stepS: slot.progression.type === 'duration' ? slot.progression.stepS : rules.stepS,
    planned: cautious ? Math.min(work, rules.cautious.maxWorkSets) : work,
    targetRir: cautious ? Math.max(rir, rules.cautious.minTargetRir) : rir,
  };
}

/** Profil prudent (05 §14) : répétitions dans [6, 15], écart d'au moins 2 sauf répétitions fixes (4–6 → 6–8). */
export function cautiousRange({ min, max }: Bounds, rules: RulesSet): Bounds {
  const { repsMin: lo, repsMax: hi, minRepsGap: gap } = rules.cautious;
  if (min === max) {
    const r = clamp(min, lo, hi);
    return { min: r, max: r };
  }
  const a = clamp(min, lo, hi);
  const b = clamp(max, lo, hi);
  if (b - a >= gap) return { min: a, max: b };
  const top = Math.min(hi, a + gap);
  return { min: top - gap, max: top };
}

/**
 * Fourchette de répétitions selon le mode : `linear` fixe à r ; `double` issu de `linear` en [r, r + 4] ; dernière
 * variante d'une chaîne prolongée à 25 répétitions (15 en profil prudent).
 */
export function repRange(shape: SlotShape, mode: SlotMode, variantRank: number | null): Bounds {
  const { slot, rules, chainLength, cautious } = shape;
  const reps = workSpec(slot)?.reps ?? { min: 1, max: 1 };
  let { min, max } = reps;
  if (slot.progression.type === 'linear') {
    max = mode === 'linear' ? min : min + LINEAR_DOUBLE_SPAN;
  } else if (mode === 'chain' && chainLength !== null && variantRank !== null && variantRank >= chainLength) {
    max = Math.max(max, cautious ? rules.cautious.chainEnd : rules.cautious.chainEndAdult);
  }
  return cautious ? cautiousRange({ min, max }, rules) : { min, max };
}

// ---------------------------------------------------------------------------------------------------------------
// Ce qui a été fait
// ---------------------------------------------------------------------------------------------------------------

export interface ExercisePerformance {
  /** Valeur de chaque série prise en compte : répétitions ou secondes. */
  values: number[];
  total: number;
  lowest: number;
  /** Charge réalisée : la plus petite des séries prises en compte (spec §4.3.2) ; null sans charge. */
  loadG: number | null;
  /** Rang de la variante faite dans la chaîne du slot ; null hors chaîne. */
  variantRank: number | null;
  /** `rirEval` (05 §7) sur toutes les lignes de travail faites (spec §4.3.4). */
  rir: number | null;
}

const minOrNull = (xs: readonly (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length === 0 ? null : Math.min(...v);
};

/**
 * Séries prises en compte (spec §4.3.1 et §4.3.3) : séries de travail faites qui portent la mesure du slot. En
 * unilatéral, une série est la paire de lignes de même position ; ses répétitions sont le minimum des deux côtés, et
 * une paire dont un côté manque ne compte pas. Une ligne sans côté compte seule.
 */
function countedSets(
  lines: readonly SetRecord[],
  measure: Measure,
  unilateral: boolean,
): { value: number; loadG: number | null }[] {
  const done = lines
    .flatMap((s) => {
      const value = measure === 'reps' ? s.reps : s.durationS;
      return s.kind === 'work' && isDone(s) && value !== null ? [{ s, value }] : [];
    })
    .sort((a, b) => a.s.position - b.s.position || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0));
  if (!unilateral) return done.map(({ s, value }) => ({ value, loadG: s.loadG }));
  const groups = new Map<number, typeof done>();
  for (const line of done) groups.set(line.s.position, [...(groups.get(line.s.position) ?? []), line]);
  return [...groups.values()].flatMap((group) => {
    const has = (side: SetRecord['side']) => group.some((l) => l.s.side === side);
    if (!has(null) && !(has('left') && has('right'))) return [];
    return [{ value: Math.min(...group.map((l) => l.value)), loadG: minOrNull(group.map((l) => l.s.loadG)) }];
  });
}

export function readPerformance(
  lines: readonly SetRecord[],
  opts: {
    measure: Measure;
    unilateral: boolean;
    loaded: boolean;
    variantRank: number | null;
    rir: number | null;
  },
): ExercisePerformance {
  const sets = countedSets(lines, opts.measure, opts.unilateral);
  const values = sets.map((s) => s.value);
  return {
    values,
    total: values.reduce((a, b) => a + b, 0),
    lowest: values.length === 0 ? 0 : Math.min(...values),
    loadG: opts.loaded ? minOrNull(sets.map((s) => s.loadG)) : null,
    variantRank: opts.variantRank,
    rir: opts.rir,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Charges : hausses et allègement (05 §12)
// ---------------------------------------------------------------------------------------------------------------

/** Écart jusqu'à la charge réalisable suivante ; null s'il n'y en a pas. */
export function stepAbove(grid: LoadGrid, c: number): number | null {
  const n = next(grid, c);
  return n === null ? null : n - c;
}

const incrementOf = (slot: SlotSpec): number =>
  slot.progression.type === 'linear' ? slot.progression.incrementG : 0;

/** Plafond d'une hausse pour un adulte (05 §12) : max(incrementG, 10 % de la charge). */
export function raiseCap(shape: SlotShape, c: number): number {
  return Math.max(incrementOf(shape.slot), (c * shape.rules.raiseCapPct) / 100);
}

/**
 * Hausse de `linear` (05 §8) : première charge réalisable ≥ c + max(incrementG, pas), sans dépasser le plafond
 * (sinon la plus lourde sous le plafond) ; un seul pas en profil prudent.
 */
export function linearRaise(shape: SlotShape, c: number): number | null {
  const { grid } = shape;
  const one = next(grid, c);
  if (one === null || shape.cautious) return one;
  const wanted = c + Math.max(incrementOf(shape.slot), one - c);
  const target = roundDown(grid, wanted) === wanted ? wanted : next(grid, wanted);
  const cap = raiseCap(shape, c);
  if (target !== null && target - c <= cap) return target;
  const capped = roundDown(grid, c + cap);
  return capped !== null && capped > c ? capped : one;
}

/** Calibration « facile » (05 §9.4) : +2 pas, plafonnés comme une hausse mais au moins un pas ; +1 pas en prudent. */
export function calibrationRaise(shape: SlotShape, c: number): number | null {
  const one = next(shape.grid, c);
  if (one === null || shape.cautious) return one;
  const two = next(shape.grid, one);
  return two !== null && two - c <= raiseCap(shape, c) ? two : one;
}

/**
 * Allègement standard d'une charge (05 §12, `LIGHTEN_PCT`) : roundDown(c × 0,9), au moins un pas sous c, ou la
 * charge la plus légère si elle est sous c ; null quand c est déjà la charge minimale.
 */
export function lightenLoad(grid: LoadGrid, c: number, rules: RulesSet): number | null {
  const t = roundDown(grid, Math.floor((c * (100 - rules.lightenPct)) / 100));
  if (t !== null && t < c) return t;
  const l = lightest(grid);
  return l !== null && l < c ? l : null;
}

const isLoadMode = (mode: SlotMode) => mode === 'linear' || mode === 'double' || mode === 'sum';

/**
 * Allègement standard des cibles (05 §12). Avec charge : `lightenLoad`, et si la charge minimale est déjà atteinte,
 * on la garde et un slot `linear` passe en `double`. Sans charge : une variante de chaîne en moins, ou −10 % de
 * durée (jamais sous le minimum), ou retour au minimum de répétitions.
 */
export function lightenTargets(t: SlotTargets, shape: SlotShape): SlotTargets {
  const { grid, rules } = shape;
  if (isLoadMode(t.mode)) {
    if (t.loadG !== null && grid.kind !== 'none') {
      const lighter = lightenLoad(grid, t.loadG, rules);
      if (lighter !== null) return { ...t, loadG: lighter };
      if (t.mode !== 'linear') return t;
      return { ...t, mode: 'double', targetReps: repRange(shape, 'double', t.variantRank).min };
    }
    return { ...t, targetReps: repRange(shape, t.mode, t.variantRank).min };
  }
  if (t.mode === 'chain') {
    const v = t.variantRank ?? 1;
    const to = v > 1 ? v - 1 : v;
    return { ...t, variantRank: to, targetReps: repRange(shape, 'chain', to).min };
  }
  const d = t.durationS ?? shape.durations.min;
  return {
    ...t,
    durationS: Math.max(shape.durations.min, Math.floor((d * (100 - rules.lightenPct)) / 100)),
  };
}

/** Mode somme automatique quand le pas dépasse 10 % de la charge (05 §8) ; sans charge plus lourde, rien ne change. */
export function sumOrDouble(mode: SlotMode, c: number | null, shape: SlotShape): SlotMode {
  if ((mode !== 'double' && mode !== 'sum') || c === null || shape.grid.kind === 'none') return mode;
  const step = stepAbove(shape.grid, c);
  if (step === null) return mode;
  return step * 100 > shape.rules.sumModeStepPct * c ? 'sum' : 'double';
}

// ---------------------------------------------------------------------------------------------------------------
// Primitives (05 §8)
// ---------------------------------------------------------------------------------------------------------------

export type PrimitiveResult = 'PROGRESS' | 'HOLD' | 'FAIL';

export interface PrimitiveOutcome {
  result: PrimitiveResult;
  code: ReasonCode;
  targets: SlotTargets;
  /** Séances de suite au sommet, effort validé, à ce niveau (`chain`, `duration`). */
  atTop: number;
  /** Échecs de suite à ce niveau (`chain`). */
  fails: number;
}

export interface PrimitiveInput {
  shape: SlotShape;
  perf: ExercisePerformance;
  /** Cibles d'avant, partant de la charge réalisée et de la variante faite (spec §4.3.2). */
  base: SlotTargets;
  /** Niveau de la séance (charge et variante réalisées), tel qu'il était avant elle. */
  level: EngineLevel;
  validated: boolean;
}

const outcome = (
  result: PrimitiveResult,
  code: ReasonCode,
  targets: SlotTargets,
  atTop = 0,
  fails = 0,
): PrimitiveOutcome => ({ result, code, targets, atTop, fails });

/** Le pas du lieu dépasse max(incrementG, 10 %) (en prudent : 10 %), ou il n'y a pas de charge plus lourde. */
function stepTooBig(shape: SlotShape, c: number): boolean {
  const step = stepAbove(shape.grid, c);
  if (step === null) return true;
  return step > (shape.cautious ? (c * shape.rules.sumModeStepPct) / 100 : raiseCap(shape, c));
}

/** `linear` (r fixe) : toutes les séries à r et effort validé → hausse ; sinon maintien ou échec. */
export function progressLinear({ shape, perf, base, validated }: PrimitiveInput): PrimitiveOutcome {
  const r = repRange(shape, 'linear', null).min;
  const c = perf.loadG;
  if (shape.grid.kind === 'none' || (c !== null && stepTooBig(shape, c))) {
    const targetReps = repRange(shape, 'double', null).min;
    return outcome('HOLD', 'LINEAR_TO_DOUBLE', { ...base, mode: 'double', targetReps });
  }
  if (perf.lowest < r) return outcome('FAIL', 'REPS_UNDER_MIN', base);
  if (perf.values.length < shape.planned) return outcome('HOLD', 'SETS_MISSING', base);
  if (perf.rir === null) return outcome('HOLD', 'EFFORT_MISSING', base);
  if (!validated) return outcome('HOLD', 'EFFORT_NOT_VALIDATED', base);
  const up = c === null ? null : linearRaise(shape, c);
  return up === null
    ? outcome('HOLD', 'NO_PROGRESS', base)
    : outcome('PROGRESS', 'LOAD_UP', { ...base, loadG: up });
}

/**
 * `double` [min, max] et son mode somme : sommet et effort validé → un pas et retour à min ; sinon progrès si le
 * total de répétitions dépasse le meilleur du niveau ; une série sous min est un échec (min − 2 juste après une
 * hausse en mode somme).
 */
export function progressDouble({ shape, perf, base, level, validated }: PrimitiveInput): PrimitiveOutcome {
  const sum = base.mode === 'sum';
  const { min, max } = repRange(shape, base.mode, base.variantRank);
  const failBelow = sum && level.raised ? min - shape.rules.sumAllowanceBelowMin : min;
  if (perf.lowest < failBelow) return outcome('FAIL', 'REPS_UNDER_MIN', base);
  if (perf.values.length < shape.planned) return outcome('HOLD', 'SETS_MISSING', base);
  const n = perf.values.length;
  const top = sum ? perf.total >= n * max + n : perf.lowest >= max;
  const up = perf.loadG === null || shape.grid.kind === 'none' ? null : next(shape.grid, perf.loadG);
  if (top && validated && up !== null) {
    return outcome('PROGRESS', sum ? 'SUM_LOAD_UP' : 'LOAD_UP', { ...base, loadG: up, targetReps: min });
  }
  if (top && perf.rir === null) return outcome('HOLD', 'EFFORT_MISSING', base);
  if (top && !validated) return outcome('HOLD', 'EFFORT_NOT_VALIDATED', base);
  if (level.total !== null && perf.total > level.total) {
    return outcome('PROGRESS', 'REPS_UP', { ...base, targetReps: clamp(perf.lowest + 1, min, max) });
  }
  return outcome('HOLD', top ? 'REPS_MAX_REACHED' : 'NO_PROGRESS', base);
}

/**
 * `chain` : répétitions comme `double`, sans charge ; sommet tenu `sessionsAtTop` séances de suite avec effort
 * validé → variante suivante et retour à min ; 2 échecs de suite sur une nouvelle variante → variante précédente.
 */
export function progressChain({ shape, perf, base, level, validated }: PrimitiveInput): PrimitiveOutcome {
  const v = base.variantRank ?? 1;
  const last = shape.chainLength === null || v >= shape.chainLength;
  const { min, max } = repRange(shape, 'chain', v);
  if (perf.lowest < min) {
    const fails = level.fails + 1;
    if (level.raised && v > 1 && fails >= 2) {
      const back = v - 1;
      return outcome('FAIL', 'CHAIN_BACK', {
        ...base,
        variantRank: back,
        targetReps: repRange(shape, 'chain', back).min,
      });
    }
    return outcome('FAIL', 'REPS_UNDER_MIN', base, 0, fails);
  }
  if (perf.values.length < shape.planned) return outcome('HOLD', 'SETS_MISSING', base);
  const top = perf.lowest >= max;
  const repsUp = level.total !== null && perf.total > level.total;
  const aim = { ...base, targetReps: clamp(perf.lowest + 1, min, max) };
  if (top && validated) {
    const atTop = level.atTop + 1;
    if (!last && atTop >= shape.rules.sessionsAtTop) {
      const to = v + 1;
      return outcome('PROGRESS', 'CHAIN_NEXT', {
        ...base,
        variantRank: to,
        targetReps: repRange(shape, 'chain', to).min,
      });
    }
    if (repsUp) return outcome('PROGRESS', 'REPS_UP', aim, atTop);
    return outcome('HOLD', last ? 'REPS_MAX_REACHED' : 'NO_PROGRESS', base, atTop);
  }
  if (top) return outcome('HOLD', perf.rir === null ? 'EFFORT_MISSING' : 'EFFORT_NOT_VALIDATED', base);
  if (repsUp) return outcome('PROGRESS', 'REPS_UP', aim);
  return outcome('HOLD', 'NO_PROGRESS', base);
}

/**
 * `duration` [min, max], pas `stepS` : séries tenues et effort validé → +stepS jusqu'à max ; max tenu
 * `sessionsAtTop` séances sur un slot à chaîne → variante suivante ; une série sous la cible − 5 s est un échec.
 */
export function progressDuration({ shape, perf, base, level, validated }: PrimitiveInput): PrimitiveOutcome {
  const { min, max } = shape.durations;
  const target = clamp(base.durationS ?? min, min, max);
  const v = base.variantRank;
  if (perf.lowest < target - shape.rules.durationFailMarginS) return outcome('FAIL', 'DURATION_UNDER', base);
  if (perf.values.length < shape.planned) return outcome('HOLD', 'SETS_MISSING', base);
  const held = perf.lowest >= target;
  if (held && validated) {
    const atTop = perf.lowest >= max ? level.atTop + 1 : 0;
    if (
      v !== null &&
      shape.chainLength !== null &&
      v < shape.chainLength &&
      atTop >= shape.rules.sessionsAtTop
    ) {
      return outcome('PROGRESS', 'CHAIN_NEXT', { ...base, variantRank: v + 1, durationS: min });
    }
    if (target < max) {
      return outcome(
        'PROGRESS',
        'DURATION_UP',
        { ...base, durationS: Math.min(max, target + shape.stepS) },
        atTop,
      );
    }
    return outcome('HOLD', 'NO_PROGRESS', base, atTop);
  }
  if (held) return outcome('HOLD', perf.rir === null ? 'EFFORT_MISSING' : 'EFFORT_NOT_VALIDATED', base);
  return outcome('HOLD', 'DURATION_UNDER', base);
}
