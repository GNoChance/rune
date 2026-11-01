import {
  defaultLoadSettings,
  EQUIPMENT,
  type EquipmentCode,
  InstanceChangeOperationSchema,
  type LoadSettings,
  LoadSettingsSchema,
} from '@rune/contracts';
import {
  type AcceptedChange,
  type ExerciseRecord,
  expandEquipment,
  type PlaceContext,
  type SessionRecord,
  type SetRecord,
} from '@rune/domain';
import type { Selectable } from 'kysely';
import { z } from 'zod';
import type {
  InstanceChangeTable,
  PerformedExerciseTable,
  PerformedSetTable,
  WorkoutSessionTable,
} from '../db/schema';

/*
 * Lignes de la base → types du moteur (`packages/domain/src/program/types.ts`). Les instants passent en millisecondes
 * Unix ; les colonnes JSON sont relues et validées.
 */

export interface SessionRows {
  sessions: readonly Selectable<WorkoutSessionTable>[];
  exercises: readonly Selectable<PerformedExerciseTable>[];
  sets: readonly Selectable<PerformedSetTable>[];
}

const ms = (iso: string): number => Date.parse(iso);
const msOrNull = (iso: string | null): number | null => (iso === null ? null : Date.parse(iso));
const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(key(row)) ?? [];
    list.push(row);
    out.set(key(row), list);
  }
  return out;
}

const toSet = (r: Selectable<PerformedSetTable>): SetRecord => ({
  id: r.id,
  position: r.position,
  kind: r.kind,
  loadMode: r.loadMode,
  loadG: r.loadG,
  reps: r.reps,
  durationS: r.durationS,
  side: r.side,
  effort: r.effort,
  targetRepsMin: r.targetRepsMin,
  targetRepsMax: r.targetRepsMax,
  targetDurationS: r.targetDurationS,
  targetLoadG: r.targetLoadG,
  targetRir: r.targetRir,
  targetVariant: r.targetVariant,
  loggedAt: msOrNull(r.loggedAt),
});

/**
 * Séances, leurs exercices et leurs séries : chaque enfant rejoint son parent par `session_id` ou
 * `performed_exercise_id` ; un enfant sans parent dans les lignes est écarté. Séries par position puis `id`.
 */
export function toSessionRecords(rows: SessionRows): SessionRecord[] {
  const setsOf = groupBy(rows.sets, (s) => s.performedExerciseId);
  const exercisesOf = groupBy(rows.exercises, (e) => e.sessionId);
  return rows.sessions.map((s) => ({
    id: s.id,
    instanceId: s.instanceId,
    workoutId: s.workoutId,
    placeId: s.placeId,
    startedAt: ms(s.startedAt),
    endedAt: msOrNull(s.endedAt),
    status: s.status,
    weekType: s.weekType,
    profile: s.profile,
    rulesVersion: s.rulesVersion,
    exercises: (exercisesOf.get(s.id) ?? []).map(
      (e): ExerciseRecord => ({
        id: e.id,
        slotId: e.slotId,
        plannedExerciseId: e.plannedExerciseId,
        exerciseId: e.exerciseId,
        position: e.position,
        swapReason: e.swapReason,
        painLevel: e.painLevel,
        nextAdjustment: e.nextAdjustment,
        sets: (setsOf.get(e.id) ?? [])
          .map(toSet)
          .sort((a, b) => a.position - b.position || binary(a.id, b.id)),
      }),
    ),
  }));
}

const Operations = z.array(InstanceChangeOperationSchema).min(1);

/**
 * Changement accepté → entrée du rejeu. Un `decided_at` absent (jamais écrit ainsi par le serveur) prend la date de
 * création. Rend null si les opérations ne passent pas le schéma : l'appelant renonce alors au rejeu.
 */
export function toAcceptedChange(r: Selectable<InstanceChangeTable>): AcceptedChange | null {
  let raw: unknown;
  try {
    raw = JSON.parse(r.operations);
  } catch {
    return null;
  }
  const operations = Operations.safeParse(raw);
  if (!operations.success) return null;
  return {
    id: r.id,
    author: r.author,
    reasonCode: r.reasonCode,
    decidedAt: ms(r.decidedAt ?? r.createdAt),
    operations: operations.data,
  };
}

/** Réglages de charge d'une colonne JSON ; null si absente ou invalide. */
function parseLoadSettings(text: string | null | undefined): LoadSettings | null {
  if (text == null) return null;
  try {
    const parsed = LoadSettingsSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const isEquipmentCode = (code: string): code is EquipmentCode =>
  (EQUIPMENT as readonly string[]).includes(code);

/** Lieu tel que le moteur le lit, avec ce que le téléphone affiche (`places-repo`). */
export interface PlaceRow {
  id: string;
  kind: 'gym' | 'home';
  /** Réglages du lieu lui-même (une maison ; une salle n'en a pas en propre). */
  loadSettings: string | null;
  /** Réglages de la salle partagée, pour un lieu `gym`. */
  gymLoadSettings: string | null;
  /** Matériel vivant du lieu (maison) ou de la salle. */
  equipment: readonly string[];
}

/**
 * Contexte d'un lieu : matériel étendu par ses implications (R-EQ-2) ; réglages du lieu, sinon de la salle, sinon
 * ceux par défaut de son type (05 §16).
 */
export function toPlaceContext(p: PlaceRow): PlaceContext {
  const loadSettings =
    parseLoadSettings(p.loadSettings) ?? parseLoadSettings(p.gymLoadSettings) ?? defaultLoadSettings(p.kind);
  return {
    id: p.id,
    equipment: expandEquipment(p.equipment.filter(isEquipmentCode)),
    loadSettings,
  };
}
