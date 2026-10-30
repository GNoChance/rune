import { describe, expect, it } from 'vitest';
import { HOME_DEFAULT_PRESET, PRESET_IDS, PRESETS, PresetIdSchema } from '../src/presets';
import {
  CATALOG_MAX_SHEETS,
  EQUIPMENT,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_IMPLIES,
  EQUIPMENT_LABELS,
  EquipmentCodeSchema,
  EXERCISE_LEVELS,
  JOINT_LABELS,
  JOINTS,
  JointSchema,
  LOAD_MODES,
  LoadModeSchema,
  MOVEMENT_PATTERN_LABELS,
  MOVEMENT_PATTERNS,
  MovementPatternSchema,
  MUSCLE_GROUPS,
  MUSCLE_LABELS,
  MUSCLES,
  MuscleSchema,
  maxExerciseLevel,
  PATTERN_GROUPS,
  patternGroup,
  REFERENCE_PROFILES,
  SENSITIVE_JOINTS,
  SUBSTITUTE_LIMIT,
} from '../src/taxonomy';

describe('taxonomy', () => {
  it('fige codes, ordre et catégories (R-EQ-1)', () => {
    expect(EQUIPMENT).toEqual(Object.values(EQUIPMENT_CATEGORIES).flat());
    expect(EQUIPMENT).toHaveLength(23);
    expect(EQUIPMENT_CATEGORIES).toEqual({
      household: ['chair', 'table'],
      small_equipment: [
        'resistance_band',
        'dumbbells',
        'kettlebell',
        'pull_up_bar',
        'suspension_trainer',
        'box',
      ],
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
    });
    expect(EQUIPMENT_CATEGORY_LABELS).toEqual({
      household: 'Objets du quotidien',
      small_equipment: 'Petit matériel',
      benches_racks: 'Bancs et supports',
      free_weights: 'Charges libres',
      machines: 'Poulies et machines',
    });
  });

  it('porte les libellés exacts', () => {
    expect(EQUIPMENT_LABELS.squat_rack).toBe('Cage ou supports à squat avec sécurités');
    expect(EQUIPMENT_LABELS.chair).toBe('Chaise ou banc stable');
    expect(Object.keys(EQUIPMENT_LABELS)).toEqual([...EQUIPMENT]);
    expect(EQUIPMENT_LABELS).toEqual({
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
    });
  });

  it('banc inclinable implique banc plat (R-EQ-2)', () => {
    expect(EQUIPMENT_IMPLIES).toEqual({ adjustable_bench: ['flat_bench'] });
  });

  it('fige les profils de référence', () => {
    expect(REFERENCE_PROFILES.home_bodyweight).toEqual(['chair', 'table']);
    expect(REFERENCE_PROFILES.home_small_equipment).toEqual([
      'chair',
      'table',
      'pull_up_bar',
      'resistance_band',
      'dumbbells',
    ]);
    expect(REFERENCE_PROFILES.gym_reference).toEqual([
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
    ]);
  });

  it('refuse un code inconnu', () => {
    expect(EquipmentCodeSchema.safeParse('cardio').success).toBe(false);
    expect(EquipmentCodeSchema.safeParse('barbell').success).toBe(true);
  });
});

describe('types de mouvement (04 §3.4)', () => {
  it('fige les 20 codes, leur ordre et leurs libellés', () => {
    expect(MOVEMENT_PATTERNS).toEqual([
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
    ]);
    expect(Object.keys(MOVEMENT_PATTERN_LABELS)).toEqual([...MOVEMENT_PATTERNS]);
    expect(MOVEMENT_PATTERN_LABELS.lunge).toBe('Fente (fentes, bulgare, step-up, pistol)');
    expect(MOVEMENT_PATTERN_LABELS.shoulder_isolation).toBe(
      "Isolation d'épaule (élévations, oiseau, face pull, rotations)",
    );
    expect(MOVEMENT_PATTERN_LABELS.core_anti_rotation).toBe('Gainage anti-rotation, y compris latéral');
    expect(MovementPatternSchema.safeParse('deadlift').success).toBe(false);
  });

  it('fige les 5 groupes de couverture', () => {
    expect(PATTERN_GROUPS).toEqual({
      lower_body: ['squat', 'lunge'],
      hinge: ['hip_hinge', 'glute_bridge'],
      push: ['horizontal_push', 'vertical_push'],
      pull: ['horizontal_pull', 'vertical_pull'],
      core: ['core_anti_extension', 'core_anti_rotation'],
    });
  });

  it('patternGroup rend son groupe ou le pattern lui-même', () => {
    expect(patternGroup('lunge')).toBe('lower_body');
    expect(patternGroup('calf_raise')).toBe('calf_raise');
    for (const [group, patterns] of Object.entries(PATTERN_GROUPS)) {
      for (const p of patterns) expect(patternGroup(p)).toBe(group);
    }
    const grouped: readonly string[] = Object.values(PATTERN_GROUPS).flat();
    for (const p of MOVEMENT_PATTERNS) if (!grouped.includes(p)) expect(patternGroup(p)).toBe(p);
  });
});

describe('muscles, articulations, niveaux et modes de charge (04 §3.5, §3.6)', () => {
  it('fige les 18 muscles et leurs libellés', () => {
    expect(MUSCLES).toEqual([
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
    ]);
    expect(Object.keys(MUSCLE_LABELS)).toEqual([...MUSCLES]);
    expect(MUSCLE_LABELS.lats).toBe('Dorsaux');
    expect(MuscleSchema.safeParse('delts').success).toBe(false);
  });

  it('fige les 8 articulations et leurs libellés', () => {
    expect(JOINTS).toEqual([
      'neck',
      'shoulders',
      'elbows',
      'wrists',
      'lower_back',
      'hips',
      'knees',
      'ankles',
    ]);
    expect(Object.keys(JOINT_LABELS)).toEqual([...JOINTS]);
    expect(JointSchema.safeParse('spine').success).toBe(false);
  });

  it('fige les niveaux et les 6 modes de charge', () => {
    expect(EXERCISE_LEVELS).toEqual([1, 2, 3]);
    expect(LOAD_MODES).toEqual(['barbell', 'dumbbell', 'machine', 'weighted', 'bodyweight', 'band']);
    expect(LoadModeSchema.safeParse('duration').success).toBe(false);
  });

  it('SENSITIVE_JOINTS est inclus dans JOINTS', () => {
    expect(SENSITIVE_JOINTS).toEqual(['lower_back', 'knees', 'shoulders', 'neck']);
    expect(SENSITIVE_JOINTS.every((j) => JOINTS.includes(j))).toBe(true);
  });

  it("MUSCLE_GROUPS couvre chacun des 18 muscles une seule fois, dans l'ordre de la refonte", () => {
    expect(MUSCLE_GROUPS.map((g) => g.code)).toEqual([
      'chest',
      'back',
      'shoulders',
      'arms',
      'core',
      'glutes',
      'quads',
      'hamstrings',
      'calves',
    ]);
    expect(MUSCLE_GROUPS.map((g) => g.label)).toEqual([
      'Pectoraux',
      'Dos',
      'Épaules',
      'Bras',
      'Abdos',
      'Fessiers',
      'Quadriceps',
      'Ischios',
      'Mollets',
    ]);
    expect(MUSCLE_GROUPS.flatMap((g) => g.muscles).sort()).toEqual([...MUSCLES].sort());
  });

  it('range les muscles comme le tableau de la spec (§4.3)', () => {
    expect(Object.fromEntries(MUSCLE_GROUPS.map((g) => [g.code, g.muscles]))).toEqual({
      chest: ['chest'],
      back: ['lats', 'traps', 'lower_back'],
      shoulders: ['front_delts', 'side_delts', 'rear_delts', 'rotator_cuff'],
      arms: ['biceps', 'triceps', 'forearms'],
      core: ['abs', 'obliques'],
      glutes: ['glutes'],
      quads: ['quadriceps', 'adductors'],
      hamstrings: ['hamstrings'],
      calves: ['calves'],
    });
  });

  it("maxExerciseLevel suit le niveau de programme (02 R-REC-2), 2 si l'expérience est inconnue", () => {
    expect(maxExerciseLevel('none')).toBe(1);
    expect(maxExerciseLevel('lt_6_months')).toBe(1);
    expect(maxExerciseLevel('6_to_24_months')).toBe(2);
    expect(maxExerciseLevel('gt_24_months')).toBe(2);
    expect(maxExerciseLevel(null)).toBe(2);
    expect(maxExerciseLevel(undefined)).toBe(2);
  });

  it('fige les limites du catalogue', () => {
    expect(SUBSTITUTE_LIMIT).toBe(5);
    expect(CATALOG_MAX_SHEETS).toBe(300);
  });
});

describe('presets', () => {
  it('porte les 7 préréglages (R-MAT-2)', () => {
    expect([...PRESET_IDS]).toEqual([
      'gym_large',
      'gym_small',
      'gym_crossfit',
      'gym_other',
      'home_none',
      'home_small',
      'home_gym',
    ]);
    expect(HOME_DEFAULT_PRESET).toBe('home_none');
    expect(PresetIdSchema.safeParse('gym_huge').success).toBe(false);
  });

  it('compose le matériel de chaque préréglage', () => {
    const household: readonly string[] = EQUIPMENT_CATEGORIES.household;
    expect(PRESETS.gym_large.equipment).toEqual(EQUIPMENT.filter((c) => !household.includes(c)));
    expect(PRESETS.home_none.equipment).toEqual(REFERENCE_PROFILES.home_bodyweight);
    expect(PRESETS.home_small.equipment).toEqual(REFERENCE_PROFILES.home_small_equipment);
    expect(PRESETS.gym_small.equipment).toEqual([
      'dumbbells',
      'barbell',
      'ez_bar',
      'flat_bench',
      'adjustable_bench',
      'squat_rack',
      'cable_station',
      'lat_pulldown',
      'seated_row',
      'leg_press',
      'pull_up_bar',
      'dip_station',
    ]);
    expect(PRESETS.gym_crossfit.equipment).toEqual([
      'barbell',
      'squat_rack',
      'dumbbells',
      'kettlebell',
      'flat_bench',
      'pull_up_bar',
      'suspension_trainer',
      'box',
      'resistance_band',
    ]);
    expect(PRESETS.home_gym.equipment).toEqual([
      'chair',
      'table',
      'pull_up_bar',
      'resistance_band',
      'dumbbells',
      'kettlebell',
      'barbell',
      'squat_rack',
      'flat_bench',
    ]);
    expect(PRESETS.gym_other.equipment).toEqual([]);
  });

  it('porte libellés et kind, sans household en salle (R-EQ-3)', () => {
    expect(PRESETS.gym_large.label).toBe('Grande salle ou chaîne');
    expect(PRESETS.gym_small.label).toBe('Petite salle de quartier');
    expect(PRESETS.gym_crossfit.label).toBe('Box de cross-training');
    expect(PRESETS.gym_other.label).toBe('Autre');
    expect(PRESETS.home_none.label).toBe('Sans matériel');
    expect(PRESETS.home_small.label).toBe('Petit matériel');
    expect(PRESETS.home_gym.label).toBe('Home gym');
    const household: readonly string[] = EQUIPMENT_CATEGORIES.household;
    for (const id of PRESET_IDS) {
      const p = PRESETS[id];
      expect(p.kind).toBe(id.startsWith('gym_') ? 'gym' : 'home');
      if (p.kind === 'gym') {
        for (const c of p.equipment) expect(household).not.toContain(c);
      }
    }
  });
});
