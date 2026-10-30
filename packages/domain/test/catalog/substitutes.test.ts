/*
 * Suite unique de `substitutes` (04 §13 critère 3) : elle tourne sous Node (projet domain) et sous happy-dom
 * (projet web, `apps/web/test/domain-parity.test.ts` l'importe). Rien ici ne doit dépendre de Node.
 */
import { type ExerciseSheet, SUBSTITUTE_LIMIT } from '@rune/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expandEquipment } from '../../src/catalog/equipment';
import { substitutes } from '../../src/catalog/substitutes';
import type { CatalogContext } from '../../src/catalog/usable';
import { arbSubstituteCase, context, sheet } from '../fixtures/catalog';

const ids = (sheets: readonly { id: string }[]) => sheets.map((s) => s.id);
const common = (a: readonly string[], b: readonly string[]) => a.filter((x) => b.includes(x)).length;

/** Score de 04 §6.4, réécrit ici pour servir d'oracle indépendant de l'implémentation. */
function oracleScore(ex: ExerciseSheet, c: ExerciseSheet): number {
  return (
    3 * common(ex.primary_muscles, c.primary_muscles) +
    common(ex.secondary_muscles, c.secondary_muscles) -
    2 * Math.abs(ex.level - c.level) +
    (ex.unilateral === c.unilateral ? 1 : 0) +
    (ex.load_mode === c.load_mode ? 1 : 0)
  );
}

/** Candidats de 04 §6.4, par score décroissant puis `id` en ordre binaire, au plus `SUBSTITUTE_LIMIT`. */
function oracle(ex: ExerciseSheet, ctx: CatalogContext): string[] {
  const { equipment } = ctx;
  const feasibleHere = (c: ExerciseSheet) =>
    equipment === 'all' || c.equipment_options.some((option) => option.every((code) => equipment.has(code)));
  const sameChain = (c: ExerciseSheet) => ex.chain_id !== undefined && c.chain_id === ex.chain_id;
  return ctx.catalog
    .filter(
      (c) =>
        c.id !== ex.id &&
        c.status === 'published' &&
        feasibleHere(c) &&
        !(ctx.cautious && c.not_for_minors) &&
        c.level <= ctx.maxLevel &&
        (c.movement_pattern === ex.movement_pattern || sameChain(c)) &&
        common(c.primary_muscles, ex.primary_muscles) > 0,
    )
    .sort((a, b) => oracleScore(ex, b) - oracleScore(ex, a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, SUBSTITUTE_LIMIT)
    .map((c) => c.id);
}

/** Variante du squat goblet (squat, quadriceps et fessiers, niveau 1, bilatéral, haltère, sans matériel). */
const squat = (id: string, fields: Partial<ExerciseSheet> = {}) =>
  sheet({ id, secondary_muscles: [], load_mode: 'bodyweight', equipment_options: [[]], ...fields });

describe('substitutes (04 §6.4) : tableaux de cas', () => {
  const ex = sheet(); // squat goblet : principaux quadriceps et fessiers ; secondaires adducteurs et abdos.
  const catalog: ExerciseSheet[] = [
    ex,
    // 3 × 2 + 1 (abdos) − 0 + 1 + 1 (haltère) = 9
    squat('kettlebell-front-squat', {
      secondary_muscles: ['abs'],
      load_mode: 'dumbbell',
      equipment_options: [['kettlebell']],
    }),
    // 3 × 2 + 0 − 0 + 1 + 0 = 7
    squat('air-squat'),
    // 7, mais not_for_minors
    squat('jump-squat', { not_for_minors: true }),
    // 7, mais demande une barre guidée
    squat('smith-squat', { load_mode: 'machine', equipment_options: [['smith_machine']] }),
    // 3 × 1 + 1 (abdos) − 2 + 1 + 1 = 4
    squat('heels-elevated-squat', {
      primary_muscles: ['quadriceps'],
      secondary_muscles: ['glutes', 'abs'],
      level: 2,
      load_mode: 'dumbbell',
      equipment_options: [['dumbbells']],
    }),
    // 3 × 2 + 0 − 2 + 0 + 0 = 4 : égalité avec le précédent, départagée par l'id
    squat('single-leg-box-squat', { unilateral: true, level: 2 }),
    // 3 × 2 + 0 − 4 + 1 + 0 = 3, niveau 3
    squat('pistol-squat', { level: 3 }),
    // écartées dans tous les contextes
    squat('barbell-back-squat', { status: 'draft' }),
    squat('safety-bar-squat', { status: 'reviewed' }),
    squat('old-squat', { status: 'retired' }),
    squat('cossack-squat', { primary_muscles: ['adductors'] }), // aucun muscle principal commun
    squat('walking-lunge', { movement_pattern: 'lunge' }), // autre pattern, pas de chaîne
    squat('leg-curl', { movement_pattern: 'knee_flexion', primary_muscles: ['hamstrings'] }),
  ];
  const place = expandEquipment(['dumbbells', 'kettlebell']);

  const cases: [string, Partial<CatalogContext>, string[]][] = [
    [
      'profil prudent, niveau 2 au plus, haltères et kettlebell',
      { equipment: place, maxLevel: 2, cautious: true },
      ['kettlebell-front-squat', 'air-squat', 'heels-elevated-squat', 'single-leg-box-squat'],
    ],
    [
      'adulte : la fiche not_for_minors revient, à égalité avec air-squat',
      { equipment: place, maxLevel: 2 },
      ['kettlebell-front-squat', 'air-squat', 'jump-squat', 'heels-elevated-squat', 'single-leg-box-squat'],
    ],
    [
      'niveau 3 permis : 6 candidats, les 5 meilleurs',
      { equipment: place, maxLevel: 3 },
      ['kettlebell-front-squat', 'air-squat', 'jump-squat', 'heels-elevated-squat', 'single-leg-box-squat'],
    ],
    [
      'sans lieu principal : la barre guidée devient faisable',
      { equipment: 'all', maxLevel: 2 },
      ['kettlebell-front-squat', 'air-squat', 'jump-squat', 'smith-squat', 'heels-elevated-squat'],
    ],
    [
      'niveau 1 au plus, lieu vide',
      { equipment: expandEquipment([]), maxLevel: 1, cautious: true },
      ['air-squat'],
    ],
  ];

  it.each(cases)('%s', (_, overrides, expected) => {
    const ctx = context(catalog, overrides);
    expect(ids(substitutes(ex, ctx))).toEqual(expected);
    expect(ids(substitutes(ex, { ...ctx, catalog: [...catalog].reverse() }))).toEqual(expected);
  });

  it('même chaîne non vide : un autre pattern devient candidat', () => {
    const chained = { ...ex, chain_id: 'squat' };
    const lunge = squat('bulgarian-split-squat', { movement_pattern: 'lunge', chain_id: 'squat' });
    const otherChain = squat('reverse-lunge', { movement_pattern: 'lunge', chain_id: 'lunge' });
    expect(ids(substitutes(chained, context([chained, lunge, otherChain])))).toEqual([
      'bulgarian-split-squat',
    ]);
    expect(ids(substitutes(ex, context([ex, lunge, otherChain])))).toEqual([]);
  });

  it('une fiche retirée ou non utilisable a quand même ses remplaçants (spec brique 2 §4.2)', () => {
    const retired = sheet({ status: 'retired' });
    expect(ids(substitutes(retired, context([retired, squat('air-squat')])))).toEqual(['air-squat']);
    const archer = sheet({ not_for_minors: true });
    expect(ids(substitutes(archer, context([archer, squat('air-squat')], { cautious: true })))).toEqual([
      'air-squat',
    ]);
  });

  it(`au plus ${SUBSTITUTE_LIMIT} résultats, égalités par id`, () => {
    expect(SUBSTITUTE_LIMIT).toBe(5);
    const seven = ['v6', 'v2', 'v7', 'v1', 'v4', 'v3', 'v5'].map((id) => squat(id));
    expect(ids(substitutes(ex, context(seven)))).toEqual(['v1', 'v2', 'v3', 'v4', 'v5']);
  });

  it('ordre binaire des id, pas localeCompare : « Zed » (0x5A) avant « alpha » (0x61)', () => {
    // Ids hors slug, pour distinguer les deux ordres (sur [a-z0-9-] ils coïncident).
    const pair = [squat('alpha'), squat('Zed')];
    expect(ids(substitutes(ex, context(pair)))).toEqual(['Zed', 'alpha']);
  });

  it('catalogue vide : aucun remplaçant', () => expect(substitutes(ex, context([]))).toEqual([]));
});

describe('substitutes : propriétés', () => {
  it('jamais la fiche elle-même, ni une fiche non publiée, non faisable, au-dessus de maxLevel, ou not_for_minors en profil prudent', () => {
    fc.assert(
      fc.property(arbSubstituteCase, ({ ex, ctx }) => {
        const { equipment } = ctx;
        for (const c of substitutes(ex, ctx)) {
          expect(c.id).not.toBe(ex.id);
          expect(c.status).toBe('published');
          if (equipment !== 'all') {
            expect(c.equipment_options.some((option) => option.every((code) => equipment.has(code)))).toBe(
              true,
            );
          }
          expect(c.level).toBeLessThanOrEqual(ctx.maxLevel);
          if (ctx.cautious) expect(c.not_for_minors).toBe(false);
          const sameChain = ex.chain_id !== undefined && c.chain_id === ex.chain_id;
          expect(c.movement_pattern === ex.movement_pattern || sameChain).toBe(true);
          expect(common(c.primary_muscles, ex.primary_muscles)).toBeGreaterThan(0);
        }
      }),
    );
  });

  it(`au plus ${SUBSTITUTE_LIMIT} résultats, sans doublon`, () => {
    fc.assert(
      fc.property(arbSubstituteCase, ({ ex, ctx }) => {
        const result = ids(substitutes(ex, ctx));
        expect(result.length).toBeLessThanOrEqual(SUBSTITUTE_LIMIT);
        expect(new Set(result).size).toBe(result.length);
      }),
    );
  });

  it("ordre stable quel que soit l'ordre du catalogue", () => {
    const arb = arbSubstituteCase.chain(({ ex, ctx }) =>
      fc.record({
        ex: fc.constant(ex),
        ctx: fc.constant(ctx),
        shuffled: fc.shuffledSubarray(ctx.catalog, {
          minLength: ctx.catalog.length,
          maxLength: ctx.catalog.length,
        }),
      }),
    );
    fc.assert(
      fc.property(arb, ({ ex, ctx, shuffled }) => {
        expect(ids(substitutes(ex, { ...ctx, catalog: shuffled }))).toEqual(ids(substitutes(ex, ctx)));
      }),
    );
  });

  it('score décroissant, égalités départagées par id en ordre binaire', () => {
    fc.assert(
      fc.property(arbSubstituteCase, ({ ex, ctx }) => {
        const result = substitutes(ex, ctx);
        for (let i = 1; i < result.length; i++) {
          const [a, b] = [result[i - 1] as ExerciseSheet, result[i] as ExerciseSheet];
          const [sa, sb] = [oracleScore(ex, a), oracleScore(ex, b)];
          expect(sa > sb || (sa === sb && a.id < b.id), `${a.id} (${sa}) puis ${b.id} (${sb})`).toBe(true);
        }
      }),
    );
  });

  it("égale l'oracle de 04 §6.4 (aucun bon candidat oublié)", () => {
    fc.assert(
      fc.property(arbSubstituteCase, ({ ex, ctx }) => {
        expect(ids(substitutes(ex, ctx))).toEqual(oracle(ex, ctx));
      }),
    );
  });
});
