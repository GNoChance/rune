import { defaultLoadSettings } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import {
  lightest,
  loadGrid,
  next,
  platesPerSide,
  roundDown,
  STANDARD_PLATES_G,
} from '../../src/program/loads';

const settings = defaultLoadSettings('gym');
const bar = loadGrid('barbell', settings);
const db = loadGrid('dumbbell', settings);
const machine = loadGrid('machine', settings);

describe('grille barre', () => {
  it('pas de 2 x le plus petit disque', () => {
    expect(bar).toEqual({ kind: 'barbell', barG: 20000, plateStepG: 2500 });
    expect(roundDown(bar, 61000)).toBe(60000);
    expect(next(bar, 60000)).toBe(62500);
    expect(roundDown(bar, 15000)).toBeNull();
    expect(lightest(bar)).toBe(20000);
    expect(next(bar, 15000)).toBe(20000);
  });
});

describe('grille haltères', () => {
  it('suit la liste', () => {
    expect(next(db, 14000)).toBe(16000);
    expect(roundDown(db, 15000)).toBe(14000);
    expect(roundDown(db, 1000)).toBeNull();
    expect(next(db, 40000)).toBeNull();
    expect(lightest(db)).toBe(2000);
  });
  it('liste vide', () => {
    const e = loadGrid('dumbbell', { ...settings, dumbbellsG: [] });
    expect(next(e, 14000)).toBeNull();
    expect(roundDown(e, 14000)).toBeNull();
    expect(lightest(e)).toBeNull();
  });
});

describe('grille machine', () => {
  it('multiples strictement positifs du pas', () => {
    expect(roundDown(machine, 12000)).toBe(10000);
    expect(roundDown(machine, 4000)).toBeNull();
    expect(next(machine, 10000)).toBe(15000);
    expect(next(machine, 0)).toBe(5000);
    expect(lightest(machine)).toBe(5000);
  });
  it('surcharge du pas', () => {
    const g = loadGrid('machine', settings, 2500);
    expect(next(g, 10000)).toBe(12500);
  });
});

describe('sans grille', () => {
  it('weighted, bodyweight, band', () => {
    for (const m of ['weighted', 'bodyweight', 'band'] as const) {
      const g = loadGrid(m, settings);
      expect(g).toEqual({ kind: 'none' });
      expect(roundDown(g, 5000)).toBeNull();
      expect(next(g, 5000)).toBeNull();
      expect(lightest(g)).toBeNull();
    }
  });
});

describe('platesPerSide', () => {
  it('glouton', () => {
    expect(platesPerSide(62500, 20000, 1250)).toEqual([20000, 1250]);
    expect(platesPerSide(60000, 20000, 1250)).toEqual([20000]);
    expect(platesPerSide(20000, 20000, 1250)).toEqual([]);
    expect(platesPerSide(21000, 20000, 1250)).toBeNull();
    expect(platesPerSide(15000, 20000, 1250)).toBeNull();
    expect(STANDARD_PLATES_G[0]).toBe(25000);
  });
});
