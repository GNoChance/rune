import { doneWorkSets, type RecordHit, type SessionRecord, sessionRecords } from '@rune/domain';
import { formatDate, formatKgGrouped, formatSeconds } from '../../ui';

/** Combien de records la Progression montre (spec brique 3 §7.10). */
export const RECENT_RECORDS = 5;

export interface RecentRecord {
  key: string;
  exerciseId: string;
  /** « Meilleure charge 40 kg ». */
  text: string;
  /** Jour de la séance qui l'a battu, `JJ/MM/AAAA`. */
  date: string;
}

const KIND_LABEL: Record<RecordHit['kind'], string> = {
  load: 'Meilleure charge',
  reps: 'Répétitions max',
  duration: 'Durée la plus longue',
  volume: 'Meilleur volume en une séance',
};

function valueText(hit: RecordHit): string {
  switch (hit.kind) {
    case 'load':
    case 'volume':
      return formatKgGrouped(hit.value);
    case 'duration':
      return formatSeconds(hit.value);
    case 'reps':
      return String(hit.value);
  }
}

/** Les 5 derniers records battus, des séances terminées les plus récentes d'abord (`history` l'est déjà). */
export function recentRecords(history: readonly SessionRecord[]): RecentRecord[] {
  const out: RecentRecord[] = [];
  for (const s of history) {
    if (s.status !== 'completed') continue;
    for (const hit of sessionRecords(history, s.id)) {
      out.push({
        key: `${s.id}-${hit.exerciseId}-${hit.kind}`,
        exerciseId: hit.exerciseId,
        text: `${KIND_LABEL[hit.kind]} ${valueText(hit)}`,
        date: formatDate(new Date(s.startedAt).toISOString()),
      });
      if (out.length === RECENT_RECORDS) return out;
    }
  }
  return out;
}

/** Exercices avec au moins une série de travail faite, dans l'ordre des identifiants rencontrés. */
export function doneExerciseIds(history: readonly SessionRecord[]): string[] {
  const seen = new Set<string>();
  for (const s of history) {
    for (const e of s.exercises) if (doneWorkSets(e).length > 0) seen.add(e.exerciseId);
  }
  return [...seen];
}
