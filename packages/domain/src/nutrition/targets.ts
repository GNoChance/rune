import type {
  ActivityLevel,
  AppliedRule,
  NutritionGoal,
  NutritionTargets,
  SexForCalc,
} from '@rune/contracts';
import { APPLIED_RULES } from '@rune/contracts';
import { NUTRITION_CONSTANTS as C, NUTRI_ALGO_VERSION } from './constants';
import { add, ceilTo, cmp, floorTo, max, mul, type Q, q, roundHalfUpTo, sub, toNumber } from './exact';

export interface TargetsInput {
  age: number;
  sexForCalc: SexForCalc;
  heightCm: number;
  weightG: number;
  activityLevel: ActivityLevel;
  goal: NutritionGoal;
  cumulativeAdjustmentKcal: number;
}

/** Entrées figées avec la cible (07 §5.12). */
export interface TargetInputsJson {
  age: number;
  sex_for_calc: SexForCalc;
  height_cm: number;
  ref_weight_g: number;
  activity_level: ActivityLevel;
  pal: number;
  requested_goal: NutritionGoal;
  cumulative_adjustment_kcal: number;
}

export type TargetsRefusal = { refusal: 'MODE_NOT_FULL' | 'INPUT_OUT_OF_RANGE' };
export type TargetsResult = { targets: NutritionTargets; inputs: TargetInputsJson } | TargetsRefusal;

const hundredths = (n: number): Q => q(n, 100);
const heightM = (heightCm: number): Q => q(heightCm, 100);
const weightKg = (weightG: number): Q => q(weightG, 1000);

/** IMC = P / T² comparé exactement à un seuil (aucun flottant). */
export function bmiBelow(heightCm: number, weightG: number, threshold: '18.5' | '30'): boolean {
  const limit = threshold === '18.5' ? q(C.bmiLowTenths, 10) : q(C.bmiHigh);
  const t = heightM(heightCm);
  return cmp(weightKg(weightG), mul(limit, mul(t, t))) < 0;
}

const inRange = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;

function validate(input: TargetsInput): TargetsRefusal | null {
  if (Number.isInteger(input.age) && (input.age < C.minAge || input.age > C.maxAge)) {
    return { refusal: 'MODE_NOT_FULL' };
  }
  const ok =
    inRange(input.age, C.minAge, C.maxAge) &&
    inRange(input.heightCm, C.minHeightCm, C.maxHeightCm) &&
    inRange(input.weightG, C.minWeightG, C.maxWeightG) &&
    input.weightG % C.weightStepG === 0 &&
    Number.isInteger(input.cumulativeAdjustmentKcal) &&
    input.cumulativeAdjustmentKcal % C.adjustmentStepKcal === 0 &&
    Object.hasOwn(C.palHundredths, input.activityLevel) &&
    Object.hasOwn(C.sexOffset, input.sexForCalc) &&
    Object.hasOwn(C.goalFactorHundredths, input.goal);
  return ok ? null : { refusal: 'INPUT_OUT_OF_RANGE' };
}

/** Arrondit à 50 (moitié vers le haut), puis ramène vers l'intérieur des bornes si l'arrondi en sort. */
function boundedKcal(brut: Q, lo: Q | null, hi: Q | null): bigint {
  const step = BigInt(C.energyStepKcal);
  let v = roundHalfUpTo(brut, step);
  if (lo && cmp(q(v), lo) < 0) v = ceilTo(lo, step);
  if (hi && cmp(q(v), hi) > 0) v = floorTo(hi, step);
  return v;
}

export function computeNutritionTargets(input: TargetsInput): TargetsResult {
  const refusal = validate(input);
  if (refusal) return refusal;

  const p = weightKg(input.weightG);
  const t = heightM(input.heightCm);
  const pal = C.palHundredths[input.activityLevel];

  // 1-2. métabolisme de base et dépense totale
  const mb = add(
    add(mul(q(10), p), mul(q(625, 100), q(input.heightCm))),
    q(-5 * input.age + C.sexOffset[input.sexForCalc]),
  );
  const det = mul(mb, hundredths(pal));

  // 3. objectif effectif
  const lowBmi = bmiBelow(input.heightCm, input.weightG, '18.5');
  const effectiveGoal: NutritionGoal = lowBmi && input.goal === 'lose' ? 'maintain' : input.goal;

  // 4-6. énergie brute, bornes de l'objectif, plancher absolu
  const brut = add(
    mul(det, hundredths(C.goalFactorHundredths[effectiveGoal])),
    q(input.cumulativeAdjustmentKcal),
  );
  const [loH, hiH] = C.goalBoundsHundredths[effectiveGoal];
  const lo = mul(det, hundredths(loH));
  const hi = mul(det, hundredths(hiH));
  const floored = max(lo, mb);

  const unbounded = boundedKcal(brut, null, null);
  const withGoalBounds = boundedKcal(brut, lo, hi);
  const kcalTarget = boundedKcal(brut, floored, hi);

  // Une règle n'entre que si elle a changé le résultat.
  const rules = new Set<AppliedRule>();
  if (lowBmi && input.goal === 'lose') rules.add('no_deficit_low_bmi');
  if (withGoalBounds !== unbounded) {
    rules.add(
      effectiveGoal === 'lose'
        ? 'deficit_cap_25'
        : effectiveGoal === 'maintain'
          ? 'maintenance_band'
          : 'surplus_cap_15',
    );
  }
  if (kcalTarget !== withGoalBounds) rules.add('bmr_floor');

  // Fourchette ± 100, coupée aux bornes arrondies vers l'intérieur
  const step = BigInt(C.energyStepKcal);
  const range = BigInt(C.rangeKcal);
  const rangeLo = ceilTo(floored, step);
  const rangeHi = floorTo(hi, step);
  const kcalMin = kcalTarget - range > rangeLo ? kcalTarget - range : rangeLo;
  const kcalMax = kcalTarget + range < rangeHi ? kcalTarget + range : rangeHi;

  // 7. poids pour les grammes
  const heavy = !bmiBelow(input.heightCm, input.weightG, '30');
  const pg = heavy ? mul(q(C.refBmi), mul(t, t)) : p;
  if (heavy) rules.add('ref_weight_bmi25');

  // 8-10. protéines, lipides, glucides (valeurs non arrondies, arrondies à 5 g en sortie)
  const gStep = BigInt(C.gramStep);
  const proteinMin = mul(hundredths(C.proteinMinHundredthsPerKg), pg);
  const proteinMax = mul(hundredths(C.proteinMaxHundredthsPerKg), pg);
  const fatByEnergy = q(C.fatEnergyPercent * Number(kcalTarget), 900);
  const fatMin = max(mul(hundredths(C.fatMinHundredthsPerKg), pg), fatByEnergy);
  const carbs = mul(q(1, 4), sub(sub(q(kcalTarget), mul(q(4), proteinMin)), mul(q(9), fatMin)));
  if (cmp(carbs, q(0)) < 0) throw new Error('invariant violé : glucides négatifs');

  const targets: NutritionTargets = {
    bmr_kcal: toNumber(mb, 2),
    tdee_kcal: toNumber(det, 2),
    kcal_target: Number(kcalTarget),
    kcal_min: Number(kcalMin),
    kcal_max: Number(kcalMax),
    protein_g_min: Number(roundHalfUpTo(proteinMin, gStep)),
    protein_g_max: Number(roundHalfUpTo(proteinMax, gStep)),
    fat_g_min: Number(roundHalfUpTo(fatMin, gStep)),
    carbs_g: Number(roundHalfUpTo(carbs, gStep)),
    fiber_g: C.fiberG,
    water_ml: C.waterMl[input.sexForCalc],
    effective_goal: effectiveGoal,
    applied_rules: APPLIED_RULES.filter((r) => rules.has(r)),
    algo_version: NUTRI_ALGO_VERSION,
  };
  const inputs: TargetInputsJson = {
    age: input.age,
    sex_for_calc: input.sexForCalc,
    height_cm: input.heightCm,
    ref_weight_g: input.weightG,
    activity_level: input.activityLevel,
    pal: pal / 100,
    requested_goal: input.goal,
    cumulative_adjustment_kcal: input.cumulativeAdjustmentKcal,
  };
  return { targets, inputs };
}

/** `limit_reached` (choix C25) : avec l'ajustement ± 100, au même poids, la `kcal_target` ne change pas. */
export function adjustedTargetIsSame(input: TargetsInput, delta: -100 | 100): boolean {
  const before = computeNutritionTargets(input);
  const after = computeNutritionTargets({
    ...input,
    cumulativeAdjustmentKcal: input.cumulativeAdjustmentKcal + delta,
  });
  if ('refusal' in before || 'refusal' in after) return false;
  return before.targets.kcal_target === after.targets.kcal_target;
}
