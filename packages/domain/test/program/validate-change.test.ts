import type { ChangeAuthor, InstanceChangeOperation, ServedProgramTemplate } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { type EffectiveProgram, effectiveProgram } from '../../src/program/effective';
import { type ChangeValidationInput, validateChange } from '../../src/program/validate-change';
import {
  accepted,
  calfSlot,
  GYM_AB,
  gymAb,
  PLACES,
  PROGRAM_CATALOG,
  place,
  slotOf,
} from '../fixtures/program';

const SERVED: ServedProgramTemplate[] = [
  { template: GYM_AB, available: true },
  { template: { ...GYM_AB, id: 'gym-intermediate-upper-lower', level: 'intermediate' }, available: true },
  { template: { ...GYM_AB, id: 'home-beginner-full-body', context: 'home' }, available: false },
];

function input(
  operations: InstanceChangeOperation[],
  overrides: Partial<Omit<ChangeValidationInput, 'change'>> & { author?: ChangeAuthor } = {},
): ChangeValidationInput {
  const { author = 'user', ...rest } = overrides;
  return {
    program: effectiveProgram(GYM_AB, 3, []),
    revision: 4,
    change: { author, baseRevision: 4, operations },
    catalog: [...PROGRAM_CATALOG],
    places: [...PLACES],
    profile: 'adult',
    level: 'beginner',
    servedTemplates: SERVED,
    instanceTemplateVersion: 1,
    ...rest,
  };
}

const check = (...args: Parameters<typeof input>) => validateChange(input(...args));
/** Erreurs d'un changement refusé ; `[]` s'il est accepté. */
const errors = (...args: Parameters<typeof input>) => {
  const result = check(...args);
  return result.ok ? [] : result.errors;
};
const cautious = { profile: 'cautious' as const };

describe('validateChange : changement accepté', () => {
  it('rend le programme résultant, sans toucher au programme reçu', () => {
    const before = input([]).program;
    const result = check([
      { op: 'set_rest', slot: 'A1', seconds: 180 },
      { op: 'replace_exercise', slot: 'A1', exercise: 'goblet-squat' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotOf(result.program.template, 'A1').exercises?.[0]).toBe('goblet-squat');
    expect(slotOf(result.program.template, 'A1').sets[1]?.restS).toBe(180);
    expect(before).toEqual(effectiveProgram(GYM_AB, 3, []));
  });

  it('add_slot : identifiant pris dans change.id quand il est fourni', () => {
    const result = validateChange({
      ...input([]),
      change: {
        id: 'c-9',
        author: 'user',
        baseRevision: 4,
        operations: [
          { op: 'add_slot', workout: 'A', movementPattern: 'calf_raise', exercises: ['calf-raise'] },
        ],
      },
    });
    expect(result.ok && result.program.template.workouts[0]?.slots.at(-1)?.id).toBe('A-c-9');
  });

  it('ne lit pas la révision : le serveur la vérifie', () => {
    expect(check([{ op: 'start_deload' }], { revision: 9 }).ok).toBe(true);
  });
});

describe('validateChange : auteurs (05 §15)', () => {
  it('resume_slot par le coach → forbidden_for_author', () => {
    const program = effectiveProgram(GYM_AB, 3, [accepted('c1', 1, [{ op: 'suspend_slot', slot: 'A1' }])]);
    expect(errors([{ op: 'resume_slot', slot: 'A1' }], { author: 'coach', program })).toEqual([
      { op: 0, code: 'forbidden_for_author' },
    ]);
    expect(check([{ op: 'resume_slot', slot: 'A1' }], { author: 'user', program }).ok).toBe(true);
  });

  it.each<[string, InstanceChangeOperation]>([
    ['change_sets', { op: 'change_sets', slot: 'A1', delta: -1 }],
    ['set_rest', { op: 'set_rest', slot: 'A1', seconds: 120 }],
    ['lighten_exercise', { op: 'lighten_exercise', slot: 'A1' }],
    ['add_slot', { op: 'add_slot', workout: 'A', movementPattern: 'calf_raise', exercises: ['calf-raise'] }],
    ['set_days_per_week', { op: 'set_days_per_week', days: 2 }],
  ])('le moteur ne peut pas %s', (_name, op) => {
    expect(errors([op], { author: 'engine' })).toEqual([{ op: 0, code: 'forbidden_for_author' }]);
  });

  it('le moteur peut remplacer, alléger la semaine et suspendre', () => {
    const ops: InstanceChangeOperation[] = [
      { op: 'replace_exercise', slot: 'A1', exercise: 'goblet-squat' },
      { op: 'start_deload' },
      { op: 'suspend_slot', slot: 'B1' },
    ];
    expect(check(ops, { author: 'engine' }).ok).toBe(true);
  });
});

describe('validateChange : cibles', () => {
  it('slot_unknown, workout_unknown', () => {
    expect(
      errors([
        { op: 'set_rest', slot: 'Z9', seconds: 120 },
        { op: 'add_slot', workout: 'Z', movementPattern: 'calf_raise', exercises: ['calf-raise'] },
      ]),
    ).toEqual([
      { op: 0, code: 'slot_unknown' },
      { op: 1, code: 'workout_unknown' },
    ]);
  });

  it('already_suspended, not_suspended', () => {
    const program = effectiveProgram(GYM_AB, 3, [accepted('c1', 1, [{ op: 'suspend_slot', slot: 'A1' }])]);
    expect(
      errors(
        [
          { op: 'suspend_slot', slot: 'A1' },
          { op: 'resume_slot', slot: 'A2' },
        ],
        { program },
      ),
    ).toEqual([
      { op: 0, code: 'already_suspended' },
      { op: 1, code: 'not_suspended' },
    ]);
  });
});

describe('validateChange : replace_exercise', () => {
  it('fiche d’un autre type de mouvement → pattern_mismatch', () => {
    expect(errors([{ op: 'replace_exercise', slot: 'A1', exercise: 'bench-press' }])).toEqual([
      { op: 0, code: 'pattern_mismatch' },
    ]);
  });

  it('fiche infaisable dans tous les lieux → exercise_unusable', () => {
    expect(errors([{ op: 'replace_exercise', slot: 'A1', exercise: 'smith-squat' }])).toEqual([
      { op: 0, code: 'exercise_unusable' },
    ]);
    const withSmith = [...PLACES, place('garage', ['smith_machine'])];
    expect(
      check([{ op: 'replace_exercise', slot: 'A1', exercise: 'smith-squat' }], { places: withSmith }).ok,
    ).toBe(true);
  });

  it('fiche non publiée ou inconnue → exercise_unusable', () => {
    expect(
      errors([
        { op: 'replace_exercise', slot: 'A1', exercise: 'draft-squat' },
        { op: 'replace_exercise', slot: 'A1', exercise: 'hack-squat' },
      ]),
    ).toEqual([
      { op: 0, code: 'exercise_unusable' },
      { op: 1, code: 'exercise_unusable' },
    ]);
  });

  it('prudent : fiche not_for_minors → forbidden_cautious ; adulte : admise', () => {
    const op: InstanceChangeOperation = { op: 'replace_exercise', slot: 'A1', exercise: 'jump-squat' };
    expect(errors([op], cautious)).toEqual([{ op: 0, code: 'forbidden_cautious' }]);
    expect(check([op]).ok).toBe(true);
  });
});

describe('validateChange : change_sets', () => {
  it('prudent : +1 → forbidden_cautious ; −1 admis', () => {
    expect(errors([{ op: 'change_sets', slot: 'A1', delta: 1 }], cautious)).toEqual([
      { op: 0, code: 'forbidden_cautious' },
    ]);
    expect(check([{ op: 'change_sets', slot: 'A1', delta: -1 }], cautious).ok).toBe(true);
  });

  it('adulte : résultat entre 1 et 5 (sets_out_of_bounds), opérations appliquées l’une après l’autre', () => {
    // A5 (gainage, 3 séries) : hors des groupes de volume.
    expect(
      check([
        { op: 'change_sets', slot: 'A5', delta: 1 },
        { op: 'change_sets', slot: 'A5', delta: 1 },
      ]).ok,
    ).toBe(true);
    expect(
      errors([
        { op: 'change_sets', slot: 'A5', delta: 1 },
        { op: 'change_sets', slot: 'A5', delta: 1 },
        { op: 'change_sets', slot: 'A5', delta: 1 },
      ]),
    ).toEqual([{ op: 2, code: 'sets_out_of_bounds' }]);
    expect(
      errors([
        { op: 'change_sets', slot: 'A4', delta: -1 },
        { op: 'change_sets', slot: 'A4', delta: -1 },
      ]),
    ).toEqual([{ op: 1, code: 'sets_out_of_bounds' }]);
  });

  it('prudent : résultat au plus 3', () => {
    const program = effectiveProgram(GYM_AB, 3, [
      accepted('c1', 1, [
        { op: 'change_sets', slot: 'A1', delta: 1 },
        { op: 'change_sets', slot: 'A1', delta: 1 },
      ]),
    ]);
    expect(errors([{ op: 'change_sets', slot: 'A1', delta: -1 }], { ...cautious, program })).toEqual([
      { op: 0, code: 'sets_out_of_bounds' },
    ]);
  });
});

describe('validateChange : set_rep_range', () => {
  it.each([
    [4, 8],
    [5, 31],
    [10, 11],
    [12, 8],
  ])('adulte : %i–%i → reps_out_of_bounds', (min, max) => {
    expect(errors([{ op: 'set_rep_range', slot: 'A3', min, max }])).toEqual([
      { op: 0, code: 'reps_out_of_bounds' },
    ]);
  });

  it('adulte : 5–30 et 10–12 admis', () => {
    expect(check([{ op: 'set_rep_range', slot: 'A3', min: 5, max: 30 }]).ok).toBe(true);
    expect(check([{ op: 'set_rep_range', slot: 'A3', min: 10, max: 12 }]).ok).toBe(true);
  });

  it.each([
    [5, 10],
    [8, 16],
    [8, 9],
  ])('prudent : %i–%i → reps_out_of_bounds', (min, max) => {
    expect(errors([{ op: 'set_rep_range', slot: 'A3', min, max }], cautious)).toEqual([
      { op: 0, code: 'reps_out_of_bounds' },
    ]);
  });

  it('prudent : 6–15 admis', () => {
    expect(check([{ op: 'set_rep_range', slot: 'A3', min: 6, max: 15 }], cautious).ok).toBe(true);
  });

  it('slot en durée : reps_out_of_bounds', () => {
    expect(errors([{ op: 'set_rep_range', slot: 'A5', min: 8, max: 12 }])).toEqual([
      { op: 0, code: 'reps_out_of_bounds' },
    ]);
  });
});

describe('validateChange : set_target_rir', () => {
  it('1 sur un slot main, utilisateur débutant → rir_out_of_bounds', () => {
    expect(errors([{ op: 'set_target_rir', slot: 'A1', value: 1 }])).toEqual([
      { op: 0, code: 'rir_out_of_bounds' },
    ]);
  });

  it('1 sur un slot main, intermédiaire sur un modèle intermédiaire : admis', () => {
    const program = effectiveProgram({ ...GYM_AB, level: 'intermediate' }, 3, []);
    expect(
      check([{ op: 'set_target_rir', slot: 'A1', value: 1 }], { level: 'intermediate', program }).ok,
    ).toBe(true);
  });

  it('1 sur un slot main d’un modèle débutant, même pour un intermédiaire → rir_out_of_bounds (règle 3)', () => {
    expect(errors([{ op: 'set_target_rir', slot: 'A1', value: 1 }], { level: 'intermediate' })).toEqual([
      { op: 0, code: 'rir_out_of_bounds' },
    ]);
  });

  it.each([0, 5, 10])('%i → rir_out_of_bounds (adulte : 1 à 4)', (value) => {
    expect(errors([{ op: 'set_target_rir', slot: 'A4', value }])).toEqual([
      { op: 0, code: 'rir_out_of_bounds' },
    ]);
  });

  it('1 sur un accessoire : admis', () => {
    expect(check([{ op: 'set_target_rir', slot: 'A4', value: 1 }]).ok).toBe(true);
  });

  it('prudent : à la baisse → forbidden_cautious ; à la hausse admis', () => {
    expect(errors([{ op: 'set_target_rir', slot: 'A4', value: 1 }], cautious)).toEqual([
      { op: 0, code: 'forbidden_cautious' },
    ]);
    expect(check([{ op: 'set_target_rir', slot: 'A4', value: 3 }], cautious).ok).toBe(true);
  });
});

describe('validateChange : set_rest', () => {
  it.each([29, 301, 0, 3600])('%i s → rest_out_of_bounds', (seconds) => {
    expect(errors([{ op: 'set_rest', slot: 'A1', seconds }])).toEqual([
      { op: 0, code: 'rest_out_of_bounds' },
    ]);
    expect(errors([{ op: 'set_rest', slot: 'A1', seconds }], cautious)).toEqual([
      { op: 0, code: 'rest_out_of_bounds' },
    ]);
  });

  it('30 et 300 s admis', () => {
    expect(
      check([
        { op: 'set_rest', slot: 'A1', seconds: 30 },
        { op: 'set_rest', slot: 'A2', seconds: 300 },
      ]).ok,
    ).toBe(true);
  });
});

describe('validateChange : remove_slot et add_slot', () => {
  it('remove_slot qui vide core → coverage_lost', () => {
    expect(errors([{ op: 'remove_slot', slot: 'A5' }])).toEqual([{ op: 0, code: 'coverage_lost' }]);
  });

  it('coverage_lost appliquée au résultat : un add_slot du même groupe la rattrape', () => {
    const ops: InstanceChangeOperation[] = [
      { op: 'remove_slot', slot: 'A5' },
      { op: 'add_slot', workout: 'B', movementPattern: 'core_anti_rotation', exercises: ['pallof-press'] },
    ];
    expect(check(ops).ok).toBe(true);
  });

  it('remove_slot qui fait sortir un groupe de sa fourchette de volume → volume_out_of_range', () => {
    // Sans A4 : pectoraux 3 × 1,5 = 4,5 < 6.
    expect(errors([{ op: 'remove_slot', slot: 'A4' }])).toEqual([{ op: 0, code: 'volume_out_of_range' }]);
  });

  it('volume déjà hors fourchette : un changement qui ne l’aggrave pas passe, un qui l’aggrave est refusé', () => {
    const program = effectiveProgram(GYM_AB, 3, [accepted('c1', 1, [{ op: 'remove_slot', slot: 'A4' }])]);
    expect(check([{ op: 'set_rest', slot: 'A1', seconds: 180 }], { program }).ok).toBe(true);
    expect(errors([{ op: 'change_sets', slot: 'A2', delta: -1 }], { program })).toEqual([
      { op: 0, code: 'volume_out_of_range' },
    ]);
    expect(check([{ op: 'change_sets', slot: 'A2', delta: 1 }], { program }).ok).toBe(true);
  });

  it('erreur du résultat imputée à la dernière opération qui l’a provoquée', () => {
    expect(
      errors([
        { op: 'set_rest', slot: 'A1', seconds: 180 },
        { op: 'change_sets', slot: 'A2', delta: -1 },
        { op: 'change_sets', slot: 'A4', delta: -1 },
        { op: 'change_sets', slot: 'A4', delta: 1 },
        { op: 'change_sets', slot: 'A4', delta: -1 },
      ]),
    ).toEqual([{ op: 4, code: 'volume_out_of_range' }]);
  });

  it('remove_slot du seul slot d’une séance → slot_limit', () => {
    const program = effectiveProgram(GYM_AB, 3, [
      accepted('c1', 1, [
        { op: 'add_slot', workout: 'B', movementPattern: 'core_anti_rotation', exercises: ['pallof-press'] },
      ]),
    ]);
    const lonely = effectiveProgram(
      gymAb((t) => {
        t.workouts.push({ id: 'C', name: 'Séance C', slots: [calfSlot('C1')] });
      }),
      3,
      [],
    );
    expect(check([{ op: 'remove_slot', slot: 'A5' }], { program }).ok).toBe(true);
    expect(errors([{ op: 'remove_slot', slot: 'C1' }], { program: lonely })).toEqual([
      { op: 0, code: 'slot_limit' },
    ]);
  });

  it('add_slot en profil prudent → forbidden_cautious', () => {
    expect(
      errors(
        [{ op: 'add_slot', workout: 'A', movementPattern: 'calf_raise', exercises: ['calf-raise'] }],
        cautious,
      ),
    ).toEqual([{ op: 0, code: 'forbidden_cautious' }]);
  });

  it('add_slot : 8 slots au plus par séance ; une séance déjà à 8 slots refuse le 9e (slot_limit)', () => {
    const withSlots = (n: number) =>
      effectiveProgram(
        gymAb((t) => {
          for (let i = 6; i < 6 + n; i += 1) t.workouts[0]?.slots.push(calfSlot(`A${i}`));
        }),
        3,
        [],
      );
    const add: InstanceChangeOperation = {
      op: 'add_slot',
      workout: 'A',
      movementPattern: 'calf_raise',
      exercises: ['calf-raise'],
    };
    expect(check([add], { program: withSlots(2) }).ok).toBe(true);
    expect(errors([add], { program: withSlots(3) })).toEqual([{ op: 0, code: 'slot_limit' }]);
  });

  it('add_slot : un slot par séance et par changement', () => {
    const add: InstanceChangeOperation = {
      op: 'add_slot',
      workout: 'A',
      movementPattern: 'calf_raise',
      exercises: ['calf-raise'],
    };
    expect(errors([add, add])).toEqual([{ op: 1, code: 'slot_limit' }]);
    expect(check([add, { ...add, workout: 'B' }]).ok).toBe(true);
  });

  it('add_slot : fiches du type de mouvement, et au moins une utilisable dans un lieu', () => {
    expect(
      errors([
        { op: 'add_slot', workout: 'A', movementPattern: 'calf_raise', exercises: ['calf-raise', 'push-up'] },
        { op: 'add_slot', workout: 'B', movementPattern: 'squat', exercises: ['smith-squat'] },
      ]),
    ).toEqual([
      { op: 0, code: 'pattern_mismatch' },
      { op: 1, code: 'exercise_unusable' },
    ]);
  });
});

describe('validateChange : set_days_per_week', () => {
  it.each([1, 4, 5])('%i jours sur un modèle 2–3 → days_out_of_range', (days) => {
    expect(errors([{ op: 'set_days_per_week', days }])).toEqual([{ op: 0, code: 'days_out_of_range' }]);
  });

  it('2 jours admis', () => {
    const result = check([{ op: 'set_days_per_week', days: 2 }]);
    expect(result.ok && result.program.daysPerWeek).toBe(2);
  });
});

describe('validateChange : switch_template', () => {
  it('même id et même version → template_unchanged', () => {
    expect(errors([{ op: 'switch_template', templateId: GYM_AB.id }])).toEqual([
      { op: 0, code: 'template_unchanged' },
    ]);
  });

  it('même id, version servie plus haute : admis (D18)', () => {
    const servedTemplates = [{ template: { ...GYM_AB, version: 2 }, available: true }];
    expect(check([{ op: 'switch_template', templateId: GYM_AB.id }], { servedTemplates }).ok).toBe(true);
  });

  it('modèle indisponible ou absent → template_unavailable', () => {
    expect(
      errors([
        { op: 'switch_template', templateId: 'home-beginner-full-body' },
        { op: 'switch_template', templateId: 'inconnu' },
      ]),
    ).toEqual([
      { op: 0, code: 'template_unavailable' },
      { op: 1, code: 'template_unavailable' },
    ]);
  });

  it('jours hors des bornes du nouveau modèle → days_out_of_range', () => {
    const op = (daysPerWeek: number): InstanceChangeOperation => ({
      op: 'switch_template',
      templateId: 'gym-intermediate-upper-lower',
      daysPerWeek,
    });
    expect(errors([op(4)])).toEqual([{ op: 0, code: 'days_out_of_range' }]);
    expect(check([op(2)]).ok).toBe(true);
    expect(check([{ op: 'switch_template', templateId: 'gym-intermediate-upper-lower' }]).ok).toBe(true);
  });

  it('ne modifie pas le programme (nouvelle inscription faite par le serveur)', () => {
    const result = check([{ op: 'switch_template', templateId: 'gym-intermediate-upper-lower' }]);
    expect(result.ok && result.program).toEqual(effectiveProgram(GYM_AB, 3, []));
  });
});

describe('validateChange : plusieurs erreurs', () => {
  it('une erreur par opération fautive, dans l’ordre des opérations', () => {
    const program: EffectiveProgram = effectiveProgram(GYM_AB, 3, []);
    expect(
      errors(
        [
          { op: 'set_rest', slot: 'A1', seconds: 10 },
          { op: 'set_rest', slot: 'A1', seconds: 120 },
          { op: 'change_sets', slot: 'A1', delta: 1 },
          { op: 'resume_slot', slot: 'A1' },
        ],
        { program, ...cautious },
      ),
    ).toEqual([
      { op: 0, code: 'rest_out_of_bounds' },
      { op: 2, code: 'forbidden_cautious' },
      { op: 3, code: 'not_suspended' },
    ]);
  });
});
