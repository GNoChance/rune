import { describe, expect, it } from 'vitest';
import {
  formatGrams,
  formatKcal,
  formatKg,
  formatLitres,
  formatLongDate,
  formatPct,
} from '../../src/features/nutrition/format';

describe('format français des nombres de la nutrition', () => {
  it('formatKcal : espace fine insécable des milliers', () => {
    expect(formatKcal(2100)).toBe('2 100');
    expect(formatKcal(950)).toBe('950');
    expect(formatKcal(12_500)).toBe('12 500');
  });

  it('formatGrams : entier, mêmes séparateurs', () => {
    expect(formatGrams(130)).toBe('130');
    expect(formatGrams(1250)).toBe('1 250');
  });

  it('formatLitres : virgule décimale, eau à 0,05 L près, zéros de fin retirés', () => {
    expect(formatLitres(2250)).toBe('2,25');
    expect(formatLitres(2000)).toBe('2');
    expect(formatLitres(2500)).toBe('2,5');
    expect(formatLitres(2270)).toBe('2,25');
    expect(formatLitres(2280)).toBe('2,3');
    expect(formatLitres(2275)).toBe('2,3');
  });

  it('formatKg : grammes vers kilogrammes, une décimale, virgule', () => {
    expect(formatKg(70_500)).toBe('70,5');
    expect(formatKg(70_000)).toBe('70,0');
    expect(formatKg(70_449)).toBe('70,4');
    expect(formatKg(100_000)).toBe('100,0');
  });

  it('formatPct : une décimale, signe explicite (moins typographique), zéro sans signe', () => {
    expect(formatPct(-0.45)).toBe('−0,5');
    expect(formatPct(0.3)).toBe('+0,3');
    expect(formatPct(0)).toBe('0,0');
    expect(formatPct(-0.04)).toBe('0,0');
  });
});

describe('formatLongDate', () => {
  it('date civile en toutes lettres', () => {
    expect(formatLongDate('2026-11-07')).toBe('7 novembre 2026');
    expect(formatLongDate('2026-02-01')).toBe('1er février 2026');
  });
});
