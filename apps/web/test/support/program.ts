import {
  type ProgramTemplate,
  REFERENCE_PROFILES,
  type ServedProgramTemplate,
  ServedProgramTemplateSchema,
  type ServedSheet,
  type SetSpec,
  type SlotSpec,
} from '@rune/contracts';
import type { AppDb } from '../../src/local-db/db';
import { seedCatalog, served } from './catalog';
import { seedPrimaryGym, seedProfile } from './onboarding';
import { seedMirror } from './seed';

/*
 * Programme de test (spec brique 3 §7.7, §7.8) : fiches de salle, un modèle complet (couverture et volume dans les
 * bornes du validateur, pour que les actions ne soient pas grisées), les 6 modèles servis, une instance active.
 */

const sheet = (o: Partial<ServedSheet> & Pick<ServedSheet, 'id' | 'name'>): ServedSheet =>
  served({ secondary_muscles: [], ...o });

/** Fiches de la salle : un muscle principal par fiche, pour garder le volume du modèle dans sa fourchette. */
export const PROGRAM_SHEETS: ServedSheet[] = [
  sheet({
    id: 'back-squat',
    name: 'Squat barre',
    load_mode: 'barbell',
    primary_muscles: ['quadriceps'],
    equipment_options: [['barbell']],
  }),
  sheet({ id: 'goblet-squat', name: 'Squat goblet', primary_muscles: ['quadriceps'] }),
  sheet({
    id: 'leg-press',
    name: 'Presse à cuisses',
    load_mode: 'machine',
    primary_muscles: ['quadriceps'],
    equipment_options: [['leg_press']],
  }),
  sheet({
    id: 'dumbbell-lunge',
    name: 'Fente aux haltères',
    movement_pattern: 'lunge',
    unilateral: true,
    primary_muscles: ['quadriceps'],
    equipment_options: [['dumbbells']],
  }),
  sheet({
    id: 'romanian-deadlift',
    name: 'Soulevé de terre roumain',
    movement_pattern: 'hip_hinge',
    load_mode: 'barbell',
    primary_muscles: ['hamstrings'],
    equipment_options: [['barbell']],
  }),
  sheet({
    id: 'dumbbell-romanian-deadlift',
    name: 'Soulevé de terre roumain aux haltères',
    movement_pattern: 'hip_hinge',
    primary_muscles: ['hamstrings'],
    equipment_options: [['dumbbells']],
  }),
  sheet({
    id: 'bench-press',
    name: 'Développé couché',
    movement_pattern: 'horizontal_push',
    load_mode: 'barbell',
    primary_muscles: ['chest'],
    equipment_options: [['barbell', 'flat_bench']],
  }),
  sheet({
    id: 'push-up',
    name: 'Pompe',
    movement_pattern: 'horizontal_push',
    load_mode: 'bodyweight',
    primary_muscles: ['chest'],
    equipment_options: [[]],
  }),
  sheet({
    id: 'dumbbell-row',
    name: 'Rowing haltère',
    movement_pattern: 'horizontal_pull',
    primary_muscles: ['lats'],
    equipment_options: [['dumbbells']],
  }),
  sheet({
    id: 'plank',
    name: 'Planche',
    movement_pattern: 'core_anti_extension',
    measure: 'duration',
    load_mode: 'bodyweight',
    primary_muscles: ['abs'],
    equipment_options: [[]],
  }),
];

const work = (count: number, reps: [number, number], restS: number): SetSpec => ({
  kind: 'work',
  count,
  reps: { min: reps[0], max: reps[1] },
  targetRir: 2,
  restS,
});

const plank = (id: string): SlotSpec => ({
  id,
  movementPattern: 'core_anti_extension',
  role: 'accessory',
  exercises: ['plank'],
  sets: [{ kind: 'work', count: 3, durationS: { min: 30, max: 45 }, restS: 60 }],
  progression: { type: 'duration', stepS: 5 },
});

const slot = (
  id: string,
  movementPattern: SlotSpec['movementPattern'],
  role: SlotSpec['role'],
  exercises: string[],
  set: SetSpec,
): SlotSpec => ({ id, movementPattern, role, exercises, sets: [set], progression: { type: 'double' } });

/** Salle · Débutant · Corps entier A/B : bloc planifié de 5 semaines, 2 à 3 jours. */
export const GYM_BEGINNER: ProgramTemplate = {
  schemaVersion: 1,
  id: 'gym-beginner-full-body-ab',
  version: 1,
  name: 'Salle · Débutant · Corps entier A/B',
  description: 'Deux séances qui alternent, tout le corps à chaque fois.',
  context: 'gym',
  level: 'beginner',
  daysPerWeek: { min: 2, max: 3, default: 3 },
  estimatedMinutes: 50,
  block: { mode: 'planned', weeks: 5, deloadWeek: 5 },
  workouts: [
    {
      id: 'A',
      name: 'Séance A',
      slots: [
        {
          ...slot('A1', 'squat', 'main', ['back-squat', 'goblet-squat', 'leg-press'], work(3, [6, 6], 180)),
          progression: { type: 'linear', incrementG: 5000 },
        },
        slot('A2', 'hip_hinge', 'secondary', ['romanian-deadlift'], work(3, [8, 10], 120)),
        slot('A3', 'horizontal_push', 'secondary', ['bench-press', 'push-up'], work(3, [8, 12], 120)),
        slot('A4', 'horizontal_pull', 'accessory', ['dumbbell-row'], work(3, [8, 12], 90)),
        plank('A5'),
      ],
    },
    {
      id: 'B',
      name: 'Séance B',
      slots: [
        slot('B1', 'lunge', 'main', ['dumbbell-lunge'], work(3, [8, 12], 120)),
        slot('B2', 'hip_hinge', 'secondary', ['romanian-deadlift'], work(3, [8, 10], 120)),
        slot('B3', 'horizontal_push', 'secondary', ['push-up'], work(3, [8, 12], 120)),
        slot('B4', 'horizontal_pull', 'accessory', ['dumbbell-row'], work(3, [8, 12], 90)),
        plank('B5'),
      ],
    },
  ],
};

/** Variante du modèle de test : autre identité, autres bornes (le contenu reste celui du modèle complet). */
export function templateLike(
  o: Pick<ProgramTemplate, 'id' | 'name' | 'context' | 'level'> & Partial<ProgramTemplate>,
): ProgramTemplate {
  return { ...structuredClone(GYM_BEGINNER), block: { mode: 'reactive' }, ...o };
}

/** Les 6 modèles de 05 §3, le dernier indisponible. */
export const TEMPLATES: ServedProgramTemplate[] = [
  { template: GYM_BEGINNER, available: true },
  {
    template: templateLike({
      id: 'gym-intermediate-upper-lower',
      name: 'Salle · Intermédiaire · Haut / Bas',
      context: 'gym',
      level: 'intermediate',
      daysPerWeek: { min: 3, max: 4, default: 4 },
      estimatedMinutes: 60,
    }),
    available: true,
  },
  {
    template: templateLike({
      id: 'home-beginner-full-body',
      name: 'Maison · Débutant · Corps entier',
      context: 'home',
      level: 'beginner',
      estimatedMinutes: 40,
    }),
    available: true,
  },
  {
    template: templateLike({
      id: 'home-intermediate-upper-lower',
      name: 'Maison · Intermédiaire · Haut / Bas',
      context: 'home',
      level: 'intermediate',
      daysPerWeek: { min: 3, max: 4, default: 4 },
    }),
    available: true,
  },
  {
    template: templateLike({
      id: 'sport-beginner-complement',
      name: 'Complément sport · Débutant · Corps entier et prévention',
      context: 'sport',
      level: 'beginner',
      daysPerWeek: { min: 2, max: 2, default: 2 },
      estimatedMinutes: 35,
    }),
    available: true,
  },
  {
    template: templateLike({
      id: 'sport-intermediate-strength-prevention',
      name: 'Complément sport · Intermédiaire · Force et prévention',
      context: 'sport',
      level: 'intermediate',
      daysPerWeek: { min: 2, max: 2, default: 2 },
    }),
    available: false,
  },
].map((x) => ServedProgramTemplateSchema.parse(x));

/** Modèles servis du catalogue de l'appareil (magasin `programTemplates`). */
export async function seedTemplates(
  db: AppDb,
  templates: readonly ServedProgramTemplate[] = TEMPLATES,
): Promise<void> {
  await db.table('programTemplates').bulkPut(templates.map((x) => ({ id: x.template.id, ...x })));
}

/** Matériel de référence d'une salle sur la salle g-1 (`seedPrimaryGym`). */
export async function seedGymEquipment(db: AppDb): Promise<void> {
  await seedMirror(
    db,
    'gym_equipment',
    REFERENCE_PROFILES.gym_reference.map((code) => ({
      id: `g-1:${code}`,
      gymId: 'g-1',
      equipmentCode: code,
    })),
  );
}

export interface InstanceSeed {
  templateId?: string;
  templateVersion?: number;
  snapshot?: ProgramTemplate;
  daysPerWeek?: number;
  revision?: number;
}

/** Instance active i-1 du membre u-1 (modèle de salle, 2 jours, révision 4 par défaut). */
export async function seedInstance(db: AppDb, o: InstanceSeed = {}): Promise<void> {
  await seedMirror(db, 'program_instance', [
    {
      id: 'i-1',
      ownerId: 'u-1',
      templateId: o.templateId ?? GYM_BEGINNER.id,
      templateVersion: o.templateVersion ?? 1,
      snapshot: o.snapshot ?? GYM_BEGINNER,
      daysPerWeek: o.daysPerWeek ?? 2,
      status: 'active',
      revision: o.revision ?? 4,
      startedAt: '2026-09-01T08:00:00.000Z',
      endedAt: null,
      createdAt: '2026-09-01T08:00:00.000Z',
    },
  ]);
}

/** Changement de l'instance i-1 (ligne du miroir) ; accepté par l'utilisateur par défaut. */
export const changeRow = (id: string, o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  ownerId: 'u-1',
  instanceId: 'i-1',
  baseRevision: 0,
  author: 'user',
  operations: [{ op: 'set_rest', slot: 'A1', seconds: 150 }],
  reasonCode: 'USER_CHANGE',
  reason: null,
  status: 'accepted',
  createdAt: '2026-09-10T09:00:00.000Z',
  expiresAt: null,
  decidedAt: '2026-09-10T09:00:00.000Z',
  ...o,
});

/** Séances terminées de l'instance i-1, sans exercice, une par jour depuis le 2 septembre (A, B, A, B…). */
export async function seedCompletedSessions(db: AppDb, n: number): Promise<void> {
  await seedMirror(
    db,
    'workout_session',
    Array.from({ length: n }, (_, i) => {
      const day = String(i + 2).padStart(2, '0');
      return {
        id: `s-${i + 1}`,
        ownerId: 'u-1',
        instanceId: 'i-1',
        workoutId: i % 2 === 0 ? 'A' : 'B',
        placeId: 'p-1',
        deviceId: 'dev-Z',
        startedAt: `2026-09-${day}T08:00:00.000Z`,
        endedAt: `2026-09-${day}T09:00:00.000Z`,
        status: 'completed',
        weekType: 'normal',
        templateVersion: 1,
        rulesVersion: '1',
        appVersion: 'dev',
        profile: 'adult',
        note: null,
      };
    }),
  );
}

export interface ProgramSetup {
  /** Profil d'entraînement ; débutant, 3 jours, salle par défaut. */
  profile?: Record<string, unknown>;
  templates?: readonly ServedProgramTemplate[];
  /** Instance active ; aucune avec `false`. */
  instance?: InstanceSeed | false;
}

/**
 * Membre u-1 à la salle « Basic Fit » (matériel de référence), catalogue de la salle, modèles servis, profil
 * débutant à 3 jours et, par défaut, l'instance active i-1.
 */
export async function seedProgram(db: AppDb, o: ProgramSetup = {}): Promise<void> {
  await seedCatalog(db, PROGRAM_SHEETS);
  await seedProfile(db, {
    goal: 'muscle',
    experience: 'none',
    daysPerWeek: 3,
    sessionMinutes: 45,
    ...o.profile,
  });
  await seedPrimaryGym(db);
  await seedGymEquipment(db);
  await seedTemplates(db, o.templates ?? TEMPLATES);
  if (o.instance !== false) await seedInstance(db, o.instance ?? {});
}

/** Réponse d'API d'une instance (inscription, changement). */
export const INSTANCE_VIEW = {
  id: 'i-1',
  templateId: GYM_BEGINNER.id,
  templateVersion: 1,
  daysPerWeek: 2,
  status: 'active',
  revision: 5,
  startedAt: '2026-09-01T08:00:00.000Z',
  endedAt: null,
};

/** Réponse d'API d'un changement accepté. */
export const CHANGE_VIEW = {
  id: 'c-new',
  instanceId: 'i-1',
  baseRevision: 4,
  author: 'user',
  operations: [{ op: 'start_deload' }],
  reasonCode: 'USER_CHANGE',
  reason: null,
  status: 'accepted',
  createdAt: '2026-10-06T12:00:00.000Z',
  expiresAt: null,
  decidedAt: '2026-10-06T12:00:00.000Z',
  aiGenerated: false,
  aiModel: null,
  coachThreadId: null,
};
