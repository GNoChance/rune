import { defaultLoadSettings, type LoadMode, type LoadSettings } from '@rune/contracts';
import { currentRules, type LoadGrid, lightest, loadGrid, next, roundDown } from '@rune/domain';

/*
 * Saisie des nombres de l'écran de séance (spec brique 3 §7.3, Review Focus 4) : charge en kg (virgule ou point),
 * répétitions et secondes entières, contrôlées avant toute écriture ; − / + au pas réalisable du lieu. Fonctions pures.
 */

export type ParseError = 'empty' | 'invalid' | 'too_high';
export type KgResult = { ok: true; g: number } | { ok: false; error: ParseError };
export type CountResult = { ok: true; n: number } | { ok: false; error: ParseError };

/** Chiffres, puis au plus une virgule ou un point suivi de chiffres : ni signe, ni exposant, ni séparateur au bord. */
const DECIMAL = /^\d+(?:[.,]\d+)?$/;
const INTEGER = /^\d+$/;

/** Charge la plus haute d'une série (500 kg), en grammes. */
const MAX_LOAD_G = (): number => currentRules().setBounds.loadG[1];

/** Charge saisie en kg (« 62,5 » ou « 62.5 ») → grammes entiers, arrondis au gramme ; au-delà de 500 kg : trop élevée. */
export function parseKg(text: string): KgResult {
  const t = text.trim();
  if (t === '') return { ok: false, error: 'empty' };
  if (!DECIMAL.test(t)) return { ok: false, error: 'invalid' };
  const g = Math.round(Number(t.replace(',', '.')) * 1000);
  if (!Number.isSafeInteger(g)) return { ok: false, error: 'invalid' };
  return g > MAX_LOAD_G() ? { ok: false, error: 'too_high' } : { ok: true, g };
}

/** Nombre entier de 0 à `max` (répétitions, secondes). */
export function parseCount(text: string, max: number): CountResult {
  const t = text.trim();
  if (t === '') return { ok: false, error: 'empty' };
  if (!INTEGER.test(t)) return { ok: false, error: 'invalid' };
  const n = Number(t);
  return n > max ? { ok: false, error: 'too_high' } : { ok: true, n };
}

/**
 * Grille des charges réalisables d'un exercice au lieu de la séance (`loadGrid`), avec le pas fixé de la machine s'il y
 * en a un. Un lieu sans haltères renseignés prend la grille « 2 à 40 kg par 2 kg » (spec §7.11) : sans elle, ni − ni +.
 */
export function gridFor(loadMode: LoadMode, settings: LoadSettings, machineStepG: number | null): LoadGrid {
  const grid = loadGrid(loadMode, settings, machineStepG);
  if (grid.kind === 'dumbbell' && grid.valuesG.length === 0) {
    return { kind: 'dumbbell', valuesG: defaultLoadSettings('gym').dumbbellsG };
  }
  return grid;
}

/**
 * Charge réalisable suivante (+1) ou précédente (−1) ; une charge hors grille reprend la grille. Champ vide : + donne
 * la charge la plus légère. Null : rien de plus (ou de moins) au lieu, ou pas de charge.
 */
export function stepLoad(grid: LoadGrid, g: number | null, direction: 1 | -1): number | null {
  if (g === null) return direction === 1 ? lightest(grid) : null;
  const value = direction === 1 ? next(grid, g) : roundDown(grid, g - 1);
  return value !== null && value <= MAX_LOAD_G() ? value : null;
}
