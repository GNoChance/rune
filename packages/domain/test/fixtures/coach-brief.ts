import {
  defaultLoadSettings,
  type Effort,
  type LoadMode,
  type NextAdjustment,
  type PainLevel,
  REFERENCE_PROFILES,
  type SetKind,
} from '@rune/contracts';
import { expandEquipment } from '../../src/catalog/equipment';
import type { BriefSession, BriefSheet, CoachBriefInput } from '../../src/coach/brief';
import { effectiveProgram } from '../../src/program/effective';
import { replayInstance } from '../../src/program/replay';
import type { PlaceContext, SessionRecord, SetRecord } from '../../src/program/types';
import { GYM_AB, PROGRAM_CATALOG } from './program';

/*
 * Entrée complète du dossier du coach (spec brique 4 §9), semée de canaris : chaque nom de lieu et chaque identifiant
 * de base (instance, lieux, séances, exercices réalisés, séries) contient « canari ». Le rejeu est le vrai : ses
 * états, décisions et événements portent ces identifiants, comme ceux que le serveur passera (tâche 15).
 */

export const TODAY = '2026-11-03';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Mardi 3 novembre 2026, minuit à Paris (UTC+1). */
const TODAY_MIDNIGHT = Date.UTC(2026, 10, 2, 23);

/**
 * Instant `daysAgo` jours avant `TODAY`, à `hour` heures après minuit de Paris (UTC+1). Avant le 25 octobre (UTC+2),
 * l'heure de Paris a une heure de plus : le jour civil ne change pas tant que `hour` reste sous 22.
 */
export const daysBefore = (daysAgo: number, hour = 19): number =>
  TODAY_MIDNIGHT - daysAgo * DAY + hour * HOUR;

export const INSTANCE_ID = 'instance-canari';
export const PRIMARY_ID = 'place-canari-1';
export const HOME_ID = 'place-canari-2';
/** Lieu supprimé : connu du rejeu (réglages de charge), absent des lieux vivants du dossier. */
export const DELETED_ID = 'place-canari-supprime';

const NAMES: Readonly<Record<string, string>> = {
  'back-squat': 'Squat barre',
  'goblet-squat': 'Squat gobelet',
  'bodyweight-squat': 'Squat au poids du corps',
  'bench-press': 'Développé couché',
  'push-up': 'Pompes',
  'barbell-row': 'Rowing barre',
  'front-plank': 'Gainage',
  'single-leg-romanian-deadlift': 'Soulevé de terre roumain sur une jambe',
  'overhead-press': 'Développé militaire',
  'lat-pulldown': 'Tirage vertical',
  'split-squat': 'Fente statique',
};

/** Catalogue de test des programmes, avec un nom et une mesure par fiche (comme une `ServedSheet`). */
export const BRIEF_CATALOG: readonly BriefSheet[] = PROGRAM_CATALOG.map((s) => ({
  ...s,
  name: NAMES[s.id] ?? s.id,
  measure: s.movement_pattern === 'core_anti_extension' ? 'duration' : 'reps',
}));

export interface DoneSpec {
  exerciseId: string;
  slotId?: string | null;
  /** Une série de travail faite par valeur : répétitions, ou secondes avec `duration`. */
  values: readonly number[];
  loadG?: number | null;
  loadMode?: LoadMode;
  duration?: boolean;
  effort?: Effort | null;
  painLevel?: PainLevel | null;
  /** Ajustement demandé (bouton douleur ou choix manuel) ; lu par le rejeu seulement. */
  nextAdjustment?: NextAdjustment | null;
  note?: string | null;
  /** Échauffements faits, en plus des séries de travail. */
  warmups?: number;
}

interface SessionSpec {
  id: string;
  workoutId: string | null;
  daysAgo: number;
  placeId: string | null;
  note?: string;
  exercises: DoneSpec[];
}

/** Séances de l'instance et une séance libre, de la plus ancienne à la plus récente. */
const PLAN: readonly SessionSpec[] = [
  {
    id: 'session-canari-1',
    workoutId: 'A',
    daysAgo: 12,
    placeId: PRIMARY_ID,
    exercises: [
      { slotId: 'A1', exerciseId: 'back-squat', loadMode: 'barbell', loadG: 40_000, values: [6, 6, 6] },
      { slotId: 'A2', exerciseId: 'bench-press', loadMode: 'barbell', loadG: 30_000, values: [6, 6, 6] },
    ],
  },
  {
    id: 'session-canari-2',
    workoutId: 'B',
    daysAgo: 10,
    placeId: HOME_ID,
    exercises: [
      { slotId: 'B1', exerciseId: 'single-leg-romanian-deadlift', loadMode: 'bodyweight', values: [8, 8, 8] },
      { slotId: 'B4', exerciseId: 'split-squat', loadMode: 'bodyweight', values: [10, 10] },
    ],
  },
  {
    id: 'session-canari-3',
    workoutId: 'A',
    daysAgo: 7,
    placeId: DELETED_ID,
    note: 'Salle bondée, attente au rack.',
    exercises: [
      {
        slotId: 'A1',
        exerciseId: 'back-squat',
        loadMode: 'barbell',
        loadG: 42_500,
        values: [6, 6, 6],
        effort: 'hard',
        warmups: 2,
      },
      {
        slotId: 'A2',
        exerciseId: 'bench-press',
        loadMode: 'barbell',
        loadG: 30_000,
        values: [6, 6, 5],
        painLevel: 'discomfort',
        nextAdjustment: 'hold',
        note: 'Barre glissante, prise à revoir.',
      },
      {
        slotId: 'A5',
        exerciseId: 'front-plank',
        loadMode: 'bodyweight',
        values: [30, 30, 25],
        duration: true,
      },
    ],
  },
  {
    id: 'session-canari-4',
    workoutId: 'B',
    daysAgo: 3,
    placeId: PRIMARY_ID,
    exercises: [
      { slotId: 'B2', exerciseId: 'overhead-press', loadMode: 'barbell', loadG: 25_000, values: [6, 6, 6] },
      { slotId: 'B3', exerciseId: 'lat-pulldown', loadMode: 'machine', loadG: 41_250, values: [10, 10, 9] },
    ],
  },
  {
    id: 'session-canari-5',
    workoutId: null,
    daysAgo: 1,
    placeId: null,
    exercises: [{ exerciseId: 'push-up', loadMode: 'bodyweight', values: [15, 12] }],
  },
];

/** Séries faites d'un exercice : échauffements puis séries de travail, identifiants `set-canari-<prefix>-n`. */
export function doneSets(spec: DoneSpec, prefix: string): SetRecord[] {
  const set = (kind: SetKind, position: number, value: number, last: boolean): SetRecord => ({
    id: `set-canari-${prefix}-${kind}-${position}`,
    position,
    kind,
    loadMode: spec.loadMode ?? (spec.loadG ? 'barbell' : 'bodyweight'),
    loadG: kind === 'warmup' && spec.loadG ? Math.round(spec.loadG / 2) : (spec.loadG ?? null),
    reps: spec.duration ? null : value,
    durationS: spec.duration ? value : null,
    side: null,
    effort: kind === 'work' && last ? (spec.effort === undefined ? 'ok' : spec.effort) : null,
    targetRepsMin: null,
    targetRepsMax: null,
    targetReps: null,
    targetDurationS: null,
    targetLoadG: null,
    targetRir: null,
    targetVariant: null,
    loggedAt: 1,
  });
  const warmups = Array.from({ length: spec.warmups ?? 0 }, (_, i) => set('warmup', i + 1, 5, false));
  const work = spec.values.map((v, i) => set('work', i + 1, v, i === spec.values.length - 1));
  return [...warmups, ...work];
}

/** Séance du dossier (entrée), sans séance de base derrière : pour les tests qui composent leur historique. */
export function briefSession(o: {
  endedAt?: number;
  daysAgo?: number;
  workoutName?: string | null;
  placeId?: string | null;
  note?: string | null;
  exercises?: readonly DoneSpec[];
}): BriefSession {
  const endedAt = o.endedAt ?? daysBefore(o.daysAgo ?? 0);
  return {
    endedAt,
    workoutName: o.workoutName === undefined ? 'Séance A' : o.workoutName,
    placeId: o.placeId === undefined ? PRIMARY_ID : o.placeId,
    note: o.note ?? null,
    exercises: (o.exercises ?? []).map((e, i) => ({
      exerciseId: e.exerciseId,
      painLevel: e.painLevel ?? null,
      note: e.note ?? null,
      sets: doneSets(e, `${endedAt}-${i}`),
    })),
  };
}

const placeContext = (id: string, kind: 'gym' | 'home'): PlaceContext => ({
  id,
  equipment: expandEquipment(
    kind === 'gym' ? REFERENCE_PROFILES.gym_reference : REFERENCE_PROFILES.home_bodyweight,
  ),
  loadSettings: defaultLoadSettings(kind),
});

/**
 * Entrée complète, toujours neuve : adulte de 30 à 39 ans, les deux accords, une salle principale « Salle Canari »,
 * une maison, l'instance `GYM_AB` rejouée sur 4 séances (dont une dans un lieu supprimé), une séance libre sans lieu,
 * une proposition du moteur en attente, deux modèles (un seul disponible), une limitation. `edit` modifie la copie.
 */
export function briefInput(edit: (input: CoachBriefInput) => void = () => {}): CoachBriefInput {
  const records: SessionRecord[] = PLAN.map((s) => ({
    id: s.id,
    instanceId: s.workoutId === null ? null : INSTANCE_ID,
    workoutId: s.workoutId,
    placeId: s.placeId,
    startedAt: daysBefore(s.daysAgo) - HOUR,
    endedAt: daysBefore(s.daysAgo),
    status: 'completed',
    weekType: 'normal',
    profile: 'adult',
    rulesVersion: '1',
    exercises: s.exercises.map((e, i) => ({
      id: `perf-canari-${s.id}-${i + 1}`,
      slotId: e.slotId ?? null,
      plannedExerciseId: e.exerciseId,
      exerciseId: e.exerciseId,
      position: i + 1,
      swapReason: null,
      painLevel: e.painLevel ?? null,
      nextAdjustment: e.nextAdjustment ?? null,
      sets: doneSets(e, `${s.id}-${i + 1}`),
    })),
  }));
  const replay = replayInstance({
    instance: { id: INSTANCE_ID, snapshot: GYM_AB, daysPerWeek: 3, startedAt: daysBefore(20) },
    sessions: records,
    changes: [],
    catalog: BRIEF_CATALOG,
    places: new Map([
      [PRIMARY_ID, placeContext(PRIMARY_ID, 'gym')],
      [HOME_ID, placeContext(HOME_ID, 'home')],
      [DELETED_ID, placeContext(DELETED_ID, 'gym')],
    ]),
    overrides: new Map(),
  });
  const workoutName = (id: string | null) => GYM_AB.workouts.find((w) => w.id === id)?.name ?? null;
  const input: CoachBriefInput = {
    today: TODAY,
    audience: 'adult',
    ageBand: '30-39',
    consents: { health: true, coach: true },
    profile: {
      experience: '6_to_24_months',
      goal: 'muscle',
      daysPerWeek: 3,
      sessionMinutes: 60,
      sportCode: null,
      cautiousMode: false,
      engineProfile: 'adult',
    },
    places: [
      {
        id: PRIMARY_ID,
        name: 'Salle Canari',
        kind: 'gym',
        primary: true,
        equipment: [...REFERENCE_PROFILES.gym_reference],
        loadSettings: defaultLoadSettings('gym'),
      },
      {
        id: HOME_ID,
        name: 'Maison Canari',
        kind: 'home',
        primary: false,
        equipment: ['table', 'chair'],
        loadSettings: defaultLoadSettings('home'),
      },
    ],
    program: {
      templateVersion: 1,
      revision: 4,
      program: effectiveProgram(GYM_AB, 3, []),
      replay,
      decisionEndedAt: new Map(
        records.flatMap((s) => s.exercises.map((e) => [e.id, s.endedAt ?? s.startedAt])),
      ),
      pending: [{ author: 'engine', operations: [{ op: 'start_deload' }], expiresAt: daysBefore(-5, 10) }],
      templates: [
        { template: structuredClone(GYM_AB), available: true },
        {
          template: {
            ...structuredClone(GYM_AB),
            id: 'gym-intermediate-upper-lower',
            name: 'Salle · Intermédiaire · Haut/Bas',
            level: 'intermediate',
          },
          available: false,
        },
      ],
    },
    sessions: PLAN.map((s, i) => {
      const record = records[i] as SessionRecord;
      return {
        endedAt: record.endedAt ?? record.startedAt,
        workoutName: workoutName(s.workoutId),
        placeId: s.placeId,
        note: s.note ?? null,
        exercises: record.exercises.map((e, j) => ({
          exerciseId: e.exerciseId,
          painLevel: e.painLevel,
          note: s.exercises[j]?.note ?? null,
          sets: e.sets,
        })),
      };
    }),
    catalog: BRIEF_CATALOG,
    limitations: [{ area: 'shoulder', side: 'right', severity: 'mild', note: 'Gêne au développé.' }],
  };
  edit(input);
  return input;
}

/** Identifiants de base de l'entrée : lieux, instance, séances, exercices réalisés, séries, états et événements. */
export function inputIds(input: CoachBriefInput): string[] {
  const ids = new Set<string>(input.places.map((p) => p.id));
  for (const s of input.sessions) {
    if (s.placeId !== null) ids.add(s.placeId);
    for (const e of s.exercises) for (const set of e.sets) ids.add(set.id);
  }
  const program = input.program;
  if (program !== null) {
    for (const key of program.decisionEndedAt.keys()) ids.add(key);
    for (const st of program.replay.slotStates) {
      ids.add(st.id);
      ids.add(st.instanceId);
      if (st.lastSessionId !== null) ids.add(st.lastSessionId);
    }
    for (const d of program.replay.decisions) {
      ids.add(d.id);
      ids.add(d.instanceId);
    }
    for (const e of program.replay.events) {
      ids.add(e.key);
      ids.add(e.triggerSessionId);
    }
  }
  return [...ids];
}
