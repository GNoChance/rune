import { parisDate } from '../age';
import type { SessionRecord } from '../program/types';
import { doneWorkSets } from './xp';

/** kg soulevés, en grammes : charge × répétitions des séries de travail faites, charge telle que saisie. */
export function tonnageG(history: readonly SessionRecord[]): number {
  let total = 0;
  for (const s of history)
    for (const e of s.exercises)
      for (const set of doneWorkSets(e)) total += (set.loadG ?? 0) * (set.reps ?? 0);
  return total;
}

/** Numéro de semaine civile (lundi à dimanche) d'une date 'YYYY-MM-DD'. */
function weekIndex(civil: string): number {
  const [y, m, d] = civil.split('-').map(Number) as [number, number, number];
  const days = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  // le 1970-01-01 est un jeudi : le lundi suivant est le jour 4
  return Math.floor((days + 3) / 7);
}

/** Semaines civiles (Paris) avec au moins une séance terminée. */
export function assiduityWeeks(history: readonly SessionRecord[]): number {
  const weeks = new Set<number>();
  for (const s of history) {
    if (s.status === 'completed') weeks.add(weekIndex(parisDate(new Date(s.startedAt))));
  }
  return weeks.size;
}
