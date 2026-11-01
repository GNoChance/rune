import type { AgeBand } from '@rune/contracts';
import { RULES_VERSION, rulesFor } from '../program/rules';
import type { SessionRecord, SetRecord } from '../program/types';
import { E1RM_MAX_REPS_PLUS_RIR } from './rules';
import { doneWorkSets } from './xp';

export interface ExerciseRecords {
  bestLoad: { loadG: number; reps: number } | null;
  bestReps: number | null;
  bestDurationS: number | null;
  bestSessionVolumeG: number | null;
  e1rmG: number | null;
}

export interface RecordHit {
  exerciseId: string;
  kind: 'load' | 'reps' | 'duration' | 'volume';
  value: number;
}

const EXTERNAL_LOAD = new Set(['barbell', 'dumbbell', 'machine']);

/** RIR retenu d'un effort (échelle du moteur, 05 §7) ; 0 sans effort noté. */
function retainedRir(set: SetRecord): number {
  if (set.effort === null) return 0;
  return rulesFor(RULES_VERSION)?.rirByEffort[set.effort] ?? 0;
}

/** Epley, arrondi au gramme inférieur ; null hors conditions (05 §13.1). */
function e1rm(set: SetRecord): number | null {
  if (!EXTERNAL_LOAD.has(set.loadMode)) return null;
  if (set.loadG === null || set.loadG <= 0 || set.reps === null || set.reps < 1) return null;
  const total = set.reps + retainedRir(set);
  if (total > E1RM_MAX_REPS_PLUS_RIR) return null;
  return Math.floor(set.loadG * (1 + total / 30));
}

const betterLoad = (a: { loadG: number; reps: number }, b: { loadG: number; reps: number } | null): boolean =>
  b === null || a.loadG > b.loadG || (a.loadG === b.loadG && a.reps > b.reps);

interface Bests {
  bestLoad: { loadG: number; reps: number } | null;
  bestReps: number | null;
  bestDurationS: number | null;
  bestSessionVolumeG: number | null;
  e1rmG: number | null;
}

function bests(sessions: readonly SessionRecord[], exerciseId: string): Bests {
  const out: Bests = {
    bestLoad: null,
    bestReps: null,
    bestDurationS: null,
    bestSessionVolumeG: null,
    e1rmG: null,
  };
  for (const s of sessions) {
    let volume = 0;
    let any = false;
    for (const e of s.exercises) {
      if (e.exerciseId !== exerciseId) continue;
      for (const set of doneWorkSets(e)) {
        any = true;
        const load = set.loadG ?? 0;
        if (set.reps !== null) {
          volume += load * set.reps;
          if (load > 0 && set.reps >= 1) {
            const cand = { loadG: load, reps: set.reps };
            if (betterLoad(cand, out.bestLoad)) out.bestLoad = cand;
          }
          if (load === 0 && (out.bestReps === null || set.reps > out.bestReps)) out.bestReps = set.reps;
        }
        if (set.durationS !== null && (out.bestDurationS === null || set.durationS > out.bestDurationS)) {
          out.bestDurationS = set.durationS;
        }
        const est = e1rm(set);
        if (est !== null && (out.e1rmG === null || est > out.e1rmG)) out.e1rmG = est;
      }
    }
    if (any && volume > 0 && (out.bestSessionVolumeG === null || volume > out.bestSessionVolumeG)) {
      out.bestSessionVolumeG = volume;
    }
  }
  return out;
}

/** Records d'un exercice sur l'historique ; le 1RM estimé n'est jamais donné à un mineur (D9). */
export function exerciseRecords(
  history: readonly SessionRecord[],
  exerciseId: string,
  ageBand: AgeBand,
): ExerciseRecords {
  const b = bests(history, exerciseId);
  return { ...b, e1rmG: ageBand === 'minor' ? null : b.e1rmG };
}

/**
 * Records battus par une séance : valeur strictement au-dessus de toutes les séances précédentes (début
 * antérieur). Un exercice jamais fait avant, ou sans valeur comparable, n'en donne aucun.
 */
export function sessionRecords(history: readonly SessionRecord[], sessionId: string): RecordHit[] {
  const target = history.find((s) => s.id === sessionId);
  if (!target) return [];
  const before = history.filter((s) => s.startedAt < target.startedAt && s.id !== target.id);
  const hits: RecordHit[] = [];
  const seen = new Set<string>();
  for (const e of target.exercises) {
    if (seen.has(e.exerciseId)) continue;
    seen.add(e.exerciseId);
    const prev = bests(before, e.exerciseId);
    const now = bests([target], e.exerciseId);
    const exerciseId = e.exerciseId;
    if (now.bestLoad !== null && prev.bestLoad !== null && betterLoad(now.bestLoad, prev.bestLoad)) {
      hits.push({ exerciseId, kind: 'load', value: now.bestLoad.loadG });
    }
    if (now.bestReps !== null && prev.bestReps !== null && now.bestReps > prev.bestReps) {
      hits.push({ exerciseId, kind: 'reps', value: now.bestReps });
    }
    if (now.bestDurationS !== null && prev.bestDurationS !== null && now.bestDurationS > prev.bestDurationS) {
      hits.push({ exerciseId, kind: 'duration', value: now.bestDurationS });
    }
    if (
      now.bestSessionVolumeG !== null &&
      prev.bestSessionVolumeG !== null &&
      now.bestSessionVolumeG > prev.bestSessionVolumeG
    ) {
      hits.push({ exerciseId, kind: 'volume', value: now.bestSessionVolumeG });
    }
  }
  return hits;
}
