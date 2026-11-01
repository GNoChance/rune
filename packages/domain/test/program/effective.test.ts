import { describe, expect, it } from 'vitest';
import { effectiveProgram } from '../../src/program/effective';
import { accepted, GYM_AB, gymAb, slotOf } from '../fixtures/program';

const run = (...changes: Parameters<typeof accepted>[]) =>
  effectiveProgram(
    GYM_AB,
    3,
    changes.map((c) => accepted(...c)),
  );

describe('effectiveProgram', () => {
  it('sans changement : le snapshot, les jours donnés, rien de suspendu', () => {
    const program = effectiveProgram(GYM_AB, 2, []);
    expect(program.template).toEqual(GYM_AB);
    expect(program.daysPerWeek).toBe(2);
    expect([...program.suspended]).toEqual([]);
  });

  it('ne modifie jamais le snapshot reçu', () => {
    const before = structuredClone(GYM_AB);
    run([
      'c1',
      1,
      [
        { op: 'remove_slot', slot: 'A4' },
        { op: 'change_sets', slot: 'A1', delta: 1 },
      ],
    ]);
    expect(GYM_AB).toEqual(before);
  });

  it('replace_exercise : la fiche passe en tête de la liste, sans doublon', () => {
    const { template } = run(['c1', 1, [{ op: 'replace_exercise', slot: 'A1', exercise: 'leg-press' }]]);
    expect(slotOf(template, 'A1').exercises).toEqual([
      'leg-press',
      'back-squat',
      'goblet-squat',
      'bodyweight-squat',
    ]);
    expect(slotOf(template, 'A1').progression).toEqual({ type: 'linear', incrementG: 5000 });
    const fresh = run(['c1', 1, [{ op: 'replace_exercise', slot: 'A3', exercise: 'pull-up' }]]);
    expect(slotOf(fresh.template, 'A3').exercises).toEqual([
      'pull-up',
      'barbell-row',
      'seated-cable-row',
      'inverted-row',
    ]);
  });

  it('replace_exercise sur un slot chain : liste à une fiche ; progression duration gardée pour un slot en durée', () => {
    const { template } = run(['c1', 1, [{ op: 'replace_exercise', slot: 'A5', exercise: 'pallof-press' }]]);
    const slot = slotOf(template, 'A5');
    expect(slot.exercises).toEqual(['pallof-press']);
    expect(slot).not.toHaveProperty('chain');
    expect(slot.progression).toEqual({ type: 'duration', stepS: 5 });
  });

  it('replace_exercise sur un slot chain en répétitions : progression double', () => {
    const snapshot = gymAb((t) => {
      const slot = slotOf(t, 'A5');
      slot.sets = [{ kind: 'work', count: 3, reps: { min: 8, max: 15 }, targetRir: 2, restS: 60 }];
      slot.progression = { type: 'chain' };
    });
    const { template } = effectiveProgram(snapshot, 3, [
      accepted('c1', 1, [{ op: 'replace_exercise', slot: 'A5', exercise: 'pallof-press' }]),
    ]);
    expect(slotOf(template, 'A5')).toMatchObject({
      exercises: ['pallof-press'],
      progression: { type: 'double' },
    });
  });

  it('replace_exercise sur un slot chain en durée sans progression duration : pas de 5 s', () => {
    const snapshot = gymAb((t) => {
      slotOf(t, 'A5').progression = { type: 'chain' };
    });
    const { template } = effectiveProgram(snapshot, 3, [
      accepted('c1', 1, [{ op: 'replace_exercise', slot: 'A5', exercise: 'pallof-press' }]),
    ]);
    expect(slotOf(template, 'A5').progression).toEqual({ type: 'duration', stepS: 5 });
  });

  it("change_sets : porte sur la dernière série de travail, jamais sur l'échauffement", () => {
    const up = run(['c1', 1, [{ op: 'change_sets', slot: 'A1', delta: 1 }]]);
    expect(slotOf(up.template, 'A1').sets).toEqual([
      { kind: 'warmup', count: 2, reps: { min: 5, max: 5 }, pctWorkLoad: 50 },
      { kind: 'work', count: 4, reps: { min: 6, max: 6 }, targetRir: 2, restS: 150 },
    ]);
    const down = run(['c1', 1, [{ op: 'change_sets', slot: 'A4', delta: -1 }]]);
    expect(slotOf(down.template, 'A4').sets).toEqual([
      { kind: 'work', count: 1, reps: { min: 10, max: 15 }, targetRir: 2, restS: 90 },
    ]);
  });

  it('change_sets −1 sur un groupe de travail à 1 série : le groupe disparaît, les autres restent', () => {
    const snapshot = gymAb((t) => {
      slotOf(t, 'A3').sets = [
        { kind: 'work', count: 2, reps: { min: 8, max: 12 }, targetRir: 2, restS: 120 },
        { kind: 'work', count: 1, reps: { min: 12, max: 15 }, targetRir: 2, restS: 120 },
      ];
    });
    const { template } = effectiveProgram(snapshot, 3, [
      accepted('c1', 1, [{ op: 'change_sets', slot: 'A3', delta: -1 }]),
    ]);
    expect(slotOf(template, 'A3').sets).toEqual([
      { kind: 'work', count: 2, reps: { min: 8, max: 12 }, targetRir: 2, restS: 120 },
    ]);
  });

  it('set_rep_range, set_target_rir, set_rest : séries de travail seulement', () => {
    const { template } = run([
      'c1',
      1,
      [
        { op: 'set_rep_range', slot: 'A1', min: 5, max: 8 },
        { op: 'set_target_rir', slot: 'A1', value: 3 },
        { op: 'set_rest', slot: 'A1', seconds: 180 },
      ],
    ]);
    expect(slotOf(template, 'A1').sets).toEqual([
      { kind: 'warmup', count: 2, reps: { min: 5, max: 5 }, pctWorkLoad: 50 },
      { kind: 'work', count: 3, reps: { min: 5, max: 8 }, targetRir: 3, restS: 180 },
    ]);
  });

  it('set_rep_range ne touche pas une série en durée', () => {
    const { template } = run(['c1', 1, [{ op: 'set_rep_range', slot: 'A5', min: 8, max: 12 }]]);
    expect(slotOf(template, 'A5').sets).toEqual(slotOf(GYM_AB, 'A5').sets);
  });

  it('remove_slot : le slot disparaît, et sa suspension avec lui', () => {
    const { template, suspended } = run(
      ['c1', 1, [{ op: 'suspend_slot', slot: 'A4' }]],
      ['c2', 2, [{ op: 'remove_slot', slot: 'A4' }]],
    );
    expect(template.workouts[0]?.slots.map((s) => s.id)).toEqual(['A1', 'A2', 'A3', 'A5']);
    expect([...suspended]).toEqual([]);
  });

  it('add_slot : slot « <séance>-<id du changement> » accessoire, double, 2 × 8–12, RIR 2, 90 s, en fin de séance', () => {
    const { template } = run([
      '0199f0a2-0000-7000-8000-000000000001',
      1,
      [{ op: 'add_slot', workout: 'A', movementPattern: 'calf_raise', exercises: ['calf-raise'] }],
    ]);
    const slots = template.workouts[0]?.slots ?? [];
    expect(slots.map((s) => s.id)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
      'A-0199f0a2-0000-7000-8000-000000000001',
    ]);
    expect(slots.at(-1)).toEqual({
      id: 'A-0199f0a2-0000-7000-8000-000000000001',
      movementPattern: 'calf_raise',
      role: 'accessory',
      exercises: ['calf-raise'],
      sets: [{ kind: 'work', count: 2, reps: { min: 8, max: 12 }, targetRir: 2, restS: 90 }],
      progression: { type: 'double' },
    });
  });

  it('set_days_per_week, suspend_slot, resume_slot', () => {
    const program = run(
      [
        'c1',
        1,
        [
          { op: 'set_days_per_week', days: 2 },
          { op: 'suspend_slot', slot: 'A1' },
        ],
      ],
      ['c2', 2, [{ op: 'suspend_slot', slot: 'B2' }]],
      ['c3', 3, [{ op: 'resume_slot', slot: 'A1' }]],
    );
    expect(program.daysPerWeek).toBe(2);
    expect([...program.suspended]).toEqual(['B2']);
  });

  it('lighten_exercise, start_deload et switch_template sont laissés au rejeu', () => {
    const program = run([
      'c1',
      1,
      [
        { op: 'lighten_exercise', slot: 'A1' },
        { op: 'start_deload' },
        { op: 'switch_template', templateId: 'gym-intermediate-upper-lower' },
      ],
    ]);
    expect(program).toEqual(effectiveProgram(GYM_AB, 3, []));
  });

  it("ordre : decidedAt, puis id en ordre binaire, quel que soit l'ordre reçu", () => {
    const changes = [
      accepted('b', 2, [{ op: 'set_rest', slot: 'A1', seconds: 200 }]),
      accepted('c', 1, [{ op: 'set_rest', slot: 'A1', seconds: 100 }]),
      accepted('a', 2, [{ op: 'set_rest', slot: 'A1', seconds: 300 }]),
    ];
    const rest = (p: ReturnType<typeof effectiveProgram>) => slotOf(p.template, 'A1').sets[1]?.restS;
    // c (1), puis a (2, « a » < « b »), puis b : la dernière écriture vaut 200.
    expect(rest(effectiveProgram(GYM_AB, 3, changes))).toBe(200);
    expect(rest(effectiveProgram(GYM_AB, 3, [...changes].reverse()))).toBe(200);
  });

  it('opération sur un slot ou une séance absents : ignorée', () => {
    const program = run([
      'c1',
      1,
      [
        { op: 'change_sets', slot: 'Z9', delta: 1 },
        { op: 'remove_slot', slot: 'Z9' },
        { op: 'add_slot', workout: 'Z', movementPattern: 'calf_raise', exercises: ['calf-raise'] },
        { op: 'replace_exercise', slot: 'Z9', exercise: 'push-up' },
      ],
    ]);
    expect(program).toEqual(effectiveProgram(GYM_AB, 3, []));
  });
});
