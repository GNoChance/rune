import { readdirSync, readFileSync } from 'node:fs';
import {
  defaultLoadSettings,
  type Effort,
  type ExerciseSheet,
  type LoadMode,
  type NextAdjustment,
  type PainLevel,
  type ProgramTemplate,
  ProgramTemplateSchema,
  REFERENCE_PROFILES,
  type SetKind,
} from '@rune/contracts';
import { expandEquipment } from '../../src/catalog/equipment';
import type { BriefSession, BriefSheet, CoachBriefInput } from '../../src/coach/brief';
import { addedSlotId, effectiveProgram, workSetCount } from '../../src/program/effective';
import { workSpec } from '../../src/program/primitives';
import { replayInstance } from '../../src/program/replay';
import { resolveSlot } from '../../src/program/resolve';
import type { AcceptedChange, PlaceContext, SessionRecord, SetRecord } from '../../src/program/types';
import { GYM_AB, PROGRAM_CATALOG } from './program';

/*
 * Entrée complète du dossier du coach (spec brique 4 §9), semée de canaris : chaque nom de lieu et chaque identifiant
 * de base (instance, lieux, séances, exercices réalisés, séries) contient « canari ». Le rejeu est le vrai : ses
 * états, décisions et événements portent ces identifiants, comme ceux que le serveur passera (tâche 15). Un slot
 * ajouté par un changement accepté porte l'UUIDv7 de ce changement (`addedSlotId`), autre identifiant de base.
 */

/** Toute forme d'UUID, n'importe où dans une chaîne. */
export const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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
/** Changement accepté qui ajoute un slot de mollets à la séance A, et ce slot (`A-<uuidv7>`). */
export const ADDED_CHANGE_ID = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a7b';
export const ADDED_SLOT_ID = addedSlotId('A', ADDED_CHANGE_ID);

/** `add_slot` accepté avant la première séance, pour la séance `workout` (mollets). */
export function addSlotChange(id: string, decidedAt: number, workout = 'A'): AcceptedChange {
  return {
    id,
    author: 'user',
    reasonCode: 'USER_CHANGE',
    decidedAt,
    operations: [{ op: 'add_slot', workout, movementPattern: 'calf_raise', exercises: ['calf-raise'] }],
  };
}

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
  'calf-raise': 'Mollets debout',
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
      { slotId: ADDED_SLOT_ID, exerciseId: 'calf-raise', loadMode: 'bodyweight', values: [15, 15] },
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
 * une maison, l'instance `GYM_AB` plus un slot ajouté (`ADDED_SLOT_ID`), rejouée sur 4 séances (dont une dans un lieu
 * supprimé), une séance libre sans lieu, deux propositions en attente (du moteur, et du coach sur le slot ajouté),
 * deux modèles (un seul disponible), une limitation. `edit` modifie la copie.
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
  const changes = [addSlotChange(ADDED_CHANGE_ID, daysBefore(15))];
  const replay = replayInstance({
    instance: { id: INSTANCE_ID, snapshot: GYM_AB, daysPerWeek: 3, startedAt: daysBefore(20) },
    sessions: records,
    changes,
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
      program: effectiveProgram(GYM_AB, 3, changes),
      replay,
      decisionEndedAt: new Map(
        records.flatMap((s) => s.exercises.map((e) => [e.id, s.endedAt ?? s.startedAt])),
      ),
      pending: [
        { author: 'engine', operations: [{ op: 'start_deload' }], expiresAt: daysBefore(-5, 10) },
        {
          author: 'coach',
          operations: [{ op: 'set_rest', slot: ADDED_SLOT_ID, seconds: 45 }],
          expiresAt: daysBefore(-6, 10),
        },
      ],
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
    nutrition: {
      mode: 'disabled',
      minor: false,
      safetyPause: false,
      sheets: [],
      target: null,
      weeklyChange: [],
      lastCheckin: null,
    },
  };
  edit(input);
  return input;
}

/**
 * Identifiants de base de l'entrée : lieux, instance, séances, exercices réalisés, séries, états et événements, et les
 * UUID des changements que portent les slots ajoutés (programme, états, décisions, propositions en attente).
 */
export function inputIds(input: CoachBriefInput): string[] {
  const ids = new Set<string>(input.places.map((p) => p.id));
  const uuidIn = (s: string) => {
    const found = UUID_ANYWHERE.exec(s)?.[0];
    if (found !== undefined) ids.add(s).add(found);
  };
  for (const w of input.program?.program.template.workouts ?? []) for (const s of w.slots) uuidIn(s.id);
  for (const c of input.program?.pending ?? [])
    for (const op of c.operations) if ('slot' in op) uuidIn(op.slot);
  for (const st of input.program?.replay.slotStates ?? []) uuidIn(st.slotId);
  for (const d of input.program?.replay.decisions ?? []) uuidIn(d.slotId);
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

// ---------------------------------------------------------------------------------------------------------------
// Taille réelle : contenu de `data/`
// ---------------------------------------------------------------------------------------------------------------

const DATA = new URL('../../../../data/', import.meta.url);

/** Fiches réelles (`data/exercises`), toutes publiées, comme au terme de la publication du catalogue. */
export function realCatalog(): BriefSheet[] {
  const dir = new URL('exercises/', DATA);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      ...(JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as ExerciseSheet),
      status: 'published' as const,
    }));
}

/** Modèles réels (`data/programs`), validés par `ProgramTemplateSchema`. */
export function realTemplates(): ProgramTemplate[] {
  const dir = new URL('programs/', DATA);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ProgramTemplateSchema.parse(JSON.parse(readFileSync(new URL(f, dir), 'utf8'))));
}

const LOADS_G: Partial<Record<LoadMode, number>> = { barbell: 60_000, dumbbell: 20_000, machine: 45_000 };

/**
 * Entrée à la taille réelle : `gym-intermediate-upper-lower` arrivé à maturité, rejoué sur `sessions` séances
 * terminées en 28 jours, chaque séance faisant tous ses slots (chaque slot a donc un état et une dernière décision),
 * au catalogue réel, dans une salle principale ; les 6 modèles réels servis. `slotsPerWorkout` allonge chaque séance
 * par des copies de ses propres slots ; `limitations` limitations, notes de 200 caractères.
 */
export function realSizeInput(
  o: { sessions?: number; slotsPerWorkout?: number; limitations?: number } = {},
): CoachBriefInput {
  const templates = realTemplates();
  const base = templates.find((t) => t.id === 'gym-intermediate-upper-lower');
  if (base === undefined) throw new Error('gym-intermediate-upper-lower absent de data/programs');
  const template = structuredClone(base);
  for (const w of template.workouts) {
    const own = [...w.slots];
    for (let k = own.length; k < (o.slotsPerWorkout ?? 0); k += 1) {
      const copy = structuredClone(own[k % own.length] as (typeof own)[number]);
      w.slots.push({ ...copy, id: `${w.id}-${k + 1}` });
    }
  }
  const catalog = realCatalog();
  const gym = placeContext(PRIMARY_ID, 'gym');
  const count = o.sessions ?? 16;
  const records: SessionRecord[] = Array.from({ length: count }, (_, k) => {
    const workout = template.workouts[k % template.workouts.length] as (typeof template.workouts)[number];
    const id = `session-canari-real-${k + 1}`;
    const at = daysBefore(27 - Math.floor((k * 28) / count));
    return {
      id,
      instanceId: INSTANCE_ID,
      workoutId: workout.id,
      placeId: PRIMARY_ID,
      startedAt: at - HOUR,
      endedAt: at,
      status: 'completed',
      weekType: 'normal',
      profile: 'adult',
      rulesVersion: '1',
      exercises: workout.slots.flatMap((slot, i) => {
        const r = resolveSlot(slot, {
          catalog,
          place: gym,
          cautious: false,
          maxLevel: 2,
          state: null,
          suspended: false,
        });
        if (r.exercise === null) return [];
        const spec = workSpec(slot);
        const duration = spec?.durationS !== undefined;
        const value = duration ? (spec?.durationS?.min ?? 30) : (spec?.reps?.max ?? 10);
        const done: DoneSpec = {
          exerciseId: r.exercise.id,
          values: Array.from({ length: workSetCount(slot) }, () => value),
          loadG: LOADS_G[r.exercise.load_mode] ?? null,
          loadMode: r.exercise.load_mode,
          duration,
        };
        return [
          {
            id: `perf-canari-${id}-${i + 1}`,
            slotId: slot.id,
            plannedExerciseId: r.exercise.id,
            exerciseId: r.exercise.id,
            position: i + 1,
            swapReason: null,
            painLevel: null,
            nextAdjustment: null,
            sets: doneSets(done, `${id}-${i + 1}`),
          },
        ];
      }),
    };
  });
  const replay = replayInstance({
    instance: { id: INSTANCE_ID, snapshot: template, daysPerWeek: 4, startedAt: daysBefore(28) },
    sessions: records,
    changes: [],
    catalog,
    places: new Map([[PRIMARY_ID, gym]]),
    overrides: new Map(),
  });
  return briefInput((i) => {
    i.profile = { ...i.profile, goal: 'strength', daysPerWeek: 4 };
    i.catalog = catalog;
    i.program = {
      templateVersion: template.version,
      revision: 12,
      program: effectiveProgram(template, 4, []),
      replay,
      decisionEndedAt: new Map(
        records.flatMap((s) => s.exercises.map((e) => [e.id, s.endedAt ?? s.startedAt])),
      ),
      pending: [],
      templates: templates.map((t) => ({ template: t, available: true })),
    };
    i.sessions = records.map((s) => ({
      endedAt: s.endedAt ?? s.startedAt,
      workoutName: template.workouts.find((w) => w.id === s.workoutId)?.name ?? null,
      placeId: s.placeId,
      note: null,
      exercises: s.exercises.map((e) => ({
        exerciseId: e.exerciseId,
        painLevel: null,
        note: null,
        sets: e.sets,
      })),
    }));
    i.limitations = Array.from({ length: o.limitations ?? 0 }, () => ({
      area: 'knee' as const,
      side: 'left' as const,
      severity: 'mild' as const,
      note: 'n'.repeat(200),
    }));
  });
}
