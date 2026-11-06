import type { Goal, NutritionGoal } from '@rune/contracts';
import { bmiBelow } from './targets';

/** Objectif nutrition présélectionné d'après l'objectif d'onboarding (07 §5.4). */
export function preselectGoal(onboardingGoal: Goal | null, heightCm: number, weightG: number): NutritionGoal {
  if (onboardingGoal === 'fat_loss') return bmiBelow(heightCm, weightG, '18.5') ? 'maintain' : 'lose';
  if (onboardingGoal === 'muscle') return 'gain';
  return 'maintain';
}

/** Niveau d'activité présélectionné : sport renseigné → 3, sinon 2. */
export function preselectActivity(sportCode: string | null): 2 | 3 {
  return sportCode !== null ? 3 : 2;
}
