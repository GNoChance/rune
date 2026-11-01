/**
 * Barèmes de la gamification (spec brique 3 §8). Leur version est propre : elle n'entre jamais dans le
 * `RulesSet` du moteur, et tout se recalcule toujours avec la version courante.
 */
export const PROGRESS_RULES_VERSION = '1';

export const RANKS = ['E', 'D', 'C', 'B', 'A', 'S'] as const;
export type Rank = (typeof RANKS)[number];

export const XP_RULES = {
  perWorkSet: 10,
  perEffortExercise: 5,
  perCompletedSession: 20,
  sessionCap: 300,
} as const;

/** XP cumulée requise pour chaque rang global. */
export const GLOBAL_RANK_XP: Readonly<Record<Rank, number>> = {
  E: 0,
  D: 1000,
  C: 5000,
  B: 12000,
  A: 30000,
  S: 60000,
};

/** Séries de travail cumulées requises pour chaque rang de groupe. */
export const GROUP_RANK_SETS: Readonly<Record<Rank, number>> = {
  E: 0,
  D: 20,
  C: 100,
  B: 250,
  A: 600,
  S: 1200,
};

/** Rang atteint pour une valeur cumulée. */
export function rankFor(value: number, thresholds: Readonly<Record<Rank, number>>): Rank {
  let rank: Rank = 'E';
  for (const r of RANKS) if (value >= thresholds[r]) rank = r;
  return rank;
}

/** Épley : seulement si répétitions + RIR retenu ≤ 12 (05 §13.1). */
export const E1RM_MAX_REPS_PLUS_RIR = 12;
