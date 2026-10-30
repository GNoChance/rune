import { describe, expect, it } from 'vitest';
import {
  BatchSchema,
  COMMENT_PARTS,
  CONTENT_EXCLUDED_KEYS,
  DraftSheetSchema,
  EXERCISE_STATUSES,
  type ExerciseSheet,
  ExerciseSheetSchema,
  exerciseJsonSchema,
  PUBLISH_BLOCKERS,
} from '../src/exercise';

/** Fiche publiée valide : un squat goblet plausible, aux bornes de 04 §4. */
function sheet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: ExerciseSheet = {
    id: 'goblet-squat',
    schema_version: 1,
    revision: 4,
    status: 'published',
    batch: 'A',
    name: 'Squat goblet',
    aliases: ['Goblet squat', 'Squat avec haltère'],
    movement_pattern: 'squat',
    mechanics: 'compound',
    unilateral: false,
    measure: 'reps',
    load_mode: 'dumbbell',
    primary_muscles: ['quadriceps', 'glutes'],
    secondary_muscles: ['adductors', 'abs'],
    equipment_options: [['dumbbells'], ['kettlebell']],
    level: 1,
    not_for_minors: false,
    stressed_joints: ['knees', 'hips'],
    instructions: [
      'Tiens un haltère à la verticale contre ta poitrine, les mains sous le disque du haut.',
      "Écarte les pieds un peu plus que la largeur des hanches, pointes légèrement vers l'extérieur.",
      "Descends en poussant les hanches en arrière et les genoux vers l'extérieur, le buste droit.",
      "Arrête-toi quand tes cuisses sont parallèles au sol, ou plus haut si ton dos s'arrondit.",
      "Remonte en poussant dans tout le pied jusqu'à te tenir droit.",
    ],
    key_points: [
      'Garde les talons au sol pendant toute la descente.',
      'Tes genoux suivent la direction de tes orteils.',
      "Garde l'haltère collé à ta poitrine.",
    ],
    mistakes: [
      {
        mistake: "Les genoux rentrent vers l'intérieur en remontant.",
        fix: "Pousse les genoux vers l'extérieur, dans l'axe des pieds.",
      },
      {
        mistake: 'Les talons décollent en bas du mouvement.',
        fix: 'Descends moins bas et répartis ton poids sur tout le pied.',
      },
    ],
    safety: [
      'Arrête la série si tu ressens une douleur vive au genou ou dans le bas du dos.',
      "Pose l'haltère au sol en pliant les jambes, jamais le dos rond.",
    ],
    breathing: 'Inspire en descendant, souffle en remontant.',
    easier_tip: "Tiens-toi à un support devant toi pour garder l'équilibre.",
    harder_tip: 'Marque une pause de deux secondes en bas avant de remonter.',
    illustrations: [
      { illustration_id: 'goblet-squat-start', role: 'start' },
      { illustration_id: 'goblet-squat-end', role: 'end' },
    ],
    review_notes: 'Profondeur à confirmer pour les débutants raides des chevilles.',
    drafting: {
      origin: 'ai',
      model: 'claude-opus-5-5',
      prompt_version: 1,
      generated_at: '2026-10-20T09:00:00.000Z',
    },
    reviewed_by: '0199f0a2-7c1e-7d3a-9b4e-2f6a1c8d5e70',
    reviewed_at: '2026-10-21T18:30:00.000Z',
    published_at: '2026-10-22T08:00:00.000Z',
    updated_at: '2026-10-22T08:00:00.000Z',
  };
  return { ...base, ...overrides };
}

/** Squelette d'un brouillon (04 §8 étape 1) : seulement les champs « squelette » et système. */
function skeleton(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'goblet-squat',
    schema_version: 1,
    revision: 1,
    status: 'draft',
    batch: 'A',
    name: 'Squat goblet',
    movement_pattern: 'squat',
    mechanics: 'compound',
    unilateral: false,
    measure: 'reps',
    load_mode: 'dumbbell',
    equipment_options: [['dumbbells'], ['kettlebell']],
    level: 1,
    not_for_minors: false,
    ...overrides,
  };
}

const valid = (v: unknown) => ExerciseSheetSchema.safeParse(v).success;

describe('ExerciseSheetSchema', () => {
  it('accepte la fiche publiée de référence sans la transformer', () => {
    const s = sheet();
    expect(ExerciseSheetSchema.parse(s)).toEqual(s);
  });

  it("suit l'ordre des clés de 04 §4, batch après status", () => {
    expect(Object.keys(ExerciseSheetSchema.shape)).toEqual([
      'id',
      'schema_version',
      'revision',
      'status',
      'batch',
      'name',
      'aliases',
      'movement_pattern',
      'mechanics',
      'unilateral',
      'measure',
      'load_mode',
      'primary_muscles',
      'secondary_muscles',
      'equipment_options',
      'level',
      'not_for_minors',
      'stressed_joints',
      'instructions',
      'key_points',
      'mistakes',
      'safety',
      'breathing',
      'setup',
      'chain_id',
      'easier_id',
      'harder_id',
      'easier_tip',
      'harder_tip',
      'illustrations',
      'review_notes',
      'drafting',
      'reviewed_by',
      'reviewed_at',
      'published_at',
      'retired_at',
      'updated_at',
    ]);
  });

  it('refuse une entrée de sécurité de 121 caractères', () => {
    expect(valid(sheet({ safety: ['x'.repeat(121)] }))).toBe(false);
    expect(valid(sheet({ safety: ['x'.repeat(120)] }))).toBe(true);
  });

  it('accepte une fiche complète à tout statut, brouillon compris', () => {
    for (const status of EXERCISE_STATUSES) expect(valid(sheet({ status }))).toBe(true);
    expect(valid(sheet({ status: 'archived' }))).toBe(false);
  });

  it('borne id, nom et alias', () => {
    expect(valid(sheet({ id: 'a'.repeat(60) }))).toBe(true);
    expect(valid(sheet({ id: 'a'.repeat(61) }))).toBe(false);
    for (const id of [
      'Goblet-squat',
      'goblet_squat',
      'goblet--squat',
      '-goblet',
      'goblet-',
      'squat goblet',
      '',
    ]) {
      expect(valid(sheet({ id }))).toBe(false);
    }
    expect(valid(sheet({ name: 'x'.repeat(61) }))).toBe(false);
    expect(valid(sheet({ name: '' }))).toBe(false);
    expect(valid(sheet({ aliases: [] }))).toBe(true);
    expect(valid(sheet({ aliases: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }))).toBe(false);
    expect(valid(sheet({ aliases: [''] }))).toBe(false);
  });

  it('refuse les champs système hors bornes et toute clé inconnue', () => {
    expect(valid(sheet({ schema_version: 2 }))).toBe(false);
    expect(valid(sheet({ revision: 0 }))).toBe(false);
    expect(valid(sheet({ revision: 1.5 }))).toBe(false);
    expect(valid(sheet({ chain_rank: 1 }))).toBe(false);
    expect(valid(sheet({ exported_revision: 4 }))).toBe(false);
    expect(valid(sheet({ updated_at: '2026-10-22' }))).toBe(false);
  });

  it('refuse un code hors taxonomie', () => {
    expect(valid(sheet({ movement_pattern: 'deadlift' }))).toBe(false);
    expect(valid(sheet({ mechanics: 'mixed' }))).toBe(false);
    expect(valid(sheet({ measure: 'distance' }))).toBe(false);
    expect(valid(sheet({ load_mode: 'kettlebell' }))).toBe(false);
    expect(valid(sheet({ primary_muscles: ['delts'] }))).toBe(false);
    expect(valid(sheet({ stressed_joints: ['spine'] }))).toBe(false);
    expect(valid(sheet({ equipment_options: [['cardio']] }))).toBe(false);
    expect(valid(sheet({ level: 4 }))).toBe(false);
    expect(valid(sheet({ level: 0 }))).toBe(false);
  });

  it('borne les muscles : 1 à 3 principaux, 0 à 4 secondaires disjoints, sans doublon', () => {
    expect(valid(sheet({ primary_muscles: [] }))).toBe(false);
    expect(
      valid(sheet({ primary_muscles: ['quadriceps', 'glutes', 'adductors'], secondary_muscles: [] })),
    ).toBe(true);
    expect(valid(sheet({ primary_muscles: ['quadriceps', 'glutes', 'adductors', 'calves'] }))).toBe(false);
    expect(valid(sheet({ secondary_muscles: [] }))).toBe(true);
    expect(
      valid(sheet({ secondary_muscles: ['adductors', 'abs', 'obliques', 'lower_back', 'calves'] })),
    ).toBe(false);
    expect(valid(sheet({ secondary_muscles: ['glutes', 'abs'] }))).toBe(false);
    expect(valid(sheet({ primary_muscles: ['quadriceps', 'quadriceps'] }))).toBe(false);
  });

  it('borne le matériel : 1 à 4 options de 0 à 3 codes, sans doublon ni inclusion', () => {
    expect(valid(sheet({ equipment_options: [[]] }))).toBe(true);
    expect(valid(sheet({ equipment_options: [] }))).toBe(false);
    expect(
      valid(
        sheet({
          equipment_options: [['dumbbells'], ['kettlebell'], ['barbell'], ['cable_station'], ['box']],
        }),
      ),
    ).toBe(false);
    expect(valid(sheet({ equipment_options: [['dumbbells', 'flat_bench', 'squat_rack']] }))).toBe(true);
    expect(valid(sheet({ equipment_options: [['dumbbells', 'flat_bench', 'squat_rack', 'box']] }))).toBe(
      false,
    );
    expect(valid(sheet({ equipment_options: [['dumbbells', 'dumbbells']] }))).toBe(false);
    expect(valid(sheet({ equipment_options: [['dumbbells'], ['dumbbells']] }))).toBe(false);
    expect(
      valid(
        sheet({
          equipment_options: [
            ['flat_bench', 'dumbbells'],
            ['dumbbells', 'flat_bench'],
          ],
        }),
      ),
    ).toBe(false);
    expect(valid(sheet({ equipment_options: [['dumbbells'], ['dumbbells', 'flat_bench']] }))).toBe(false);
    expect(valid(sheet({ equipment_options: [[], ['dumbbells']] }))).toBe(false);
  });

  it('borne les articulations sollicitées : 0 à 3, sans doublon', () => {
    expect(valid(sheet({ stressed_joints: [] }))).toBe(true);
    expect(valid(sheet({ stressed_joints: ['knees', 'hips', 'ankles'] }))).toBe(true);
    expect(valid(sheet({ stressed_joints: ['knees', 'hips', 'ankles', 'lower_back'] }))).toBe(false);
    expect(valid(sheet({ stressed_joints: ['knees', 'knees'] }))).toBe(false);
  });

  it('borne les textes rédigés', () => {
    const steps = (n: number, len = 20) => Array.from({ length: n }, () => 'x'.repeat(len));
    expect(valid(sheet({ instructions: steps(2) }))).toBe(false);
    expect(valid(sheet({ instructions: steps(3, 160) }))).toBe(true);
    expect(valid(sheet({ instructions: steps(7) }))).toBe(true);
    expect(valid(sheet({ instructions: steps(8) }))).toBe(false);
    expect(valid(sheet({ instructions: [...steps(2), 'x'.repeat(161)] }))).toBe(false);
    expect(valid(sheet({ key_points: steps(1) }))).toBe(false);
    expect(valid(sheet({ key_points: steps(4, 120) }))).toBe(true);
    expect(valid(sheet({ key_points: steps(5) }))).toBe(false);
    expect(valid(sheet({ key_points: [...steps(1), 'x'.repeat(121)] }))).toBe(false);
    const mistake = { mistake: 'Erreur.', fix: 'Correction.' };
    expect(valid(sheet({ mistakes: [mistake] }))).toBe(false);
    expect(valid(sheet({ mistakes: [mistake, mistake, mistake, mistake] }))).toBe(true);
    expect(valid(sheet({ mistakes: [mistake, mistake, mistake, mistake, mistake] }))).toBe(false);
    expect(valid(sheet({ mistakes: [mistake, { mistake: 'x'.repeat(161), fix: 'Correction.' }] }))).toBe(
      false,
    );
    expect(valid(sheet({ mistakes: [mistake, { mistake: 'Erreur.' }] }))).toBe(false);
    expect(valid(sheet({ safety: [] }))).toBe(false);
    expect(valid(sheet({ safety: steps(3) }))).toBe(true);
    expect(valid(sheet({ safety: steps(4) }))).toBe(false);
    expect(valid(sheet({ breathing: 'x'.repeat(161) }))).toBe(false);
    expect(valid(sheet({ setup: 'x'.repeat(240) }))).toBe(true);
    expect(valid(sheet({ setup: 'x'.repeat(241) }))).toBe(false);
    expect(valid(sheet({ easier_tip: 'x'.repeat(161) }))).toBe(false);
    expect(valid(sheet({ harder_tip: 'x'.repeat(161) }))).toBe(false);
  });

  it('borne la chaîne et les illustrations', () => {
    expect(
      valid(sheet({ chain_id: 'squat', easier_id: 'chair-squat', harder_id: 'bulgarian-split-squat' })),
    ).toBe(true);
    expect(valid(sheet({ chain_id: 'Squat' }))).toBe(false);
    expect(valid(sheet({ easier_id: 'chair squat' }))).toBe(false);
    expect(valid(sheet({ chain_id: null }))).toBe(false);
    expect(valid(sheet({ illustrations: [] }))).toBe(true);
    const ill = (illustration_id: string, role: string) => ({ illustration_id, role });
    expect(valid(sheet({ illustrations: [ill('a', 'start'), ill('b', 'mid'), ill('c', 'end')] }))).toBe(true);
    expect(
      valid(sheet({ illustrations: [ill('a', 'start'), ill('b', 'mid'), ill('c', 'end'), ill('d', 'end')] })),
    ).toBe(false);
    expect(valid(sheet({ illustrations: [ill('a', 'start'), ill('b', 'start')] }))).toBe(false);
    expect(valid(sheet({ illustrations: [ill('a', 'start'), ill('a', 'end')] }))).toBe(false);
    expect(valid(sheet({ illustrations: [ill('a', 'side')] }))).toBe(false);
    expect(valid(sheet({ illustrations: [ill('../a', 'start')] }))).toBe(false);
  });

  it('exige le modèle et la version du prompt pour un brouillon rédigé par IA', () => {
    expect(valid(sheet({ drafting: { origin: 'human', generated_at: '2026-10-20T09:00:00.000Z' } }))).toBe(
      true,
    );
    expect(valid(sheet({ drafting: { origin: 'ai', generated_at: '2026-10-20T09:00:00.000Z' } }))).toBe(
      false,
    );
    expect(
      valid(
        sheet({
          drafting: { origin: 'ai', model: 'claude-opus-5-5', generated_at: '2026-10-20T09:00:00.000Z' },
        }),
      ),
    ).toBe(false);
  });
});

describe('BatchSchema', () => {
  it('accepte A, B, E1, E99 et refuse E0, E100, C', () => {
    for (const b of ['A', 'B', 'E1', 'E9', 'E10', 'E99']) expect(BatchSchema.safeParse(b).success).toBe(true);
    for (const b of ['E0', 'E01', 'E100', 'C', 'a', 'E', 'AB', ' A', '']) {
      expect(BatchSchema.safeParse(b).success).toBe(false);
    }
  });

  it('rend batch obligatoire dans la fiche', () => {
    const { batch: _, ...rest } = sheet();
    expect(valid(rest)).toBe(false);
    expect(valid(sheet({ batch: 'E100' }))).toBe(false);
  });
});

describe('DraftSheetSchema (R-FIC-1)', () => {
  it('accepte un squelette de brouillon, que le schéma complet refuse', () => {
    expect(DraftSheetSchema.safeParse(skeleton()).success).toBe(true);
    expect(valid(skeleton())).toBe(false);
  });

  it('accepte un squelette retiré, refuse un squelette relu ou publié', () => {
    expect(DraftSheetSchema.safeParse(skeleton({ status: 'retired' })).success).toBe(true);
    expect(DraftSheetSchema.safeParse(skeleton({ status: 'reviewed' })).success).toBe(false);
    expect(DraftSheetSchema.safeParse(skeleton({ status: 'published' })).success).toBe(false);
  });

  it('accepte une fiche complète et garde les bornes des champs présents', () => {
    expect(DraftSheetSchema.safeParse(sheet()).success).toBe(true);
    expect(DraftSheetSchema.safeParse(skeleton({ safety: ['x'.repeat(121)] })).success).toBe(false);
    expect(
      DraftSheetSchema.safeParse(skeleton({ primary_muscles: ['glutes'], secondary_muscles: ['glutes'] }))
        .success,
    ).toBe(false);
    expect(DraftSheetSchema.safeParse(skeleton({ equipment_options: [[], ['dumbbells']] })).success).toBe(
      false,
    );
  });

  it('garde les champs squelette obligatoires', () => {
    const { batch: _, ...noBatch } = skeleton();
    expect(DraftSheetSchema.safeParse(noBatch).success).toBe(false);
    const { level: __, ...noLevel } = skeleton();
    expect(DraftSheetSchema.safeParse(noLevel).success).toBe(false);
  });
});

describe('constantes de la relecture', () => {
  it('fige les statuts', () => {
    expect(EXERCISE_STATUSES).toEqual(['draft', 'reviewed', 'published', 'retired']);
  });

  it('exclut du contenu les champs système et éditoriaux (spec §3.2)', () => {
    expect(CONTENT_EXCLUDED_KEYS).toEqual([
      'schema_version',
      'revision',
      'status',
      'review_notes',
      'drafting',
      'reviewed_by',
      'reviewed_at',
      'published_at',
      'retired_at',
      'updated_at',
      'exported_revision',
      'batch',
    ]);
  });

  it('fige les 15 parts commentables (spec §3.3)', () => {
    expect(COMMENT_PARTS).toEqual([
      'general',
      'name',
      'muscles',
      'equipment',
      'level',
      'not_for_minors',
      'stressed_joints',
      'instructions',
      'key_points',
      'mistakes',
      'safety',
      'breathing',
      'setup',
      'variants',
      'illustrations',
    ]);
  });

  it("PUBLISH_BLOCKERS suit l'ordre de la spec", () => {
    expect(PUBLISH_BLOCKERS[0]).toBe('incomplete');
    expect(PUBLISH_BLOCKERS).toEqual([
      'incomplete',
      'invalid_sheet',
      'review_unchecked',
      'minors_unconfirmed',
      'open_comments',
      'health_validation_missing',
      'illustrations_missing',
      'referenced_by_template',
      'chain_break',
      'catalog_full',
    ]);
  });
});

describe('exerciseJsonSchema', () => {
  it('dérive le JSON Schema de la fiche, clés dans le même ordre et sans clé libre', () => {
    const schema = exerciseJsonSchema() as {
      type: string;
      additionalProperties: boolean;
      properties: Record<string, { items?: { maxLength?: number }; pattern?: string }>;
      required: string[];
    };
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toEqual(Object.keys(ExerciseSheetSchema.shape));
    expect(schema.required).toContain('batch');
    expect(schema.required).toContain('safety');
    expect(schema.required).not.toContain('setup');
    expect(schema.properties.safety?.items?.maxLength).toBe(120);
    expect(schema.properties.batch?.pattern).toBe('^(A|B|E([1-9][0-9]?))$');
  });
});
