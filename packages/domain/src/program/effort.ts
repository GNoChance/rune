import type { RulesSet } from './rules';
import { isDone, type SetRecord } from './types';

/** Minimum du RIR retenu sur les séries de travail faites qui portent un effort ; null s'il n'y en a pas. */
export function rirEval(sets: readonly SetRecord[], rules: RulesSet): number | null {
  let min: number | null = null;
  for (const s of sets) {
    if (s.kind !== 'work' || !isDone(s) || s.effort === null) continue;
    const rir = rules.rirByEffort[s.effort];
    if (min === null || rir < min) min = rir;
  }
  return min;
}

export const effortValidated = (rir: number | null, targetRir: number): boolean =>
  rir !== null && rir > 0 && rir >= targetRir - 1;
