import { describe, expect, it } from 'vitest';
import { parseWeight } from '../../src/features/nutrition/parse-weight';

describe('parseWeight', () => {
  it.each([
    ['72,5', 72_500],
    ['72.5', 72_500],
    ['72', 72_000],
    [' 30 ', 30_000],
    ['250', 250_000],
  ])('« %s » → %i g', (text, weightG) => {
    expect(parseWeight(text)).toEqual({ ok: true, weightG });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['72,55', 'decimals'],
    ['7 2', 'format'],
    ['abc', 'format'],
    ['29,9', 'range'],
    ['250,1', 'range'],
  ])('« %s » → %s', (text, reason) => {
    expect(parseWeight(text)).toEqual({ ok: false, reason });
  });
});
