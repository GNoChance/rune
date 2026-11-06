import { addDays, movingAverage7, parisDate } from '@rune/domain';
import { useState } from 'react';
import { Link } from 'wouter';
import { useServices } from '../../app-services';
import { useWeighIns } from '../../repos';
import { Button } from '../../ui';
import { formatKg, formatPct } from './format';
import styles from './nutrition.module.css';
import { NUTRITION_TEXTS } from './nutrition-texts';
import { WeighInSheet } from './WeighInSheet';

const T = NUTRITION_TEXTS.full.weight;

/** Contenu de la section « Poids » du module : moyenne sur 7 jours, sa variation sur la semaine (neutre), les deux entrées. */
export function WeightSummary() {
  const services = useServices();
  const weighIns = useWeighIns();
  const [sheet, setSheet] = useState(false);

  const today = parisDate(new Date(services.now()));
  const list = weighIns ?? [];
  const now = movingAverage7(list, today);
  const before = movingAverage7(list, addDays(today, -7));
  const changePct = now !== null && before !== null && before > 0 ? (100 * (now - before)) / before : null;

  return (
    <>
      {weighIns === undefined ? null : now === null ? (
        <p className={styles.muted}>{T.none}</p>
      ) : (
        <>
          <p>{T.mean7(formatKg(now))}</p>
          {changePct !== null ? <p className={styles.muted}>{T.change(formatPct(changePct))}</p> : null}
        </>
      )}
      <Button variant="secondary" onClick={() => setSheet(true)}>
        {T.log}
      </Button>
      <Link href="/nutrition/weight" className={styles.textLink}>
        {T.curve}
      </Link>
      <WeighInSheet open={sheet} onClose={() => setSheet(false)} />
    </>
  );
}
