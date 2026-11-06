import { useId } from 'react';
import { Page } from '../../ui';
import { TcaLine } from '../nutrition/NutritionFooter';
import nutritionStyles from '../nutrition/nutrition.module.css';
import { NUTRITION_TEXTS } from '../nutrition/nutrition-texts';
import styles from './public.module.css';
import { usePublicBack } from './use-public-back';

const T = NUTRITION_TEXTS.help;

/**
 * « Demander de l'aide » (spec brique 5 §10.6, 07 §5.11) : page publique, lisible sans session et dans tous les modes.
 * La ligne d'écoute des troubles du comportement alimentaire vient de `HELP_RESOURCES` (lien `tel:` et lien vers le
 * site de l'association) ; viennent ensuite le médecin traitant, le ou la diététicien·ne et la sage-femme. Statique :
 * aucune requête.
 */
export function NutritionHelpPage() {
  const back = usePublicBack();
  const listenId = useId();
  const referralsId = useId();
  return (
    <Page title={T.title} back={back}>
      <div className={`stagger ${styles.stack}`}>
        <p>{T.lead}</p>
        <section aria-labelledby={listenId} className={styles.section}>
          <h2 id={listenId}>{T.listenTitle}</h2>
          <div className={`${styles.card} ${nutritionStyles.helpCard}`}>
            <p>{T.listenLead}</p>
            <TcaLine />
          </div>
        </section>
        <section aria-labelledby={referralsId} className={styles.section}>
          <h2 id={referralsId}>{T.referralsTitle}</h2>
          <ul className={`${styles.card} ${styles.privacyList}`}>
            <li>{T.doctor}</li>
            <li>{T.dietitian}</li>
            <li>{T.midwife}</li>
          </ul>
        </section>
      </div>
    </Page>
  );
}
