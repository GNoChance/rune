import { describe, expect, it } from 'vitest';
import { exerciseRecords, sessionRecords } from '../../src/progress/records';
import { ex, session, sets, wset } from './helpers';

const day = (d: number) => Date.UTC(2026, 0, d, 10);

describe('1RM estimé', () => {
  const e1 = (over = {}, band: 'adult' | 'minor' = 'adult') =>
    exerciseRecords([session([ex('a', [wset({ loadG: 60000, reps: 6, effort: 'ok', ...over })])])], 'a', band)
      .e1rmG;
  it('60 kg x 6 + correct = 77 000 g', () => expect(e1()).toBe(77000));
  it('10 répétitions + facile (14) : null', () => expect(e1({ reps: 10, effort: 'easy' })).toBeNull());
  it('RIR 0 sans effort', () => expect(e1({ effort: null })).toBe(72000));
  it('poids du corps : null', () => expect(e1({ loadMode: 'bodyweight' })).toBeNull());
  it('mineur : null', () => expect(e1({}, 'minor')).toBeNull());
  it('arrondi au gramme inférieur', () =>
    expect(e1({ loadG: 61, reps: 1, effort: 'ok' })).toBe(Math.floor(61 * (1 + 3.5 / 30))));
});

describe('exerciseRecords', () => {
  it('meilleures valeurs', () => {
    const bw = { loadG: null, loadMode: 'bodyweight' as const };
    const h = [
      session([ex('a', [wset({ loadG: 50000, reps: 10 }), wset({ loadG: 60000, reps: 5 })])], {
        startedAt: day(5),
      }),
      session(
        [
          ex('a', [
            wset({ loadG: 60000, reps: 7 }),
            wset({ ...bw, reps: 20 }),
            wset({ ...bw, reps: null, durationS: 90 }),
          ]),
        ],
        { startedAt: day(6) },
      ),
    ];
    const r = exerciseRecords(h, 'a', 'adult');
    expect(r.bestLoad).toEqual({ loadG: 60000, reps: 7 });
    expect(r.bestReps).toBe(20);
    expect(r.bestDurationS).toBe(90);
    expect(r.bestSessionVolumeG).toBe(50000 * 10 + 60000 * 5);
  });
  it('rien : tout null', () => {
    expect(exerciseRecords([], 'a', 'adult')).toEqual({
      bestLoad: null,
      bestReps: null,
      bestDurationS: null,
      bestSessionVolumeG: null,
      e1rmG: null,
    });
  });
  it('ignore échauffements et séries non faites', () => {
    const h = [
      session([ex('a', [wset({ kind: 'warmup', loadG: 90000 }), wset({ loggedAt: null, loadG: 90000 })])]),
    ];
    expect(exerciseRecords(h, 'a', 'adult').bestLoad).toBeNull();
  });
});

describe('sessionRecords', () => {
  it("première séance d'un exercice : aucun record", () => {
    const h = [session([ex('a', sets(3))], { id: 's1', startedAt: day(5) })];
    expect(sessionRecords(h, 's1')).toEqual([]);
  });
  it('dépassement strict : charge et volume', () => {
    const h = [
      session([ex('a', [wset({ loadG: 60000, reps: 8 })])], { id: 's1', startedAt: day(5) }),
      session([ex('a', [wset({ loadG: 62500, reps: 8 })])], { id: 's2', startedAt: day(7) }),
    ];
    expect(sessionRecords(h, 's2')).toEqual([
      { exerciseId: 'a', kind: 'load', value: 62500 },
      { exerciseId: 'a', kind: 'volume', value: 500000 },
    ]);
  });
  it('égalité : pas de record', () => {
    const h = [
      session([ex('a', [wset({ loadG: 60000, reps: 8 })])], { id: 's1', startedAt: day(5) }),
      session([ex('a', [wset({ loadG: 60000, reps: 8 })])], { id: 's2', startedAt: day(7) }),
    ];
    expect(sessionRecords(h, 's2')).toEqual([]);
  });
  it('même charge, plus de répétitions : record de charge', () => {
    const h = [
      session([ex('a', [wset({ loadG: 60000, reps: 8 })])], { id: 's1', startedAt: day(5) }),
      session([ex('a', [wset({ loadG: 60000, reps: 9 })])], { id: 's2', startedAt: day(7) }),
    ];
    expect(sessionRecords(h, 's2').map((r) => r.kind)).toContain('load');
  });
  it('répétitions et durée', () => {
    const bw = (reps: number | null, durationS: number | null) =>
      wset({ loadG: null, loadMode: 'bodyweight', reps, durationS });
    const h = [
      session([ex('a', [bw(10, 30)])], { id: 's1', startedAt: day(5) }),
      session([ex('a', [bw(12, 40)])], { id: 's2', startedAt: day(7) }),
    ];
    expect(sessionRecords(h, 's2')).toEqual([
      { exerciseId: 'a', kind: 'reps', value: 12 },
      { exerciseId: 'a', kind: 'duration', value: 40 },
    ]);
  });
  it('seules les séances antérieures comptent ; séance inconnue : []', () => {
    const h = [
      session([ex('a', [wset({ loadG: 90000 })])], { id: 's9', startedAt: day(20) }),
      session([ex('a', [wset({ loadG: 60000 })])], { id: 's1', startedAt: day(5) }),
    ];
    expect(sessionRecords(h, 's1')).toEqual([]);
    expect(sessionRecords(h, 'zzz')).toEqual([]);
  });
});
