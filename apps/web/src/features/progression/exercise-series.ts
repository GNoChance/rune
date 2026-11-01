import { doneWorkSets, type SessionRecord } from '@rune/domain';

/** Ce que mesure la courbe d'un exercice : la charge, à défaut les secondes tenues, à défaut les répétitions. */
export type Metric = 'load' | 'duration' | 'reps';

export interface SeriesPoint {
  sessionId: string;
  /** Début de la séance, en millisecondes. */
  startedAt: number;
  /** Grammes, secondes ou répétitions selon `metric`. */
  value: number;
}

export interface ExerciseSeries {
  /** Null si l'exercice n'a aucune série de travail faite avec une valeur. */
  metric: Metric | null;
  /** Meilleure série de chaque séance terminée, de la plus ancienne à la plus récente. */
  points: SeriesPoint[];
}

type Work = ReturnType<typeof doneWorkSets>[number];

const loaded = (s: Work) => (s.loadG ?? 0) > 0 && (s.reps ?? 0) >= 1;

/**
 * Courbe de la meilleure série par séance terminée (spec brique 3 §7.10) : charge si l'exercice a déjà été fait
 * avec une charge, sinon secondes tenues, sinon répétitions.
 */
export function exerciseSeries(history: readonly SessionRecord[], exerciseId: string): ExerciseSeries {
  const perSession = history
    .filter((s) => s.status === 'completed')
    .map((s) => ({
      session: s,
      sets: s.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => doneWorkSets(e)),
    }))
    .filter((x) => x.sets.length > 0);
  const all = perSession.flatMap((x) => x.sets);
  const metric: Metric | null = all.some(loaded)
    ? 'load'
    : all.some((s) => (s.durationS ?? 0) > 0)
      ? 'duration'
      : all.some((s) => (s.reps ?? 0) > 0)
        ? 'reps'
        : null;
  if (metric === null) return { metric, points: [] };
  const metricValue = (s: Work): number =>
    metric === 'load'
      ? loaded(s)
        ? (s.loadG ?? 0)
        : 0
      : metric === 'duration'
        ? (s.durationS ?? 0)
        : (s.reps ?? 0);
  const points = perSession
    .map(({ session, sets }) => ({
      sessionId: session.id,
      startedAt: session.startedAt,
      value: Math.max(0, ...sets.map(metricValue)),
    }))
    .filter((p) => p.value > 0)
    .sort((a, b) => a.startedAt - b.startedAt || (a.sessionId < b.sessionId ? -1 : 1));
  return { metric, points };
}
