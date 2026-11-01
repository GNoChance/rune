import { describe, expect, it } from 'vitest';
import { currentRules, RULES_BY_VERSION, RULES_VERSION, rulesFor } from '../../src/program/rules';

const deepFrozen = (o: unknown): boolean =>
  typeof o !== 'object' || o === null || (Object.isFrozen(o) && Object.values(o).every(deepFrozen));

describe('règles versionnées', () => {
  it('la version courante existe et est gelée en profondeur', () => {
    expect(RULES_VERSION).toBe('1');
    expect(deepFrozen(RULES_BY_VERSION)).toBe(true);
    expect(deepFrozen(RULES_BY_VERSION['1'])).toBe(true);
  });
  it('rulesFor renvoie null pour une version inconnue', () => {
    expect(rulesFor('x')).toBeNull();
    expect(rulesFor('toString')).toBeNull();
    expect(rulesFor('1')).toBe(RULES_BY_VERSION['1']);
  });
  it('valeurs fixées', () => {
    const r = rulesFor('1');
    if (!r) throw new Error('règles 1 absentes');
    expect(r.rirByEffort).toEqual({ easy: 4, ok: 2.5, hard: 1, failed: 0 });
    expect(r.lightenPct).toBe(10);
    expect(r.stallSessions).toBe(3);
    expect(r.sessionsAtTop).toBe(2);
    expect(r.stepS).toBe(5);
    expect(r.calibrationSessions).toBe(3);
    expect(r.raiseCapPct).toBe(10);
    expect(r.restS).toEqual([30, 300]);
    expect(r.defaultIncrementG).toEqual({ upper: 2500, lower: 5000 });
  });
  it('bornes des modèles et des changements (05 §5 règle 3, 05 §15)', () => {
    expect(currentRules()).toBe(RULES_BY_VERSION[RULES_VERSION]);
    expect(currentRules().programBounds).toEqual({
      workSets: [1, 5],
      reps: [5, 30],
      minRepsGap: 2,
      targetRir: [1, 4],
      minRirBeginnerCompound: 2,
      maxSlotsPerWorkout: 8,
      days: [2, 4],
    });
  });
});
