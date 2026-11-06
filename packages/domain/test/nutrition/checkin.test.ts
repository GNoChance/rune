import { describe, expect, it } from 'vitest';
import { addDays, type CheckinInput, decideCheckin, type WeighIn } from '../../src/nutrition';

const week = (monday: string, count: number, meanG: number): WeighIn[] =>
  Array.from({ length: count }, (_, i) => ({ date: addDays(monday, i), weightG: meanG }));

const S0 = '2026-11-02';
const S1 = '2026-11-09';

const base = (over: Partial<CheckinInput> = {}): CheckinInput => ({
  weekStart: S1,
  weighIns: [...week(S0, 4, 80_000), ...week(S1, 4, 79_900)],
  startPoint: S0,
  target: { effectiveGoal: 'lose', refWeightG: 80_000 },
  targetForPrevWeek: null,
  previousCheckin: null,
  representative: true,
  heightCm: 180,
  requestedGoal: 'lose',
  safetyPause: false,
  limitReached: () => false,
  ...over,
});

type Prev = NonNullable<CheckinInput['previousCheckin']>;
const prev = (position: Prev['position'], extra: Partial<Prev> = {}): Prev => ({
  meanWeightG: 80_000,
  position,
  representative: true,
  countable: true,
  ...extra,
});

// semaine S1 de moyenne voulue, S0 stockée à 80,0 kg
const withMean = (meanG: number, p: Prev | null, over: Partial<CheckinInput> = {}) =>
  base({ weighIns: week(S1, 4, meanG), previousCheckin: p, ...over });

describe('decideCheckin', () => {
  it('sans bilan stocké, v vient des pesées ; hors bande sans précédent : pending', () => {
    const r = decideCheckin(base());
    expect(r.decision).toBe('out_of_band_pending');
    expect(r.position).toBe('above');
    expect(r.changePct).toBe(-0.13);
    expect(r.weighInCount).toBe(4);
    expect(r.proposedDeltaKcal).toBeNull();
  });
  it('M(S) à 2 pesées : insufficient_data', () => {
    const r = decideCheckin(base({ weighIns: week(S1, 2, 79_900) }));
    expect(r.decision).toBe('insufficient_data');
    expect(r.meanWeightG).toBeNull();
    expect(r.position).toBeNull();
    expect(r.weighInCount).toBe(2);
  });
  it('S-1 avant le point de départ : v non définie', () => {
    const r = decideCheckin(base({ startPoint: S1, previousCheckin: prev('above', { countable: false }) }));
    expect(r.decision).toBe('insufficient_data');
    expect(r.changePct).toBeNull();
    expect(decideCheckin(base({ startPoint: S1 })).decision).toBe('insufficient_data');
  });
  it('deux semaines au-dessus : proposition -100', () => {
    const r = decideCheckin(base({ previousCheckin: prev('above') }));
    expect(r.decision).toBe('proposal');
    expect(r.proposedDeltaKcal).toBe(-100);
  });
  it('position de S-1 calculée avec la bande de la cible en vigueur', () => {
    const wi = [...week('2026-10-26', 4, 80_100), ...week(S0, 4, 80_000), ...week(S1, 4, 79_900)];
    const r = decideCheckin(
      base({ weighIns: wi, startPoint: '2026-10-26', targetForPrevWeek: { effectiveGoal: 'lose' } }),
    );
    expect(r.decision).toBe('proposal');
    // la bande de maintain donnerait : S-1 = -0,12 % dans la bande, donc pending
    const r2 = decideCheckin(
      base({ weighIns: wi, startPoint: '2026-10-26', targetForPrevWeek: { effectiveGoal: 'maintain' } }),
    );
    expect(r2.decision).toBe('out_of_band_pending');
    // sans cible pour S-1 la position est inconnue
    expect(decideCheckin(base({ weighIns: wi, startPoint: '2026-10-26' })).decision).toBe(
      'out_of_band_pending',
    );
  });
  it('v = -1,2 puis -1,3 : proposition +100', () => {
    const a = decideCheckin(withMean(79_040, prev(null)));
    expect(a.changePct).toBe(-1.2);
    expect(a.decision).toBe('out_of_band_pending');
    expect(a.position).toBe('below');
    const b = decideCheckin(withMean(78_960, prev('below')));
    expect(b.changePct).toBe(-1.3);
    expect(b.decision).toBe('proposal');
    expect(b.proposedDeltaKcal).toBe(100);
  });
  it('v = -1,6 : rapid_loss +100 dès la première semaine', () => {
    const r = decideCheckin(withMean(78_720, prev('in')));
    expect(r.decision).toBe('rapid_loss');
    expect(r.proposedDeltaKcal).toBe(100);
    expect(r.changePct).toBe(-1.6);
  });
  it('-1,5 pile n est pas rapid_loss', () => {
    expect(decideCheckin(withMean(78_800, prev('in'))).decision).toBe('out_of_band_pending');
  });
  it('limit_reached sur proposition et sur rapid_loss', () => {
    const r = decideCheckin(base({ previousCheckin: prev('above'), limitReached: (d) => d === -100 }));
    expect(r.decision).toBe('limit_reached');
    const r2 = decideCheckin(withMean(78_720, prev('in'), { limitReached: (d) => d === 100 }));
    expect(r2.decision).toBe('limit_reached');
  });
  it('dans la bande : in_band, bornes incluses', () => {
    const r = decideCheckin(withMean(79_360, prev('above')));
    expect(r.changePct).toBe(-0.8);
    expect(r.decision).toBe('in_band');
    expect(r.position).toBe('in');
    expect(decideCheckin(withMean(79_600, prev(null))).decision).toBe('in_band');
    expect(decideCheckin(withMean(79_200, prev(null))).decision).toBe('in_band');
  });
  it('semaine non représentative : pas de delta', () => {
    const r = decideCheckin(base({ previousCheckin: prev('above'), representative: false }));
    expect(r.decision).toBe('non_representative_week');
    expect(r.proposedDeltaKcal).toBeNull();
  });
  it('S-1 non représentative : pas de proposition', () => {
    const r = decideCheckin(base({ previousCheckin: prev('above', { representative: false }) }));
    expect(r.decision).toBe('out_of_band_pending');
  });
  it('safety_pause actif et deux semaines au-dessus', () => {
    const r = decideCheckin(base({ previousCheckin: prev('above'), safetyPause: true }));
    expect(r.decision).toBe('safety_pause');
    expect(r.lowBmiSafety).toBe(false);
    expect(r.proposedDeltaKcal).toBeNull();
  });
  it('safety_pause ne bloque pas le +100', () => {
    const r = decideCheckin(withMean(78_960, prev('below'), { safetyPause: true }));
    expect(r.decision).toBe('proposal');
  });
  it('recalibrage dès 2 kg, puis la décision continue', () => {
    const r = decideCheckin(withMean(78_000, prev(null, { meanWeightG: 78_100 })));
    expect(r.recalibrate).toBe(true);
    expect(r.decision).toBe('out_of_band_pending');
    expect(decideCheckin(withMean(78_001, prev(null, { meanWeightG: 78_100 }))).recalibrate).toBe(false);
    const r3 = decideCheckin(
      withMean(78_000, prev(null, { meanWeightG: 78_100 }), { representative: false }),
    );
    expect(r3.recalibrate).toBe(true);
    expect(r3.decision).toBe('non_representative_week');
  });
  it('lose et IMC < 18,5 : lowBmiSafety et safety_pause', () => {
    // 1,80 m : seuil 59,94 kg
    const low = { target: { effectiveGoal: 'lose', refWeightG: 59_900 } } as const;
    const r = decideCheckin(withMean(59_900, prev('above'), low));
    expect(r.lowBmiSafety).toBe(true);
    expect(r.decision).toBe('safety_pause');
    const r2 = decideCheckin(
      withMean(59_900, prev('above'), {
        requestedGoal: 'maintain',
        target: { effectiveGoal: 'maintain', refWeightG: 59_900 },
      }),
    );
    expect(r2.lowBmiSafety).toBe(false);
  });
  it('bandes maintain et gain', () => {
    const m = decideCheckin(
      withMean(80_200, prev(null), {
        requestedGoal: 'maintain',
        target: { effectiveGoal: 'maintain', refWeightG: 80_000 },
      }),
    );
    expect(m.decision).toBe('in_band');
    const g = decideCheckin(
      withMean(80_100, prev('below'), {
        requestedGoal: 'gain',
        target: { effectiveGoal: 'gain', refWeightG: 80_000 },
      }),
    );
    expect(g.decision).toBe('proposal');
    expect(g.proposedDeltaKcal).toBe(100);
  });
});
