import { describe, expect, it } from 'vitest';
import {
  CatalogBundle,
  CHANGE_ERROR_CODES,
  CHANGE_REASON_CODES,
  CreateChangeRequest,
  EnrollRequest,
  InstanceChangeOperationSchema,
  MAX_CHANGE_OPERATIONS,
  MachineStepRequest,
  PAIN_CODE_REWRITES,
  ProgramTemplateSchema,
  REASON_CODES,
  REASON_TEXTS,
  ServedProgramTemplateSchema,
  SetSpecSchema,
} from '../src/index';

const template = {
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
          sets: [
            { kind: 'warmup', count: 2, reps: { min: 5, max: 5 }, pctWorkLoad: 50 },
            { kind: 'work', count: 3, reps: { min: 6, max: 6 }, targetRir: 2, restS: 150 },
          ],
          progression: { type: 'linear', incrementG: 5000 },
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
  ],
};

describe('ProgramTemplateSchema', () => {
  it("accepte l'extrait de 05 §4", () => {
    expect(ProgramTemplateSchema.safeParse(template).success).toBe(true);
  });

  it('accepte un bloc planifié', () => {
    const t = { ...template, block: { mode: 'planned', weeks: 5, deloadWeek: 5 } };
    expect(ProgramTemplateSchema.safeParse(t).success).toBe(true);
  });

  it('refuse un champ inconnu', () => {
    expect(ProgramTemplateSchema.safeParse({ ...template, extra: 1 }).success).toBe(false);
  });

  it('refuse un slot sans exercises ni chain, ou avec les deux', () => {
    const workout = template.workouts[0] as (typeof template.workouts)[number];
    const slot = workout.slots[0] as (typeof workout.slots)[number];
    const { exercises: _e, ...noExercises } = slot;
    const bad = (s: object) => ({ ...template, workouts: [{ ...workout, slots: [s] }] });
    expect(ProgramTemplateSchema.safeParse(bad(noExercises)).success).toBe(false);
    expect(ProgramTemplateSchema.safeParse(bad({ ...slot, chain: 'front-plank' })).success).toBe(false);
  });

  it('refuse une version de schéma inconnue', () => {
    expect(ProgramTemplateSchema.safeParse({ ...template, schemaVersion: 2 }).success).toBe(false);
  });
});

describe('SetSpecSchema', () => {
  it('refuse reps et durationS ensemble, ou aucun des deux', () => {
    const both = { kind: 'work', count: 3, reps: { min: 5, max: 8 }, durationS: { min: 20, max: 60 } };
    expect(SetSpecSchema.safeParse(both).success).toBe(false);
    expect(SetSpecSchema.safeParse({ kind: 'work', count: 3 }).success).toBe(false);
  });

  it('refuse targetRir 0 et accepte 1 à 5', () => {
    const base = { kind: 'work', count: 3, reps: { min: 5, max: 8 } };
    expect(SetSpecSchema.safeParse({ ...base, targetRir: 0 }).success).toBe(false);
    expect(SetSpecSchema.safeParse({ ...base, targetRir: 6 }).success).toBe(false);
    expect(SetSpecSchema.safeParse({ ...base, targetRir: 5 }).success).toBe(true);
  });

  it('refuse un nombre de séries hors 1 à 5', () => {
    const base = { kind: 'work', reps: { min: 5, max: 8 } };
    expect(SetSpecSchema.safeParse({ ...base, count: 0 }).success).toBe(false);
    expect(SetSpecSchema.safeParse({ ...base, count: 6 }).success).toBe(false);
  });
});

describe('ServedProgramTemplateSchema', () => {
  it('porte le modèle et sa disponibilité', () => {
    expect(ServedProgramTemplateSchema.safeParse({ template, available: false }).success).toBe(true);
    expect(ServedProgramTemplateSchema.safeParse({ template }).success).toBe(false);
  });

  it('CatalogBundle.programTemplates : une liste de modèles servis, plus de modèles bruts', () => {
    const empty = { version: 'v', exercises: [], illustrations: [], programTemplates: [], adviceSheets: [] };
    const served = { ...empty, programTemplates: [{ template, available: true }] };
    expect(CatalogBundle.safeParse(served).success).toBe(true);
    expect(CatalogBundle.safeParse({ ...empty, programTemplates: [template] }).success).toBe(false);
    expect(CatalogBundle.safeParse({ ...empty, programTemplates: [{ id: 'full-body' }] }).success).toBe(
      false,
    );
  });
});

describe('InstanceChangeOperationSchema', () => {
  it("refuse lighten_exercise porteur d'un pourcentage", () => {
    expect(
      InstanceChangeOperationSchema.safeParse({ op: 'lighten_exercise', slot: 'A1', pct: 10 }).success,
    ).toBe(false);
    expect(InstanceChangeOperationSchema.safeParse({ op: 'lighten_exercise', slot: 'A1' }).success).toBe(
      true,
    );
  });

  it('accepte switch_template sans jours', () => {
    expect(InstanceChangeOperationSchema.safeParse({ op: 'switch_template', templateId: 'x' }).success).toBe(
      true,
    );
    expect(
      InstanceChangeOperationSchema.safeParse({ op: 'switch_template', templateId: 'x', daysPerWeek: 3 })
        .success,
    ).toBe(true);
  });

  it('accepte start_deload sans paramètre et refuse un delta de 2', () => {
    expect(InstanceChangeOperationSchema.safeParse({ op: 'start_deload' }).success).toBe(true);
    expect(InstanceChangeOperationSchema.safeParse({ op: 'change_sets', slot: 'A1', delta: 2 }).success).toBe(
      false,
    );
  });

  it('exige au moins un exercice pour add_slot', () => {
    const op = { op: 'add_slot', workout: 'A', movementPattern: 'elbow_flexion' };
    expect(InstanceChangeOperationSchema.safeParse({ ...op, exercises: [] }).success).toBe(false);
    expect(InstanceChangeOperationSchema.safeParse({ ...op, exercises: ['curl'] }).success).toBe(true);
  });

  it('refuse une opération inconnue', () => {
    expect(InstanceChangeOperationSchema.safeParse({ op: 'reduce_load', slot: 'A1' }).success).toBe(false);
  });
});

describe("requêtes de l'API", () => {
  const op = { op: 'start_deload' };

  it('refuse 6 opérations et 0 opération', () => {
    expect(MAX_CHANGE_OPERATIONS).toBe(5);
    const ok = { baseRevision: 0, operations: Array(5).fill(op) };
    expect(CreateChangeRequest.safeParse(ok).success).toBe(true);
    expect(CreateChangeRequest.safeParse({ ...ok, operations: Array(6).fill(op) }).success).toBe(false);
    expect(CreateChangeRequest.safeParse({ ...ok, operations: [] }).success).toBe(false);
    expect(CreateChangeRequest.safeParse({ ...ok, baseRevision: -1 }).success).toBe(false);
  });

  it("borne les jours de l'inscription à 2 à 4", () => {
    expect(EnrollRequest.safeParse({ templateId: 'x', daysPerWeek: 4 }).success).toBe(true);
    expect(EnrollRequest.safeParse({ templateId: 'x', daysPerWeek: 5 }).success).toBe(false);
  });

  it('borne le pas de machine à 500 à 10 000 g ou nul', () => {
    expect(MachineStepRequest.safeParse({ stepG: null }).success).toBe(true);
    expect(MachineStepRequest.safeParse({ stepG: 500 }).success).toBe(true);
    expect(MachineStepRequest.safeParse({ stepG: 499 }).success).toBe(false);
    expect(MachineStepRequest.safeParse({ stepG: 10001 }).success).toBe(false);
    expect(MachineStepRequest.safeParse({ stepG: 1250.5 }).success).toBe(false);
  });

  it("liste 18 codes d'erreur de changement", () => {
    expect(CHANGE_ERROR_CODES).toHaveLength(18);
  });
});

describe('codes raison', () => {
  it("donne à chaque code un texte non vide, droit, sans l'ancien nom de code", () => {
    for (const code of [...REASON_CODES, ...CHANGE_REASON_CODES]) {
      const text = REASON_TEXTS[code];
      expect(text.length, code).toBeGreaterThan(0);
      expect(text.toLowerCase(), code).not.toContain(['app', 'sport'].join(''));
      expect(text, code).not.toContain('’');
    }
    expect(Object.keys(REASON_TEXTS)).toHaveLength(REASON_CODES.length + CHANGE_REASON_CODES.length);
  });

  it('donne à chaque code une seule phrase, sans chiffre', () => {
    for (const code of [...REASON_CODES, ...CHANGE_REASON_CODES]) {
      const text = REASON_TEXTS[code];
      expect(text, code).toMatch(/^[^.!?]+\.$/);
      expect(text, code).not.toMatch(/\d/);
    }
  });

  it("dit ce que le moteur fait, sans parler de charge là où il n'y en a pas", () => {
    expect(REASON_TEXTS.REPS_MAX_REACHED).not.toMatch(/monte/);
    expect(REASON_TEXTS.REPS_UP).not.toMatch(/marge/);
    for (const code of ['CALIBRATION_DONE', 'NO_PROGRESS', 'EFFORT_MISSING', 'STALL_RESET_MIN'] as const) {
      expect(REASON_TEXTS[code], code).not.toMatch(/charge/);
    }
    expect(REASON_TEXTS.STALL_RESET_MIN).toMatch(/durée/);
  });

  it('réécrit des codes connus vers des codes connus', () => {
    const all: readonly string[] = [...REASON_CODES, ...CHANGE_REASON_CODES];
    for (const [from, to] of Object.entries(PAIN_CODE_REWRITES)) {
      expect(all).toContain(from);
      expect(all).toContain(to);
    }
  });
});
