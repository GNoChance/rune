import { describe, expect, it } from 'vitest';
import {
  addDays,
  isSuspiciousEntry,
  mondayOf,
  movingAverage7,
  referenceWeight,
  type WeighIn,
  weekMean,
} from '../../src/nutrition';

const w = (date: string, weightG: number): WeighIn => ({ date, weightG });

describe('dates sans fuseau', () => {
  it('mondayOf', () => {
    expect(mondayOf('2026-10-26')).toBe('2026-10-26');
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
    expect(mondayOf('2026-11-02')).toBe('2026-11-02');
    expect(mondayOf('2024-03-01')).toBe('2024-02-26');
  });
  it('addDays', () => {
    expect(addDays('2026-10-26', 7)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('moyenne glissante et poids de référence', () => {
  const data = [w('2026-11-01', 80_000), w('2026-11-03', 81_000), w('2026-11-07', 82_000)];
  it('moyenne de d-6 à d, arrondie au gramme', () => {
    expect(movingAverage7(data, '2026-11-07')).toBe(81_000);
    expect(movingAverage7(data, '2026-11-08')).toBe(81_500);
    const r = [w('2026-11-01', 80_000), w('2026-11-02', 80_001), w('2026-11-03', 80_001)];
    expect(movingAverage7(r, '2026-11-03')).toBe(80_001);
    expect(movingAverage7(data, '2026-11-20')).toBeNull();
  });
  it('référence : moyenne glissante arrondie à 100 g', () => {
    expect(referenceWeight([w('2026-11-01', 80_040), w('2026-11-02', 80_000)], '2026-11-02')).toBe(80_000);
    expect(referenceWeight([w('2026-11-01', 80_050)], '2026-11-01')).toBe(80_100);
  });
  it('à défaut, dernière pesée de moins de 14 jours', () => {
    const one = [w('2026-11-01', 80_000)];
    expect(referenceWeight(one, '2026-11-14')).toBe(80_000);
    expect(referenceWeight(one, '2026-11-15')).toBeNull();
  });
});

describe('moyenne de semaine', () => {
  it('définie à 3 pesées seulement', () => {
    const two = [w('2026-10-26', 80_000), w('2026-11-01', 80_000), w('2026-11-02', 90_000)];
    expect(weekMean(two, '2026-10-26')).toEqual({ count: 2, meanG: null });
    const three = [...two, w('2026-10-28', 80_300)];
    expect(weekMean(three, '2026-10-26')).toEqual({ count: 3, meanG: 80_100 });
  });
});

describe('isSuspiciousEntry', () => {
  const base = [w('2026-11-01', 80_000), w('2026-11-02', 80_000)];
  it('seuil de 3 000 g', () => {
    expect(isSuspiciousEntry(base, 83_000, '2026-11-03')).toBe(false);
    expect(isSuspiciousEntry(base, 83_100, '2026-11-03')).toBe(true);
    expect(isSuspiciousEntry(base, 76_900, '2026-11-03')).toBe(true);
    expect(isSuspiciousEntry([], 99_000, '2026-11-03')).toBe(false);
  });
});
