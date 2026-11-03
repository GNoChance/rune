import { type LoadMode, MUSCLE_GROUPS, type MuscleGroupCode, REASON_TEXTS } from '@rune/contracts';
import {
  type CatalogSheet,
  exerciseRecords,
  type NextTarget,
  type ProgressSummary,
  progressSummary,
  type Rank,
  type RecordHit,
  rankUps,
  type SessionRecord,
  sessionRecords,
  sessionXp,
} from '@rune/domain';
import type { SessionDecision } from '../../repos';
import { formatKg, formatKgGrouped, formatSeconds, plural } from '../../ui';
import { minutesOf, type SessionWork, showsDecision, totalsOf } from '../history/history-format';
import { targetSummary } from './workout-labels';

/*
 * Bilan d'une séance terminée (spec brique 3 §7.4, §8), tel qu'il était à sa fin : la progression avant (séances
 * commencées avant elle) et après (avec elle), l'XP de la séance, les rangs gagnés, les records battus et les lignes de
 * « La prochaine fois ». Tout part de l'historique local et des fonctions du domaine (`progressSummary`, `sessionXp`,
 * `rankUps`, `sessionRecords`) ; rien n'est stocké. Fonctions pures, sans rendu.
 */

export interface RecordLines {
  exerciseId: string;
  /** « Nouveau record : 62,5 kg × 6 », « Nouveau record de volume : 1 125 kg »… */
  lines: string[];
}

export interface SessionSummary {
  /** Durée en minutes pleines ; null sans heure de fin. */
  minutes: number | null;
  /** Séries de travail faites (une paire gauche/droite compte pour une). */
  sets: number;
  /** Travail de la séance : kg soulevés, sinon répétitions, sinon temps d'effort (ruling R56). */
  work: SessionWork;
  /** XP de la séance (10 / 5 / 20, plafond 300). */
  xp: number;
  before: ProgressSummary;
  after: ProgressSummary;
  rankUp: { global: Rank | null; groups: MuscleGroupCode[] };
  records: RecordLines[];
}

/** Libellé d'un groupe musculaire (« Quadriceps »). */
export const groupLabel = (code: MuscleGroupCode): string =>
  MUSCLE_GROUPS.find((g) => g.code === code)?.label ?? code;

/** Part du prochain rang déjà faite, de 0 à 1, comme la barre de la Progression (pleine au rang S). */
export const rankRatio = (s: ProgressSummary): number =>
  s.nextRankXp === null ? 1 : Math.round((Math.min(s.xp, s.nextRankXp) / s.nextRankXp) * 10_000) / 10_000;

function recordText(hit: RecordHit, session: SessionRecord): string {
  switch (hit.kind) {
    case 'load': {
      // Meilleure série de la séance pour cet exercice (charge, puis répétitions) : celle qui bat le record.
      const best = exerciseRecords([session], hit.exerciseId, 'adult').bestLoad;
      return best === null
        ? `Nouveau record : ${formatKg(hit.value)}`
        : `Nouveau record : ${formatKg(best.loadG)} × ${best.reps}`;
    }
    case 'reps':
      return `Nouveau record : ${hit.value} ${plural(hit.value, 'répétition', 'répétitions')}`;
    case 'duration':
      return `Nouveau record : ${formatSeconds(hit.value)}`;
    case 'volume':
      return `Nouveau record de volume : ${formatKgGrouped(hit.value)}`;
  }
}

/** Records battus par la séance, regroupés par exercice dans l'ordre où le domaine les rend. */
function recordLines(history: readonly SessionRecord[], session: SessionRecord): RecordLines[] {
  const out: RecordLines[] = [];
  for (const hit of sessionRecords(history, session.id)) {
    const text = recordText(hit, session);
    const known = out.find((r) => r.exerciseId === hit.exerciseId);
    if (known) known.lines.push(text);
    else out.push({ exerciseId: hit.exerciseId, lines: [text] });
  }
  return out;
}

/**
 * Bilan de `session` (terminée) dans `history` (séances non supprimées, elle comprise ou non) : seules les séances
 * commencées avant elle font le « avant », si bien qu'un résumé rouvert plus tard dit toujours la même chose.
 */
export function sessionSummary(
  history: readonly SessionRecord[],
  sheets: readonly CatalogSheet[],
  session: SessionRecord,
): SessionSummary {
  const earlier = history.filter((s) => s.id !== session.id && s.startedAt < session.startedAt);
  const before = progressSummary(earlier, sheets);
  const after = progressSummary([...earlier, session], sheets);
  const totals = totalsOf(session);
  return {
    minutes: minutesOf(session),
    sets: totals.sets,
    work: totals.work,
    xp: sessionXp(session),
    before,
    after,
    rankUp: rankUps(before, after),
    records: recordLines([...earlier, session], session),
  };
}

export interface NextLine {
  /** Exercice de la séance qui porte la décision. */
  performedExerciseId: string;
  exerciseId: string;
  /** Autre variante visée la prochaine fois (chaîne) ; null pour la même fiche. */
  variantId: string | null;
  /** « 3 × 6 · 62,5 kg » ; vide sans cible. */
  target: string;
  /** Phrase du code raison (`REASON_TEXTS`). */
  reason: string;
  provisional: boolean;
}

/** Cible suivante résumée comme la séance du jour la montrera (`targetSummary`). */
function nextTargetText(target: NextTarget, loadMode: LoadMode | null): string {
  return targetSummary({
    calibration: false,
    loadMode,
    sets: Array.from({ length: target.workSets }, (_, i) => ({
      kind: 'work' as const,
      position: i + 1,
      targetRepsMin: target.repsMin,
      targetRepsMax: target.repsMax,
      targetDurationS: target.durationS,
      targetLoadG: target.loadG,
    })),
  });
}

/**
 * « La prochaine fois » : une ligne par exercice de la séance qui porte une décision du moteur (rulings R34, R55 : la
 * dernière entrée d'un état qui a une série de travail faite), dans l'ordre de la séance, sauf un exercice sans série
 * de travail faite et une décision `NO_DATA` (`showsDecision`). Une séance libre n'en a aucune (D7).
 */
export function nextLines(
  exercises: readonly SessionRecord['exercises'][number][],
  decisions: readonly SessionDecision[],
): NextLine[] {
  const byExercise = new Map(decisions.map((d) => [d.performedExerciseId, d]));
  return exercises.flatMap((e) => {
    const decision = byExercise.get(e.id);
    if (!decision || !showsDecision(e, decision)) return [];
    const target = decision.nextTarget;
    const loadMode = (e.sets.find((s) => s.kind === 'work') ?? e.sets[0])?.loadMode ?? null;
    const variantId = target?.variantId ?? null;
    return [
      {
        performedExerciseId: e.id,
        exerciseId: e.exerciseId,
        variantId: variantId === e.exerciseId ? null : variantId,
        target: target === null ? '' : nextTargetText(target, loadMode),
        reason: REASON_TEXTS[decision.reasonCode],
        provisional: decision.provisional,
      },
    ];
  });
}
