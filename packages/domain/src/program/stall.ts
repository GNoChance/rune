import type { ProgressionSpec, ReasonCode, SlotMode } from '@rune/contracts';
import {
  type ExercisePerformance,
  lightenTargets,
  type Measure,
  repRange,
  type SlotShape,
  type SlotTargets,
} from './primitives';

/*
 * Stagnation (05 §9.6, spec brique 3 §4.3.11 et §4.3.12) et mémoire interne du moteur : le record du moteur et le
 * niveau courant. Cette mémoire n'est jamais stockée ; le rejeu la recalcule séance par séance.
 */

/** Niveau courant d'un état : charge et variante réalisées à sa dernière séance avec données. */
export interface EngineLevel {
  loadG: number | null;
  variantRank: number | null;
  /**
   * Total (répétitions ou secondes) de la dernière séance complète à ce niveau, référence de « à charge égale, total
   * en hausse » (05 §8) ; null avant la première. Ni les séances incomplètes ni les ajustements ne le changent.
   */
  lastTotal: number | null;
  /** Séances de suite au sommet, effort validé (`sessionsAtTop`, 05 §8). */
  atTop: number;
  /** Échecs de suite à ce niveau (`chain`, 05 §8). */
  fails: number;
  /** Niveau atteint par une hausse (charge ou variante) et sans progrès depuis : mode somme, `CHAIN_BACK`. */
  raised: boolean;
}

/**
 * Mémoire interne du moteur pour un état, jamais stockée :
 * - le record du moteur (spec §4.3.11) : variante la plus difficile, puis charge réalisée la plus haute, puis
 *   meilleurs totaux de répétitions et de secondes à ce point ;
 * - `level` : le niveau courant, référence du progrès de 05 §8 ; null tant qu'aucune séance n'a été évaluée ;
 * - `sessions` : séances de l'exercice avec données dans cet état (semaines allégées comprises), pour « aucune
 *   hausse avant la 3e séance » du profil prudent (05 §14).
 */
export interface EngineBest {
  loadG: number | null;
  variantRank: number | null;
  reps: number;
  durationS: number;
  level: EngineLevel | null;
  sessions: number;
}

export const EMPTY_BEST: Readonly<EngineBest> = Object.freeze({
  loadG: null,
  variantRank: null,
  reps: 0,
  durationS: 0,
  level: null,
  sessions: 0,
});

type RecordPoint = Pick<EngineBest, 'loadG' | 'variantRank' | 'reps' | 'durationS'>;

export function recordPoint(perf: ExercisePerformance, measure: Measure): RecordPoint {
  return {
    loadG: perf.loadG,
    variantRank: perf.variantRank,
    reps: measure === 'reps' ? perf.total : 0,
    durationS: measure === 'duration' ? perf.total : 0,
  };
}

/** Ordre du record : variante, charge, puis totaux. */
function compareRecord(a: RecordPoint, b: RecordPoint): number {
  const ka = [a.variantRank ?? 0, a.loadG ?? 0, a.reps, a.durationS];
  const kb = [b.variantRank ?? 0, b.loadG ?? 0, b.reps, b.durationS];
  for (let i = 0; i < ka.length; i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Record du moteur : mieux que toutes les séances déjà évaluées de cet état (la première n'en est pas un). */
export function isRecord(best: EngineBest, point: RecordPoint): boolean {
  return best.level !== null && compareRecord(point, best) > 0;
}

export function withRecord(best: EngineBest, point: RecordPoint): EngineBest {
  return best.level === null || compareRecord(point, best) > 0 ? { ...best, ...point } : best;
}

const above = (a: number | null, b: number | null) => a !== null && b !== null && a > b;

/** Niveau de la séance : le niveau courant si la charge et la variante sont les mêmes, sinon un nouveau. */
export function enterLevel(best: EngineBest, perf: ExercisePerformance): EngineLevel {
  const l = best.level;
  if (l !== null && l.loadG === perf.loadG && l.variantRank === perf.variantRank) return l;
  return {
    loadG: perf.loadG,
    variantRank: perf.variantRank,
    lastTotal: null,
    atTop: 0,
    fails: 0,
    raised: l !== null && (above(perf.loadG, l.loadG) || above(perf.variantRank, l.variantRank)),
  };
}

/** Niveau après la séance : compteurs donnés, et total de la séance s'il sert de référence (`counts`). */
export function leaveLevel(
  level: EngineLevel,
  perf: ExercisePerformance,
  streaks: Pick<EngineLevel, 'atTop' | 'fails' | 'raised'>,
  counts: boolean,
): EngineLevel {
  return { ...level, ...streaks, lastTotal: counts ? perf.total : level.lastTotal };
}

/**
 * Progrès au sens de 05 §8, sur ce qui a été fait, quel que soit le résultat de la primitive et l'effort : charge en
 * hausse ; ou, au même niveau, total de répétitions ou de secondes en hausse ; ou variante plus difficile ; ou record.
 */
export function progressed(
  previous: EngineLevel | null,
  level: EngineLevel,
  perf: ExercisePerformance,
  record: boolean,
): boolean {
  if (record) return true;
  if (
    previous !== null &&
    (above(perf.loadG, previous.loadG) || above(perf.variantRank, previous.variantRank))
  ) {
    return true;
  }
  return level.lastTotal !== null && perf.total > level.lastTotal;
}

// ---------------------------------------------------------------------------------------------------------------
// Réponses à la stagnation (05 §9.6)
// ---------------------------------------------------------------------------------------------------------------

/** `linear` : celle d'un slot `linear`, même passé en `double` ; `double` : double et somme ; `reset` : chain, duration. */
export type StallLadder = 'linear' | 'double' | 'reset';

type StallAction = 'lighten' | 'lighten_min' | 'to_double' | 'reset_min' | 'none';

const LADDERS: Readonly<Record<StallLadder, readonly { code: ReasonCode; action: StallAction }[]>> = {
  linear: [
    { code: 'STALL_1_LIGHTEN', action: 'lighten' },
    { code: 'STALL_2_DOUBLE', action: 'to_double' },
    { code: 'STALL_REPLACE_PROPOSED', action: 'none' },
  ],
  double: [
    { code: 'STALL_1_LIGHTEN', action: 'lighten_min' },
    { code: 'STALL_REPLACE_PROPOSED', action: 'none' },
  ],
  reset: [
    { code: 'STALL_RESET_MIN', action: 'reset_min' },
    { code: 'STALL_REPLACE_PROPOSED', action: 'none' },
  ],
};

export function stallLadder(progression: ProgressionSpec['type'], mode: SlotMode): StallLadder {
  if (progression === 'linear') return 'linear';
  return mode === 'double' || mode === 'sum' ? 'double' : 'reset';
}

function toMin(t: SlotTargets, shape: SlotShape): SlotTargets {
  return t.mode === 'duration'
    ? { ...t, durationS: shape.durations.min }
    : { ...t, targetReps: repRange(shape, t.mode, t.variantRank).min };
}

function apply(action: StallAction, t: SlotTargets, shape: SlotShape): SlotTargets {
  switch (action) {
    case 'lighten':
      return lightenTargets(t, shape);
    case 'lighten_min':
      return toMin(lightenTargets(t, shape), shape);
    case 'to_double':
      return { ...t, mode: 'double', targetReps: repRange(shape, 'double', t.variantRank).min };
    case 'reset_min':
      return toMin(t, shape);
    default:
      return t;
  }
}

export interface StallResponse {
  rank: number;
  code: ReasonCode;
  propose: boolean;
  targets: SlotTargets;
}

/**
 * Stagnation de rang k = `previousRank` + 1. Après la dernière marche (spec §4.3.12), le rang reste au maximum :
 * nouvelle proposition de remplacement et, pour `linear` et `double`, allègement standard.
 */
export function stallResponse(
  ladder: StallLadder,
  previousRank: number,
  targets: SlotTargets,
  shape: SlotShape,
): StallResponse {
  const steps = LADDERS[ladder];
  const step = steps[previousRank];
  if (step === undefined) {
    const lightened = ladder === 'reset' ? targets : lightenTargets(targets, shape);
    return { rank: steps.length, code: 'STALL_REPLACE_PROPOSED', propose: true, targets: lightened };
  }
  return {
    rank: previousRank + 1,
    code: step.code,
    propose: step.code === 'STALL_REPLACE_PROPOSED',
    targets: apply(step.action, targets, shape),
  };
}
