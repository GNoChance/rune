import {
  defaultLoadSettings,
  type EquipmentCode,
  type MovementPattern,
  type Muscle,
  type ProgramTemplate,
  REFERENCE_PROFILES,
  type SetSpec,
  type SlotSpec,
} from '@rune/contracts';
import { expandEquipment } from '../../src/catalog/equipment';
import type { CatalogSheet } from '../../src/catalog/usable';
import type { AcceptedChange, PlaceContext } from '../../src/program/types';

/*
 * Catalogue et modèles de test des programmes (05 §4 et §5). Chaque slot du modèle de salle finit par une fiche au
 * poids du corps aux mêmes muscles que la tête de liste : le volume se calcule sans surprise dans les deux contextes.
 */

type Muscles = { primary: Muscle[]; secondary?: Muscle[] };

/** Fiche publiée de niveau 1, polyarticulaire, surchargée champ par champ. */
export function programSheet(
  id: string,
  pattern: MovementPattern,
  muscles: Muscles,
  equipment: EquipmentCode[][],
  extra: Partial<CatalogSheet> = {},
): CatalogSheet {
  return {
    id,
    status: 'published',
    level: 1,
    mechanics: 'compound',
    not_for_minors: false,
    equipment_options: equipment,
    movement_pattern: pattern,
    primary_muscles: muscles.primary,
    secondary_muscles: muscles.secondary ?? [],
    unilateral: false,
    load_mode: equipment.some((o) => o.length === 0) ? 'bodyweight' : 'barbell',
    ...extra,
  };
}

const SQUAT: Muscles = { primary: ['quadriceps', 'glutes'], secondary: ['hamstrings', 'adductors'] };
const PRESS: Muscles = { primary: ['chest', 'triceps'], secondary: ['front_delts'] };
const ROW: Muscles = { primary: ['lats'], secondary: ['rear_delts', 'biceps'] };
const HINGE: Muscles = { primary: ['hamstrings', 'glutes'], secondary: ['lower_back'] };
const OVERHEAD: Muscles = { primary: ['front_delts'], secondary: ['side_delts', 'triceps'] };
const PULL_DOWN: Muscles = { primary: ['lats'], secondary: ['biceps'] };
const LUNGE: Muscles = { primary: ['quadriceps'], secondary: ['glutes', 'adductors'] };
const PLANK: Muscles = { primary: ['abs'], secondary: ['obliques'] };

export const PROGRAM_CATALOG: readonly CatalogSheet[] = [
  programSheet('back-squat', 'squat', SQUAT, [['barbell', 'squat_rack']]),
  programSheet('goblet-squat', 'squat', SQUAT, [['dumbbells'], ['kettlebell']], { load_mode: 'dumbbell' }),
  programSheet('leg-press', 'squat', SQUAT, [['leg_press']], { load_mode: 'machine' }),
  programSheet('bodyweight-squat', 'squat', SQUAT, [[]]),
  programSheet('bench-press', 'horizontal_push', PRESS, [['barbell', 'flat_bench']]),
  programSheet('dumbbell-bench-press', 'horizontal_push', PRESS, [['dumbbells', 'flat_bench']], {
    load_mode: 'dumbbell',
  }),
  programSheet('push-up', 'horizontal_push', PRESS, [[]]),
  programSheet(
    'dumbbell-fly',
    'horizontal_push',
    { primary: ['chest'], secondary: ['front_delts'] },
    [['dumbbells', 'flat_bench']],
    { load_mode: 'dumbbell', mechanics: 'isolation' },
  ),
  programSheet('barbell-row', 'horizontal_pull', ROW, [['barbell']]),
  programSheet('seated-cable-row', 'horizontal_pull', ROW, [['seated_row']], { load_mode: 'machine' }),
  programSheet('inverted-row', 'horizontal_pull', ROW, [['table']]),
  programSheet('kneeling-plank', 'core_anti_extension', PLANK, [[]], {
    mechanics: 'isolation',
    chain_id: 'front-plank',
    harder_id: 'front-plank',
  }),
  programSheet('front-plank', 'core_anti_extension', PLANK, [[]], {
    mechanics: 'isolation',
    chain_id: 'front-plank',
    easier_id: 'kneeling-plank',
  }),
  programSheet('romanian-deadlift', 'hip_hinge', HINGE, [['barbell']]),
  programSheet('dumbbell-romanian-deadlift', 'hip_hinge', HINGE, [['dumbbells']], { load_mode: 'dumbbell' }),
  programSheet('single-leg-romanian-deadlift', 'hip_hinge', HINGE, [[]], { unilateral: true }),
  programSheet('overhead-press', 'vertical_push', OVERHEAD, [['barbell']]),
  programSheet('dumbbell-shoulder-press', 'vertical_push', OVERHEAD, [['dumbbells']], {
    load_mode: 'dumbbell',
  }),
  programSheet('pike-push-up', 'vertical_push', OVERHEAD, [[]]),
  programSheet('lat-pulldown', 'vertical_pull', PULL_DOWN, [['lat_pulldown']], { load_mode: 'machine' }),
  programSheet('pull-up', 'vertical_pull', PULL_DOWN, [['pull_up_bar']]),
  programSheet('dumbbell-lunge', 'lunge', LUNGE, [['dumbbells']], {
    load_mode: 'dumbbell',
    unilateral: true,
  }),
  programSheet('split-squat', 'lunge', LUNGE, [[]], { unilateral: true }),
  // Fiches des cas de test : hors volume, introuvable dans les lieux, brouillon, interdite aux mineurs.
  programSheet('calf-raise', 'calf_raise', { primary: ['calves'] }, [[]], { mechanics: 'isolation' }),
  programSheet('pallof-press', 'core_anti_rotation', { primary: ['obliques'] }, [['cable_station']], {
    load_mode: 'machine',
    mechanics: 'isolation',
  }),
  programSheet('smith-squat', 'squat', SQUAT, [['smith_machine']], { load_mode: 'machine' }),
  programSheet('weighted-plank', 'core_anti_extension', PLANK, [['dumbbells']], {
    load_mode: 'dumbbell',
    mechanics: 'isolation',
  }),
  programSheet('draft-squat', 'squat', SQUAT, [[]], { status: 'draft' }),
  programSheet('jump-squat', 'squat', SQUAT, [[]], { not_for_minors: true }),
];

const warmup: SetSpec = { kind: 'warmup', count: 2, reps: { min: 5, max: 5 }, pctWorkLoad: 50 };
const work = (count: number, min: number, max: number, restS: number, targetRir = 2): SetSpec => ({
  kind: 'work',
  count,
  reps: { min, max },
  targetRir,
  restS,
});

/**
 * L'extrait de 05 §4 complété en modèle valide : salle, débutant, A/B, 2 à 3 jours (3 par défaut). Volume par
 * semaine (3 jours, 2 séances : × 1,5) : quadriceps 7,5 ; ischio-jambiers 6,75 ; fessiers 10,5 ; pectoraux 7,5 ;
 * dorsaux 9 ; deltoïdes 10,5. Le gainage (A5) n'est que dans A : chaque semaine du cycle contient A.
 */
export const GYM_AB: ProgramTemplate = {
  schemaVersion: 1,
  id: 'gym-beginner-full-body-ab',
  version: 1,
  name: 'Salle · Débutant · Corps entier A/B',
  description: 'Deux séances qui alternent, 2 ou 3 fois par semaine.',
  context: 'gym',
  level: 'beginner',
  daysPerWeek: { min: 2, max: 3, default: 3 },
  estimatedMinutes: 55,
  block: { mode: 'reactive' },
  workouts: [
    {
      id: 'A',
      name: 'Séance A',
      slots: [
        {
          id: 'A1',
          movementPattern: 'squat',
          role: 'main',
          exercises: ['back-squat', 'goblet-squat', 'leg-press', 'bodyweight-squat'],
          sets: [warmup, work(3, 6, 6, 150)],
          progression: { type: 'linear', incrementG: 5000 },
        },
        {
          id: 'A2',
          movementPattern: 'horizontal_push',
          role: 'main',
          exercises: ['bench-press', 'dumbbell-bench-press', 'push-up'],
          sets: [warmup, work(3, 6, 6, 150)],
          progression: { type: 'linear', incrementG: 2500 },
        },
        {
          id: 'A3',
          movementPattern: 'horizontal_pull',
          role: 'secondary',
          exercises: ['barbell-row', 'seated-cable-row', 'inverted-row'],
          sets: [work(3, 8, 12, 120)],
          progression: { type: 'double' },
        },
        {
          id: 'A4',
          movementPattern: 'horizontal_push',
          role: 'accessory',
          exercises: ['dumbbell-fly', 'push-up'],
          sets: [work(2, 10, 15, 90)],
          progression: { type: 'double' },
        },
        {
          id: 'A5',
          movementPattern: 'core_anti_extension',
          role: 'accessory',
          chain: 'front-plank',
          sets: [{ kind: 'work', count: 3, durationS: { min: 20, max: 60 }, targetRir: 2, restS: 60 }],
          progression: { type: 'duration', stepS: 5 },
        },
      ],
    },
    {
      id: 'B',
      name: 'Séance B',
      slots: [
        {
          id: 'B1',
          movementPattern: 'hip_hinge',
          role: 'main',
          exercises: ['romanian-deadlift', 'dumbbell-romanian-deadlift', 'single-leg-romanian-deadlift'],
          sets: [warmup, work(3, 8, 8, 150)],
          progression: { type: 'linear', incrementG: 5000 },
        },
        {
          id: 'B2',
          movementPattern: 'vertical_push',
          role: 'main',
          exercises: ['overhead-press', 'dumbbell-shoulder-press', 'pike-push-up'],
          sets: [warmup, work(3, 6, 6, 150)],
          progression: { type: 'linear', incrementG: 2500 },
        },
        {
          id: 'B3',
          movementPattern: 'vertical_pull',
          role: 'secondary',
          exercises: ['lat-pulldown', 'pull-up'],
          sets: [work(3, 8, 12, 120)],
          progression: { type: 'double' },
        },
        {
          id: 'B4',
          movementPattern: 'lunge',
          role: 'accessory',
          exercises: ['dumbbell-lunge', 'split-squat'],
          sets: [work(2, 8, 12, 90)],
          progression: { type: 'double' },
        },
      ],
    },
  ],
};

/** Copie profonde de `GYM_AB`, modifiée par `edit` (mutation de la copie). */
export function gymAb(edit: (t: ProgramTemplate) => void = () => {}): ProgramTemplate {
  const copy = structuredClone(GYM_AB);
  edit(copy);
  return copy;
}

/** Slot `id` d'un modèle (lève s'il manque : erreur de la fixture). */
export function slotOf(template: ProgramTemplate, id: string): SlotSpec {
  const slot = template.workouts.flatMap((w) => w.slots).find((s) => s.id === id);
  if (slot === undefined) throw new Error(`slot ${id} absent`);
  return slot;
}

/** Slot d'accessoire de mollets (hors volume et hors couverture), pour remplir une séance. */
export const calfSlot = (id: string): SlotSpec => ({
  id,
  movementPattern: 'calf_raise',
  role: 'accessory',
  exercises: ['calf-raise'],
  sets: [work(2, 10, 15, 60)],
  progression: { type: 'double' },
});

/** Lieu de test : matériel déjà étendu, réglages de charge par défaut. */
export function place(
  id: string,
  equipment: readonly EquipmentCode[],
  kind: 'gym' | 'home' = 'gym',
): PlaceContext {
  return { id, equipment: expandEquipment(equipment), loadSettings: defaultLoadSettings(kind) };
}

/** Une salle de référence et une maison sans matériel. */
export const PLACES: readonly PlaceContext[] = [
  place('gym', REFERENCE_PROFILES.gym_reference),
  place('home', REFERENCE_PROFILES.home_bodyweight, 'home'),
];

/** Changement accepté, auteur `user` par défaut. */
export function accepted(
  id: string,
  decidedAt: number,
  operations: AcceptedChange['operations'],
  author: AcceptedChange['author'] = 'user',
): AcceptedChange {
  return { id, author, reasonCode: 'USER_CHANGE', decidedAt, operations };
}
