import type { ModeCause, NutritionMode } from '@rune/contracts';

/** Âge maximal du mode complet (07 §5.3, règle 3). */
export const NUTRITION_MAX_AGE = 78;

export interface EffectiveModeInput {
  stored: NutritionMode;
  age: number;
  healthConsentActive: boolean;
  screenVersion: number | null;
  currentScreenVersion: number;
  /** Le mode complet est-il ouvert (réglage de déploiement) ? */
  fullOpen: boolean;
}

/** Mode effectif (07 §5.3) : règles 1 à 5, puis `full_closed`, puis le mode stocké. */
export function effectiveNutritionMode(i: EffectiveModeInput): { mode: NutritionMode; cause: ModeCause } {
  if (i.stored === 'disabled') return { mode: 'disabled', cause: 'stored' };
  if (i.age < 18) return { mode: 'qualitative', cause: 'minor' };
  if (i.age > NUTRITION_MAX_AGE) return { mode: 'qualitative', cause: 'over_max_age' };
  if (i.stored === 'full') {
    if (!i.healthConsentActive) return { mode: 'qualitative', cause: 'no_health_consent' };
    if (i.screenVersion !== i.currentScreenVersion) return { mode: 'qualitative', cause: 'screen_outdated' };
    if (!i.fullOpen) return { mode: 'qualitative', cause: 'full_closed' };
  }
  return { mode: i.stored, cause: 'stored' };
}
