import type { EquipmentCode, ExerciseLevel, ExerciseSheet } from '@rune/contracts';
import { feasible } from './equipment';

/**
 * Champs qu'on lit dans une fiche pour la faisabilité, les chaînes, les remplaçants et les programmes (`mechanics` :
 * bornes des débutants en polyarticulaire, 05 §15). Une fiche complète (`ExerciseSheet`) les a tous, comme une fiche
 * servie aux téléphones, privée de ses colonnes éditoriales.
 */
export type CatalogSheet = Pick<
  ExerciseSheet,
  | 'id'
  | 'status'
  | 'level'
  | 'mechanics'
  | 'not_for_minors'
  | 'equipment_options'
  | 'movement_pattern'
  | 'primary_muscles'
  | 'secondary_muscles'
  | 'unilateral'
  | 'load_mode'
  | 'chain_id'
  | 'easier_id'
  | 'harder_id'
>;

/**
 * Contexte des fonctions du catalogue (04 §6).
 * - `equipment` : matériel du lieu principal, déjà passé par `expandEquipment` ; `'all'` sans lieu principal,
 *   où tout est faisable (spec brique 2 §4.1 et §4.2).
 * - `maxLevel` : `maxExerciseLevel` du profil d'entraînement ; seul `substitutes` le lit.
 * - `cautious` : profil prudent (`computeCautious`), fourni par l'appelant.
 */
export type CatalogContext<S extends CatalogSheet = ExerciseSheet> = {
  catalog: S[];
  equipment: Set<EquipmentCode> | 'all';
  maxLevel: ExerciseLevel;
  cautious: boolean;
};

/** Ordre binaire des `id` (unités UTF-16, comme `<`), jamais `localeCompare` : le même partout. */
export function compareIds(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Ce qu'on voit interrupteur « Faisable » coupé, ou sans lieu principal (spec brique 2 §4.1) : fiche publiée, et
 * pas `not_for_minors` en profil prudent. Le matériel n'entre pas en compte.
 */
export function visibleWithoutPlace(
  ex: Pick<CatalogSheet, 'status' | 'not_for_minors'>,
  cautious: boolean,
): boolean {
  return ex.status === 'published' && !(cautious && ex.not_for_minors);
}

/**
 * 04 §6.2 : publiée, faisable avec `ctx.equipment` (toujours avec `'all'`), et pas `not_for_minors` en profil
 * prudent. Le niveau n'y entre pas : `substitutes` filtre sur `maxLevel`, et le niveau ne bloque pas une chaîne.
 */
export function isUsable(
  ex: Pick<CatalogSheet, 'status' | 'not_for_minors' | 'equipment_options'>,
  ctx: Pick<CatalogContext<CatalogSheet>, 'equipment' | 'cautious'>,
): boolean {
  return visibleWithoutPlace(ex, ctx.cautious) && (ctx.equipment === 'all' || feasible(ex, ctx.equipment));
}
