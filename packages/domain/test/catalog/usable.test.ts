import type { EquipmentCode, ExerciseStatus } from '@rune/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expandEquipment } from '../../src/catalog/equipment';
import { isUsable, visibleWithoutPlace } from '../../src/catalog/usable';
import { arbEquipment, arbSheet, context, sheet } from '../fixtures/catalog';

const HOME = expandEquipment(['chair', 'table']);
const GYM = expandEquipment(['dumbbells', 'barbell', 'adjustable_bench']);

describe('isUsable (04 §6.2)', () => {
  const cases: [
    string,
    { status?: ExerciseStatus; not_for_minors?: boolean; level?: 1 | 2 | 3 },
    Set<EquipmentCode> | 'all',
    boolean,
    boolean,
  ][] = [
    ['publiée et faisable', {}, GYM, false, true],
    ['publiée, pas faisable dans le lieu', {}, HOME, false, false],
    ['publiée, sans lieu principal', {}, 'all', false, true],
    ['brouillon', { status: 'draft' }, GYM, false, false],
    ['relue, pas encore publiée', { status: 'reviewed' }, GYM, false, false],
    ['retirée', { status: 'retired' }, GYM, false, false],
    ['retirée, sans lieu principal', { status: 'retired' }, 'all', false, false],
    ['not_for_minors, adulte', { not_for_minors: true }, GYM, false, true],
    ['not_for_minors, profil prudent', { not_for_minors: true }, GYM, true, false],
    ['not_for_minors, profil prudent, sans lieu', { not_for_minors: true }, 'all', true, false],
    ['profil prudent, fiche permise', {}, GYM, true, true],
    ['niveau 3 : le niveau ne compte pas ici (substitutes le filtre)', { level: 3 }, GYM, false, true],
  ];

  it.each(cases)('%s', (_, fields, equipment, cautious, expected) => {
    expect(isUsable(sheet(fields), context([], { equipment, cautious, maxLevel: 1 }))).toBe(expected);
  });
});

describe('visibleWithoutPlace (spec brique 2 §4.1, interrupteur coupé ou sans lieu)', () => {
  const cases: [string, ExerciseStatus, boolean, boolean, boolean][] = [
    ['publiée', 'published', false, false, true],
    ['publiée, profil prudent', 'published', false, true, true],
    ['not_for_minors, adulte', 'published', true, false, true],
    ['not_for_minors, profil prudent', 'published', true, true, false],
    ['brouillon', 'draft', false, false, false],
    ['relue', 'reviewed', false, false, false],
    ['retirée', 'retired', false, false, false],
  ];

  it.each(cases)('%s', (_, status, notForMinors, cautious, expected) => {
    expect(visibleWithoutPlace(sheet({ status, not_for_minors: notForMinors }), cautious)).toBe(expected);
  });

  it('ignore le matériel : une fiche de salle reste visible', () => {
    expect(visibleWithoutPlace(sheet({ equipment_options: [['leg_press']] }), false)).toBe(true);
  });

  it("propriété : vaut isUsable avec equipment 'all'", () => {
    fc.assert(
      fc.property(arbSheet, fc.boolean(), (ex, cautious) => {
        expect(visibleWithoutPlace(ex, cautious)).toBe(isUsable(ex, context([], { cautious })));
      }),
    );
  });

  it('propriété : isUsable dans un lieu ⇒ visibleWithoutPlace', () => {
    fc.assert(
      fc.property(arbSheet, arbEquipment, fc.boolean(), (ex, equipment, cautious) => {
        if (isUsable(ex, context([], { equipment, cautious }))) {
          expect(visibleWithoutPlace(ex, cautious)).toBe(true);
        }
      }),
    );
  });
});
