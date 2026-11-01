import type { WeekType } from '@rune/contracts';
import { parisDate } from '../age';
import type { EffectiveProgram } from './effective';
import type { SessionRecord } from './types';

/*
 * État du programme (spec brique 3 §4.3.7 à §4.3.9 et §4.4.7) : semaine de programme, place dans le bloc, séances
 * allégées restantes, prochaine séance de la rotation. Jamais stocké : le téléphone et le serveur le recalculent par
 * `replayInstance`, séance terminée après séance terminée et changement accepté après changement accepté.
 */

export interface ProgramState {
  /**
   * Semaine de programme en cours, à partir de 0 : le nombre de semaines terminées. Une semaine se termine dès que
   * ses séances `completed` atteignent les jours par semaine en vigueur (05 §4) ; jamais par le calendrier.
   */
  weekIndex: number;
  /** Séances terminées depuis le début de la semaine en cours. */
  sessionsInWeek: number;
  /** Semaine du bloc où tombe la semaine en cours, à partir de 1 (bloc `planned`) ; null pour un bloc `reactive`. */
  blockWeek: number | null;
  /** Séances encore allégées par un allègement accepté (05 §10). */
  deloadSessionsLeft: number;
  /** Séance proposée : celle qui suit, dans `workouts`, la dernière séance terminée (05 §4). */
  nextWorkoutId: string;
  /** Début de la dernière séance terminée, ISO 8601 UTC ; null avant la première. */
  lastCompletedStartedAt: string | null;
}

const DAY_MS = 86_400_000;

/** Instant (millisecondes Unix) en ISO 8601 UTC, le format des colonnes de date du serveur. */
export const isoInstant = (ms: number): string => new Date(ms).toISOString();

/** Numéro du jour d'une date civile `YYYY-MM-DD`. */
function dayNumber(civil: string): number {
  const [y = 0, m = 1, d = 1] = civil.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/**
 * Jours civils de Paris entre deux instants (spec §4.3.9), passages d'heure compris : du 1er à 23 h 30 au 15 à
 * 0 h 30, 14 jours, alors que 13 jours et une heure seulement se sont écoulés.
 */
export function parisDaysBetween(fromMs: number, toMs: number): number {
  return dayNumber(parisDate(new Date(toMs))) - dayNumber(parisDate(new Date(fromMs)));
}

const blockLength = (program: EffectiveProgram): number | null =>
  program.template.block.mode === 'planned' ? program.template.block.weeks : null;

/** Séance qui suit `workoutId` dans la rotation, la première après la dernière ; la première si elle est inconnue. */
export function workoutAfter(program: EffectiveProgram, workoutId: string | null): string {
  const workouts = program.template.workouts;
  const i = workouts.findIndex((w) => w.id === workoutId);
  return workouts[(i + 1) % workouts.length]?.id ?? workouts[0]?.id ?? '';
}

/** État d'une instance sans séance : semaine 0, semaine 1 du bloc planifié, première séance de la rotation. */
export function initialProgramState(program: EffectiveProgram): ProgramState {
  return {
    weekIndex: 0,
    sessionsInWeek: 0,
    blockWeek: blockLength(program) === null ? null : 1,
    deloadSessionsLeft: 0,
    nextWorkoutId: workoutAfter(program, null),
    lastCompletedStartedAt: null,
  };
}

/** Ferme la semaine en cours si ses séances atteignent les jours en vigueur ; le bloc passe à sa semaine suivante. */
function closeWeekIfDone(state: ProgramState, program: EffectiveProgram): ProgramState {
  if (state.sessionsInWeek === 0 || state.sessionsInWeek < program.daysPerWeek) return state;
  const weeks = blockLength(program);
  return {
    ...state,
    weekIndex: state.weekIndex + 1,
    sessionsInWeek: 0,
    blockWeek: state.blockWeek === null || weeks === null ? state.blockWeek : (state.blockWeek % weeks) + 1,
  };
}

/**
 * Une séance `completed` de plus (spec §4.3.7) : la semaine se ferme dès que le compte est atteint ; une séance
 * allégée de moins, et le bloc repart à sa semaine 1 quand l'allègement accepté est fini ; la rotation suit la
 * séance faite, sauf une séance inconnue du programme, qui ne la change pas.
 */
export function countSession(
  state: ProgramState,
  program: EffectiveProgram,
  session: Pick<SessionRecord, 'workoutId' | 'startedAt'>,
): ProgramState {
  let next = closeWeekIfDone({ ...state, sessionsInWeek: state.sessionsInWeek + 1 }, program);
  if (next.deloadSessionsLeft > 0) {
    const left = next.deloadSessionsLeft - 1;
    next = {
      ...next,
      deloadSessionsLeft: left,
      blockWeek: left === 0 && next.blockWeek !== null ? 1 : next.blockWeek,
    };
  }
  const known = program.template.workouts.some((w) => w.id === session.workoutId);
  return {
    ...next,
    nextWorkoutId: known ? workoutAfter(program, session.workoutId) : next.nextWorkoutId,
    lastCompletedStartedAt: isoInstant(session.startedAt),
  };
}

/** Jours par semaine changés (`set_days_per_week`, déjà appliqué à `program`) : la semaine se ferme si elle est faite. */
export const afterDaysChange = (state: ProgramState, program: EffectiveProgram): ProgramState =>
  closeWeekIfDone(state, program);

/** Allègement accepté (`start_deload`, 05 §10) : les `daysPerWeek` séances suivantes sont allégées. */
export const afterDeloadAccepted = (state: ProgramState, program: EffectiveProgram): ProgramState => ({
  ...state,
  deloadSessionsLeft: program.daysPerWeek,
});

/**
 * Type de la prochaine séance (spec §4.3.7 et §4.3.8), que `planWorkout` fige dans la séance : allégée pendant un
 * allègement accepté et pendant la semaine allégée d'un bloc planifié.
 */
export function upcomingWeekType(state: ProgramState, program: EffectiveProgram): WeekType {
  const { block } = program.template;
  const planned = block.mode === 'planned' && state.blockWeek === block.deloadWeek;
  return state.deloadSessionsLeft > 0 || planned ? 'deload' : 'normal';
}
