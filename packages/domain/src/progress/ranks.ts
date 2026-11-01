import { MUSCLE_GROUPS, type MuscleGroupCode } from '@rune/contracts';
import type { CatalogSheet } from '../catalog/usable';
import type { SessionRecord } from '../program/types';
import { GLOBAL_RANK_XP, GROUP_RANK_SETS, RANKS, type Rank, rankFor } from './rules';
import { assiduityWeeks, tonnageG } from './stats';
import { sessionXp, workSetUnits } from './xp';

export interface ProgressSummary {
  xp: number;
  rank: Rank;
  nextRank: Rank | null;
  nextRankXp: number | null;
  groups: Record<MuscleGroupCode, { sets: number; rank: Rank }>;
  sessions: number;
  tonnageG: number;
  assiduityWeeks: number;
}

/** Crédit d'une série à un groupe : 1 si un muscle principal en fait partie, sinon 0,5 pour un secondaire. */
function groupCredit(
  group: (typeof MUSCLE_GROUPS)[number],
  sheet: Pick<CatalogSheet, 'primary_muscles' | 'secondary_muscles'>,
): number {
  const muscles: readonly string[] = group.muscles;
  if (sheet.primary_muscles.some((m) => muscles.includes(m))) return 1;
  if (sheet.secondary_muscles.some((m) => muscles.includes(m))) return 0.5;
  return 0;
}

/** Tout se recalcule depuis l'historique (spec §8) ; `history` ne contient que des séances non supprimées. */
export function progressSummary(
  history: readonly SessionRecord[],
  catalog: readonly CatalogSheet[],
): ProgressSummary {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const groupSets = Object.fromEntries(MUSCLE_GROUPS.map((g) => [g.code, 0])) as Record<
    MuscleGroupCode,
    number
  >;
  let xp = 0;
  let sessions = 0;
  for (const s of history) {
    xp += sessionXp(s);
    if (s.status === 'completed') sessions++;
    for (const e of s.exercises) {
      const sheet = byId.get(e.exerciseId);
      if (!sheet) continue;
      const units = workSetUnits(e);
      for (const g of MUSCLE_GROUPS) groupSets[g.code] += units * groupCredit(g, sheet);
    }
  }
  const rank = rankFor(xp, GLOBAL_RANK_XP);
  const nextRank = RANKS[RANKS.indexOf(rank) + 1] ?? null;
  const groups = Object.fromEntries(
    MUSCLE_GROUPS.map((g) => [
      g.code,
      { sets: groupSets[g.code], rank: rankFor(groupSets[g.code], GROUP_RANK_SETS) },
    ]),
  ) as ProgressSummary['groups'];
  return {
    xp,
    rank,
    nextRank,
    nextRankXp: nextRank === null ? null : GLOBAL_RANK_XP[nextRank],
    groups,
    sessions,
    tonnageG: tonnageG(history),
    assiduityWeeks: assiduityWeeks(history),
  };
}

/** Rangs gagnés entre deux calculs (jamais de « descente » annoncée). */
export function rankUps(
  before: ProgressSummary,
  after: ProgressSummary,
): { global: Rank | null; groups: MuscleGroupCode[] } {
  const idx = (r: Rank) => RANKS.indexOf(r);
  return {
    global: idx(after.rank) > idx(before.rank) ? after.rank : null,
    groups: MUSCLE_GROUPS.map((g) => g.code).filter(
      (c) => idx(after.groups[c].rank) > idx(before.groups[c].rank),
    ),
  };
}
