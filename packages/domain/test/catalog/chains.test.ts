import type { ExerciseSheet } from '@rune/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildChains, chainRank, usableChainSteps } from '../../src/catalog/chains';
import { expandEquipment } from '../../src/catalog/equipment';
import { isUsable } from '../../src/catalog/usable';
import { arbCatalog, context, linkChain, PUSH_UP_CHAIN, sheet } from '../fixtures/catalog';

const ids = (sheets: readonly { id: string }[] | undefined) => sheets?.map((s) => s.id);
const PUSH_UP_IDS = ['wall-push-up', 'incline-push-up', 'push-up', 'feet-elevated-push-up', 'archer-push-up'];

/** `PUSH_UP_CHAIN` où la fiche `id` reçoit `fields`. */
const pushUps = (id: string, fields: Partial<ExerciseSheet>) =>
  PUSH_UP_CHAIN.map((s) => (s.id === id ? { ...s, ...fields } : s));

describe('buildChains (R-CH-5)', () => {
  it("ordonne la chaîne de la plus facile à la plus dure, quel que soit l'ordre du catalogue", () => {
    expect(ids(buildChains(PUSH_UP_CHAIN).get('push-up'))).toEqual(PUSH_UP_IDS);
    expect(ids(buildChains([...PUSH_UP_CHAIN].reverse()).get('push-up'))).toEqual(PUSH_UP_IDS);
  });

  it('chainRank va de 1 à n', () => {
    const chains = buildChains([...PUSH_UP_CHAIN].reverse());
    expect(PUSH_UP_CHAIN.map((s) => chainRank(s, chains))).toEqual([1, 2, 3, 4, 5]);
  });

  it('chainRank vaut null hors chaîne ou pour une chaîne inconnue', () => {
    const chains = buildChains(PUSH_UP_CHAIN);
    expect(chainRank(sheet(), chains)).toBeNull();
    expect(chainRank(sheet({ chain_id: 'squat' }), chains)).toBeNull();
  });

  it('ne garde que les fiches à chaîne, une entrée par chaîne en ordre binaire', () => {
    const squats = linkChain('squat', [
      sheet({ id: 'box-squat', level: 1 }),
      sheet({ id: 'goblet-squat', level: 1 }),
      sheet({ id: 'bulgarian-split-squat', movement_pattern: 'lunge', level: 2 }),
    ]);
    const chains = buildChains([sheet({ id: 'leg-press' }), ...squats, ...PUSH_UP_CHAIN]);
    expect([...chains.keys()]).toEqual(['push-up', 'squat']);
    expect(ids(chains.get('squat'))).toEqual(['box-squat', 'goblet-squat', 'bulgarian-split-squat']);
  });

  it('une fiche retirée sort de sa chaîne (R-CH-6)', () => {
    // Avant de retirer la pompe murale, on relie ses voisines : la pompe inclinée devient la tête.
    const catalog = PUSH_UP_CHAIN.map((s) => {
      if (s.id === 'wall-push-up') return { ...s, status: 'retired' as const };
      if (s.id === 'incline-push-up') {
        const { easier_id: _, ...rest } = s;
        return rest;
      }
      return s;
    });
    const chains = buildChains(catalog);
    expect(ids(chains.get('push-up'))).toEqual(PUSH_UP_IDS.slice(1));
    expect(catalog.map((s) => chainRank(s, chains))).toEqual([null, 1, 2, 3, 4]);
  });

  it('une chaîne dont tous les membres sont retirés disparaît', () => {
    expect(buildChains(PUSH_UP_CHAIN.map((s) => ({ ...s, status: 'retired' as const }))).size).toBe(0);
  });

  it('les brouillons comptent dans la chaîne (catalogue du serveur)', () => {
    const chains = buildChains(pushUps('push-up', { status: 'draft' }));
    expect(ids(chains.get('push-up'))).toEqual(PUSH_UP_IDS);
  });

  it('chaîne coupée (brouillon du milieu absent du catalogue servi) : morceaux par niveau de leur tête', () => {
    const served = PUSH_UP_CHAIN.filter((s) => s.id !== 'push-up');
    expect(ids(buildChains(served).get('push-up'))).toEqual([
      'wall-push-up',
      'incline-push-up',
      'feet-elevated-push-up',
      'archer-push-up',
    ]);
  });

  it('chaîne cyclique (refusée par le validateur) : chaque membre une fois, sans boucle', () => {
    const cycle = linkChain('loop', [sheet({ id: 'c' }), sheet({ id: 'a' }), sheet({ id: 'b' })]).map((s) =>
      s.id === 'c' ? { ...s, easier_id: 'b' } : s.id === 'b' ? { ...s, harder_id: 'c' } : s,
    );
    expect(ids(buildChains(cycle).get('loop'))).toEqual(['a', 'b', 'c']);
  });

  it('propriété : chaque fiche non retirée à chaîne apparaît une fois, dans la bonne chaîne', () => {
    fc.assert(
      fc.property(arbCatalog(), (catalog) => {
        const chains = buildChains(catalog);
        const chained = catalog.filter((s) => s.chain_id !== undefined && s.status !== 'retired');
        expect([...chains.values()].flat().length).toBe(chained.length);
        for (const s of chained) expect(ids(chains.get(s.chain_id ?? ''))).toContain(s.id);
        for (const [chainId, members] of chains)
          expect(members.every((m) => m.chain_id === chainId)).toBe(true);
      }),
    );
  });

  it("propriété : le résultat ne dépend pas de l'ordre du catalogue", () => {
    const arb = arbCatalog().chain((catalog) =>
      fc.tuple(
        fc.constant(catalog),
        fc.shuffledSubarray(catalog, { minLength: catalog.length, maxLength: catalog.length }),
      ),
    );
    fc.assert(
      fc.property(arb, ([catalog, shuffled]) => {
        const a = buildChains(catalog);
        const b = buildChains(shuffled);
        expect([...b.keys()]).toEqual([...a.keys()]);
        for (const [chainId, members] of a) expect(ids(b.get(chainId))).toEqual(ids(members));
      }),
    );
  });
});

describe('usableChainSteps (04 §6.3)', () => {
  const steps = (catalog: readonly ExerciseSheet[], overrides: Parameters<typeof context>[1] = {}) =>
    ids(usableChainSteps('push-up', context([...catalog], overrides)));

  it("adulte sans lieu : toute la chaîne, dans l'ordre des rangs", () => {
    expect(steps([...PUSH_UP_CHAIN].reverse())).toEqual(PUSH_UP_IDS);
  });

  it("profil prudent : s'arrête avant la première variante not_for_minors", () => {
    expect(steps(PUSH_UP_CHAIN, { cautious: true })).toEqual(PUSH_UP_IDS.slice(0, 4));
  });

  it('profil prudent : ne reprend pas après une variante not_for_minors du milieu', () => {
    const catalog = pushUps('push-up', { not_for_minors: true });
    expect(steps(catalog, { cautious: true })).toEqual(['wall-push-up', 'incline-push-up']);
    expect(steps(catalog)).toEqual(PUSH_UP_IDS);
  });

  it('profil prudent : vide si la première variante est not_for_minors', () => {
    expect(steps(pushUps('wall-push-up', { not_for_minors: true }), { cautious: true })).toEqual([]);
  });

  it('lieu vide : saute les variantes qui demandent du matériel', () => {
    const empty = expandEquipment([]);
    expect(steps(PUSH_UP_CHAIN, { equipment: empty })).toEqual(['wall-push-up', 'push-up', 'archer-push-up']);
    expect(steps(PUSH_UP_CHAIN, { equipment: empty, cautious: true })).toEqual(['wall-push-up', 'push-up']);
  });

  it('saute une variante non publiée, pas la suite de la chaîne', () => {
    expect(steps(pushUps('push-up', { status: 'reviewed' }))).toEqual([
      'wall-push-up',
      'incline-push-up',
      'feet-elevated-push-up',
      'archer-push-up',
    ]);
  });

  it("le niveau ne bloque pas l'avancée dans une chaîne (04 §3.5)", () => {
    expect(steps(PUSH_UP_CHAIN, { maxLevel: 1 })).toEqual(PUSH_UP_IDS);
  });

  it('chaîne inconnue : vide', () => {
    expect(usableChainSteps('pull-up', context([...PUSH_UP_CHAIN]))).toEqual([]);
  });

  it('propriété : des fiches utilisables de la chaîne, rangs croissants, aucune not_for_minors en profil prudent', () => {
    fc.assert(
      fc.property(
        arbCatalog(),
        fc.boolean(),
        fc.constantFrom('chain-a', 'chain-b'),
        (catalog, cautious, id) => {
          const ctx = context(catalog, { cautious });
          const chains = buildChains(catalog);
          const result = usableChainSteps(id, ctx);
          const ranks = result.map((s) => chainRank(s, chains) ?? Number.NaN);
          expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
          for (const s of result) {
            expect(s.chain_id).toBe(id);
            expect(isUsable(s, ctx)).toBe(true);
            if (cautious) expect(s.not_for_minors).toBe(false);
          }
        },
      ),
    );
  });
});
