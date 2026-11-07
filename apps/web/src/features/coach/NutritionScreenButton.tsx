import { Link } from 'wouter';
import styles from './coach-page.module.css';
import type { NutritionScreenOffer } from './coach-store';
import { NUTRITION_BUTTONS } from './coach-texts';

/** Adresse des réglages nutrition ouverte par le coach (spec brique 5 §11.2) : l'écran, puis la valeur à présélectionner. */
export function nutritionSettingsPath(offer: NutritionScreenOffer): string {
  const params = new URLSearchParams({ focus: offer.screen });
  if (offer.suggestion !== undefined) params.set('suggest', String(offer.suggestion));
  return `/nutrition/settings?${params.toString()}`;
}

/**
 * Bouton sous la bulle du coach après `open_nutrition_screen` : un lien vers les réglages, rien n'est modifié tant
 * que la personne ne confirme pas là-bas. Un seul par message.
 */
export function NutritionScreenButton(p: { offer: NutritionScreenOffer }) {
  return (
    <div className={styles.cards}>
      <Link href={nutritionSettingsPath(p.offer)} className={styles.action}>
        {NUTRITION_BUTTONS.openSettings}
      </Link>
    </div>
  );
}
