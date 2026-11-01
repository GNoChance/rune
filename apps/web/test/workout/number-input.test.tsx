import { defaultLoadSettings } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { gridFor, parseCount, parseKg, stepLoad } from '../../src/features/workout/number-input';

// Saisie d'une charge ou d'un nombre sur l'écran de séance (spec brique 3 §7.3, Review Focus 4) : rien de `NaN`
// ni de hors bornes n'atteint le dépôt.

describe('parseKg', () => {
  it('virgule ou point, espaces autour, arrondi au gramme', () => {
    expect(parseKg('62,5')).toEqual({ ok: true, g: 62_500 });
    expect(parseKg('62.5')).toEqual({ ok: true, g: 62_500 });
    expect(parseKg(' 62,5 ')).toEqual({ ok: true, g: 62_500 });
    expect(parseKg('60')).toEqual({ ok: true, g: 60_000 });
    expect(parseKg('0')).toEqual({ ok: true, g: 0 });
    expect(parseKg('1,25')).toEqual({ ok: true, g: 1250 });
    expect(parseKg('0,001')).toEqual({ ok: true, g: 1 });
    expect(parseKg('62,5004')).toEqual({ ok: true, g: 62_500 });
    expect(parseKg('1.005')).toEqual({ ok: true, g: 1005 });
  });

  it('vide', () => {
    expect(parseKg('')).toEqual({ ok: false, error: 'empty' });
    expect(parseKg('   ')).toEqual({ ok: false, error: 'empty' });
  });

  it('invalide : lettres, signe, exposant, deux séparateurs, séparateur seul au bord', () => {
    for (const text of [
      'abc',
      '-5',
      '+5',
      '1e3',
      '62,5,5',
      '62.5.5',
      '6 2',
      '62,',
      ',5',
      'NaN',
      'Infinity',
      '0x10',
    ]) {
      expect(parseKg(text), text).toEqual({ ok: false, error: 'invalid' });
    }
  });

  it('au-delà de 500 kg : trop élevé ; 500 kg passe', () => {
    expect(parseKg('600')).toEqual({ ok: false, error: 'too_high' });
    expect(parseKg('500,001')).toEqual({ ok: false, error: 'too_high' });
    expect(parseKg('500')).toEqual({ ok: true, g: 500_000 });
  });
});

describe('parseCount', () => {
  it('entier de 0 au plafond', () => {
    expect(parseCount('6', 200)).toEqual({ ok: true, n: 6 });
    expect(parseCount(' 12 ', 200)).toEqual({ ok: true, n: 12 });
    expect(parseCount('0', 200)).toEqual({ ok: true, n: 0 });
    expect(parseCount('200', 200)).toEqual({ ok: true, n: 200 });
  });

  it('vide, invalide, trop élevé', () => {
    expect(parseCount('', 200)).toEqual({ ok: false, error: 'empty' });
    for (const text of ['abc', '6,5', '6.5', '-1', '1e2']) {
      expect(parseCount(text, 200), text).toEqual({ ok: false, error: 'invalid' });
    }
    expect(parseCount('201', 200)).toEqual({ ok: false, error: 'too_high' });
    expect(parseCount('7201', 7200)).toEqual({ ok: false, error: 'too_high' });
  });
});

describe('stepLoad : pas réalisable du lieu', () => {
  const settings = {
    barG: 20_000,
    smallestPlateG: 1250,
    dumbbellsG: [10_000, 12_000, 14_000, 16_000],
    machineStepG: 5000,
  };

  it('barre (disques de 1,25 kg) : 62,5 kg → 65 kg et 60 kg ; une charge hors grille reprend la grille', () => {
    const grid = gridFor('barbell', settings, null);
    expect(stepLoad(grid, 62_500, 1)).toBe(65_000);
    expect(stepLoad(grid, 62_500, -1)).toBe(60_000);
    expect(stepLoad(grid, 63_000, 1)).toBe(65_000);
    expect(stepLoad(grid, 63_000, -1)).toBe(62_500);
    // Sous la barre seule, rien de plus léger.
    expect(stepLoad(grid, 20_000, -1)).toBeNull();
  });

  it('haltères : 14 kg → 16 kg et 12 kg ; au bout de la liste, rien', () => {
    const grid = gridFor('dumbbell', settings, null);
    expect(stepLoad(grid, 14_000, 1)).toBe(16_000);
    expect(stepLoad(grid, 14_000, -1)).toBe(12_000);
    expect(stepLoad(grid, 16_000, 1)).toBeNull();
  });

  it('haltères sans liste au lieu : la grille « 2 à 40 kg par 2 kg »', () => {
    const grid = gridFor('dumbbell', { ...settings, dumbbellsG: [] }, null);
    expect(grid).toEqual({ kind: 'dumbbell', valuesG: defaultLoadSettings('gym').dumbbellsG });
    expect(stepLoad(grid, 14_000, 1)).toBe(16_000);
  });

  it('machine : pas du lieu, ou celui fixé pour l’exercice', () => {
    expect(stepLoad(gridFor('machine', settings, null), 50_000, 1)).toBe(55_000);
    expect(stepLoad(gridFor('machine', settings, 2500), 50_000, 1)).toBe(52_500);
    expect(stepLoad(gridFor('machine', settings, 2500), 50_000, -1)).toBe(47_500);
  });

  it('poids du corps : pas de pas', () => {
    expect(stepLoad(gridFor('bodyweight', settings, null), 0, 1)).toBeNull();
  });

  it('champ vide : + donne la charge la plus légère, − rien', () => {
    expect(stepLoad(gridFor('barbell', settings, null), null, 1)).toBe(20_000);
    expect(stepLoad(gridFor('dumbbell', settings, null), null, 1)).toBe(10_000);
    expect(stepLoad(gridFor('barbell', settings, null), null, -1)).toBeNull();
  });
});
