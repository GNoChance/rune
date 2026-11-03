import { readFileSync } from 'node:fs';
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
    expect(r.linearDoubleSpan).toBe(4);
    expect(r.defaultTargetRir).toBe(2);
    expect(r.painSuspendStreak).toBe(2);
    expect(r.reactiveDeload).toEqual({ stalledSlots: 2, weeks: 2 });
    expect(r.deloadRirPlus).toBe(2);
    expect(r.deloadRirMax).toBe(5);
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

describe('lecture des règles versionnée (garde-fou M8)', () => {
  it('une seconde version des règles exige un pas versionné', () => {
    const effective = readFileSync(new URL('../../src/program/effective.ts', import.meta.url), 'utf8');
    const readsCurrent = 'currentRules().stepS';
    // (a) Le garde-fou a un objet : le programme effectif lit encore le pas dans les règles courantes. À retirer
    // quand la lecture sera versionnée (cette moitié échoue alors).
    expect(effective).toContain(readsCurrent);
    // (b) Avec deux versions, un programme rejoué sous l'ancienne prendrait le pas de la nouvelle : la lecture doit
    // alors suivre la version de la séance.
    if (Object.keys(RULES_BY_VERSION).length >= 2) expect(effective).not.toContain(readsCurrent);
  });
});
