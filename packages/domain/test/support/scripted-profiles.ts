import type { AgeBand, Effort, NextAdjustment, PainLevel, SessionProfile } from '@rune/contracts';
import type { PlannedExercise, PlannedSet } from '../../src/program/plan';
import type { SetRecord } from '../../src/program/types';

/*
 * Profils scriptés des scénarios de référence (05 §5 règle 9, §17.3). Règles de la simulation, toutes déterministes
 * (ni `Math.random`, ni horloge) :
 *
 * - Dates : première séance le 2026-01-05 à 18 h (Paris), puis une séance tous les 2 jours, quel que soit le nombre de
 *   jours par semaine du modèle (les semaines de programme se comptent en séances, jamais au calendrier).
 * - Chaque `PlannedSet` devient une série faite (`loggedAt` non nul). Charge : la cible de la série, sinon la
 *   suggestion de calibration de l'exercice, sinon une charge de départ fixe par mode de charge (`START_LOAD_G`, sur
 *   la grille des réglages par défaut) ; rien sans charge (poids du corps, élastique, lesté).
 * - Répétitions et durées dépendent du profil (voir chaque profil) ; « tout en haut » veut dire le haut de la
 *   fourchette plus une répétition quand le slot a une fourchette (le mode somme de 05 §8 l'exige quand le pas de
 *   charge du lieu dépasse le plafond d'une hausse), la durée visée en durée. L'effort n'est saisi que sur la dernière série de
 *   travail de chaque exercice, comme l'écran de séance.
 * - Le profil « douleur » marque `painLevel: 'pain'` et `nextAdjustment: 'lighten'` sur le premier slot de la première
 *   séance du modèle, à sa 3e et à sa 4e occurrence consécutives : la 2e douleur de suite suspend le slot.
 * - Les suspensions du moteur sont rendues au rejeu suivant comme changements acceptés, comme le serveur les écrit
 *   (identifiant = clé de l'événement, `decidedAt` = fin de la séance déclenchante, auteur `engine`). Les propositions
 *   (remplacement, allègement) ne sont jamais acceptées.
 * - Le profil prudent (`cautious`) tourne en profil de séance `cautious`, tranche d'âge `minor`.
 */

/** Charge de départ de l'utilisateur quand le moteur n'en propose aucune, par mode de charge (grammes). */
export const START_LOAD_G: Readonly<Partial<Record<string, number>>> = {
  barbell: 30_000,
  dumbbell: 10_000,
  machine: 30_000,
};

/** Ce que le profil sait de la série qu'il fait. */
export interface SetContext {
  exercise: PlannedExercise;
  /** 1 pour la première fois que ce slot est fait dans la simulation, 2 pour la deuxième… */
  occurrence: number;
  /** Dernière série de travail de l'exercice : celle qui porte l'effort. */
  lastWork: boolean;
  /** Instant de la saisie (millisecondes Unix). */
  loggedAt: number;
  /** Identifiant de la série. */
  id: string;
}

export interface ExerciseContext {
  exercise: PlannedExercise;
  occurrence: number;
  /** Premier slot de la première séance du modèle. */
  slotIsFirst: boolean;
}

export interface ScriptedProfile {
  id: 'always_progresses' | 'fails' | 'reports_pain' | 'never_logs_effort' | 'cautious';
  sessionProfile: SessionProfile;
  ageBand: AgeBand;
  /** La série faite pour une série prévue. */
  doSet(planned: PlannedSet, ctx: SetContext): SetRecord;
  /** Douleur et ajustement déclarés sur l'exercice ; null si rien. */
  report(ctx: ExerciseContext): {
    painLevel: PainLevel;
    nextAdjustment: NextAdjustment;
  } | null;
}

function startLoad(ctx: SetContext, planned: PlannedSet): number | null {
  if (planned.targetLoadG !== null) return planned.targetLoadG;
  const mode = ctx.exercise.loadMode;
  if (mode === null) return null;
  const start = START_LOAD_G[mode];
  if (start === undefined) return null;
  // Une série d'échauffement sans cible reste légère : la moitié de la charge de départ de l'exercice.
  const work = ctx.exercise.suggestionG ?? start;
  return planned.kind === 'warmup' ? Math.floor(work / 2) : work;
}

type Shape = (planned: PlannedSet) => { reps: number | null; durationS: number | null };

/** Série faite à partir de la série prévue, avec une forme (répétitions, durée) et un effort au choix du profil. */
function record(planned: PlannedSet, ctx: SetContext, shape: Shape, effort: Effort | null): SetRecord {
  const { reps, durationS } = planned.kind === 'warmup' ? warmup(planned) : shape(planned);
  return {
    id: ctx.id,
    position: planned.position,
    kind: planned.kind,
    loadMode: ctx.exercise.loadMode ?? 'bodyweight',
    loadG: startLoad(ctx, planned),
    reps,
    durationS,
    side: planned.side,
    effort: planned.kind === 'work' && ctx.lastWork ? effort : null,
    targetRepsMin: planned.targetRepsMin,
    targetRepsMax: planned.targetRepsMax,
    targetReps: planned.targetReps,
    targetDurationS: planned.targetDurationS,
    targetLoadG: planned.targetLoadG,
    targetRir: planned.targetRir,
    targetVariant: planned.targetVariant,
    loggedAt: ctx.loggedAt,
  };
}

/** Un échauffement est toujours fait comme prévu. */
const warmup = (p: PlannedSet) => ({ reps: p.targetRepsMax, durationS: p.targetDurationS });

/** Le haut de la cible : le haut de la fourchette plus une répétition si elle en est une, ou la durée visée. */
const atTop: Shape = (p) => ({
  reps: p.targetRepsMax === null ? null : p.targetRepsMax + (p.targetRepsMin === p.targetRepsMax ? 0 : 1),
  durationS: p.targetDurationS,
});

/** Deux répétitions sous le bas de la fourchette (au moins 1), 60 % de la durée visée. */
const short: Shape = (p) => ({
  reps: p.targetRepsMin === null ? null : Math.max(1, p.targetRepsMin - 2),
  durationS: p.targetDurationS === null ? null : Math.floor(p.targetDurationS * 0.6),
});

const none = () => null;

const progresses = (id: ScriptedProfile['id'], over: Partial<ScriptedProfile> = {}): ScriptedProfile => ({
  id,
  sessionProfile: 'adult',
  ageBand: 'adult',
  doSet: (p, ctx) => record(p, ctx, atTop, 'ok'),
  report: none,
  ...over,
});

export const SCRIPTED_PROFILES: readonly ScriptedProfile[] = [
  // Tout en haut de la cible, effort « correct » : le moteur doit monter dès qu'il le peut.
  progresses('always_progresses'),
  // Deux répétitions sous le bas de la fourchette, effort « échec » : stagnations, remplacements, allègement réactif.
  progresses('fails', { doSet: (p, ctx) => record(p, ctx, short, 'failed') }),
  // Comme le premier, avec une douleur sur le premier slot à ses 3e et 4e occurrences.
  progresses('reports_pain', {
    report: ({ occurrence, slotIsFirst }) =>
      slotIsFirst && (occurrence === 3 || occurrence === 4)
        ? { painLevel: 'pain', nextAdjustment: 'lighten' }
        : null,
  }),
  // Tout en haut de la cible mais aucun effort saisi : le moteur ne doit jamais monter la charge.
  progresses('never_logs_effort', { doSet: (p, ctx) => record(p, ctx, atTop, null) }),
  // Profil prudent d'un mineur qui fait ce qui est prévu, effort « correct ».
  progresses('cautious', { sessionProfile: 'cautious', ageBand: 'minor' }),
];
