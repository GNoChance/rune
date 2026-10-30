import { type ExerciseSheet, ExerciseSheetSchema } from '@rune/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/catalog/canonical';
import { arbSheet, sheet } from '../fixtures/catalog';

/** Ordre des champs de 04 §4, `batch` juste après `status` (spec brique 2 §2) : recopié de la spec, pas du code. */
const SPEC_ORDER = [
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
];

/** Fiche où chaque champ facultatif est présent. */
const FULL: ExerciseSheet = sheet({
  status: 'retired',
  setup: 'Règle la hauteur du banc pour que tes cuisses soient parallèles au sol.',
  chain_id: 'squat',
  easier_id: 'box-squat',
  harder_id: 'front-squat',
  harder_tip: 'Marque une pause de deux secondes en bas.',
  reviewed_by: '0199f0a2-7c1e-7d3a-9b4e-2f6a1c8d5e70',
  reviewed_at: '2026-10-21T18:30:00.000Z',
  retired_at: '2026-10-25T08:00:00.000Z',
  updated_at: '2026-10-25T08:00:00.000Z',
});

/** Reconstruit `value` en réordonnant les clés de chaque objet selon `order`. */
function reorder(value: unknown, order: (keys: string[]) => string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => reorder(item, order));
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(order(Object.keys(record)).map((k) => [k, reorder(record[k], order)]));
}

describe('canonicalJson (04 §10)', () => {
  it("toutes les clés de 04 §4 dans l'ordre de la spec", () => {
    expect(Object.keys(JSON.parse(canonicalJson(FULL)))).toEqual(SPEC_ORDER);
    expect(Object.keys(ExerciseSheetSchema.shape)).toEqual(SPEC_ORDER);
  });

  it("ordre de la spec même si l'objet arrive clés inversées", () => {
    const reversed = reorder(FULL, (keys) => [...keys].reverse()) as ExerciseSheet;
    expect(Object.keys(reversed)[0]).toBe('updated_at');
    expect(canonicalJson(reversed)).toBe(canonicalJson(FULL));
  });

  it("objets imbriqués dans l'ordre du schéma", () => {
    const parsed = JSON.parse(canonicalJson(reorder(FULL, (keys) => [...keys].reverse()) as ExerciseSheet));
    expect(Object.keys(parsed.mistakes[0])).toEqual(['mistake', 'fix']);
    expect(Object.keys(parsed.illustrations[0])).toEqual(['illustration_id', 'role']);
    expect(Object.keys(parsed.drafting)).toEqual(['origin', 'model', 'prompt_version', 'generated_at']);
  });

  it('indentation de 2 espaces, LF seulement, LF final', () => {
    const text = canonicalJson(sheet());
    expect(
      text.startsWith(
        '{\n  "id": "goblet-squat",\n  "schema_version": 1,\n  "revision": 4,\n  "status": "published",\n  "batch": "A",\n',
      ),
    ).toBe(true);
    expect(text).toContain(
      '  "mistakes": [\n    {\n      "mistake": "Les genoux rentrent vers l\'intérieur en remontant.",\n      "fix": ',
    );
    expect(text).toContain(
      '  "equipment_options": [\n    [\n      "dumbbells"\n    ],\n    [\n      "kettlebell"\n    ]\n  ],\n',
    );
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).not.toContain('\r');
  });

  it('[[]] et listes vides restent sur une ligne', () => {
    const text = canonicalJson(sheet({ equipment_options: [[]], aliases: [] }));
    expect(text).toContain('  "aliases": [],\n');
    expect(text).toContain('  "equipment_options": [\n    []\n  ],\n');
  });

  it('caractères non ASCII écrits tels quels (UTF-8), sans échappement', () => {
    const text = canonicalJson(sheet());
    expect(text).toContain('"Écarte les pieds');
    expect(text).not.toContain('\\u');
  });

  it("facultatif = clé absente : une valeur undefined n'est pas écrite", () => {
    const text = canonicalJson({ ...sheet(), setup: undefined, chain_id: undefined });
    expect(text).not.toContain('"setup"');
    expect(text).not.toContain('"chain_id"');
    expect(text).toBe(canonicalJson(sheet()));
  });

  it('aller-retour JSON.parse : texte identique et fiche toujours valide', () => {
    const text = canonicalJson(FULL);
    const parsed = JSON.parse(text);
    expect(canonicalJson(parsed)).toBe(text);
    expect(ExerciseSheetSchema.parse(parsed)).toEqual(FULL);
  });

  it('contenu partiel (sans les champs système) : ordre de la spec, clés absentes sautées', () => {
    const { status: _s, batch: _b, revision: _r, ...content } = FULL;
    expect(Object.keys(JSON.parse(canonicalJson(content)))).toEqual(
      SPEC_ORDER.filter((k) => !['status', 'batch', 'revision'].includes(k)),
    );
  });

  it('clé hors 04 §4 : gardée, après les autres, en ordre binaire', () => {
    const text = canonicalJson({ ...sheet(), zeta: 1, Alpha: 2, exported_revision: 3 });
    expect(Object.keys(JSON.parse(text)).slice(-3)).toEqual(['Alpha', 'exported_revision', 'zeta']);
  });

  it("propriété : stable quel que soit l'ordre des clés, à tous les niveaux", () => {
    fc.assert(
      fc.property(arbSheet, fc.func(fc.integer()), (s, rank) => {
        const shuffled = reorder(s, (keys) =>
          [...keys].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)),
        ) as ExerciseSheet;
        expect(canonicalJson(shuffled)).toBe(canonicalJson(s));
      }),
    );
  });

  it('propriété : identique après aller-retour JSON.parse', () => {
    fc.assert(
      fc.property(arbSheet, (s) => {
        const text = canonicalJson(s);
        expect(canonicalJson(JSON.parse(text))).toBe(text);
      }),
    );
  });
});
