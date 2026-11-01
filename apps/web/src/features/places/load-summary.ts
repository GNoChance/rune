import type { LoadSettings } from '@rune/contracts';
import { formatKg } from '../../ui';

/** Résumé de la ligne « Réglages de charge » d'une fiche : « Barre 20 kg · disque 1,25 kg ». */
export function loadSummary(s: LoadSettings): string {
  return `Barre ${formatKg(s.barG)} · disque ${formatKg(s.smallestPlateG)}`;
}
