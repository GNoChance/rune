import { doneWorkSets, type SessionRecord, tonnageG, workSetUnits } from '@rune/domain';
import { formatInt, formatLifted, formatSeconds, plural } from '../../ui';

const TIME_ZONE = 'Europe/Paris';

const dayFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const monthFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, month: 'long', year: 'numeric' });
const monthKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
});

/** « mar. 28 oct. », à l'heure de Paris. */
export const dayLabel = (ms: number): string => dayFormat.format(new Date(ms));

/** « Octobre 2025 ». */
export function monthLabel(ms: number): string {
  const label = monthFormat.format(new Date(ms));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Clé de regroupement du mois civil de Paris (« 2025-10 »). */
export const monthKey = (ms: number): string => monthKeyFormat.format(new Date(ms));

/** « 3 200 kg » ; « 12,4 t » au-delà de 10 000 kg. Charges en grammes entiers. */
export const liftedLabel = formatLifted;

/**
 * Décision du moteur à montrer pour une entrée de séance (« La prochaine fois » du résumé, historique) : pas pour un
 * exercice sans série de travail faite (sauté, ou échauffement seul), ni pour `NO_DATA` (rien à évaluer : le repère ne
 * change pas).
 */
export const showsDecision = (
  exercise: Pick<SessionRecord['exercises'][number], 'sets'>,
  decision: { reasonCode: string },
): boolean =>
  decision.reasonCode !== 'NO_DATA' && exercise.sets.some((s) => s.kind === 'work' && s.loggedAt !== null);

/** « Séance A » pour une séance de programme, « Séance libre » sans programme (D7). */
export const sessionName = (s: Pick<SessionRecord, 'workoutId'>): string =>
  s.workoutId === null ? 'Séance libre' : `Séance ${s.workoutId}`;

export const setsLabel = (n: number): string => `${n} ${plural(n, 'série', 'séries')}`;

/** Durée en minutes pleines (au moins 1) ; null sans heure de fin. */
export function minutesOf(s: Pick<SessionRecord, 'startedAt' | 'endedAt'>): number | null {
  if (s.endedAt === null) return null;
  return Math.max(1, Math.round((s.endedAt - s.startedAt) / 60_000));
}

/**
 * Travail d'une séance, tel qu'on le montre (ruling R56) : les kg soulevés dès qu'une charge a bougé ; sinon (poids du
 * corps, élastique) les répétitions des séries de travail faites ; sans répétition, leur temps d'effort. Une séance
 * sans rien de tout cela garde « 0 kg ».
 */
export type SessionWork =
  | { kind: 'lifted'; grams: number }
  | { kind: 'reps'; reps: number }
  | { kind: 'duration'; seconds: number };

export interface SessionTotals {
  sets: number;
  work: SessionWork;
}

/** Séries de travail faites (une paire gauche/droite compte pour une) et travail de la séance (`SessionWork`). */
export function totalsOf(s: SessionRecord): SessionTotals {
  const sets = s.exercises.reduce((n, e) => n + workSetUnits(e), 0);
  const grams = tonnageG([s]);
  const done = s.exercises.flatMap(doneWorkSets);
  const reps = done.reduce((n, set) => n + (set.reps ?? 0), 0);
  const seconds = done.reduce((n, set) => n + (set.durationS ?? 0), 0);
  if (grams > 0 || (reps === 0 && seconds === 0)) return { sets, work: { kind: 'lifted', grams } };
  return { sets, work: reps > 0 ? { kind: 'reps', reps } : { kind: 'duration', seconds } };
}

/** Case de la fenêtre du Système : « Total soulevé · 1 080 kg », « Répétitions · 61 », « Temps d'effort · 1 min 15 s ». */
export function workStat(work: SessionWork): { term: string; value: string } {
  switch (work.kind) {
    case 'lifted':
      return { term: 'Total soulevé', value: formatLifted(work.grams) };
    case 'reps':
      return { term: 'Répétitions', value: formatInt(work.reps) };
    case 'duration':
      return { term: "Temps d'effort", value: formatSeconds(work.seconds) };
  }
}

/** Fin de ligne de l'historique : « 3 200 kg », « 61 répétitions », « 1 min 15 s d'effort ». */
export function workLabel(work: SessionWork): string {
  switch (work.kind) {
    case 'lifted':
      return liftedLabel(work.grams);
    case 'reps':
      return `${formatInt(work.reps)} ${plural(work.reps, 'répétition', 'répétitions')}`;
    case 'duration':
      return `${formatSeconds(work.seconds)} d'effort`;
  }
}
