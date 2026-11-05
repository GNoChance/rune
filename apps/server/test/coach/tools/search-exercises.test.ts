import type { EquipmentCode, ExerciseSheet } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { runTool } from '../../../src/coach/tools';
import {
  createTestContext,
  createUserAndLogin,
  insertFixtureRow,
  seedSheet,
  sheetFixture,
  type TestContext,
} from '../../support';
import { skeletonFixture } from '../../support/catalog';
import { toolContext } from '../../support/coach';
import { rebuild } from '../../support/review';

/*
 * `search_exercises` (spec brique 4 §10, choix C25) : fiches publiées, 10 au plus, filtres texte (`normalize`), muscle
 * et type de mouvement, faisables par défaut dans au moins un lieu vivant (toutes sans lieu), sans `not_for_minors`
 * pour un mineur ou un profil prudent ; tri pertinence, niveau, nom ; `feasible_at` en `lieu_n`.
 */

type Member = Awaited<ReturnType<typeof createUserAndLogin>>;
type Found = { id: string; feasible_at: string[] } & Record<string, unknown>;
type Search = { exercises: Found[]; total_matching: number };

const NOW = '2026-11-05T10:00:00.000Z';

/** Catalogue de test : fiches publiées, une retirée après publication, un brouillon. */
const SHEETS: readonly ExerciseSheet[] = [
  sheetFixture('goblet-squat', { name: 'Squat goblet', aliases: ['Goblet squat'] }),
  sheetFixture('bodyweight-squat', {
    name: 'Squat au poids du corps',
    equipment_options: [[]],
    load_mode: 'bodyweight',
  }),
  sheetFixture('back-squat', {
    name: 'Squat barre',
    level: 2,
    equipment_options: [['barbell', 'squat_rack']],
    load_mode: 'barbell',
  }),
  sheetFixture('barbell-row', {
    name: 'Rowing barre',
    level: 2,
    movement_pattern: 'horizontal_pull',
    primary_muscles: ['lats'],
    secondary_muscles: ['biceps'],
    equipment_options: [['barbell']],
    load_mode: 'barbell',
  }),
  sheetFixture('band-row', {
    name: 'Rowing élastique',
    movement_pattern: 'horizontal_pull',
    primary_muscles: ['rear_delts'],
    secondary_muscles: ['lats'],
    equipment_options: [['resistance_band']],
    load_mode: 'band',
  }),
  sheetFixture('leg-press', {
    name: 'Presse à cuisses',
    equipment_options: [['leg_press']],
    load_mode: 'machine',
  }),
  sheetFixture('box-jump', {
    name: 'Saut sur box',
    level: 2,
    movement_pattern: 'plyometrics',
    equipment_options: [['box']],
    load_mode: 'bodyweight',
    not_for_minors: true,
  }),
  sheetFixture('old-squat', {
    name: 'Squat retiré',
    status: 'retired',
    retired_at: '2026-10-27T08:00:00.000Z',
  }),
];
const PUBLISHED = SHEETS.filter((s) => s.status === 'published').map((s) => s.id);

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup(sheets: readonly ExerciseSheet[] = SHEETS): Promise<void> {
  ctx = await createTestContext({ now: NOW });
  for (const sheet of sheets) await seedSheet(ctx, sheet);
  await seedSheet(ctx, skeletonFixture('draft-squat', { name: 'Squat brouillon' }));
  await rebuild(ctx, []);
}

/** Lieu maison vivant de `u` avec son matériel. */
async function place(u: Member, id: string, primary: boolean, equipment: readonly EquipmentCode[]) {
  await insertFixtureRow(ctx.deps.db, 'place', {
    id,
    ownerId: u.id,
    kind: 'home',
    name: `Chez ${id}`,
    isPrimary: primary ? 1 : 0,
  });
  for (const code of equipment) {
    await insertFixtureRow(ctx.deps.db, 'home_equipment', {
      id: `${id}:${code}`,
      ownerId: u.id,
      placeId: id,
      equipmentCode: code,
    });
  }
}

async function search(u: Member, input: unknown, audience: 'adult' | 'minor' = 'adult'): Promise<Search> {
  const outcome = await runTool('search_exercises', input, toolContext(ctx, u.id, { thread: { audience } }));
  expect(outcome.isError).toBe(false);
  return outcome.result as Search;
}

const ids = (s: Search) => s.exercises.map((e) => e.id);

describe('search_exercises : profil', () => {
  it('mineur et profil prudent : aucune fiche not_for_minors ; adulte : présente', async () => {
    await setup();
    const adult = await createUserAndLogin(ctx);
    const minor = await createUserAndLogin(ctx, { birthDate: '2009-06-01' });
    const cautious = await createUserAndLogin(ctx);
    await insertFixtureRow(ctx.deps.db, 'training_profile', { ownerId: cautious.id, cautiousMode: 1 });

    expect(ids(await search(adult, {}))).toContain('box-jump');
    expect(ids(await search(minor, {}, 'minor'))).not.toContain('box-jump');
    expect(ids(await search(cautious, {}))).not.toContain('box-jump');
    expect(ids(await search(cautious, { movement_pattern: 'plyometrics' }))).toEqual([]);
  });
});

describe('search_exercises : lieux et matériel (C25)', () => {
  it('fiche faisable seulement au lieu secondaire : rendue, feasible_at lieu_2 ; infaisable partout : absente', async () => {
    await setup();
    const u = await createUserAndLogin(ctx);
    // Principal `place-b` (lieu_1) malgré l'ordre des identifiants ; `place-a` est lieu_2.
    await place(u, 'place-b', true, ['dumbbells']);
    await place(u, 'place-a', false, ['barbell', 'squat_rack']);
    const found = await search(u, {});
    const at = new Map(found.exercises.map((e) => [e.id, e.feasible_at]));
    expect(at.get('back-squat')).toEqual(['lieu_2']);
    expect(at.get('barbell-row')).toEqual(['lieu_2']);
    expect(at.get('goblet-squat')).toEqual(['lieu_1']);
    expect(at.get('bodyweight-squat')).toEqual(['lieu_1', 'lieu_2']);
    expect(at.has('leg-press')).toBe(false);
    expect(at.has('band-row')).toBe(false);
    expect(JSON.stringify(found)).not.toMatch(/place-|Chez/);
  });

  it('available_equipment_only faux : fiches infaisables comprises, feasible_at vide', async () => {
    await setup();
    const u = await createUserAndLogin(ctx);
    await place(u, 'place-b', true, ['dumbbells']);
    const found = await search(u, { available_equipment_only: false });
    expect(ids(found).sort()).toEqual([...PUBLISHED].sort());
    expect(found.exercises.find((e) => e.id === 'leg-press')?.feasible_at).toEqual([]);
  });

  it('sans lieu (Review Focus 4) : toutes les fiches publiées, feasible_at vide', async () => {
    await setup();
    const u = await createUserAndLogin(ctx);
    const found = await search(u, {});
    expect(ids(found).sort()).toEqual([...PUBLISHED].sort());
    expect(found.total_matching).toBe(PUBLISHED.length);
    expect(found.exercises.every((e) => e.feasible_at.length === 0)).toBe(true);
  });

  it('lieu supprimé : ne compte pas', async () => {
    await setup();
    const u = await createUserAndLogin(ctx);
    await place(u, 'place-b', true, ['dumbbells']);
    await place(u, 'place-a', false, ['barbell', 'squat_rack']);
    await ctx.deps.db
      .updateTable('place')
      .set({ deletedAt: '2026-11-01T10:00:00.000Z' })
      .where('id', '=', 'place-a')
      .execute();
    expect(ids(await search(u, {}))).not.toContain('back-squat');
  });
});

describe('search_exercises : catalogue, filtres et tri', () => {
  it('ni brouillon ni fiche retirée', async () => {
    await setup();
    const u = await createUserAndLogin(ctx);
    const found = ids(await search(u, { query: 'squat' }));
    expect(found).not.toContain('draft-squat');
    expect(found).not.toContain('old-squat');
    expect(found).toContain('goblet-squat');
  });

  it('15 correspondances : 10 rendues, total_matching 15', async () => {
    const lunges = Array.from({ length: 15 }, (_, i) =>
      sheetFixture(`lunge-${String(i).padStart(2, '0')}`, {
        name: `Fente ${String(i).padStart(2, '0')}`,
        movement_pattern: 'lunge',
        equipment_options: [[]],
      }),
    );
    await setup([...SHEETS, ...lunges]);
    const u = await createUserAndLogin(ctx);
    const found = await search(u, { movement_pattern: 'lunge' });
    expect(found.exercises).toHaveLength(10);
    expect(found.total_matching).toBe(15);
  });

  it('à pertinence égale : niveau, puis nom', async () => {
    await setup();
    const u = await createUserAndLogin(ctx);
    expect(ids(await search(u, { movement_pattern: 'squat' }))).toEqual([
      'leg-press', // Presse à cuisses, niveau 1
      'bodyweight-squat', // Squat au poids du corps, niveau 1
      'goblet-squat', // Squat goblet, niveau 1
      'back-squat', // niveau 2
    ]);
  });

  it('pertinence : nom ou alias égal à la recherche, puis tous les mots dans le nom, puis dans un alias', async () => {
    await setup([
      sheetFixture('goblet-squat', { name: 'Squat goblet', aliases: ['Goblet squat'] }),
      sheetFixture('goblet-box-squat', { name: 'Goblet squat sur box' }),
      sheetFixture('sumo-squat', { name: 'Squat sumo', aliases: ['Goblet sumo squat'] }),
      sheetFixture('bodyweight-squat', { name: 'Squat au poids du corps', equipment_options: [[]] }),
    ]);
    const u = await createUserAndLogin(ctx);
    expect(ids(await search(u, { query: 'GOBLET  squat !' }))).toEqual([
      'goblet-squat',
      'goblet-box-squat',
      'sumo-squat',
    ]);
    expect(ids(await search(u, { query: 'squât' }))).toHaveLength(4);
  });

  it('muscle : muscle principal ; type de mouvement', async () => {
    await setup();
    const u = await createUserAndLogin(ctx);
    expect(ids(await search(u, { muscle: 'lats' }))).toEqual(['barbell-row']);
    expect(ids(await search(u, { movement_pattern: 'horizontal_pull' }))).toEqual([
      'band-row',
      'barbell-row',
    ]);
  });

  it('champs du §10 : fiche, matériel, lieux, points clés, sécurité, titres des erreurs', async () => {
    await setup();
    const u = await createUserAndLogin(ctx);
    await place(u, 'place-b', true, ['dumbbells']);
    const [goblet] = (await search(u, { query: 'squat goblet' })).exercises;
    const sheet = SHEETS[0] as ExerciseSheet;
    expect(goblet).toEqual({
      id: 'goblet-squat',
      name: 'Squat goblet',
      movement_pattern: 'squat',
      primary_muscles: sheet.primary_muscles,
      secondary_muscles: sheet.secondary_muscles,
      level: 1,
      load_mode: 'dumbbell',
      unilateral: false,
      equipment_options: [['dumbbells'], ['kettlebell']],
      feasible_at: ['lieu_1'],
      key_points: sheet.key_points,
      safety: sheet.safety,
      mistakes: sheet.mistakes.map((m) => m.mistake),
    });
  });

  it('entrée hors schéma : invalid_input', async () => {
    await setup();
    const u = await createUserAndLogin(ctx);
    const outcome = await runTool('search_exercises', { muscle: 'mollets' }, toolContext(ctx, u.id));
    expect(outcome).toMatchObject({ isError: true, result: { error: 'invalid_input' } });
  });
});
