import { z } from 'zod';
import type { Experience } from './api/profile';

export const EQUIPMENT_CATEGORIES = {
  household: ['chair', 'table'],
  small_equipment: ['resistance_band', 'dumbbells', 'kettlebell', 'pull_up_bar', 'suspension_trainer', 'box'],
  benches_racks: ['flat_bench', 'adjustable_bench', 'squat_rack', 'dip_station', 'back_extension_bench'],
  free_weights: ['barbell', 'ez_bar'],
  machines: [
    'cable_station',
    'lat_pulldown',
    'seated_row',
    'leg_press',
    'smith_machine',
    'leg_extension',
    'leg_curl',
    'upper_body_machines',
  ],
} as const;

export type EquipmentCategory = keyof typeof EQUIPMENT_CATEGORIES;

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  household: 'Objets du quotidien',
  small_equipment: 'Petit matériel',
  benches_racks: 'Bancs et supports',
  free_weights: 'Charges libres',
  machines: 'Poulies et machines',
};

export const EQUIPMENT = [
  'chair',
  'table',
  'resistance_band',
  'dumbbells',
  'kettlebell',
  'pull_up_bar',
  'suspension_trainer',
  'box',
  'flat_bench',
  'adjustable_bench',
  'squat_rack',
  'dip_station',
  'back_extension_bench',
  'barbell',
  'ez_bar',
  'cable_station',
  'lat_pulldown',
  'seated_row',
  'leg_press',
  'smith_machine',
  'leg_extension',
  'leg_curl',
  'upper_body_machines',
] as const;

export type EquipmentCode = (typeof EQUIPMENT)[number];
export const EquipmentCodeSchema = z.enum(EQUIPMENT);

export const EQUIPMENT_LABELS: Record<EquipmentCode, string> = {
  chair: 'Chaise ou banc stable',
  table: 'Table solide (rowing sous la table)',
  resistance_band: 'Élastiques (bandes, avec poignées ou mini-bandes)',
  dumbbells: 'Haltères fixes ou réglables',
  kettlebell: 'Kettlebell',
  pull_up_bar: 'Barre de traction',
  suspension_trainer: 'Sangles de suspension ou anneaux',
  box: 'Box ou step stable',
  flat_bench: 'Banc plat',
  adjustable_bench: 'Banc inclinable',
  squat_rack: 'Cage ou supports à squat avec sécurités',
  dip_station: 'Barres parallèles',
  back_extension_bench: 'Banc à lombaires (45° ou GHD)',
  barbell: 'Barre droite et disques',
  ez_bar: 'Barre EZ',
  cable_station: 'Poulie réglable ou vis-à-vis',
  lat_pulldown: 'Tirage vertical',
  seated_row: 'Tirage horizontal assis',
  leg_press: 'Presse à cuisses',
  smith_machine: 'Barre guidée (Smith)',
  leg_extension: 'Leg extension',
  leg_curl: 'Leg curl',
  upper_body_machines: 'Machines guidées du haut du corps (développé, pec deck, épaules)',
};

export const EQUIPMENT_IMPLIES: Partial<Record<EquipmentCode, readonly EquipmentCode[]>> = {
  adjustable_bench: ['flat_bench'],
};

export const REFERENCE_PROFILES = {
  home_bodyweight: ['chair', 'table'],
  home_small_equipment: ['chair', 'table', 'pull_up_bar', 'resistance_band', 'dumbbells'],
  gym_reference: [
    'dumbbells',
    'barbell',
    'squat_rack',
    'flat_bench',
    'adjustable_bench',
    'dip_station',
    'pull_up_bar',
    'cable_station',
    'lat_pulldown',
    'seated_row',
    'leg_press',
    'leg_extension',
    'leg_curl',
    'upper_body_machines',
  ],
} as const satisfies Record<string, readonly EquipmentCode[]>;

/**
 * Types de mouvement (04 §3.4) : les slots de Programmes les utilisent directement (`slot.movementPattern`),
 * il n'existe pas de seconde liste.
 */
export const MOVEMENT_PATTERNS = [
  'squat',
  'lunge',
  'hip_hinge',
  'glute_bridge',
  'knee_flexion',
  'knee_extension',
  'calf_raise',
  'hip_adduction_abduction',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'shoulder_isolation',
  'elbow_flexion',
  'elbow_extension',
  'core_anti_extension',
  'core_anti_rotation',
  'trunk_flexion',
  'loaded_carry',
  'plyometrics',
] as const;

export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];
export const MovementPatternSchema = z.enum(MOVEMENT_PATTERNS);

export const MOVEMENT_PATTERN_LABELS: Record<MovementPattern, string> = {
  squat: 'Squat',
  lunge: 'Fente (fentes, bulgare, step-up, pistol)',
  hip_hinge: 'Charnière de hanche',
  glute_bridge: 'Pont fessier, hip thrust',
  knee_flexion: 'Flexion du genou (leg curl, Nordic)',
  knee_extension: 'Extension du genou',
  calf_raise: 'Mollets',
  hip_adduction_abduction: 'Adducteurs et abducteurs (dont Copenhague)',
  horizontal_push: 'Poussée horizontale',
  vertical_push: 'Poussée verticale',
  horizontal_pull: 'Tirage horizontal',
  vertical_pull: 'Tirage vertical',
  shoulder_isolation: "Isolation d'épaule (élévations, oiseau, face pull, rotations)",
  elbow_flexion: 'Flexion du coude',
  elbow_extension: 'Extension du coude',
  core_anti_extension: 'Gainage anti-extension',
  core_anti_rotation: 'Gainage anti-rotation, y compris latéral',
  trunk_flexion: 'Flexion du tronc',
  loaded_carry: 'Port de charge',
  plyometrics: 'Pliométrie',
};

/**
 * Groupes de couverture (04 §3.4), lus par la règle de couverture de Programmes et par les chaînes (R-CH-3).
 * Un pattern absent de ces groupes forme son propre groupe (`patternGroup`).
 */
export const PATTERN_GROUPS = {
  lower_body: ['squat', 'lunge'],
  hinge: ['hip_hinge', 'glute_bridge'],
  push: ['horizontal_push', 'vertical_push'],
  pull: ['horizontal_pull', 'vertical_pull'],
  core: ['core_anti_extension', 'core_anti_rotation'],
} as const satisfies Record<string, readonly MovementPattern[]>;

export type PatternGroup = keyof typeof PATTERN_GROUPS;

const GROUP_OF_PATTERN = new Map<MovementPattern, PatternGroup>(
  (Object.keys(PATTERN_GROUPS) as PatternGroup[]).flatMap((group) =>
    PATTERN_GROUPS[group].map((p): [MovementPattern, PatternGroup] => [p, group]),
  ),
);

/** Groupe de couverture d'un pattern, ou le pattern lui-même s'il n'appartient à aucun groupe (04 §3.4). */
export function patternGroup(p: MovementPattern): PatternGroup | MovementPattern {
  return GROUP_OF_PATTERN.get(p) ?? p;
}

/** Muscles (04 §3.5). Les groupes de volume de Programmes et les groupes d'affichage en dérivent. */
export const MUSCLES = [
  'chest',
  'front_delts',
  'side_delts',
  'rear_delts',
  'rotator_cuff',
  'traps',
  'lats',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'lower_back',
  'glutes',
  'quadriceps',
  'hamstrings',
  'adductors',
  'calves',
] as const;

export type Muscle = (typeof MUSCLES)[number];
export const MuscleSchema = z.enum(MUSCLES);

export const MUSCLE_LABELS: Record<Muscle, string> = {
  chest: 'Pectoraux',
  front_delts: 'Deltoïdes antérieurs',
  side_delts: 'Deltoïdes latéraux',
  rear_delts: 'Deltoïdes postérieurs',
  rotator_cuff: 'Coiffe des rotateurs',
  traps: 'Trapèzes',
  lats: 'Dorsaux',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Avant-bras',
  abs: 'Abdominaux',
  obliques: 'Obliques',
  lower_back: 'Lombaires',
  glutes: 'Fessiers',
  quadriceps: 'Quadriceps',
  hamstrings: 'Ischio-jambiers',
  adductors: 'Adducteurs',
  calves: 'Mollets',
};

/** Articulations fortement sollicitées (`stressed_joints`, 04 §3.5), lues par les briques 3 et 4. */
export const JOINTS = [
  'neck',
  'shoulders',
  'elbows',
  'wrists',
  'lower_back',
  'hips',
  'knees',
  'ankles',
] as const;

export type Joint = (typeof JOINTS)[number];
export const JointSchema = z.enum(JOINTS);

export const JOINT_LABELS: Record<Joint, string> = {
  neck: 'Cou',
  shoulders: 'Épaules',
  elbows: 'Coudes',
  wrists: 'Poignets',
  lower_back: 'Bas du dos',
  hips: 'Hanches',
  knees: 'Genoux',
  ankles: 'Chevilles',
};

/**
 * Articulations qui rendent une fiche sensible (spec brique 2 §3.2) : elle ne se publie qu'avec le feu vert
 * santé à jour. Réglable.
 */
export const SENSITIVE_JOINTS = [
  'lower_back',
  'knees',
  'shoulders',
  'neck',
] as const satisfies readonly Joint[];

/** Niveaux de fiche (04 §3.5) : 1 débutant, 2 intermédiaire, 3 avancé. */
export const EXERCISE_LEVELS = [1, 2, 3] as const;
export type ExerciseLevel = (typeof EXERCISE_LEVELS)[number];

/**
 * Niveau de fiche le plus haut proposé automatiquement (04 §3.5) : `beginner` → 1, `intermediate` → 2, le
 * niveau de programme étant déduit de l'expérience comme en 02 R-REC-2 (`none` et `lt_6_months` → `beginner`).
 * Expérience inconnue → 2 (spec brique 2 §4.2). Le niveau 3 n'est jamais proposé automatiquement.
 */
export function maxExerciseLevel(experience: Experience | null | undefined): ExerciseLevel {
  return experience === 'none' || experience === 'lt_6_months' ? 1 : 2;
}

/** Modes de charge (04 §3.6) : toutes les options de matériel d'une fiche partagent le même. */
export const LOAD_MODES = ['barbell', 'dumbbell', 'machine', 'weighted', 'bodyweight', 'band'] as const;

export type LoadMode = (typeof LOAD_MODES)[number];
export const LoadModeSchema = z.enum(LOAD_MODES);

/**
 * Groupes musculaires d'affichage (spec brique 2 §4.3) : tuiles de l'onglet Exercices et rangs de Progression,
 * dans l'ordre de la refonte. Chaque muscle est dans un seul groupe ; un exercice apparaît dans le groupe de
 * chacun de ses muscles principaux. Distincts des groupes de volume de Programmes (05).
 */
export const MUSCLE_GROUPS = [
  { code: 'chest', label: 'Pectoraux', muscles: ['chest'] },
  { code: 'back', label: 'Dos', muscles: ['lats', 'traps', 'lower_back'] },
  {
    code: 'shoulders',
    label: 'Épaules',
    muscles: ['front_delts', 'side_delts', 'rear_delts', 'rotator_cuff'],
  },
  { code: 'arms', label: 'Bras', muscles: ['biceps', 'triceps', 'forearms'] },
  { code: 'core', label: 'Abdos', muscles: ['abs', 'obliques'] },
  { code: 'glutes', label: 'Fessiers', muscles: ['glutes'] },
  { code: 'quads', label: 'Quadriceps', muscles: ['quadriceps', 'adductors'] },
  { code: 'hamstrings', label: 'Ischios', muscles: ['hamstrings'] },
  { code: 'calves', label: 'Mollets', muscles: ['calves'] },
] as const satisfies readonly { code: string; label: string; muscles: readonly Muscle[] }[];

export type MuscleGroupCode = (typeof MUSCLE_GROUPS)[number]['code'];

/** Remplaçants rendus au plus par `substitutes` (04 §6). Réglable. */
export const SUBSTITUTE_LIMIT = 5;

/** Fiches non retirées au plus, tous statuts confondus, brouillons compris (spec brique 2 §2). Réglable. */
export const CATALOG_MAX_SHEETS = 300;
