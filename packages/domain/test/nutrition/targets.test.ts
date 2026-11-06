import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  adjustedTargetIsSame,
  bmiBelow,
  computeNutritionTargets,
  NUTRI_ALGO_VERSION,
  type TargetsInput,
} from '../../src/nutrition';

const A: TargetsInput = {
  age: 30,
  sexForCalc: 'male',
  heightCm: 180,
  weightG: 80_000,
  activityLevel: 2,
  goal: 'lose',
  cumulativeAdjustmentKcal: 0,
};

const ok = (input: TargetsInput) => {
  const r = computeNutritionTargets(input);
  if ('refusal' in r) throw new Error(`refus inattendu : ${r.refusal}`);
  return r;
};

describe('cas de référence 07 §5.6.6', () => {
  it('A', () => {
    const { targets: t, inputs } = ok(A);
    expect(t.bmr_kcal).toBe(1780);
    expect(t.tdee_kcal).toBe(2759);
    expect(t.kcal_target).toBe(2200);
    expect(t.kcal_min).toBe(2100);
    expect(t.kcal_max).toBe(2300);
    expect(t.protein_g_min).toBe(130);
    expect(t.protein_g_max).toBe(175);
    expect(t.fat_g_min).toBe(50);
    expect(t.carbs_g).toBe(310);
    expect(t.fiber_g).toBe(30);
    expect(t.water_ml).toBe(2500);
    expect(t.effective_goal).toBe('lose');
    expect(t.applied_rules).toEqual([]);
    expect(t.algo_version).toBe(NUTRI_ALGO_VERSION);
    expect(inputs).toEqual({
      age: 30,
      sex_for_calc: 'male',
      height_cm: 180,
      ref_weight_g: 80_000,
      activity_level: 2,
      pal: 1.55,
      requested_goal: 'lose',
      cumulative_adjustment_kcal: 0,
    });
  });

  it('B', () => {
    const { targets: t } = ok({
      age: 25,
      sexForCalc: 'female',
      heightCm: 165,
      weightG: 60_000,
      activityLevel: 1,
      goal: 'gain',
      cumulativeAdjustmentKcal: 0,
    });
    expect(t.bmr_kcal).toBe(1345.25);
    expect(t.tdee_kcal).toBe(1883.35);
    expect(t.kcal_target).toBe(2050);
    expect(t.kcal_min).toBe(1950);
    expect(t.kcal_max).toBe(2150);
    expect(t.protein_g_min).toBe(95);
    expect(t.protein_g_max).toBe(130);
    expect(t.fat_g_min).toBe(45);
    expect(t.carbs_g).toBe(315);
    expect(t.water_ml).toBe(2000);
    expect(t.applied_rules).toEqual([]);
  });

  it('C : IMC bas, pas de déficit', () => {
    const { targets: t } = ok({
      age: 22,
      sexForCalc: 'female',
      heightCm: 160,
      weightG: 47_000,
      activityLevel: 2,
      goal: 'lose',
      cumulativeAdjustmentKcal: 0,
    });
    expect(t.effective_goal).toBe('maintain');
    expect(t.applied_rules).toEqual(['no_deficit_low_bmi']);
    expect(t.bmr_kcal).toBe(1199);
    expect(t.kcal_target).toBe(1850);
    expect(t.kcal_min).toBe(1750);
    expect(t.kcal_max).toBe(1950);
    expect(t.protein_g_min).toBe(75);
    expect(t.protein_g_max).toBe(105);
    expect(t.fat_g_min).toBe(40);
    expect(t.carbs_g).toBe(295);
  });

  it("D : plafond de déficit, arrondi vers l'intérieur", () => {
    const { targets: t } = ok({ ...A, cumulativeAdjustmentKcal: -400 });
    expect(t.kcal_target).toBe(2100);
    expect(t.kcal_min).toBe(2100);
    expect(t.kcal_max).toBe(2200);
    expect(t.applied_rules).toEqual(['deficit_cap_25']);
  });

  it('E : 17 ans refusé', () => {
    expect(computeNutritionTargets({ ...A, age: 17 })).toEqual({ refusal: 'MODE_NOT_FULL' });
  });

  it('F : IMC >= 30, poids de référence IMC 25', () => {
    const { targets: t } = ok({
      age: 40,
      sexForCalc: 'male',
      heightCm: 175,
      weightG: 110_000,
      activityLevel: 1,
      goal: 'lose',
      cumulativeAdjustmentKcal: 0,
    });
    expect(t.applied_rules).toEqual(['ref_weight_bmi25']);
    expect(t.bmr_kcal).toBe(1998.75);
    expect(t.kcal_target).toBe(2250);
    expect(t.kcal_min).toBe(2150);
    expect(t.kcal_max).toBe(2350);
    expect(t.protein_g_min).toBe(125);
    expect(t.protein_g_max).toBe(170);
    expect(t.fat_g_min).toBe(50);
    expect(t.carbs_g).toBe(330);
  });
});

describe('domaines et règles', () => {
  it.each([
    ['taille 119', { heightCm: 119 }],
    ['taille 221', { heightCm: 221 }],
    ['poids 29 900 g', { weightG: 29_900 }],
    ['poids 250 100 g', { weightG: 250_100 }],
    ['poids non multiple de 100', { weightG: 80_050 }],
    ['ajustement non multiple de 100', { cumulativeAdjustmentKcal: 50 }],
    ['niveau 5', { activityLevel: 5 as never }],
  ])('%s : INPUT_OUT_OF_RANGE', (_n, patch) => {
    expect(computeNutritionTargets({ ...A, ...patch })).toEqual({ refusal: 'INPUT_OUT_OF_RANGE' });
  });

  it('bornes incluses acceptées ; âge 79 : MODE_NOT_FULL, 18 et 78 acceptés', () => {
    expect(computeNutritionTargets({ ...A, age: 79 })).toEqual({ refusal: 'MODE_NOT_FULL' });
    expect('targets' in computeNutritionTargets({ ...A, age: 18 })).toBe(true);
    expect('targets' in computeNutritionTargets({ ...A, age: 78 })).toBe(true);
    expect('targets' in computeNutritionTargets({ ...A, heightCm: 120, weightG: 30_000 })).toBe(true);
    expect('targets' in computeNutritionTargets({ ...A, heightCm: 220, weightG: 250_000 })).toBe(true);
  });

  it('bmiBelow est exact au seuil', () => {
    // 18,5 x 1,6^2 = 47,36 kg ; 30 x 1,6^2 = 76,8 kg
    expect(bmiBelow(160, 47_300, '18.5')).toBe(true);
    expect(bmiBelow(160, 47_400, '18.5')).toBe(false);
    expect(bmiBelow(160, 76_800, '30')).toBe(false);
    expect(bmiBelow(160, 76_700, '30')).toBe(true);
    // 18,5 x 2^2 = 74 kg exactement : pas en dessous
    expect(bmiBelow(200, 74_000, '18.5')).toBe(false);
  });

  it('maintain et gain : bornes de bande et de surplus', () => {
    const m = ok({ ...A, goal: 'maintain', cumulativeAdjustmentKcal: 600 }).targets;
    expect(m.applied_rules).toEqual(['maintenance_band']);
    expect(m.kcal_target).toBe(3000); // 1,10 x 2759 = 3034,9 -> 3000 (vers l'intérieur)
    expect(m.kcal_max).toBe(3000);
    const g = ok({ ...A, goal: 'gain', cumulativeAdjustmentKcal: 1000 }).targets;
    expect(g.applied_rules).toEqual(['surplus_cap_15']);
    expect(g.kcal_target).toBe(3150); // 1,15 x 2759 = 3172,85
  });

  it("applied_rules triées dans l'ordre de APPLIED_RULES", () => {
    const t = ok({
      age: 40,
      sexForCalc: 'male',
      heightCm: 175,
      weightG: 110_000,
      activityLevel: 1,
      goal: 'lose',
      cumulativeAdjustmentKcal: -800,
    }).targets;
    expect(t.applied_rules).toEqual(['deficit_cap_25', 'ref_weight_bmi25']);
  });
});

describe('limit_reached (adjustedTargetIsSame)', () => {
  it("faux quand l'ajustement déplace la cible", () => {
    expect(adjustedTargetIsSame(A, 100)).toBe(false);
    expect(adjustedTargetIsSame(A, -100)).toBe(false);
  });
  it('vrai au plafond de déficit (cas D)', () => {
    expect(adjustedTargetIsSame({ ...A, cumulativeAdjustmentKcal: -400 }, -100)).toBe(true);
  });
  it('faux sur une entrée refusée', () => {
    expect(adjustedTargetIsSame({ ...A, age: 17 }, 100)).toBe(false);
  });
});

describe('propriétés', () => {
  const inputArb = fc.record({
    age: fc.integer({ min: 18, max: 78 }),
    sexForCalc: fc.constantFrom('male', 'female', 'unspecified' as const),
    heightCm: fc.integer({ min: 120, max: 220 }),
    weightG: fc.integer({ min: 300, max: 2500 }).map((n) => n * 100),
    activityLevel: fc.constantFrom(1, 2, 3, 4 as const),
    goal: fc.constantFrom('lose', 'maintain', 'gain' as const),
    cumulativeAdjustmentKcal: fc.integer({ min: -10, max: 10 }).map((n) => n * 100),
  }) as fc.Arbitrary<TargetsInput>;

  it('invariants du calcul', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const { targets: t } = ok(input);
        expect(t.kcal_target).toBeGreaterThanOrEqual(t.bmr_kcal);
        expect(t.kcal_min).toBeLessThanOrEqual(t.kcal_target);
        expect(t.kcal_target).toBeLessThanOrEqual(t.kcal_max);
        const bounds: Record<string, [number, number]> = {
          lose: [0.75, 1],
          maintain: [0.9, 1.1],
          gain: [1, 1.15],
        };
        const [lo, hi] = bounds[t.effective_goal] as [number, number];
        expect(t.kcal_target).toBeGreaterThanOrEqual(lo * t.tdee_kcal - 0.01);
        expect(t.kcal_target).toBeLessThanOrEqual(hi * t.tdee_kcal + 0.01);
        expect(t.carbs_g).toBeGreaterThanOrEqual(0);
        if (bmiBelow(input.heightCm, input.weightG, '18.5')) expect(t.effective_goal).not.toBe('lose');
        expect(t.algo_version).toBe(NUTRI_ALGO_VERSION);
        for (const k of [t.kcal_target, t.kcal_min, t.kcal_max]) expect(k % 50).toBe(0);
        for (const g of [t.protein_g_min, t.protein_g_max, t.fat_g_min, t.carbs_g]) expect(g % 5).toBe(0);
      }),
      { numRuns: 500 },
    );
  });

  it('âge < 18 : toujours refusé', () => {
    fc.assert(
      fc.property(inputArb, fc.integer({ min: 0, max: 17 }), (input, age) => {
        expect(computeNutritionTargets({ ...input, age })).toEqual({ refusal: 'MODE_NOT_FULL' });
      }),
      { numRuns: 100 },
    );
  });
});
