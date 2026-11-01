import { type ExerciseRecord, isDone, type SessionRecord, type SetRecord } from '../program/types';
import { XP_RULES } from './rules';

/** Séries de travail faites d'un exercice. */
export const doneWorkSets = (e: ExerciseRecord): SetRecord[] =>
  e.sets.filter((s) => s.kind === 'work' && isDone(s));

/** Nombre de séries de travail faites ; une paire gauche/droite compte pour une. */
export function workSetUnits(e: ExerciseRecord): number {
  let plain = 0;
  let left = 0;
  let right = 0;
  for (const s of doneWorkSets(e)) {
    if (s.side === 'left') left++;
    else if (s.side === 'right') right++;
    else plain++;
  }
  return plain + Math.max(left, right);
}

/** XP d'une séance : seulement `completed`, plafonnée ; rien pour la charge, l'échec ni un record. */
export function sessionXp(session: SessionRecord): number {
  if (session.status !== 'completed') return 0;
  let xp = XP_RULES.perCompletedSession;
  for (const e of session.exercises) {
    xp += workSetUnits(e) * XP_RULES.perWorkSet;
    const work = doneWorkSets(e);
    const last = work.reduce<SetRecord | null>(
      (best, s) => (best === null || s.position >= best.position ? s : best),
      null,
    );
    if (last !== null && last.effort !== null) xp += XP_RULES.perEffortExercise;
  }
  return Math.min(xp, XP_RULES.sessionCap);
}
