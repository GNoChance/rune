import type { Effort } from '@rune/contracts';

/** Version courante des règles du moteur ; chaque séance garde la sienne (spec brique 3 §4.1). */
export const RULES_VERSION = '1';

export interface RulesSet {
  /** RIR retenu par effort (05 §7). */
  rirByEffort: Readonly<Record<Effort, number>>;
  lightenPct: number;
  stallSessions: number;
  sessionsAtTop: number;
  stepS: number;
  raiseCapPct: number;
  sumModeStepPct: number;
  sumAllowanceBelowMin: number;
  durationFailMarginS: number;
  /** Fourchette d'un slot `linear` passé en `double` : [r, r + linearDoubleSpan] (05 §9.6). */
  linearDoubleSpan: number;
  /** RIR cible d'un slot dont le modèle n'en donne pas (05 §1.3 : 2 à 3 RIR en réserve). */
  defaultTargetRir: number;
  defaultIncrementG: { upper: number; lower: number };
  /** Semaine allégée (05 §10.3) : `targetRir` + `deloadRirPlus`, au plus `deloadRirMax` (05 §4 : 1 à 5). */
  deloadRirPlus: number;
  deloadRirMax: number;
  restS: readonly [number, number];
  calibrationSessions: number;
  /** Séances de suite en douleur sur un état avant la suspension du slot (05 §13.7). */
  painSuspendStreak: number;
  /** Allègement réactif (05 §10.1) : au moins `stalledSlots` slots en stagnation sur les `weeks` dernières semaines. */
  reactiveDeload: { stalledSlots: number; weeks: number };
  resume: {
    days14: { days: number; loadPct: number; variantsBack: number };
    days28: { days: number; loadPct: number; variantsBack: number };
  };
  cautious: {
    repsMin: number;
    repsMax: number;
    minRepsGap: number;
    maxWorkSets: number;
    minTargetRir: number;
    chainEnd: number;
    chainEndAdult: number;
    noRaiseBeforeSession: number;
  };
  proposalValidDays: number;
  maxOperations: number;
  forgottenSessionH: { sameDevice: number; otherDevice: number };
  setBounds: {
    loadG: readonly [number, number];
    reps: readonly [number, number];
    durationS: readonly [number, number];
    position: readonly [number, number];
  };
  noteMaxLength: number;
  /**
   * Bornes des modèles (05 §5, règle 3) et plafonds adultes des changements (05 §15) ; les bornes prudentes sont
   * dans `cautious`, le repos dans `restS`.
   */
  programBounds: {
    workSets: readonly [number, number];
    reps: readonly [number, number];
    minRepsGap: number;
    targetRir: readonly [number, number];
    /** `targetRir` minimal d'un débutant sur un slot principal ou un exercice polyarticulaire. */
    minRirBeginnerCompound: number;
    maxSlotsPerWorkout: number;
    days: readonly [number, number];
  };
}

export type RulesBook = Readonly<Record<string, RulesSet>>;

function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

const V1: RulesSet = {
  rirByEffort: { easy: 4, ok: 2.5, hard: 1, failed: 0 },
  lightenPct: 10,
  stallSessions: 3,
  sessionsAtTop: 2,
  stepS: 5,
  raiseCapPct: 10,
  sumModeStepPct: 10,
  sumAllowanceBelowMin: 2,
  durationFailMarginS: 5,
  linearDoubleSpan: 4,
  defaultTargetRir: 2,
  defaultIncrementG: { upper: 2500, lower: 5000 },
  deloadRirPlus: 2,
  deloadRirMax: 5,
  restS: [30, 300],
  calibrationSessions: 3,
  painSuspendStreak: 2,
  reactiveDeload: { stalledSlots: 2, weeks: 2 },
  resume: {
    days14: { days: 14, loadPct: 10, variantsBack: 0 },
    days28: { days: 28, loadPct: 20, variantsBack: 1 },
  },
  cautious: {
    repsMin: 6,
    repsMax: 15,
    minRepsGap: 2,
    maxWorkSets: 3,
    minTargetRir: 3,
    chainEnd: 15,
    chainEndAdult: 25,
    noRaiseBeforeSession: 3,
  },
  proposalValidDays: 7,
  maxOperations: 5,
  forgottenSessionH: { sameDevice: 6, otherDevice: 24 },
  setBounds: { loadG: [0, 500_000], reps: [0, 200], durationS: [0, 7200], position: [1, 99] },
  noteMaxLength: 500,
  programBounds: {
    workSets: [1, 5],
    reps: [5, 30],
    minRepsGap: 2,
    targetRir: [1, 4],
    minRirBeginnerCompound: 2,
    maxSlotsPerWorkout: 8,
    days: [2, 4],
  },
};

export const RULES_BY_VERSION: RulesBook = deepFreeze({ '1': V1 });

export function rulesFor(version: string): RulesSet | null {
  return Object.hasOwn(RULES_BY_VERSION, version) ? (RULES_BY_VERSION[version] ?? null) : null;
}

/**
 * Règles de la version courante (`RULES_VERSION`) : celles des validateurs et des nouvelles séances. Lève si elles
 * manquent, ce qui serait une erreur de publication des règles.
 */
export function currentRules(): RulesSet {
  const rules = rulesFor(RULES_VERSION);
  if (rules === null) throw new Error(`Règles ${RULES_VERSION} absentes de RULES_BY_VERSION`);
  return rules;
}
