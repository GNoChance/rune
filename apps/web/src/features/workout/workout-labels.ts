import type { PlanNotice, PlannedExercise, PlannedSet } from '@rune/domain';
import { formatKg, formatSeconds } from '../../ui';

/*
 * Textes de la séance du jour (spec brique 3 §7.2) : cible résumée d'un exercice, mention de résolution du slot et
 * phrase de chaque avis. Fonctions pures, sans rendu.
 */

export const CALIBRATION_TEXT = 'Calibration : tu choisis ta charge';
export const ALL_SKIPPED_TEXT = "Aucun exercice de cette séance n'est disponible pour l'instant.";

/** Nom d'un exercice dans la table des noms du catalogue ; l'identifiant faute de mieux. */
export const nameOf = (names: ReadonlyMap<string, string>, id: string | null): string =>
  id === null ? 'Exercice' : (names.get(id) ?? id);

/** Ce que `targetSummary` lit d'un exercice : celui du plan, ou celui d'une séance commencée (cibles figées, D2). */
export interface TargetSource {
  calibration: boolean;
  loadMode: PlannedExercise['loadMode'];
  sets: readonly Pick<
    PlannedSet,
    'kind' | 'position' | 'targetRepsMin' | 'targetRepsMax' | 'targetDurationS' | 'targetLoadG'
  >[];
}

/** Exercice qui porte une charge à choisir : ni au poids du corps, ni à l'élastique. */
const carriesLoad = (loadMode: TargetSource['loadMode']): boolean =>
  loadMode !== null && loadMode !== 'bodyweight' && loadMode !== 'band';

/**
 * Cible résumée : « 3 × 6 · 60 kg », « 3 × 8–12 · 14 kg par main » (haltères), « 3 × 30 s » ; en calibration sans
 * charge visée d'un exercice qui porte une charge, « Calibration : tu choisis ta charge » (au poids du corps ou à
 * l'élastique, la cible normale). Un slot sans série (sauté, suspendu) ou des séries sans cible (séance libre) n'ont
 * pas de cible (« »). Une série unilatérale compte pour une (gauche et droite).
 */
export function targetSummary(exercise: TargetSource): string {
  const work = exercise.sets.filter((s) => s.kind === 'work');
  const first = work[0];
  if (
    !first ||
    (first.targetRepsMin === null && first.targetRepsMax === null && first.targetDurationS === null)
  ) {
    return '';
  }
  if (exercise.calibration && first.targetLoadG === null && carriesLoad(exercise.loadMode)) {
    return CALIBRATION_TEXT;
  }
  const count = new Set(work.map((s) => s.position)).size;
  const amount =
    first.targetDurationS !== null
      ? formatSeconds(first.targetDurationS)
      : first.targetRepsMin === first.targetRepsMax || first.targetRepsMax === null
        ? `${first.targetRepsMin ?? 0}`
        : `${first.targetRepsMin ?? 0}–${first.targetRepsMax}`;
  const load =
    first.targetLoadG !== null && first.targetLoadG > 0
      ? ` · ${formatKg(first.targetLoadG)}${exercise.loadMode === 'dumbbell' ? ' par main' : ''}`
      : '';
  return `${count} × ${amount}${load}`;
}

/**
 * Mention sous le nom : « Remplace <exercice prévu> (pas faisable ici) », ou « (retiré du catalogue) » quand la fiche
 * prévue est retirée (`retired` : ids des fiches retirées du catalogue local) ; « Pas faisable ici : sauté »,
 * « Suspendu » ; null pour un exercice prévu tel quel.
 */
export function resolutionNote(
  exercise: PlannedExercise,
  names: ReadonlyMap<string, string>,
  retired: ReadonlySet<string> = new Set(),
): string | null {
  switch (exercise.resolution) {
    case 'replaced_not_feasible': {
      const planned = exercise.plannedExerciseId;
      const why = planned !== null && retired.has(planned) ? 'retiré du catalogue' : 'pas faisable ici';
      return `Remplace ${nameOf(names, planned)} (${why})`;
    }
    case 'not_feasible_here':
      return 'Pas faisable ici : sauté';
    case 'suspended':
      return 'Suspendu';
    default:
      return null;
  }
}

/** Phrase d'un avis au-dessus de la liste (reprise, mineurs, sport, allègement, charge la plus légère). */
export function noticeText(notice: PlanNotice, names: ReadonlyMap<string, string>): string {
  switch (notice.code) {
    case 'resume':
      return `${notice.days} jours depuis ta dernière séance : charges −${notice.pct} %`;
    case 'deload':
      return "Semaine allégée : les charges et les séries sont réduites pour t'aider à récupérer.";
    case 'minor_barbell':
      return `${nameOf(names, notice.exerciseId)} : à la barre, entraîne-toi avec un adulte expérimenté.`;
    case 'sport_gap':
      return "Garde 3 h d'écart avec ton entraînement de sport.";
    case 'lightest_load':
      return `${nameOf(names, notice.exerciseId)} : aucune charge d'ici n'est assez légère, c'est la plus légère disponible.`;
    case 'all_skipped':
      return ALL_SKIPPED_TEXT;
  }
}
