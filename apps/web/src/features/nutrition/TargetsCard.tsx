import type { NutritionGoal } from '@rune/contracts';
import { Link } from 'wouter';
import type { NutritionTargetView } from '../../repos';
import styles from './nutrition.module.css';
import { NUTRITION_TEXTS } from './nutrition-texts';

const T = NUTRITION_TEXTS.full.targets;

/**
 * Repères du jour (spec brique 5 §12.2) : l'énergie en fourchette avec le repère central en petit, puis protéines,
 * lipides, glucides, fibres et eau, tels que la cible les donne (aucun calcul ici). Quand l'objectif effectif est le
 * maintien alors que la personne a demandé la perte, une ligne neutre le dit, sans autre explication.
 */
export function TargetsCard(p: { target: NutritionTargetView | null; requestedGoal: NutritionGoal | null }) {
  const t = p.target;
  return (
    <>
      <p className={styles.muted}>{T.estimate}</p>
      {t ? (
        <dl className={styles.targets}>
          <div>
            <dt>{T.energy}</dt>
            <dd>{T.energyRange(t.kcalMin, t.kcalMax)}</dd>
            <dd className={styles.muted}>{T.energyCentre(t.kcalTarget)}</dd>
          </div>
          <div>
            <dt>{T.protein}</dt>
            <dd>{T.proteinRange(t.proteinGMin, t.proteinGMax)}</dd>
          </div>
          <div>
            <dt>{T.fat}</dt>
            <dd>{T.fatMin(t.fatGMin)}</dd>
          </div>
          <div>
            <dt>{T.carbs}</dt>
            <dd>{T.carbsAbout(t.carbsG)}</dd>
          </div>
          <div>
            <dt>{T.fiber}</dt>
            <dd>{T.fiberValue(t.fiberG)}</dd>
          </div>
          <div>
            <dt>{T.water}</dt>
            <dd>{T.waterValue(t.waterMl)}</dd>
          </div>
        </dl>
      ) : null}
      {t && p.requestedGoal === 'lose' && t.effectiveGoal === 'maintain' ? (
        <p>{T.goalOnMaintenance}</p>
      ) : null}
      <Link href="/nutrition/how" className={styles.textLink}>
        {T.how}
      </Link>
    </>
  );
}
