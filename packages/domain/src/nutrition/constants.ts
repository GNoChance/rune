/** Seul module où vivent les constantes de `nutri-1` (07 §5.6). Toute modification change `NUTRI_ALGO_VERSION`. */
export const NUTRI_ALGO_VERSION = 'nutri-1.0.0';

type Sex = 'male' | 'female' | 'unspecified';
type Goal = 'lose' | 'maintain' | 'gain';

/** Les facteurs sont en centièmes (140 = 1,40) pour rester en entiers. */
export const NUTRITION_CONSTANTS = Object.freeze({
  minAge: 18,
  maxAge: 78,
  minHeightCm: 120,
  maxHeightCm: 220,
  minWeightG: 30_000,
  maxWeightG: 250_000,
  weightStepG: 100,
  adjustmentStepKcal: 100,
  palHundredths: Object.freeze({ 1: 140, 2: 155, 3: 175, 4: 200 }) as Readonly<Record<1 | 2 | 3 | 4, number>>,
  sexOffset: Object.freeze({ male: 5, female: -161, unspecified: -78 }) as Readonly<Record<Sex, number>>,
  goalFactorHundredths: Object.freeze({ lose: 80, maintain: 100, gain: 110 }) as Readonly<
    Record<Goal, number>
  >,
  /** Bornes de l'énergie en centièmes de DET : [bas, haut]. */
  goalBoundsHundredths: Object.freeze({
    lose: Object.freeze([75, 100] as const),
    maintain: Object.freeze([90, 110] as const),
    gain: Object.freeze([100, 115] as const),
  }),
  /** Seuil d'IMC bas, en dixièmes (185 = 18,5). */
  bmiLowTenths: 185,
  bmiHigh: 30,
  /** IMC de référence pour le poids des grammes quand IMC >= 30. */
  refBmi: 25,
  proteinMinHundredthsPerKg: 160,
  proteinMaxHundredthsPerKg: 220,
  fatMinHundredthsPerKg: 60,
  fatEnergyPercent: 20,
  fiberG: 30,
  waterMl: Object.freeze({ male: 2500, female: 2000, unspecified: 2250 }) as Readonly<Record<Sex, number>>,
  energyStepKcal: 50,
  gramStep: 5,
  rangeKcal: 100,
});
