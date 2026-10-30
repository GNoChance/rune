import { EQUIPMENT, type EquipmentCode } from '@rune/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expandEquipment, feasible } from '../../src/catalog/equipment';
import { sheet } from '../fixtures/catalog';

const sorted = (codes: Iterable<EquipmentCode>) => [...codes].sort();

describe('expandEquipment (R-EQ-2)', () => {
  const cases: [string, EquipmentCode[], EquipmentCode[]][] = [
    ['lieu vide', [], []],
    ['le banc inclinable vaut aussi banc plat', ['adjustable_bench'], ['adjustable_bench', 'flat_bench']],
    ['le banc plat ne vaut pas banc inclinable', ['flat_bench'], ['flat_bench']],
    ['sans implication, rien ne change', ['dumbbells', 'pull_up_bar'], ['dumbbells', 'pull_up_bar']],
    [
      'doublons fusionnés',
      ['adjustable_bench', 'flat_bench', 'dumbbells', 'dumbbells'],
      ['adjustable_bench', 'dumbbells', 'flat_bench'],
    ],
    [
      'les objets du quotidien ne sont jamais implicites (R-EQ-3)',
      ['box', 'flat_bench'],
      ['box', 'flat_bench'],
    ],
  ];

  it.each(cases)('%s', (_, codes, expected) => expect(sorted(expandEquipment(codes))).toEqual(expected));

  it('accepte un Set et ne le modifie pas', () => {
    const place = new Set<EquipmentCode>(['adjustable_bench']);
    expect(sorted(expandEquipment(place))).toEqual(['adjustable_bench', 'flat_bench']);
    expect(sorted(place)).toEqual(['adjustable_bench']);
  });

  it('propriétés : garde chaque code, idempotente', () => {
    fc.assert(
      fc.property(fc.subarray([...EQUIPMENT]), (codes) => {
        const once = expandEquipment(codes);
        expect(codes.every((c) => once.has(c))).toBe(true);
        expect(sorted(expandEquipment(once))).toEqual(sorted(once));
      }),
    );
  });
});

describe('feasible (04 §6.1)', () => {
  const cases: [string, EquipmentCode[][], EquipmentCode[], boolean][] = [
    ['[[]] dans un lieu vide', [[]], [], true],
    ['[[]] dans une salle', [[]], ['barbell', 'squat_rack'], true],
    ['lieu vide, option à un code', [['dumbbells']], [], false],
    ['lieu vide, plusieurs options', [['dumbbells'], ['kettlebell']], [], false],
    ['plusieurs options : la première suffit', [['dumbbells'], ['kettlebell']], ['dumbbells'], true],
    ['plusieurs options : la seconde suffit', [['dumbbells'], ['kettlebell']], ['kettlebell'], true],
    ['plusieurs options : aucune', [['dumbbells'], ['kettlebell']], ['barbell'], false],
    ['option ET incomplète', [['flat_bench', 'dumbbells']], ['dumbbells'], false],
    ['option ET complète', [['flat_bench', 'dumbbells']], ['flat_bench', 'dumbbells'], true],
    [
      'banc inclinable vaut banc plat',
      [['flat_bench', 'dumbbells']],
      ['adjustable_bench', 'dumbbells'],
      true,
    ],
    [
      'banc plat ne vaut pas banc inclinable',
      [['adjustable_bench', 'dumbbells']],
      ['flat_bench', 'dumbbells'],
      false,
    ],
  ];

  it.each(cases)('%s', (_, options, place, expected) => {
    expect(feasible(sheet({ equipment_options: options }), expandEquipment(place))).toBe(expected);
  });

  const arbOptions = fc.array(fc.subarray([...EQUIPMENT], { maxLength: 3 }), { minLength: 1, maxLength: 4 });

  it('propriété : [[]] toujours faisable', () => {
    fc.assert(
      fc.property(fc.subarray([...EQUIPMENT]), (place) => {
        expect(feasible(sheet({ equipment_options: [[]] }), expandEquipment(place))).toBe(true);
      }),
    );
  });

  it('propriété : un lieu plus garni reste faisable', () => {
    fc.assert(
      fc.property(arbOptions, fc.subarray([...EQUIPMENT]), fc.subarray([...EQUIPMENT]), (options, a, b) => {
        const ex = sheet({ equipment_options: options });
        if (feasible(ex, expandEquipment(a))) expect(feasible(ex, expandEquipment([...a, ...b]))).toBe(true);
      }),
    );
  });

  it('propriété : faisable ⇔ une option entièrement dans le lieu', () => {
    fc.assert(
      fc.property(arbOptions, fc.subarray([...EQUIPMENT]), (options, codes) => {
        const place = expandEquipment(codes);
        const expected = options.some((option) => option.every((code) => place.has(code)));
        expect(feasible(sheet({ equipment_options: options }), place)).toBe(expected);
      }),
    );
  });
});
