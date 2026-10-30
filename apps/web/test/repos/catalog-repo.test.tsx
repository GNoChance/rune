import {
  type Experience,
  type MeResponse,
  MUSCLE_GROUPS,
  type ServedSheet,
  ServedSheetSchema,
} from '@rune/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { type AppServices, ServicesProvider } from '../../src/app-services';
import type { AppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { reposFor } from '../../src/repos';
import { useCatalog, useExerciseView } from '../../src/repos/catalog-repo';
import { createTestServices, makeMe } from '../support/render';
import { seedMirror } from '../support/seed';

/** Fiche servie de référence (squat goblet, sans colonne éditoriale), surchargée champ par champ. */
const BASE: ServedSheet = {
  id: 'goblet-squat',
  schema_version: 1,
  revision: 4,
  status: 'published',
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
    'Tiens un haltère contre ta poitrine.',
    'Descends en poussant les hanches en arrière.',
    'Remonte en poussant dans tout le pied.',
  ],
  key_points: ['Garde les talons au sol.', 'Tes genoux suivent tes orteils.'],
  mistakes: [
    { mistake: 'Les genoux rentrent.', fix: "Pousse les genoux vers l'extérieur." },
    { mistake: 'Les talons décollent.', fix: 'Descends moins bas.' },
  ],
  safety: ['Arrête la série si tu ressens une douleur vive.'],
  breathing: 'Inspire en descendant, souffle en remontant.',
  illustrations: [],
};

/** Fiche servie valide (le schéma la vérifie : une fiche refusée serait écartée en silence par le dépôt). */
const served = (o: Partial<ServedSheet>): ServedSheet =>
  ServedSheetSchema.parse({ ...structuredClone(BASE), ...o });

/** Relie des fiches en chaîne, de la plus facile à la plus dure (R-CH-1). */
function chain(chainId: string, members: ServedSheet[]): ServedSheet[] {
  return members.map((m, i) => {
    const easier = members[i - 1]?.id;
    const harder = members[i + 1]?.id;
    return served({
      ...m,
      chain_id: chainId,
      ...(easier ? { easier_id: easier } : {}),
      ...(harder ? { harder_id: harder } : {}),
    });
  });
}

const pushUp = (o: Partial<ServedSheet>) =>
  served({
    movement_pattern: 'horizontal_push',
    load_mode: 'bodyweight',
    primary_muscles: ['chest'],
    secondary_muscles: ['triceps', 'front_delts', 'abs'],
    equipment_options: [[]],
    stressed_joints: ['shoulders', 'wrists'],
    ...o,
  });

const benchPress = (o: Partial<ServedSheet>) =>
  served({
    movement_pattern: 'horizontal_push',
    primary_muscles: ['chest'],
    secondary_muscles: ['triceps', 'front_delts'],
    stressed_joints: ['shoulders'],
    ...o,
  });

/**
 * Catalogue d'essai. Au Garage (haltères et banc réglable), le filtre Faisable fait baisser Pectoraux (5 → 4 : le
 * développé couché à la barre tombe, celui aux haltères reste grâce au banc réglable qui vaut un banc plat) et
 * passer Dos à 0 (tirage vertical à la machine). Deux fiches `not_for_minors` : la pompe archer (au bout de la
 * chaîne des pompes) et le Nordic curl. Une fiche retirée, jamais proposée.
 */
const CATALOG: ServedSheet[] = [
  ...chain('squat', [
    served({
      id: 'bodyweight-squat',
      name: 'Squat au poids du corps',
      aliases: ['Air squat'],
      load_mode: 'bodyweight',
      equipment_options: [[]],
    }),
    served({ id: 'goblet-squat' }),
    served({
      id: 'back-squat',
      name: 'Squat barre',
      aliases: ['Back squat'],
      load_mode: 'barbell',
      equipment_options: [['barbell', 'squat_rack']],
      level: 2,
    }),
  ]),
  served({
    id: 'jump-squat',
    status: 'retired',
    name: 'Squat sauté',
    aliases: [],
    load_mode: 'bodyweight',
    equipment_options: [[]],
  }),
  benchPress({
    id: 'bench-press',
    name: 'Développé couché',
    aliases: ['Bench press'],
    load_mode: 'barbell',
    equipment_options: [['barbell', 'flat_bench']],
    level: 2,
  }),
  benchPress({
    id: 'dumbbell-bench-press',
    name: 'Développé couché haltères',
    aliases: ['Dumbbell bench press'],
    equipment_options: [['dumbbells', 'flat_bench']],
  }),
  ...chain('push-up', [
    pushUp({ id: 'wall-push-up', name: 'Pompe contre le mur', aliases: ['Wall push-up'] }),
    pushUp({ id: 'push-up', name: 'Pompe', aliases: ['Push-up'] }),
    pushUp({
      id: 'archer-push-up',
      name: 'Pompe archer',
      aliases: ['Archer push-up'],
      level: 3,
      not_for_minors: true,
    }),
  ]),
  served({
    id: 'lat-pulldown',
    name: 'Tirage vertical',
    aliases: ['Lat pulldown'],
    movement_pattern: 'vertical_pull',
    load_mode: 'machine',
    primary_muscles: ['lats'],
    secondary_muscles: ['biceps'],
    equipment_options: [['lat_pulldown']],
    stressed_joints: ['shoulders'],
  }),
  served({
    id: 'nordic-curl',
    name: 'Nordic curl',
    aliases: ['Curl nordique'],
    movement_pattern: 'knee_flexion',
    load_mode: 'bodyweight',
    primary_muscles: ['hamstrings'],
    secondary_muscles: ['glutes'],
    equipment_options: [[]],
    level: 3,
    not_for_minors: true,
    stressed_joints: ['knees'],
  }),
  served({
    id: 'lying-leg-curl',
    name: 'Leg curl allongé',
    aliases: ['Leg curl'],
    movement_pattern: 'knee_flexion',
    load_mode: 'machine',
    primary_muscles: ['hamstrings'],
    secondary_muscles: ['calves'],
    equipment_options: [['leg_curl']],
    stressed_joints: ['knees'],
  }),
];

const MINOR = makeMe({ ageBand: 'minor', birthDate: '2011-01-01', cautious: true });

interface Setup {
  me?: MeResponse;
  /** Lieu principal : le Garage (haltères, banc réglable) par défaut ; null : aucun lieu principal. */
  place?: 'garage' | 'garage-secondary' | null;
  experience?: Experience | null;
  cautiousMode?: boolean;
  /** Fiches du magasin `exercises` ; null : catalogue jamais téléchargé. */
  catalog?: unknown[] | null;
}

async function seedCatalog(db: AppDb, sheets: readonly unknown[], version = 'cat-1'): Promise<void> {
  await db.table('exercises').bulkPut([...sheets]);
  await setMeta(db, 'catalogVersion', version);
}

async function seedGarage(db: AppDb, isPrimary = true): Promise<void> {
  await seedMirror(db, 'place', [
    {
      id: 'p-1',
      ownerId: 'u-1',
      kind: 'home',
      gymId: null,
      name: 'Garage',
      isPrimary,
      visibleAtGym: null,
      loadSettings: null,
    },
  ]);
  await seedMirror(db, 'home_equipment', [
    { id: 'p-1:dumbbells', ownerId: 'u-1', placeId: 'p-1', equipmentCode: 'dumbbells' },
    { id: 'p-1:adjustable_bench', ownerId: 'u-1', placeId: 'p-1', equipmentCode: 'adjustable_bench' },
  ]);
}

async function setup(o: Setup = {}) {
  const t = await createTestServices({ me: o.me });
  const { db } = t;
  await seedMirror(db, 'training_profile', [
    {
      id: 'u-1',
      ownerId: 'u-1',
      goal: 'muscle',
      experience: o.experience === undefined ? '6_to_24_months' : o.experience,
      daysPerWeek: 3,
      sessionMinutes: 45,
      sportCode: null,
      sportOtherLabel: null,
      cautiousMode: o.cautiousMode ?? false,
      coach: 'skald',
    },
  ]);
  const place = o.place === undefined ? 'garage' : o.place;
  if (place !== null) await seedGarage(db, place === 'garage');
  if (o.catalog !== null) await seedCatalog(db, o.catalog ?? CATALOG);
  return { ...t, repo: reposFor(t.services).catalog };
}

const wrapper = (services: AppServices) => (p: { children: ReactNode }) => (
  <ServicesProvider services={services}>{p.children}</ServicesProvider>
);

const ids = (sheets: readonly { id: string }[]) => sheets.map((s) => s.id);
const counts = (groups: readonly { code: string; count: number }[]) =>
  Object.fromEntries(groups.map((g) => [g.code, g.count]));

const NO_GROUP = { shoulders: 0, arms: 0, core: 0, calves: 0 };

describe('useCatalog', () => {
  it('catalogue absent → missing (après loading) ; ready dès qu’il arrive, fiches publiées et retirées', async () => {
    const { services, db } = await setup({ catalog: null });
    const { result } = renderHook(() => useCatalog(), { wrapper: wrapper(services) });
    expect(result.current).toEqual({ state: 'loading', sheets: [] });
    await waitFor(() => expect(result.current.state).toBe('missing'));
    expect(result.current.sheets).toEqual([]);

    await act(() => seedCatalog(db, CATALOG));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(ids(result.current.sheets)).toEqual(ids(CATALOG).sort());
    expect(result.current.sheets.find((s) => s.id === 'jump-squat')?.status).toBe('retired');
  });

  it('catalogue vide, seulement retiré ou illisible → missing, jamais des tuiles à 0 (Review Focus 5)', async () => {
    for (const catalog of [
      [],
      [CATALOG.find((s) => s.id === 'jump-squat')],
      [{ id: 'squat', name: 'Squat' }],
    ]) {
      const { services } = await setup({ catalog });
      const { result, unmount } = renderHook(() => useCatalog(), { wrapper: wrapper(services) });
      await waitFor(() => expect(result.current.state).toBe('missing'));
      unmount();
    }
  });

  it('une fiche illisible ou une colonne éditoriale (brouillon, lot) est écartée, les autres restent', async () => {
    const draft = { ...BASE, id: 'draft-sheet', status: 'draft' };
    const withBatch = { ...BASE, id: 'with-batch', batch: 'A' };
    const { repo } = await setup({ catalog: [...CATALOG, draft, withBatch, { id: 'broken' }] });
    expect(ids((await repo.sheets()) ?? [])).toEqual(ids(CATALOG).sort());
    expect(await repo.getSheetView('draft-sheet')).toBeNull();
    expect(await repo.getSheetView('with-batch')).toBeNull();
  });
});

describe('tuiles des groupes (useExerciseView)', () => {
  it('9 groupes dans l’ordre de MUSCLE_GROUPS ; filtre Faisable : une tuile baisse, une autre passe à 0', async () => {
    const { repo } = await setup();
    const all = await repo.view({ feasibleOnly: false });
    expect(all.groups.map((g) => [g.code, g.label])).toEqual(MUSCLE_GROUPS.map((g) => [g.code, g.label]));
    expect(counts(all.groups)).toEqual({
      chest: 5,
      back: 1,
      glutes: 3,
      quads: 3,
      hamstrings: 2,
      ...NO_GROUP,
    });

    const feasible = await repo.view({ feasibleOnly: true });
    // Garage : le banc réglable vaut un banc plat (expandEquipment) → le développé aux haltères reste.
    expect(counts(feasible.groups)).toEqual({
      chest: 4,
      back: 0,
      glutes: 2,
      quads: 2,
      hamstrings: 1,
      ...NO_GROUP,
    });
    expect(ids((await repo.groupExercises('chest', { feasibleOnly: true })) ?? [])).toContain(
      'dumbbell-bench-press',
    );
  });

  it('lieu principal : son nom et son matériel étendu ; adulte, niveau max 2 sans expérience connue', async () => {
    const { repo } = await setup({ experience: null });
    const view = await repo.view({ feasibleOnly: true });
    expect(view.place?.id).toBe('p-1');
    expect(view.place?.name).toBe('Garage');
    expect([...(view.place?.equipment ?? [])].sort()).toEqual([
      'adjustable_bench',
      'dumbbells',
      'flat_bench',
    ]);
    expect(view.cautious).toBe(false);
    expect(view.maxLevel).toBe(2);
    const beginner = await setup({ experience: 'none' });
    expect((await beginner.repo.view({ feasibleOnly: false })).maxLevel).toBe(1);
  });

  it('sans lieu principal : place null, tout le matériel, le filtre ne masque rien', async () => {
    const { repo } = await setup({ place: 'garage-secondary' });
    const on = await repo.view({ feasibleOnly: true });
    const off = await repo.view({ feasibleOnly: false });
    expect(on.place).toBeNull();
    expect(on.groups).toEqual(off.groups);
    expect(counts(on.groups)).toEqual({ chest: 5, back: 1, glutes: 3, quads: 3, hamstrings: 2, ...NO_GROUP });

    const search = await repo.searchExercises('squat', { feasibleOnly: true });
    expect(ids(search.results)).toEqual(['bodyweight-squat', 'back-squat', 'goblet-squat']);
    expect(search.hiddenByFeasible).toBe(0);

    const bench = await repo.getSheetView('bench-press');
    expect(bench?.feasibleHere).toBe(true);
    // Remplaçants avec tout le matériel : le développé couché à la barre en fait partie.
    expect(ids((await repo.getSheetView('dumbbell-bench-press'))?.substitutes ?? [])).toContain(
      'bench-press',
    );
  });

  it('le hook suit le filtre et le lieu principal choisi ensuite', async () => {
    const { services, db } = await setup({ place: null });
    let feasibleOnly = true;
    const { result, rerender } = renderHook(() => useExerciseView({ feasibleOnly }), {
      wrapper: wrapper(services),
    });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current?.place).toBeNull());
    expect(result.current?.groups.find((g) => g.code === 'back')?.count).toBe(1);

    await act(() => seedGarage(db));
    await waitFor(() => expect(result.current?.place?.name).toBe('Garage'));
    expect(result.current?.groups.find((g) => g.code === 'back')?.count).toBe(0);

    feasibleOnly = false;
    rerender();
    await waitFor(() => expect(result.current?.groups.find((g) => g.code === 'back')?.count).toBe(1));
  });
});

describe('profil prudent (Review Focus 2)', () => {
  it('mineur : aucune fiche not_for_minors dans les groupes, la recherche ou les variantes', async () => {
    const { repo } = await setup({ me: MINOR, place: null });
    const view = await repo.view({ feasibleOnly: false });
    expect(view.cautious).toBe(true);
    expect(counts(view.groups)).toEqual({
      chest: 4,
      back: 1,
      glutes: 3,
      quads: 3,
      hamstrings: 1,
      ...NO_GROUP,
    });

    const listed: ServedSheet[] = [];
    for (const g of MUSCLE_GROUPS)
      listed.push(...((await repo.groupExercises(g.code, { feasibleOnly: false })) ?? []));
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.filter((s) => s.not_for_minors)).toEqual([]);

    for (const query of ['pompe', 'nordic', 'curl', 'archer push']) {
      const search = await repo.searchExercises(query, { feasibleOnly: false });
      expect(
        search.results.filter((s) => s.not_for_minors),
        query,
      ).toEqual([]);
      expect(search.hiddenByCautious, query).toBe(true);
    }
    expect(ids((await repo.searchExercises('pompe', { feasibleOnly: false })).results)).toEqual([
      'push-up',
      'wall-push-up',
    ]);

    for (const sheet of CATALOG) {
      const view = await repo.getSheetView(sheet.id);
      const variants = [view?.chain.easier, view?.chain.harder, ...(view?.substitutes ?? [])];
      expect(
        variants.filter((s) => s?.not_for_minors),
        sheet.id,
      ).toEqual([]);
    }
    // La chaîne des pompes s'arrête avant la pompe archer.
    expect((await repo.getSheetView('push-up'))?.chain).toEqual({
      easier: CATALOG.find((s) => s.id === 'wall-push-up'),
    });
  });

  it('adulte : les mêmes fiches sont proposées, et rien n’est masqué par le mode prudent', async () => {
    const { repo } = await setup({ place: null });
    const search = await repo.searchExercises('pompe', { feasibleOnly: false });
    expect(ids(search.results)).toEqual(['push-up', 'archer-push-up', 'wall-push-up']);
    expect(search.hiddenByCautious).toBe(false);
    expect((await repo.getSheetView('push-up'))?.chain.harder?.id).toBe('archer-push-up');
    expect((await repo.searchExercises('squat', { feasibleOnly: false })).hiddenByCautious).toBe(false);
  });

  it('hiddenByCautious ne vaut que si une fiche masquée par le mode prudent correspond à la recherche', async () => {
    const { repo } = await setup({ me: MINOR });
    expect((await repo.searchExercises('squat', { feasibleOnly: false })).hiddenByCautious).toBe(false);
    expect((await repo.searchExercises('nordic', { feasibleOnly: true })).hiddenByCautious).toBe(true);
  });

  it('getSheetView d’une fiche not_for_minors en profil prudent → usable: false ; adulte → true', async () => {
    const minor = await setup({ me: MINOR });
    expect((await minor.repo.getSheetView('archer-push-up'))?.usable).toBe(false);
    expect((await minor.repo.getSheetView('nordic-curl'))?.usable).toBe(false);
    expect((await minor.repo.getSheetView('push-up'))?.usable).toBe(true);
    const adult = await setup();
    expect((await adult.repo.getSheetView('archer-push-up'))?.usable).toBe(true);
  });

  it('mode prudent du profil : prudent même si meta.me (calculé par le serveur) est en retard', async () => {
    const { repo } = await setup({ cautiousMode: true });
    expect((await repo.view({ feasibleOnly: false })).cautious).toBe(true);
    expect((await repo.getSheetView('nordic-curl'))?.usable).toBe(false);
  });

  it('questionnaire santé « prudence » avec l’accord santé actif : prudent ; sans accord : non', async () => {
    const health = { active: true, textVersion: '1.0', at: '2026-10-01T10:00:00.000Z' };
    const consented = makeMe({ consents: { ...makeMe().consents, health } });
    for (const [me, expected] of [
      [consented, true],
      [makeMe(), false],
    ] as const) {
      const { db, repo } = await setup({ me });
      await seedMirror(db, 'health_screening', [
        {
          id: 'u-1',
          ownerId: 'u-1',
          caution: true,
          questionnaireVersion: '1.0',
          answeredAt: '2026-10-01T10:00:00.000Z',
        },
      ]);
      expect((await repo.view({ feasibleOnly: false })).cautious).toBe(expected);
    }
  });
});

describe('searchExercises', () => {
  it('sans accents ni casse, sur le nom et les alias, mots dans n’importe quel ordre ; tri par nom', async () => {
    const { repo } = await setup({ place: null });
    const search = (q: string) =>
      repo.searchExercises(q, { feasibleOnly: false }).then((r) => ids(r.results));
    expect(await search('DEVELOPPE couche')).toEqual(['bench-press', 'dumbbell-bench-press']);
    expect(await search('couché  développé')).toEqual(['bench-press', 'dumbbell-bench-press']);
    expect(await search('bench press')).toEqual(['bench-press', 'dumbbell-bench-press']);
    expect(await search('air-squat')).toEqual(['bodyweight-squat']);
    expect(await search('squat avec haltere')).toEqual(['goblet-squat']);
    expect(await search('haltère')).toEqual(['dumbbell-bench-press', 'goblet-squat']);
    expect(await search('zzz')).toEqual([]);
  });

  it('filtre Faisable : résultats faisables au lieu principal, hiddenByFeasible = fiches masquées par lui', async () => {
    const { repo } = await setup();
    const on = await repo.searchExercises('squat', { feasibleOnly: true });
    expect(ids(on.results)).toEqual(['bodyweight-squat', 'goblet-squat']);
    expect(on.hiddenByFeasible).toBe(1);
    const off = await repo.searchExercises('squat', { feasibleOnly: false });
    expect(ids(off.results)).toEqual(['bodyweight-squat', 'back-squat', 'goblet-squat']);
    expect(off.hiddenByFeasible).toBe(0);
    const none = await repo.searchExercises('tirage', { feasibleOnly: true });
    expect(none).toEqual({ results: [], hiddenByFeasible: 1, hiddenByCautious: false });
  });

  it('une fiche retirée n’est jamais trouvée ; recherche vide ou sans lettre : aucun résultat', async () => {
    const { repo } = await setup({ place: null });
    expect(ids((await repo.searchExercises('sauté', { feasibleOnly: false })).results)).toEqual([]);
    expect((await repo.searchExercises('sauté', { feasibleOnly: true })).hiddenByFeasible).toBe(0);
    for (const q of ['', '   ', '-!']) {
      expect(await repo.searchExercises(q, { feasibleOnly: false })).toEqual({
        results: [],
        hiddenByFeasible: 0,
        hiddenByCautious: false,
      });
    }
  });

  it('catalogue absent : aucun résultat', async () => {
    const { repo } = await setup({ catalog: null });
    expect(await repo.searchExercises('squat', { feasibleOnly: false })).toEqual({
      results: [],
      hiddenByFeasible: 0,
      hiddenByCautious: false,
    });
  });
});

describe('groupExercises', () => {
  it('tri par niveau, puis par nom (collation française), puis par id ; code inconnu → null', async () => {
    const { repo } = await setup({ place: null });
    expect(ids((await repo.groupExercises('chest', { feasibleOnly: false })) ?? [])).toEqual([
      'dumbbell-bench-press',
      'push-up',
      'wall-push-up',
      'bench-press',
      'archer-push-up',
    ]);
    expect(await repo.groupExercises('shoulders', { feasibleOnly: false })).toEqual([]);
    expect(await repo.groupExercises('inconnu', { feasibleOnly: false })).toBeNull();
  });

  it('même nom à la casse et aux accents près : départagés par id', async () => {
    const twins = [
      served({ id: 'squat-b', name: 'Squat Éclair' }),
      served({ id: 'squat-a', name: 'squat eclair' }),
    ];
    const { repo } = await setup({ catalog: twins, place: null });
    expect(ids((await repo.groupExercises('quads', { feasibleOnly: false })) ?? [])).toEqual([
      'squat-a',
      'squat-b',
    ]);
  });
});

describe('getSheetView', () => {
  it('voisins de chaîne filtrés par usableChainSteps : un voisin infaisable au lieu n’est pas proposé', async () => {
    const { repo } = await setup();
    const goblet = await repo.getSheetView('goblet-squat');
    expect(goblet?.sheet.id).toBe('goblet-squat');
    expect(goblet?.usable).toBe(true);
    expect(goblet?.feasibleHere).toBe(true);
    expect(goblet?.chain.easier?.id).toBe('bodyweight-squat');
    expect(goblet?.chain.harder).toBeUndefined(); // squat barre : ni barre ni rack au Garage

    const nowhere = await setup({ place: null });
    expect((await nowhere.repo.getSheetView('goblet-squat'))?.chain.harder?.id).toBe('back-squat');
  });

  it('fiche infaisable au lieu : affichée (usable), feasibleHere faux', async () => {
    const { repo } = await setup();
    const back = await repo.getSheetView('back-squat');
    expect(back?.usable).toBe(true);
    expect(back?.feasibleHere).toBe(false);
    expect(back?.chain.easier?.id).toBe('goblet-squat');
  });

  it('remplaçants : faisables au lieu, plafonnés au niveau max du profil', async () => {
    const beginner = await setup({ experience: 'none', place: null });
    expect(ids((await beginner.repo.getSheetView('goblet-squat'))?.substitutes ?? [])).toEqual([
      'bodyweight-squat',
    ]);
    const confirmed = await setup({ experience: 'gt_24_months', place: null });
    expect(ids((await confirmed.repo.getSheetView('goblet-squat'))?.substitutes ?? [])).toEqual([
      'bodyweight-squat',
      'back-squat',
    ]);
    const garage = await setup({ experience: 'gt_24_months' });
    expect(ids((await garage.repo.getSheetView('goblet-squat'))?.substitutes ?? [])).toEqual([
      'bodyweight-squat',
    ]);
  });

  it('fiche retirée : lue, hors chaîne, avec ses remplaçants publiés ; id inconnu → null', async () => {
    const { repo } = await setup({ place: null });
    const retired = await repo.getSheetView('jump-squat');
    expect(retired?.sheet.status).toBe('retired');
    expect(retired?.usable).toBe(true);
    expect(retired?.chain).toEqual({});
    expect(ids(retired?.substitutes ?? [])).toEqual(['bodyweight-squat', 'goblet-squat', 'back-squat']);
    expect(await repo.getSheetView('inconnu')).toBeNull();
    expect(await (await setup({ catalog: null })).repo.getSheetView('goblet-squat')).toBeNull();
  });
});
