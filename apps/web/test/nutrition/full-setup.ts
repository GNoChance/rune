import type { AppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { createFakeApi } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { seedProfile } from '../support/onboarding';
import { makeMe, renderApp } from '../support/render';
import { seedMirror } from '../support/seed';
import { seedHealthConsent } from '../support/workout';

export const LAZY = { timeout: 10_000 };

const base = { ownerId: 'u-1', serverRevSeen: 1, deletedAt: null, updatedAt: '2026-10-01T10:00:00.000Z' };

/** Cas de référence A (07 §5.6.6) : 2 100 à 2 300 kcal, repère 2 200. */
export const TARGET_A = {
  bmr_kcal: 1700,
  tdee_kcal: 2300,
  kcal_target: 2200,
  kcal_min: 2100,
  kcal_max: 2300,
  protein_g_min: 130,
  protein_g_max: 175,
  fat_g_min: 50,
  carbs_g: 310,
  fiber_g: 30,
  water_ml: 2500,
  effective_goal: 'maintain',
  applied_rules: [],
  algo_version: 'nutri-1.0.0',
};

export interface FullOptions {
  mode?: 'full' | 'qualitative' | 'disabled';
  /** Réglages de la personne (profil nutrition, miroir). */
  settings?: Record<string, unknown>;
  /** Champs de la cible en vigueur (camelCase, miroir) ; `null` : aucune cible. */
  target?: Record<string, unknown> | null;
  safetyPause?: boolean;
}

/** Ouvre `path` avec un appareil au mode demandé (`full` par défaut) et la cible A en copie locale. */
export async function openNutritionAt(path: string, o: FullOptions = {}) {
  const db: AppDb = createTestLocalDb();
  await seedProfile(db, { coach: 'skald', goal: 'muscle', experience: 'none', daysPerWeek: 3 });
  const mode = o.mode ?? 'full';
  await setMeta(db, 'nutritionEffectiveMode', mode);
  await seedHealthConsent(db);
  if (mode === 'full') {
    await seedMirror(db, 'nutrition_profile', [
      {
        id: 'u-1',
        ...base,
        sexForCalc: 'male',
        heightCm: 178,
        activityLevel: 2,
        goal: 'maintain',
        safetyPause: o.safetyPause ?? false,
        ...o.settings,
      },
    ]);
    if (o.target !== null) {
      await seedMirror(db, 'nutrition_target', [
        {
          id: 't1',
          ...base,
          validFrom: '2026-10-01',
          reason: 'setup',
          effectiveGoal: 'maintain',
          kcalTarget: 2200,
          kcalMin: 2100,
          kcalMax: 2300,
          proteinGMin: 130,
          proteinGMax: 175,
          fatGMin: 50,
          carbsG: 310,
          fiberG: 30,
          waterMl: 2500,
          appliedRules: [],
          ...o.target,
        },
      ]);
    }
  }
  const api = createFakeApi();
  const me = makeMe({
    consents: {
      health: { active: true, textVersion: '1.0', at: '2026-10-01T10:00:00.000Z' },
      aiCoach: { active: false, textVersion: null, at: null },
    },
  });
  const view = await renderApp({ db, api, path, me });
  return { ...view, db, api };
}

/** Sans normalisation : l'espace fine insécable des milliers reste elle-même (le défaut la réduit à une espace). */
export const RAW = { normalizer: (s: string) => s };

const shape = { cause: 'stored', full_open: true, screen_version_current: 1, needs: null };

/** État rendu en mode `disabled`, valide pour `NutritionStateSchema`. */
export const DISABLED_STATE = {
  ...shape,
  effective_mode: 'disabled',
  stored_mode: 'disabled',
  mode_reason: null,
};

/** État rendu en mode `full`, valide pour `NutritionStateSchema`. */
export const FULL_STATE = {
  ...shape,
  effective_mode: 'full',
  stored_mode: 'full',
  mode_reason: null,
  settings: { sex_for_calc: 'male', height_cm: 178, activity_level: 2, goal: 'maintain' },
  safety_pause: false,
  target: null,
  last_checkin: null,
  checkin: null,
  weekly_means: [],
  reference_weight_g: null,
};
