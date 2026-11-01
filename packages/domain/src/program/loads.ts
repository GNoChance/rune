import type { LoadMode, LoadSettings } from '@rune/contracts';

export type LoadGrid =
  | { kind: 'barbell'; barG: number; plateStepG: number }
  | { kind: 'dumbbell'; valuesG: readonly number[] }
  | { kind: 'machine'; stepG: number }
  | { kind: 'none' };

export const STANDARD_PLATES_G = [25000, 20000, 15000, 10000, 5000, 2500, 1250, 500, 250] as const;

export function loadGrid(
  loadMode: LoadMode,
  settings: LoadSettings,
  overrideStepG?: number | null,
): LoadGrid {
  switch (loadMode) {
    case 'barbell':
      return { kind: 'barbell', barG: settings.barG, plateStepG: 2 * settings.smallestPlateG };
    case 'dumbbell':
      return { kind: 'dumbbell', valuesG: settings.dumbbellsG };
    case 'machine':
      return { kind: 'machine', stepG: overrideStepG ?? settings.machineStepG };
    default:
      return { kind: 'none' };
  }
}

/** Plus grande charge réalisable <= g, ou null s'il n'y en a pas. */
export function roundDown(grid: LoadGrid, g: number): number | null {
  switch (grid.kind) {
    case 'barbell':
      return g < grid.barG
        ? null
        : grid.barG + Math.floor((g - grid.barG) / grid.plateStepG) * grid.plateStepG;
    case 'dumbbell': {
      let best: number | null = null;
      for (const v of grid.valuesG) if (v <= g && (best === null || v > best)) best = v;
      return best;
    }
    case 'machine':
      return g < grid.stepG ? null : Math.floor(g / grid.stepG) * grid.stepG;
    default:
      return null;
  }
}

/** Plus petite charge réalisable > g, ou null. */
export function next(grid: LoadGrid, g: number): number | null {
  switch (grid.kind) {
    case 'barbell':
      return g < grid.barG
        ? grid.barG
        : grid.barG + (Math.floor((g - grid.barG) / grid.plateStepG) + 1) * grid.plateStepG;
    case 'dumbbell': {
      let best: number | null = null;
      for (const v of grid.valuesG) if (v > g && (best === null || v < best)) best = v;
      return best;
    }
    case 'machine':
      return g < 0 ? grid.stepG : (Math.floor(g / grid.stepG) + 1) * grid.stepG;
    default:
      return null;
  }
}

/** Plus petite charge réalisable. */
export function lightest(grid: LoadGrid): number | null {
  switch (grid.kind) {
    case 'barbell':
      return grid.barG;
    case 'dumbbell':
      return grid.valuesG.length === 0 ? null : Math.min(...grid.valuesG);
    case 'machine':
      return grid.stepG;
    default:
      return null;
  }
}

/** Disques d'un côté de la barre (glouton, du plus lourd au plus léger), ou null si la charge n'est pas réalisable. */
export function platesPerSide(totalG: number, barG: number, smallestPlateG: number): number[] | null {
  if (totalG < barG) return null;
  let rest = (totalG - barG) / 2;
  if (!Number.isInteger(rest)) return null;
  const plates: number[] = [];
  for (const p of STANDARD_PLATES_G) {
    if (p < smallestPlateG) continue;
    while (rest >= p) {
      plates.push(p);
      rest -= p;
    }
  }
  return rest === 0 ? plates : null;
}
