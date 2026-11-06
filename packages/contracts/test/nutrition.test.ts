import { describe, expect, it } from 'vitest';
import {
  AdviceSheetFileSchema,
  APPLIED_RULES,
  ModeRequestSchema,
  NutritionStateSchema,
  ScreenRequestSchema,
} from '../src/index';

const base = {
  cause: 'stored',
  stored_mode: 'qualitative',
  mode_reason: null,
  full_open: true,
  screen_version_current: 1,
  needs: null,
};

const target = {
  bmr_kcal: 1500.5,
  tdee_kcal: 2300.2,
  kcal_target: 2000,
  kcal_min: 1900,
  kcal_max: 2100,
  protein_g_min: 100,
  protein_g_max: 140,
  fat_g_min: 60,
  carbs_g: 250,
  fiber_g: 30,
  water_ml: 2500,
  effective_goal: 'maintain',
  applied_rules: ['maintenance_band'],
  algo_version: 'nutri-1.0.0',
  valid_from: '2026-11-02',
  reason: 'initial',
};

const full = {
  ...base,
  effective_mode: 'full',
  stored_mode: 'full',
  settings: { sex_for_calc: 'male', height_cm: 180, activity_level: 2, goal: 'maintain' },
  safety_pause: false,
  target,
  last_checkin: null,
  checkin: null,
  weekly_means: [
    { week_start: '2026-10-26', weigh_in_count: 4, mean_weight_g: 80000, change_pct: null },
    { week_start: '2026-11-02', weigh_in_count: 1, mean_weight_g: null, change_pct: null },
  ],
  reference_weight_g: 80000,
};

describe('NutritionStateSchema', () => {
  it('accepte un état réduit hors mode complet', () => {
    expect(NutritionStateSchema.safeParse({ ...base, effective_mode: 'qualitative' }).success).toBe(true);
    expect(
      NutritionStateSchema.safeParse({ ...base, effective_mode: 'disabled', mode_reason: 'choice' }).success,
    ).toBe(true);
  });
  it('accepte un état complet', () => {
    expect(NutritionStateSchema.safeParse(full).success).toBe(true);
  });
  it.each(['target', 'settings', 'safety_pause', 'weekly_means'])(
    'refuse un état qualitatif portant %s',
    (key) => {
      const extra = { [key]: (full as Record<string, unknown>)[key] };
      expect(
        NutritionStateSchema.safeParse({ ...base, effective_mode: 'qualitative', ...extra }).success,
      ).toBe(false);
    },
  );
  it('refuse mode_reason = safety hors mode complet', () => {
    expect(
      NutritionStateSchema.safeParse({ ...base, effective_mode: 'qualitative', mode_reason: 'safety' })
        .success,
    ).toBe(false);
  });
  it('refuse plus de 12 moyennes', () => {
    const many = Array.from({ length: 13 }, () => full.weekly_means[0]);
    expect(NutritionStateSchema.safeParse({ ...full, weekly_means: many }).success).toBe(false);
  });
});

describe('ScreenRequestSchema et ModeRequestSchema', () => {
  const answers = { pregnancy: 'no', eating_disorder: 'no', medical: 'prefer_not' };
  it('accepte une demande valide', () => {
    expect(ScreenRequestSchema.safeParse({ answers, mode: 'qualitative' }).success).toBe(true);
  });
  it('refuse une réponse maybe', () => {
    expect(
      ScreenRequestSchema.safeParse({ answers: { ...answers, medical: 'maybe' }, mode: 'qualitative' })
        .success,
    ).toBe(false);
  });
  it('refuse un mode hors énumération', () => {
    expect(ScreenRequestSchema.safeParse({ answers, mode: 'partial' }).success).toBe(false);
  });
  it('le mode demandé ne peut être que qualitative ou disabled', () => {
    expect(ModeRequestSchema.safeParse({ mode: 'qualitative' }).success).toBe(true);
    expect(ModeRequestSchema.safeParse({ mode: 'full' }).success).toBe(false);
  });
});

describe('AdviceSheetFileSchema', () => {
  const file = {
    title: 'Bien manger',
    body_md: '## Titre\n\nTexte',
    audience: 'all',
    visible_modes: ['qualitative'],
    tags: ['base'],
    sources: [{ title: 'PNNS', url: 'https://example.org', accessed_on: '2026-11-01' }],
    draft_origin: 'ai',
  };
  it('accepte un id kebab-case anglais', () => {
    expect(AdviceSheetFileSchema.safeParse({ id: 'eat-well', ...file }).success).toBe(true);
  });
  it.each(['Bien-Manger', 'eat_well'])("refuse l'id %s", (id) => {
    expect(AdviceSheetFileSchema.safeParse({ id, ...file }).success).toBe(false);
  });
});

describe('APPLIED_RULES', () => {
  it("suit l'ordre de 07 §5.12", () => {
    expect([...APPLIED_RULES]).toEqual([
      'no_deficit_low_bmi',
      'deficit_cap_25',
      'surplus_cap_15',
      'maintenance_band',
      'bmr_floor',
      'ref_weight_bmi25',
    ]);
  });
});
