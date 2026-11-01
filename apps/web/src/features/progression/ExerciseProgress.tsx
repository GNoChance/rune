import { exerciseRecords } from '@rune/domain';
import { useId } from 'react';
import { useMe } from '../../app-services';
import { useCatalog, useHistory } from '../../repos';
import { formatDate, formatKgGrouped, formatSeconds, Page } from '../../ui';
import { type ExerciseSeries, exerciseSeries, type Metric } from './exercise-series';
import { LineChart } from './LineChart';
import styles from './progression.module.css';

/** Retour : Progression, d'où la page s'ouvre (spec brique 3 §7.10). */
const BACK = '/progression';

/** 05 §13.1 : un 1RM estimé porte toujours cette mention et ne sert jamais de cible. */
const E1RM_MENTION = 'estimation, écart possible de 10 % ou plus';

const METRIC_HEADER: Record<Metric, string> = {
  load: 'Meilleure charge',
  duration: 'Durée la plus longue',
  reps: 'Répétitions',
};

const valueText = (metric: Metric, value: number): string =>
  metric === 'load' ? formatKgGrouped(value) : metric === 'duration' ? formatSeconds(value) : String(value);

/** L'estimation, au demi-kilo : un chiffre plus précis laisserait croire à une mesure. */
const roundToHalfKg = (grams: number): number => Math.round(grams / 500) * 500;

function Curve({ series }: { series: ExerciseSeries & { metric: Metric } }) {
  const titleId = useId();
  const { metric, points } = series;
  return (
    <section aria-labelledby={titleId} className={styles.panel}>
      <h2 id={titleId} className={styles.sectionTitle}>
        Courbe
      </h2>
      <LineChart values={points.map((p) => p.value)} />
      <table className={styles.srOnly}>
        <caption>Meilleure série par séance</caption>
        <thead>
          <tr>
            <th scope="col">Séance du</th>
            <th scope="col">{METRIC_HEADER[metric]}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.sessionId}>
              <td>{formatDate(new Date(p.startedAt).toISOString())}</td>
              <td>{valueText(metric, p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Progression d'un exercice (`/progression/exercises/:id`, spec brique 3 §7.10) : courbe de la meilleure série par
 * séance (charge, ou secondes, ou répétitions selon l'exercice) avec son tableau équivalent pour les lecteurs
 * d'écran, records de l'exercice et 1RM estimé (jamais pour un mineur, 05 §13.1).
 */
export function ExerciseProgress({ id }: { id: string }) {
  const me = useMe();
  const history = useHistory();
  const catalog = useCatalog();
  const recordsTitle = useId();
  if (!me || history === undefined || catalog.state === 'loading') return null;

  const sheet = catalog.sheets.find((s) => s.id === id);
  if (!sheet) {
    return (
      <Page title="Exercice" back={BACK}>
        <p className={styles.hint}>Cet exercice n'est pas dans ton catalogue.</p>
      </Page>
    );
  }
  const series = exerciseSeries(history, id);
  const records = exerciseRecords(history, id, me.ageBand);
  const rows: [string, string][] = [];
  if (records.bestLoad) {
    rows.push(['Meilleure charge', `${formatKgGrouped(records.bestLoad.loadG)} × ${records.bestLoad.reps}`]);
  }
  if (records.bestReps !== null) rows.push(['Répétitions max', String(records.bestReps)]);
  if (records.bestDurationS !== null)
    rows.push(['Durée la plus longue', formatSeconds(records.bestDurationS)]);
  if (records.bestSessionVolumeG !== null) {
    rows.push(['Meilleur volume en une séance', formatKgGrouped(records.bestSessionVolumeG)]);
  }

  return (
    <Page title={sheet.name} back={BACK}>
      {series.metric === null ? (
        <p className={styles.hint}>Aucune série faite sur cet exercice pour l'instant.</p>
      ) : (
        <div className={`${styles.content} stagger`}>
          <Curve series={{ ...series, metric: series.metric }} />
          <section aria-labelledby={recordsTitle} className={styles.panel}>
            <h2 id={recordsTitle} className={styles.sectionTitle}>
              Records
            </h2>
            <dl className={styles.records}>
              {rows.map(([label, value]) => (
                <div key={label} className={styles.record}>
                  <dt>{label}</dt> <dd>{value}</dd>
                </div>
              ))}
              {records.e1rmG === null ? null : (
                <div className={styles.record}>
                  <dt>1RM estimé</dt> <dd>{formatKgGrouped(roundToHalfKg(records.e1rmG))}</dd>
                  <dd className={styles.mention}>{E1RM_MENTION}</dd>
                </div>
              )}
            </dl>
          </section>
        </div>
      )}
    </Page>
  );
}
