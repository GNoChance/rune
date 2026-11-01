import { z } from 'zod';

export const LoadSettingsSchema = z.strictObject({
  barG: z.number().int().min(5000).max(25000),
  smallestPlateG: z.number().int().min(250).max(5000),
  dumbbellsG: z
    .array(z.number().int().min(500).max(80000))
    .max(60)
    .refine((a) => a.every((v, i) => i === 0 || v > (a[i - 1] as number)), {
      message: 'dumbbellsG doit être strictement croissant',
    }),
  machineStepG: z.number().int().min(500).max(10000),
});

export type LoadSettings = z.infer<typeof LoadSettingsSchema>;

export function defaultLoadSettings(kind: 'gym' | 'home'): LoadSettings {
  return {
    barG: 20000,
    smallestPlateG: 1250,
    dumbbellsG: kind === 'gym' ? Array.from({ length: 20 }, (_, i) => 2000 * (i + 1)) : [],
    machineStepG: 5000,
  };
}

/**
 * Haltères proposés à la coche (écran Réglages de charge) : les paires courantes de 0,5 à 80 kg, strictement
 * croissantes, toutes dans les bornes de `LoadSettingsSchema` (48 valeurs, sous le plafond de 60).
 */
export const DUMBBELL_CHOICES_G: readonly number[] = [
  500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 7500, 8000, 9000, 10000, 12000, 12500, 14000,
  15000, 16000, 17500, 18000, 20000, 22000, 22500, 24000, 25000, 26000, 27500, 28000, 30000, 32000, 32500,
  34000, 35000, 36000, 37500, 38000, 40000, 42500, 45000, 47500, 50000, 55000, 60000, 65000, 70000, 75000,
  80000,
];
