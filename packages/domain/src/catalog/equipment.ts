import { EQUIPMENT_IMPLIES, type EquipmentCode, type ExerciseSheet } from '@rune/contracts';

/**
 * Matériel d'un lieu avec ses implications (R-EQ-2, `EQUIPMENT_IMPLIES` : `adjustable_bench` vaut aussi
 * `flat_bench`). À appliquer avant tout calcul : `feasible` et `CatalogContext.equipment` attendent un ensemble
 * déjà étendu. L'entrée n'est pas modifiée.
 */
export function expandEquipment(codes: Iterable<EquipmentCode>): Set<EquipmentCode> {
  const out = new Set<EquipmentCode>();
  const pending = [...codes];
  for (let code = pending.pop(); code !== undefined; code = pending.pop()) {
    if (out.has(code)) continue;
    out.add(code);
    pending.push(...(EQUIPMENT_IMPLIES[code] ?? []));
  }
  return out;
}

/**
 * 04 §6.1 : vrai s'il existe une option de `equipment_options` entièrement incluse dans `equipment`
 * (déjà passé par `expandEquipment`). `[[]]` est toujours faisable.
 */
export function feasible(
  ex: Pick<ExerciseSheet, 'equipment_options'>,
  equipment: ReadonlySet<EquipmentCode>,
): boolean {
  return ex.equipment_options.some((option) => option.every((code) => equipment.has(code)));
}
