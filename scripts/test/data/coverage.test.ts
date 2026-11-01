import type { ProgramTemplate, SlotSpec } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_MIN,
  COVERAGE_PROFILES,
  coverageFailures,
  dataCoverage,
  type SlotCoverage,
  slotMeasure,
  templateCoverage,
  templateMaxLevel,
} from '../../data/coverage';
import { type DataSheet, DEFAULT_DATA_DIR } from '../../data/validate';

/** Fiche minimale lue par le contrôle : par défaut, un squat au poids du corps en répétitions, brouillon de niveau 1. */
const sheet = (id: string, extra: Partial<DataSheet> = {}): DataSheet => ({
  id,
  status: 'draft',
  level: 1,
  mechanics: 'compound',
  not_for_minors: false,
  equipment_options: [[]],
  movement_pattern: 'squat',
  primary_muscles: ['quadriceps'],
  secondary_muscles: [],
  unilateral: false,
  load_mode: 'bodyweight',
  measure: 'reps',
  ...extra,
});

const REPS: SlotSpec['sets'] = [
  { kind: 'work', count: 3, reps: { min: 8, max: 12 }, targetRir: 2, restS: 90 },
];

const slot = (
  id: string,
  from: Pick<SlotSpec, 'exercises'> | Pick<SlotSpec, 'chain'>,
  sets: SlotSpec['sets'] = REPS,
): SlotSpec => ({
  id,
  movementPattern: 'squat',
  role: 'main',
  ...from,
  sets,
  progression: { type: 'double' },
});

const template = (
  context: ProgramTemplate['context'],
  level: ProgramTemplate['level'],
  slots: SlotSpec[],
): ProgramTemplate => ({
  schemaVersion: 1,
  id: `${context}-${level}`,
  version: 1,
  name: 'Modèle de test',
  description: 'Modèle de test.',
  context,
  level,
  daysPerWeek: { min: 2, max: 3, default: 3 },
  estimatedMinutes: 40,
  block: { mode: 'reactive' },
  workouts: [{ id: 'A', name: 'Séance A', slots }],
});

const row = (rows: SlotCoverage[], profile: SlotCoverage['profile'], slotId = 'A1') =>
  rows.find((r) => r.profile === profile && r.slotId === slotId);

describe('condition (c) de 04 §7 : le contrôle', () => {
  it('maxLevel du modèle par maxExerciseLevel : débutant 1, intermédiaire 2', () => {
    expect(templateMaxLevel('beginner')).toBe(1);
    expect(templateMaxLevel('intermediate')).toBe(2);
  });

  it('profils pertinents : salle, maison (deux profils), sport (les trois)', () => {
    const catalog = [sheet('squat')];
    const profiles = (context: ProgramTemplate['context']) =>
      templateCoverage([template(context, 'beginner', [slot('A1', { exercises: ['squat'] })])], catalog).map(
        (r) => r.profile,
      );
    expect(profiles('gym')).toEqual(['gym_reference']);
    expect(profiles('home')).toEqual(['home_bodyweight', 'home_small_equipment']);
    expect(profiles('sport')).toEqual(['gym_reference', 'home_bodyweight', 'home_small_equipment']);
    expect(COVERAGE_PROFILES.sport).toHaveLength(3);
  });

  it('liste : ses fiches utilisables (niveau libre), puis les remplaçants de la première (niveau ≤ maxLevel)', () => {
    const catalog = [
      sheet('back-squat', { level: 2, equipment_options: [['barbell', 'squat_rack']] }),
      sheet('air-squat'),
      sheet('box-squat', { equipment_options: [['box']] }),
      sheet('wall-sit', { level: 2 }), // remplaçant au-dessus du niveau d'un débutant
      sheet('lunge', { movement_pattern: 'lunge' }), // autre type de mouvement
      sheet('glute-squat', { primary_muscles: ['glutes'] }), // aucun muscle principal commun
    ];
    const rows = templateCoverage(
      [template('sport', 'beginner', [slot('A1', { exercises: ['back-squat', 'box-squat'] })])],
      catalog,
    );
    expect(row(rows, 'gym_reference')?.adult).toEqual(['back-squat', 'air-squat']);
    // Sans matériel : ni barre ni box, seul le remplaçant au poids du corps reste.
    expect(row(rows, 'home_bodyweight')?.adult).toEqual(['air-squat']);
    const intermediate = templateCoverage(
      [template('gym', 'intermediate', [slot('A1', { exercises: ['back-squat'] })])],
      catalog,
    );
    expect(row(intermediate, 'gym_reference')?.adult).toEqual(['back-squat', 'wall-sit', 'air-squat']);
  });

  it('prudent : une fiche not_for_minors ne compte pas ; brouillon compté comme publié, fiche retirée jamais', () => {
    const catalog = [
      sheet('jump-squat', { not_for_minors: true }),
      sheet('air-squat'),
      sheet('old-squat', { status: 'retired' }),
    ];
    const rows = templateCoverage(
      [template('gym', 'beginner', [slot('A1', { exercises: ['jump-squat', 'old-squat'] })])],
      catalog,
    );
    expect(row(rows, 'gym_reference')).toMatchObject({
      adult: ['jump-squat', 'air-squat'],
      cautious: ['air-squat'],
    });
  });

  it('chaîne : variantes utilisables, coupées avant la première not_for_minors en prudent', () => {
    const catalog = [
      sheet('step-1', { chain_id: 'ladder', harder_id: 'step-2' }),
      sheet('step-2', {
        chain_id: 'ladder',
        easier_id: 'step-1',
        harder_id: 'step-3',
        level: 3,
        not_for_minors: true,
      }),
      sheet('step-3', { chain_id: 'ladder', easier_id: 'step-2', level: 3 }),
    ];
    const rows = templateCoverage(
      [template('gym', 'intermediate', [slot('A1', { chain: 'ladder' })])],
      catalog,
    );
    expect(row(rows, 'gym_reference')).toMatchObject({
      adult: ['step-1', 'step-2', 'step-3'],
      cautious: ['step-1'],
    });
  });

  it("chaîne : la variante courante peut être n'importe quel membre, on garde le pire des cas", () => {
    // Chaîne hors de portée sans matériel ; seule la première variante partage un muscle avec `bridge-squat`.
    const catalog = [
      sheet('shallow', {
        chain_id: 'ladder',
        harder_id: 'deep',
        equipment_options: [['box']],
        primary_muscles: ['quadriceps', 'glutes'],
      }),
      sheet('deep', { chain_id: 'ladder', easier_id: 'shallow', equipment_options: [['box']] }),
      sheet('bridge-squat', { primary_muscles: ['glutes'] }),
    ];
    const rows = templateCoverage([template('home', 'beginner', [slot('A1', { chain: 'ladder' })])], catalog);
    expect(row(rows, 'home_bodyweight')?.adult).toEqual([]);
    expect(row(rows, 'home_small_equipment')?.adult).toEqual([]);
  });

  it('seules comptent les fiches de la mesure du slot, lue sur sa première série de travail', () => {
    const timed: SlotSpec['sets'] = [
      { kind: 'warmup', count: 1, reps: { min: 5, max: 5 }, pctWorkLoad: 50 },
      { kind: 'work', count: 3, durationS: { min: 20, max: 40 }, targetRir: 2, restS: 60 },
    ];
    expect(slotMeasure({ sets: REPS })).toBe('reps');
    expect(slotMeasure({ sets: timed })).toBe('duration');
    const catalog = [sheet('squat-hold', { measure: 'duration' }), sheet('air-squat'), sheet('split-squat')];
    const rows = templateCoverage(
      [
        template('gym', 'beginner', [
          slot('A1', { exercises: ['air-squat'] }),
          slot('A2', { exercises: ['squat-hold'] }, timed),
        ]),
      ],
      catalog,
    );
    expect(row(rows, 'gym_reference', 'A1')?.adult).toEqual(['air-squat', 'split-squat']);
    expect(row(rows, 'gym_reference', 'A2')?.adult).toEqual(['squat-hold']);
  });

  it(`échec sous ${COVERAGE_MIN.adult} exercices pour un adulte ou sous ${COVERAGE_MIN.cautious} en prudent`, () => {
    const base = {
      templateId: 't',
      slotId: 'A1',
      movementPattern: 'squat',
      profile: 'gym_reference',
    } as const;
    const rows: SlotCoverage[] = [
      { ...base, adult: ['a', 'b'], cautious: ['a'] },
      { ...base, adult: ['a'], cautious: ['a'] },
      { ...base, adult: ['a', 'b'], cautious: [] },
    ];
    expect(coverageFailures(rows)).toEqual([rows[1], rows[2]]);
  });
});

describe('condition (c) de 04 §7 sur le dépôt', () => {
  it('chaque slot des 6 modèles a 2 exercices utilisables (adulte) et 1 en prudent, dans chaque profil pertinent', async () => {
    const rows = await dataCoverage(DEFAULT_DATA_DIR);
    // 6 modèles : 2 salle (1 profil), 2 maison (2 profils), 2 sport (3 profils).
    expect(new Set(rows.map((r) => r.templateId)).size).toBe(6);
    const failures = coverageFailures(rows).map(
      (r) =>
        `${r.templateId} ${r.slotId} (${r.movementPattern}), ${r.profile} : ` +
        `adulte ${r.adult.length} [${r.adult.join(', ')}], prudent ${r.cautious.length} [${r.cautious.join(', ')}]`,
    );
    expect(failures).toEqual([]);
  });
});
