import { describe, expect, it } from 'vitest';
import {
  add,
  ceilTo,
  cmp,
  div,
  floorTo,
  mul,
  q,
  roundHalfUpTo,
  sub,
  toNumber,
} from '../../src/nutrition/exact';

describe('arithmétique exacte', () => {
  it('arrondit à la moitié vers le haut', () => {
    expect(roundHalfUpTo(q(1225, 10), 5n)).toBe(125n);
    expect(roundHalfUpTo(q(3275, 10), 5n)).toBe(330n);
    expect(roundHalfUpTo(q(2207, 1), 50n)).toBe(2200n);
    expect(roundHalfUpTo(q(2225, 1), 50n)).toBe(2250n);
    expect(roundHalfUpTo(q(-25, 1), 50n)).toBe(0n);
  });

  it('plafond et plancher au multiple', () => {
    expect(ceilTo(q(206925, 100), 50n)).toBe(2100n);
    expect(ceilTo(q(2100, 1), 50n)).toBe(2100n);
    expect(floorTo(q(206925, 100), 50n)).toBe(2050n);
    expect(floorTo(q(-1, 1), 50n)).toBe(-50n);
    expect(ceilTo(q(-1, 1), 50n)).toBe(0n);
  });

  it('opérations et comparaison sur des rationnels réduits', () => {
    expect(add(q(1, 3), q(1, 6))).toEqual(q(1, 2));
    expect(sub(q(1, 2), q(1, 3))).toEqual(q(1, 6));
    expect(mul(q(2, 3), q(3, 4))).toEqual(q(1, 2));
    expect(div(q(1, 2), q(1, 4))).toEqual(q(2));
    expect(q(2, -4)).toEqual(q(-1, 2));
    expect(cmp(q(1, 3), q(2, 6))).toBe(0);
    expect(cmp(q(1, 3), q(1, 2))).toBe(-1);
    expect(cmp(q(-1, 3), q(-1, 2))).toBe(1);
  });

  it('toNumber garde au plus le nombre de décimales demandé', () => {
    expect(toNumber(q(134525, 100), 2)).toBe(1345.25);
    expect(toNumber(q(1, 3), 2)).toBe(0.33);
    expect(toNumber(q(2, 3), 2)).toBe(0.67);
  });

  it('refuse un dénominateur nul et un pas invalide', () => {
    expect(() => q(1, 0)).toThrow();
    expect(() => roundHalfUpTo(q(1), 0n)).toThrow();
  });
});
