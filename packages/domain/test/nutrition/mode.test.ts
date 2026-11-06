import { describe, expect, it } from 'vitest';
import { effectiveNutritionMode, NUTRITION_MAX_AGE } from '../../src/nutrition';

const ok = {
  stored: 'full' as const,
  age: 30,
  healthConsentActive: true,
  screenVersion: 1,
  currentScreenVersion: 1,
  fullOpen: true,
};

describe('effectiveNutritionMode', () => {
  it("plafond d'âge", () => expect(NUTRITION_MAX_AGE).toBe(78));
  it.each([0, 17, 30, 79, 90])('disabled reste disabled à %i ans', (age) => {
    expect(effectiveNutritionMode({ ...ok, stored: 'disabled', age, healthConsentActive: false })).toEqual({
      mode: 'disabled',
      cause: 'stored',
    });
  });
  it('17 ans : qualitatif mineur', () => {
    expect(effectiveNutritionMode({ ...ok, age: 17 })).toEqual({ mode: 'qualitative', cause: 'minor' });
    expect(effectiveNutritionMode({ ...ok, stored: 'qualitative', age: 17 })).toEqual({
      mode: 'qualitative',
      cause: 'minor',
    });
  });
  it('18 et 78 ans en ordre : full', () => {
    expect(effectiveNutritionMode({ ...ok, age: 18 })).toEqual({ mode: 'full', cause: 'stored' });
    expect(effectiveNutritionMode({ ...ok, age: 78 })).toEqual({ mode: 'full', cause: 'stored' });
  });
  it('79 ans : over_max_age', () => {
    expect(effectiveNutritionMode({ ...ok, age: 79 })).toEqual({
      mode: 'qualitative',
      cause: 'over_max_age',
    });
  });
  it('full sans accord santé', () => {
    expect(effectiveNutritionMode({ ...ok, healthConsentActive: false })).toEqual({
      mode: 'qualitative',
      cause: 'no_health_consent',
    });
  });
  it.each([0, null, 2])('full avec écran %s : screen_outdated', (screenVersion) => {
    expect(effectiveNutritionMode({ ...ok, screenVersion })).toEqual({
      mode: 'qualitative',
      cause: 'screen_outdated',
    });
  });
  it('full fermé', () => {
    expect(effectiveNutritionMode({ ...ok, fullOpen: false })).toEqual({
      mode: 'qualitative',
      cause: 'full_closed',
    });
  });
  it('ordre des règles', () => {
    expect(effectiveNutritionMode({ ...ok, age: 17, healthConsentActive: false }).cause).toBe('minor');
    expect(effectiveNutritionMode({ ...ok, age: 79, healthConsentActive: false }).cause).toBe('over_max_age');
    expect(effectiveNutritionMode({ ...ok, healthConsentActive: false, fullOpen: false }).cause).toBe(
      'no_health_consent',
    );
    expect(effectiveNutritionMode({ ...ok, screenVersion: null, fullOpen: false }).cause).toBe(
      'screen_outdated',
    );
  });
  it('qualitative stocké reste qualitative, cause stored', () => {
    expect(
      effectiveNutritionMode({ ...ok, stored: 'qualitative', healthConsentActive: false, fullOpen: false }),
    ).toEqual({ mode: 'qualitative', cause: 'stored' });
  });
});
