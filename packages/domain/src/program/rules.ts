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
  defaultIncrementG: { upper: number; lower: number };
  deloadRirPlus: number;
  restS: readonly [number, number];
  calibrationSessions: number;
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
  defaultIncrementG: { upper: 2500, lower: 5000 },
  deloadRirPlus: 2,
  restS: [30, 300],
  calibrationSessions: 3,
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
};

export const RULES_BY_VERSION: RulesBook = deepFreeze({ '1': V1 });

export function rulesFor(version: string): RulesSet | null {
  return Object.hasOwn(RULES_BY_VERSION, version) ? (RULES_BY_VERSION[version] ?? null) : null;
}
