/*
 * Bloc `nutrition` du dossier `coach-brief/2` (spec brique 5 §11.1, 07 §5.9) : directives par cas, repères chiffrés
 * en mode `full` seulement, rien de ce que le dossier ne doit jamais contenir, clés portant leur unité.
 */
import { describe, expect, it } from 'vitest';
import { buildCoachBrief, type CoachBriefInput } from '../../src/coach/brief';
import { allowedValues } from '../../src/coach/values';
import { briefInput } from '../fixtures/coach-brief';

type Nutrition = CoachBriefInput['nutrition'];

const TARGET: NonNullable<Nutrition['target']> = {
  validFrom: '2026-10-31',
  algoVersion: 'nutri-1.0.0',
  effectiveGoal: 'lose',
  kcalTarget: 2400,
  kcalMin: 2300,
  kcalMax: 2500,
  proteinGMin: 130,
  proteinGMax: 175,
  fatGMin: 65,
  carbsG: 300,
  fiberG: 30,
  waterMl: 2500,
  appliedRules: ['bmr_floor'],
};

const FULL: Nutrition = {
  mode: 'full',
  minor: false,
  safetyPause: false,
  sheets: [{ id: 'protein', title: 'Les protéines' }],
  target: TARGET,
  weeklyChange: [
    { weeksAgo: 1, changePct: -0.5 },
    { weeksAgo: 2, changePct: null },
  ],
  lastCheckin: { weeksAgo: 1, decision: 'proposal', proposedDeltaKcal: -100, response: null },
};

const nutritionOf = (nutrition: Partial<Nutrition>, edit: (i: CoachBriefInput) => void = () => {}) => {
  const out = buildCoachBrief(
    briefInput((i) => {
      i.nutrition = { ...i.nutrition, ...nutrition };
      edit(i);
    }),
  );
  return { ...out, nutrition: out.brief.nutrition };
};

describe('dossier coach-brief/2 : bloc nutrition', () => {
  it('le schéma est coach-brief/2 et le bloc est toujours présent', () => {
    const { brief } = buildCoachBrief(briefInput());
    expect(brief.schema).toBe('coach-brief/2');
    expect(brief.nutrition).toEqual({
      mode: 'disabled',
      directives: ['no_deficit', 'no_numbers'],
      sheets: [],
    });
  });

  it('directives : mineur -> les trois', () => {
    const n = nutritionOf({ mode: 'qualitative', minor: true }, (i) => {
      i.audience = 'minor';
      i.ageBand = '16-17';
    }).nutrition;
    expect(n.directives).toEqual(['minor_profile', 'no_deficit', 'no_numbers']);
  });

  it.each([
    ['minor vrai', { ...FULL, minor: true }, 'adult', '30-39'],
    ['public mineur', FULL, 'minor', '16-17'],
  ] as const)(
    'mineur même en mode full (%s) : aucun repère chiffré, directives fermées',
    (_n, nutrition, audience, ageBand) => {
      const n = nutritionOf(nutrition, (i) => {
        i.audience = audience;
        i.ageBand = ageBand;
      }).nutrition;
      expect(n).not.toHaveProperty('target');
      expect(n).not.toHaveProperty('weekly_change');
      expect(n).not.toHaveProperty('last_checkin');
      expect(n.directives).toEqual(expect.arrayContaining(['no_deficit', 'no_numbers']));
    },
  );

  it('directives : adulte qualitatif -> no_deficit, no_numbers', () => {
    expect(nutritionOf({ mode: 'qualitative' }).nutrition.directives).toEqual(['no_deficit', 'no_numbers']);
  });

  it('directives : full avec safety_pause -> no_deficit', () => {
    expect(nutritionOf({ ...FULL, safetyPause: true }).nutrition.directives).toEqual(['no_deficit']);
  });

  it('directives : full maintain -> no_deficit', () => {
    const target = { ...TARGET, effectiveGoal: 'maintain' as const };
    expect(nutritionOf({ ...FULL, target }).nutrition.directives).toEqual(['no_deficit']);
  });

  it('directives : full sans cible -> no_deficit (objectif inconnu)', () => {
    expect(nutritionOf({ ...FULL, target: null }).nutrition.directives).toEqual(['no_deficit']);
  });

  it('directives : full lose sans pause -> aucune', () => {
    expect(nutritionOf(FULL).nutrition.directives).toEqual([]);
  });

  it('full : target, weekly_change et last_checkin, clés avec unité, days_ago relatif', () => {
    const n = nutritionOf(FULL).nutrition;
    expect(n.sheets).toEqual([{ id: 'protein', title: 'Les protéines' }]);
    expect(n.target).toEqual({
      energy_kcal: 2400,
      energy_min_kcal: 2300,
      energy_max_kcal: 2500,
      protein_min_g: 130,
      protein_max_g: 175,
      fat_min_g: 65,
      carbs_g: 300,
      fiber_g: 30,
      water_ml: 2500,
      effective_goal: 'lose',
      applied_rules: ['bmr_floor'],
      algo_version: 'nutri-1.0.0',
      days_ago: 3,
    });
    expect(n.weekly_change).toEqual([
      { weeks_ago: 1, change_pct: -0.5 },
      { weeks_ago: 2, change_pct: null },
    ]);
    expect(n.last_checkin).toEqual({
      weeks_ago: 1,
      decision: 'proposal',
      proposed_delta_kcal: -100,
    });
  });

  it('full sans cible ni bilan : ni target, ni last_checkin ; weekly_change vide absent', () => {
    const n = nutritionOf({ ...FULL, target: null, weeklyChange: [], lastCheckin: null }).nutrition;
    expect(n).toEqual({ mode: 'full', directives: ['no_deficit'], sheets: FULL.sheets });
  });

  it.each(['qualitative', 'disabled'] as const)(
    'mode %s : ni target, ni weekly_change, ni last_checkin même si l’entrée en porte',
    (mode) => {
      const n = nutritionOf({ ...FULL, mode }).nutrition;
      expect(n).not.toHaveProperty('target');
      expect(n).not.toHaveProperty('weekly_change');
      expect(n).not.toHaveProperty('last_checkin');
      expect(n.directives).toContain('no_numbers');
    },
  );

  it('le JSON sérialisé ne contient jamais pesée, taille, sexe, mode_reason, bmr, tdee ni moyenne en kg', () => {
    const { json } = nutritionOf({
      ...FULL,
      target: { ...TARGET, bmrKcal: 1700, tdeeKcal: 2600, inputs: { weightG: 81000 } } as never,
    });
    for (const banned of [
      'weight_g',
      'height_cm',
      'sex_for_calc',
      'mode_reason',
      'cause',
      'bmr_kcal',
      'tdee_kcal',
      'mean_weight',
      'weighIns',
    ]) {
      expect(json, banned).not.toContain(banned);
    }
    expect(json).not.toContain('81000');
    expect(json).not.toContain('1700');
    expect(json).not.toContain('2600');
  });

  it('clés triées et sans champ nul : le bloc complet se sérialise stablement', () => {
    const { json } = nutritionOf(FULL);
    const block = json.slice(json.indexOf('"nutrition":'));
    expect(block.startsWith('"nutrition":{"directives":[],"last_checkin":{')).toBe(true);
    expect(block).toContain('"mode":"full"');
    expect(block).not.toContain('"response":null');
  });

  it('allowedValues range les nouvelles clés dans les bonnes familles', () => {
    const { brief } = nutritionOf(FULL);
    const allowed = allowedValues({ brief, toolResults: [], constants: [], nutritionFull: true });
    expect(allowed.nutrition.has('2400')).toBe(true);
    expect(allowed.nutrition.has('130')).toBe(true);
    expect(allowed.nutrition.has('65')).toBe(true);
    expect(allowed.volume.has('2500')).toBe(true);
    expect(allowed.percent.has('0.5')).toBe(true);
    expect(allowed.nutrition.has('100')).toBe(true);
    const off = allowedValues({ brief, toolResults: [], constants: [], nutritionFull: false });
    expect(off.nutrition.has('2400')).toBe(false);
    expect(off.volume.has('2500')).toBe(false);
  });
});
