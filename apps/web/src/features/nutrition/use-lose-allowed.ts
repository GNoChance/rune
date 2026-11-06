import { bmiBelow, parisDate, referenceWeight } from '@rune/domain';
import { useServices } from '../../app-services';
import { type NutritionView, useWeighIns } from '../../repos';

/**
 * « Perte » est proposée ou non (07 §5.4.5, D14) : jamais pendant une pause de sécurité, ni quand l'objectif est
 * déjà imposé au maintien (règle `no_deficit_low_bmi`), ni sous un IMC de 18,5 d'après la taille et le poids de
 * référence de l'appareil. Aucun chiffre ni motif n'est montré. Sans poids de référence, la décision revient au serveur ; tant que rien n'est lu, elle n'est pas proposée.
 */
export function useLoseAllowed(view: NutritionView | undefined): boolean {
  const services = useServices();
  const weighIns = useWeighIns();
  // Tant que la vue ou les pesées ne sont pas lues, « perte » n'est pas proposée (jamais d'ouverture par défaut).
  if (view === undefined || weighIns === undefined || view.safetyPause) return false;
  if (view.target?.appliedRules.includes('no_deficit_low_bmi')) return false;
  const height = view.settings?.heightCm ?? null;
  const ref = referenceWeight(weighIns, parisDate(new Date(services.now())));
  return !(height !== null && ref !== null && bmiBelow(height, ref, '18.5'));
}
