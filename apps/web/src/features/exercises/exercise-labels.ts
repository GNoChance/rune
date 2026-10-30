import { EQUIPMENT_LABELS, type EquipmentCode, type ExerciseLevel } from '@rune/contracts';
import { feasible } from '@rune/domain';

/** Nom de chaque niveau de fiche (04 §3.5). */
export const LEVEL_NAMES: Record<ExerciseLevel, string> = {
  1: 'débutant',
  2: 'intermédiaire',
  3: 'avancé',
};

/** « Niveau 1 sur 3, débutant » (spec brique 2 §4.1) : texte du niveau, lu tel quel par les lecteurs d'écran. */
export const levelText = (level: ExerciseLevel): string => `Niveau ${level} sur 3, ${LEVEL_NAMES[level]}`;

/**
 * Option de matériel montrée pour une fiche (spec brique 2 §4.1) : la première faisable avec le matériel du lieu
 * principal (déjà étendu par `expandEquipment`), sinon la première ; sans lieu (`equipment` null), la première.
 */
export function shownEquipmentOption(
  options: readonly (readonly EquipmentCode[])[],
  equipment: ReadonlySet<EquipmentCode> | null,
): readonly EquipmentCode[] {
  const first = options[0] ?? [];
  if (equipment === null) return first;
  return options.find((option) => feasible({ equipment_options: [[...option]] }, equipment)) ?? first;
}

/** Libellé d'une option de matériel : « Barre droite et disques + Cage… », « Sans matériel » pour `[]`. */
export const equipmentText = (option: readonly EquipmentCode[]): string =>
  option.length === 0 ? 'Sans matériel' : option.map((code) => EQUIPMENT_LABELS[code]).join(' + ');
