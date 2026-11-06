import { ACTIVITY_LEVELS, NUTRITION_GOALS, type NutritionGoal } from '@rune/contracts';
import { Redirect } from 'wouter';
import { useNutritionView } from '../../repos';
import { Page } from '../../ui';
import { formatLongDate } from './format';
import styles from './nutrition.module.css';
import { HOW_REVIEWED_ON, HOW_SOURCE_URLS, NUTRITION_TEXTS } from './nutrition-texts';

const T = NUTRITION_TEXTS.how;
const SOURCE_IDS = Object.keys(HOW_SOURCE_URLS) as (keyof typeof HOW_SOURCE_URLS)[];

/**
 * « Comment sont calculés mes repères » (spec brique 5 §10.6) : texte fixe (formule, niveau d'activité, objectif,
 * arrondis, bilan) avec les valeurs de la cible en vigueur, les règles appliquées en phrases, les sources et la date de
 * relecture. Mode complet seulement ; ailleurs, retour au module. L'IMC n'est jamais nommé, et pendant une pause de
 * sécurité l'objectif « perte » n'est pas décrit.
 */
export function HowPage() {
  const view = useNutritionView();
  if (view === undefined) return null;
  if (view.mode !== 'full') return <Redirect to="/nutrition" replace />;
  const t = view.target;
  const goals: readonly NutritionGoal[] = NUTRITION_GOALS.filter((g) => !(g === 'lose' && view.safetyPause));
  const mine = view.settings?.activityLevel ?? null;

  return (
    <Page title={T.title} back="/nutrition">
      <div className={`${styles.stack} stagger`}>
        <section className={styles.section}>
          <p>{T.lead}</p>
          {t ? null : <p>{T.noTarget}</p>}
        </section>

        <section className={styles.section} aria-labelledby="how-base">
          <h2 id="how-base">{T.base.title}</h2>
          <p>{T.base.text}</p>
        </section>

        <section className={styles.section} aria-labelledby="how-activity">
          <h2 id="how-activity">{T.activity.title}</h2>
          <p>{T.activity.text}</p>
          <ul className={styles.list}>
            {ACTIVITY_LEVELS.map((level) => (
              <li key={level}>
                {T.activity.factor(NUTRITION_TEXTS.start.setup.activity[level], T.activity.pal[level])}
                {mine === level ? (
                  <>
                    {' '}
                    <strong className={styles.mine}>{T.activity.mine}</strong>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="how-goal">
          <h2 id="how-goal">{T.goal.title}</h2>
          <p>{T.goal.text}</p>
          <ul className={styles.list}>
            {goals.map((g) => (
              <li key={g}>{T.goal[g]}</li>
            ))}
          </ul>
        </section>

        {t ? (
          <section className={styles.section} aria-labelledby="how-values">
            <h2 id="how-values">{T.values.title}</h2>
            <ul className={styles.list}>
              <li>{T.values.energy(t.kcalMin, t.kcalMax, t.kcalTarget)}</li>
              <li>{T.values.protein(t.proteinGMin, t.proteinGMax)}</li>
              <li>{T.values.fat(t.fatGMin)}</li>
              <li>{T.values.carbs(t.carbsG)}</li>
              <li>{T.values.fiber(t.fiberG)}</li>
              <li>{T.values.water(t.waterMl)}</li>
            </ul>
          </section>
        ) : null}

        {t && t.appliedRules.length > 0 ? (
          <section className={styles.section} aria-labelledby="how-rules">
            <h2 id="how-rules">{T.rules.title}</h2>
            <ul className={styles.list}>
              {t.appliedRules.map((rule) => (
                <li key={rule}>{T.rules[rule]}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={styles.section} aria-labelledby="how-rounding">
          <h2 id="how-rounding">{T.rounding.title}</h2>
          <p>{T.rounding.text}</p>
        </section>

        <section className={styles.section} aria-labelledby="how-checkin">
          <h2 id="how-checkin">{T.checkin.title}</h2>
          <p>{T.checkin.text}</p>
        </section>

        <section className={styles.section} aria-labelledby="how-sources">
          <h2 id="how-sources">{T.sources.title}</h2>
          <ul className={styles.list}>
            {SOURCE_IDS.map((id) => (
              <li key={id}>
                <a
                  href={HOW_SOURCE_URLS[id]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.textLink}
                >
                  {T.sources.labels[id]}
                </a>
              </li>
            ))}
          </ul>
          <p className={styles.muted}>{`${T.sources.reviewedOn} ${formatLongDate(HOW_REVIEWED_ON)}`}</p>
        </section>
      </div>
    </Page>
  );
}
