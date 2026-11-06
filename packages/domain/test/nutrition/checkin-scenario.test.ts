import { describe, expect, it } from 'vitest';
import { addDays, type CheckinInput, decideCheckin, type WeighIn } from '../../src/nutrition';

const S0 = '2026-10-26';
// M(S) voulues ; S3 n'a que 2 pesées
const weeks: { count: number; meanG: number }[] = [
  { count: 5, meanG: 80_000 },
  { count: 4, meanG: 79_900 },
  { count: 6, meanG: 79_800 },
  { count: 2, meanG: 79_000 },
  { count: 5, meanG: 79_200 },
  { count: 5, meanG: 78_700 },
];

const fixture = (): WeighIn[] =>
  weeks.flatMap((wk, i) =>
    Array.from({ length: wk.count }, (_, j) => ({ date: addDays(S0, i * 7 + j), weightG: wk.meanG })),
  );

type Out = ReturnType<typeof decideCheckin>;

const input = (
  i: number,
  weighIns: WeighIn[],
  startPoint: string,
  prevOut: Out | null,
  prevCountable: boolean,
): CheckinInput => ({
  weekStart: addDays(S0, i * 7),
  weighIns,
  startPoint,
  target: { effectiveGoal: 'lose', refWeightG: 80_000 },
  targetForPrevWeek: null,
  previousCheckin: prevOut
    ? {
        meanWeightG: prevOut.meanWeightG,
        position: prevOut.position,
        representative: true,
        countable: prevCountable,
      }
    : null,
  representative: true,
  heightCm: 180,
  requestedGoal: 'lose',
  safetyPause: false,
  limitReached: () => false,
});

describe('scénario de référence 07 §5.7.4', () => {
  it('S0 à S5', () => {
    const weighIns = fixture();
    const out: Out[] = [];
    weeks.forEach((_, i) => {
      out.push(decideCheckin(input(i, weighIns, S0, out[i - 1] ?? null, true)));
    });
    expect(out.map((o) => o.decision)).toEqual([
      'insufficient_data',
      'out_of_band_pending',
      'proposal',
      'insufficient_data',
      'insufficient_data',
      'in_band',
    ]);
    expect(out.map((o) => o.meanWeightG)).toEqual([80_000, 79_900, 79_800, null, 79_200, 78_700]);
    expect(out.map((o) => o.changePct)).toEqual([null, -0.13, -0.13, null, null, -0.63]);
    expect(out[1]?.position).toBe('above');
    expect(out[2]?.proposedDeltaKcal).toBe(-100);
    expect(out.map((o) => o.weighInCount)).toEqual([5, 4, 6, 2, 5, 5]);
  });

  it('même scénario sans bilan stocké : tout est recalculé depuis les pesées', () => {
    const weighIns = fixture();
    const r = decideCheckin({
      ...input(2, weighIns, S0, null, true),
      targetForPrevWeek: { effectiveGoal: 'lose' },
    });
    expect(r.decision).toBe('proposal');
  });

  it('refus : insufficient_data puis out_of_band_pending avant toute nouvelle proposition', () => {
    // refus pris le lundi de S3 : le point de départ devient ce lundi
    const startPoint = addDays(S0, 21);
    const w3 = [
      ...fixture().filter((x) => x.date < startPoint),
      ...Array.from({ length: 4 }, (_, j) => ({ date: addDays(S0, 21 + j), weightG: 79_700 })),
      ...Array.from({ length: 4 }, (_, j) => ({ date: addDays(S0, 28 + j), weightG: 79_600 })),
    ];
    const s3 = decideCheckin(input(3, w3, startPoint, decideCheckin(input(2, w3, S0, null, true)), false));
    expect(s3.decision).toBe('insufficient_data');
    const s4 = decideCheckin(input(4, w3, startPoint, s3, true));
    expect(s4.decision).toBe('out_of_band_pending');
  });
});
