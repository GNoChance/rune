import {
  CATALOG_MAX_SHEETS,
  type DraftSheet,
  type ExerciseSheet,
  type IllustrationEntry,
} from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/catalog/canonical';
import {
  type CatalogInput,
  type CatalogValidation,
  EXERCISES_DIR,
  MANIFEST_FILE,
  validateCatalog,
} from '../../src/catalog/validate';
import { linkChain, PUSH_UP_CHAIN, sheet, without } from '../fixtures/catalog';

const HASH8 = '0a1b2c3d';
const SHA = `${HASH8}${'e'.repeat(56)}`;

/** Entrée de manifeste valide pour l'illustration `id`. */
function illustration(id: string, overrides: Partial<IllustrationEntry> = {}): IllustrationEntry {
  return {
    id,
    file: `${id}.${HASH8}.svg`,
    sha256: SHA,
    bytes: 2048,
    media_type: 'image/svg+xml',
    source: 'everkinetic',
    source_url: `https://github.com/everkinetic/data/blob/0123abc/svg/${id}.svg`,
    creators: ['Greg Priday'],
    license: 'CC-BY-SA-4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    replace_before_public: false,
    ...overrides,
  };
}

/** Manifeste des deux illustrations de la fiche de référence (squat goblet). */
const MANIFEST = [illustration('goblet-squat-start'), illustration('goblet-squat-end')];

type Json = Readonly<Record<string, unknown>>;

/** Fichier `exercises/<id>.json` de la fiche, en forme canonique. */
const fileOf = (s: Json) => ({
  file: `${EXERCISES_DIR}/${String(s.id)}.json`,
  json: s,
  text: canonicalJson(s),
});

function run(
  sheets: readonly Json[],
  overrides: Partial<CatalogInput> = {},
  options: { strict?: boolean } = {},
): CatalogValidation {
  return validateCatalog(
    { sheets: sheets.map(fileOf), manifest: MANIFEST, templates: [], ...overrides },
    options,
  );
}

/** Codes d'erreur distincts, triés. */
const codes = (result: CatalogValidation) => [...new Set(result.errors.map((e) => e.code))].sort();

/** Catalogue valide : le squat goblet et la chaîne des pompes (04 §5). */
const BASE: readonly ExerciseSheet[] = [sheet(), ...PUSH_UP_CHAIN];

/** Fiche hors chaîne, au nom et à l'id donnés, sans alias. */
const member = (id: string, level: 1 | 2 | 3, extra: Partial<ExerciseSheet> = {}) =>
  sheet({ id, name: `Exercice ${id}`, aliases: [], level, ...extra });

describe('validateCatalog : catalogue valide', () => {
  it('accepte le catalogue de référence, sans erreur', () => {
    expect(run(BASE)).toEqual({ ok: true, errors: [] });
  });

  it('accepte un catalogue vide', () => {
    expect(validateCatalog({ sheets: [], manifest: [], templates: [] })).toEqual({ ok: true, errors: [] });
  });

  it("n'exige pas qu'une nouvelle fiche soit un draft : c'est le chargeur qui décide (tâche 6)", () => {
    expect(run([sheet({ status: 'published' })]).ok).toBe(true);
    expect(run([sheet({ status: 'reviewed' })]).ok).toBe(true);
  });

  it('accepte un brouillon aux champs IA vides (R-FIC-1), et un brouillon retiré', () => {
    const skeleton = without(
      sheet({ status: 'draft' }),
      'instructions',
      'safety',
      'aliases',
      'illustrations',
    );
    expect(run([skeleton]).ok).toBe(true);
    expect(run([{ ...skeleton, status: 'retired' }]).ok).toBe(true);
  });
});

describe('validateCatalog : un refus par règle de 04 §13, critère 1', () => {
  it.each([
    ['un type de mouvement', { movement_pattern: 'deadlift' }],
    ['un mode de charge', { load_mode: 'cable' }],
    ['un muscle principal', { primary_muscles: ['pecs'] }],
    ['un muscle secondaire', { secondary_muscles: ['pecs'] }],
    ['un code de matériel', { equipment_options: [['dumbbells', 'treadmill']] }],
    ['une articulation', { stressed_joints: ['spine'] }],
    ['un niveau', { level: 4 }],
  ])('refuse un code hors taxonomie : %s', (_, overrides) => {
    const result = run([{ ...sheet(), ...overrides }]);
    expect(codes(result)).toEqual(['unknown_code']);
    expect(result.ok).toBe(false);
  });

  it('refuse un id différent du nom de fichier', () => {
    const result = validateCatalog({
      sheets: [{ ...fileOf(sheet()), file: `${EXERCISES_DIR}/squat-goblet.json` }],
      manifest: MANIFEST,
      templates: [],
    });
    expect(result.errors).toEqual([
      expect.objectContaining({ file: `${EXERCISES_DIR}/squat-goblet.json`, code: 'id_mismatch' }),
    ]);
  });

  it.each([
    ['entre deux fiches', [sheet(), member('front-squat', 1, { aliases: ['goblet-squat'] })]],
    ["avec le nom d'une autre fiche (casse et accents)", [sheet({ aliases: ['POMPÉ'] }), ...PUSH_UP_CHAIN]],
    ['dans une même fiche', [sheet({ aliases: ['Hip thrust', 'hip-thrust'] })]],
  ])('refuse un alias en double après normalize : %s', (_, sheets) => {
    expect(codes(run(sheets))).toEqual(['duplicate_alias']);
  });

  it.each([
    ['en double', [['dumbbells'], ['dumbbells']]],
    ['qui en contient une autre', [['dumbbells'], ['dumbbells', 'flat_bench']]],
  ])('refuse une option de matériel %s', (_, equipment_options) => {
    expect(codes(run([{ ...sheet(), equipment_options }]))).toEqual(['equipment_option_redundant']);
  });

  it.each([
    ['dumbbell', [['dumbbells'], ['barbell']]],
    ['barbell', [['barbell', 'squat_rack'], ['dumbbells']]],
    ['machine', [['cable_station'], ['dumbbells']]],
    ['band', [[]]],
  ] as const)('refuse des modes de charge mélangés : %s avec %j', (load_mode, equipment_options) => {
    const s = sheet({ load_mode, equipment_options: equipment_options.map((o) => [...o]) });
    expect(codes(run([s]))).toEqual(['load_mode_mismatch']);
  });

  it("ne contrôle pas le matériel en poids du corps ni en lest (barre fixe, élastique d'assistance, lest)", () => {
    const inverted = member('inverted-row', 1, {
      load_mode: 'bodyweight',
      equipment_options: [['table'], ['squat_rack', 'barbell'], ['suspension_trainer']],
    });
    const assisted = member('assisted-pull-up', 1, {
      load_mode: 'bodyweight',
      equipment_options: [['pull_up_bar', 'resistance_band']],
    });
    const weighted = member('weighted-dip', 2, {
      load_mode: 'weighted',
      equipment_options: [['dip_station', 'dumbbells']],
    });
    expect(run([inverted, assisted, weighted]).ok).toBe(true);
  });

  it('refuse des pointeurs non réciproques (R-CH-1)', () => {
    const chain = PUSH_UP_CHAIN.map((s) => (s.id === 'push-up' ? without(s, 'easier_id') : s));
    expect(codes(run(chain))).toContain('chain_not_reciprocal');
  });

  it('refuse une chaîne cyclique (R-CH-2)', () => {
    const loop = linkChain('loop', [member('loop-a', 1), member('loop-b', 1), member('loop-c', 1)]);
    const closed = loop.map((s) =>
      s.id === 'loop-a'
        ? { ...s, easier_id: 'loop-c' }
        : s.id === 'loop-c'
          ? { ...s, harder_id: 'loop-a' }
          : s,
    );
    expect(codes(run(closed))).toEqual(['chain_cycle']);
  });

  it('refuse une chaîne ramifiée (R-CH-2)', () => {
    const [a, b] = linkChain('fork', [member('fork-a', 1), member('fork-b', 1)]);
    const c = member('fork-c', 1, { chain_id: 'fork', easier_id: 'fork-a' });
    expect(codes(run([a as ExerciseSheet, b as ExerciseSheet, c]))).toContain('chain_branch');
  });

  it('refuse une chaîne discontinue : deux morceaux (R-CH-2)', () => {
    const pieces = [
      ...linkChain('split', [member('split-a', 1), member('split-b', 1)]),
      ...linkChain('split', [member('split-c', 2), member('split-d', 2)]),
    ];
    expect(codes(run(pieces))).toEqual(['chain_discontinuous']);
  });

  it('refuse une chaîne discontinue : membre isolé, seul dans sa chaîne', () => {
    expect(codes(run([sheet({ chain_id: 'goblet' })]))).toEqual(['chain_discontinuous']);
  });

  it('refuse une chaîne discontinue : voisine retirée sans relier les autres (R-CH-6)', () => {
    const chain = PUSH_UP_CHAIN.map((s) => (s.id === 'push-up' ? { ...s, status: 'retired' as const } : s));
    expect(codes(run(chain))).toEqual(['chain_discontinuous']);
    // Retirer la dernière variante après avoir relié sa voisine : accepté.
    const relinked = PUSH_UP_CHAIN.map((s) =>
      s.id === 'archer-push-up'
        ? { ...s, status: 'retired' as const }
        : s.id === 'feet-elevated-push-up'
          ? without(s, 'harder_id')
          : s,
    );
    expect(run(relinked).ok).toBe(true);
  });

  it.each([
    ['sans chain_id', [sheet({ harder_id: 'push-up' }), ...PUSH_UP_CHAIN]],
    ['vers une fiche inconnue', PUSH_UP_CHAIN.filter((s) => s.id !== 'archer-push-up')],
    [
      "vers une fiche d'une autre chaîne",
      [...PUSH_UP_CHAIN, member('lonely', 3, { chain_id: 'other', harder_id: 'wall-push-up' })],
    ],
  ])('refuse un pointeur %s', (_, sheets) => {
    expect(codes(run(sheets))).toContain('chain_pointer');
  });

  it('refuse des membres sans muscle principal commun (R-CH-3)', () => {
    const chain = linkChain('mix', [
      member('mix-a', 1, { primary_muscles: ['chest'], secondary_muscles: [] }),
      member('mix-b', 1, { primary_muscles: ['quadriceps'], secondary_muscles: [] }),
    ]);
    expect(codes(run(chain))).toEqual(['chain_muscles']);
  });

  it('refuse des membres de groupes de couverture différents (R-CH-3)', () => {
    const chain = linkChain('mix', [
      member('mix-a', 1),
      member('mix-b', 1, { movement_pattern: 'horizontal_push' }),
    ]);
    expect(codes(run(chain))).toEqual(['chain_pattern_group']);
    // Squat → fente reste dans `lower_body`.
    const lower = linkChain('legs', [
      member('legs-a', 1),
      member('legs-b', 2, { movement_pattern: 'lunge' }),
    ]);
    expect(run(lower).ok).toBe(true);
  });

  it('refuse un niveau qui baisse le long de la chaîne (R-CH-4)', () => {
    const chain = linkChain('down', [member('down-a', 2), member('down-b', 1)]);
    const result = run(chain);
    expect(codes(result)).toEqual(['chain_level']);
    expect(result.errors[0]?.file).toBe(`${EXERCISES_DIR}/down-b.json`);
  });

  it.each(['reviewed', 'published'] as const)('refuse une fiche %s incomplète (R-FIC-1)', (status) => {
    const result = run([without(sheet({ status }), 'safety', 'instructions')]);
    expect(codes(result)).toEqual(['incomplete']);
    expect(result.errors[0]?.message).toContain('instructions, safety');
  });

  it('refuse une illustration absente du manifeste', () => {
    const s = sheet({ illustrations: [{ illustration_id: 'ghost-start', role: 'start' }] });
    expect(codes(run([s]))).toEqual(['illustration_unknown']);
  });

  it("refuse une illustration d'empreinte différente, ou dont le fichier manque", () => {
    const [start, end] = MANIFEST as [IllustrationEntry, IllustrationEntry];
    const good = new Map([
      [start.file, SHA],
      [end.file, SHA],
    ]);
    expect(run(BASE, { illustrationFiles: good }).ok).toBe(true);

    const changed = run(BASE, { illustrationFiles: new Map([...good, [end.file, 'f'.repeat(64)]]) });
    expect(codes(changed)).toEqual(['illustration_hash_mismatch']);
    expect(changed.errors[0]?.file).toBe(`illustrations/files/${end.file}`);

    const missing = run(BASE, { illustrationFiles: new Map([[start.file, SHA]]) });
    expect(codes(missing)).toEqual(['illustration_file_missing']);
  });

  it('refuse un code de matériel inutilisé (R-EQ-5), seulement en mode strict', () => {
    expect(run(BASE).ok).toBe(true);
    const result = run(BASE, {}, { strict: true });
    expect(codes(result)).toEqual(['equipment_unused']);
    expect(result.errors.map((e) => e.message).join('\n')).toContain('« barbell »');
    expect(result.errors.every((e) => e.file === EXERCISES_DIR)).toBe(true);
  });

  it('mode strict : accepte un catalogue qui utilise les 23 codes, sans compter les fiches retirées', () => {
    const all = [
      member('k-barbell', 1, {
        load_mode: 'barbell',
        equipment_options: [['barbell', 'squat_rack'], ['ez_bar']],
      }),
      member('k-dumbbell', 1, {
        load_mode: 'dumbbell',
        equipment_options: [
          ['dumbbells', 'flat_bench'],
          ['kettlebell', 'adjustable_bench'],
        ],
      }),
      member('k-machine-a', 1, {
        load_mode: 'machine',
        equipment_options: [['cable_station'], ['lat_pulldown'], ['seated_row'], ['leg_press']],
      }),
      member('k-machine-b', 1, {
        load_mode: 'machine',
        equipment_options: [['smith_machine'], ['leg_extension'], ['leg_curl'], ['upper_body_machines']],
      }),
      member('k-band', 1, { load_mode: 'band', equipment_options: [['resistance_band']] }),
      member('k-body-a', 1, {
        load_mode: 'bodyweight',
        equipment_options: [['chair'], ['table'], ['pull_up_bar', 'box'], ['suspension_trainer']],
      }),
      member('k-body-b', 1, {
        load_mode: 'bodyweight',
        equipment_options: [['dip_station'], ['back_extension_bench']],
      }),
    ];
    expect(run(all, {}, { strict: true })).toEqual({ ok: true, errors: [] });
    const retiredBand = all.map((s) => (s.id === 'k-band' ? { ...s, status: 'retired' as const } : s));
    expect(run(retiredBand, {}, { strict: true }).errors).toEqual([
      expect.objectContaining({
        code: 'equipment_unused',
        message: expect.stringContaining('resistance_band'),
      }),
    ]);
  });
});

describe('validateCatalog : plafond, forme canonique et autres règles', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      member(`sheet-${String(i).padStart(3, '0')}`, 1, { status: 'draft' }),
    );

  it(`accepte ${CATALOG_MAX_SHEETS} fiches non retirées et refuse la suivante (spec brique 2 §2)`, () => {
    expect(run(many(CATALOG_MAX_SHEETS)).ok).toBe(true);
    const full = run(many(CATALOG_MAX_SHEETS + 1));
    expect(full.errors).toEqual([expect.objectContaining({ file: EXERCISES_DIR, code: 'catalog_full' })]);
  });

  it('ne compte pas les fiches retirées dans le plafond', () => {
    const sheets = many(CATALOG_MAX_SHEETS + 2).map((s, i) =>
      i < 2 ? { ...s, status: 'retired' as const } : s,
    );
    expect(run(sheets).ok).toBe(true);
  });

  it.each([
    ['indentation de 4 espaces', (s: Json) => `${JSON.stringify(s, null, 4)}\n`],
    ['fins de ligne CRLF', (s: Json) => canonicalJson(s).replaceAll('\n', '\r\n')],
    ['sans LF final', (s: Json) => canonicalJson(s).trimEnd()],
    [
      'clés triées par ordre alphabétique',
      (s: Json) => `${JSON.stringify(Object.fromEntries(Object.entries(s).sort()), null, 2)}\n`,
    ],
  ])('refuse un fichier non canonique : %s', (_, write) => {
    const s = sheet();
    const result = validateCatalog({
      sheets: [{ ...fileOf(s), text: write(s) }],
      manifest: MANIFEST,
      templates: [],
    });
    expect(codes(result)).toEqual(['not_canonical']);
  });

  it("ne contrôle pas la forme canonique quand le texte n'est pas fourni", () => {
    const { text: _, ...parsedOnly } = fileOf(sheet());
    expect(validateCatalog({ sheets: [parsedOnly], manifest: MANIFEST, templates: [] }).ok).toBe(true);
  });

  it.each([
    ['un tableau', []],
    ['null', null],
    ['une chaîne', 'goblet-squat'],
  ])("refuse une fiche qui n'est pas un objet : %s", (_, json) => {
    const result = validateCatalog({
      sheets: [{ file: 'exercises/x.json', json }],
      manifest: [],
      templates: [],
    });
    expect(codes(result)).toEqual(['invalid_sheet']);
  });

  it.each([
    ['une étape trop longue', { instructions: ['x'.repeat(161), 'b', 'c'] }],
    ['une entrée de sécurité de 121 caractères', { safety: ['x'.repeat(121)] }],
    ['un lot inconnu', { batch: 'C' }],
    ['une mécanique inconnue (hors taxonomie partagée)', { mechanics: 'compoundish' }],
    ['une clé inconnue', { chain_rank: 1 }],
  ])('refuse une fiche invalide : %s', (_, overrides) => {
    expect(codes(run([{ ...sheet(), ...overrides }]))).toEqual(['invalid_sheet']);
  });

  it('vérifie les règles entre fiches même quand une fiche est invalide', () => {
    const broken = { ...member('front-squat', 1, { aliases: ['Goblet squat'] }), batch: 'C' };
    expect(codes(run([sheet(), broken]))).toEqual(['duplicate_alias', 'invalid_sheet']);
  });

  it('refuse deux fichiers du même id', () => {
    const s = sheet();
    const result = validateCatalog({
      sheets: [fileOf(s), { ...fileOf(s), file: 'archive/goblet-squat.json' }],
      manifest: MANIFEST,
      templates: [],
    });
    expect(codes(result)).toEqual(['duplicate_alias', 'duplicate_id']);
  });

  it('refuse des illustrations de plusieurs sources dans une fiche (04 §12, règle 4)', () => {
    const manifest = [
      illustration('goblet-squat-start'),
      illustration('goblet-squat-end', { source: 'workout_guide' }),
    ];
    expect(codes(run([sheet()], { manifest }))).toEqual(['illustration_sources_mixed']);
  });

  it('refuse une illustration en double dans le manifeste', () => {
    const result = run([sheet()], { manifest: [...MANIFEST, illustration('goblet-squat-end')] });
    expect(result.errors).toEqual([
      expect.objectContaining({ file: MANIFEST_FILE, code: 'duplicate_illustration' }),
    ]);
  });

  it("refuse une fiche retirée qu'un modèle de programme cite dans une liste de slot (04 §8)", () => {
    const template = {
      id: 'gym-beginner-full-body-ab',
      workouts: [{ id: 'A', slots: [{ exercises: ['goblet-squat'] }] }],
    };
    expect(run([sheet()], { templates: [template] }).ok).toBe(true);
    const result = run([sheet({ status: 'retired' })], { templates: [template] });
    expect(result.errors).toEqual([
      expect.objectContaining({
        file: `${EXERCISES_DIR}/goblet-squat.json`,
        code: 'retired_in_template',
        message: expect.stringContaining('gym-beginner-full-body-ab'),
      }),
    ]);
  });

  it("ignore un modèle d'une autre forme : c'est le validateur de Programmes qui le juge", () => {
    expect(
      run([sheet({ status: 'retired' })], {
        templates: [null, 'x', { workouts: 3 }, { workouts: [{ slots: [{}] }] }],
      }).ok,
    ).toBe(true);
  });

  it("rend les erreurs dans le même ordre quel que soit l'ordre des fichiers", () => {
    const sheets: DraftSheet[] = [
      sheet({ aliases: ['Pompe'] }),
      ...PUSH_UP_CHAIN.map((s) => (s.id === 'push-up' ? without(s, 'easier_id') : s)),
      member('down-a', 2, { chain_id: 'solo' }),
    ];
    const forward = run(sheets);
    expect(forward.errors.length).toBeGreaterThan(2);
    expect(run([...sheets].reverse())).toEqual(forward);
  });
});
