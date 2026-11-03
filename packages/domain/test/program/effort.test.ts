import type { Effort } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { effortValidated, rirEval } from '../../src/program/effort';
import { rulesFor } from '../../src/program/rules';

const fail = (): never => {
  throw new Error('règles 1 absentes');
};

import type { SetRecord } from '../../src/program/types';
import { isDone } from '../../src/program/types';

const rules = rulesFor('1') ?? fail();
let n = 0;
const set = (effort: Effort | null, over: Partial<SetRecord> = {}): SetRecord => ({
  id: `s${++n}`,
  position: n,
  kind: 'work',
  loadMode: 'barbell',
  loadG: 60000,
  reps: 8,
  durationS: null,
  side: null,
  effort,
  targetRepsMin: null,
  targetRepsMax: null,
  targetReps: null,
  targetDurationS: null,
  targetLoadG: null,
  targetRir: null,
  targetVariant: null,
  loggedAt: 1000,
  ...over,
});

describe('effort', () => {
  it.each<[Effort, boolean]>([
    ['easy', true],
    ['ok', true],
    ['hard', true],
    ['failed', false],
  ])('targetRir 2 : %s -> %s', (e, ok) => {
    expect(effortValidated(rirEval([set(e)], rules), 2)).toBe(ok);
  });
  it('targetRir 3 : difficile non validé', () => {
    expect(effortValidated(rirEval([set('hard')], rules), 3)).toBe(false);
    expect(effortValidated(rirEval([set('ok')], rules), 3)).toBe(true);
  });
  it('aucun effort', () => {
    expect(rirEval([set(null)], rules)).toBeNull();
    expect(rirEval([], rules)).toBeNull();
    expect(effortValidated(null, 2)).toBe(false);
  });
  it('minimum sur plusieurs séries, hors échauffement et séries non faites', () => {
    expect(rirEval([set('easy'), set('hard'), set('ok')], rules)).toBe(1);
    expect(
      rirEval([set('easy'), set('failed', { kind: 'warmup' }), set('hard', { loggedAt: null })], rules),
    ).toBe(4);
  });
  it('isDone', () => {
    expect(isDone(set(null))).toBe(true);
    expect(isDone(set(null, { loggedAt: null }))).toBe(false);
  });
});
