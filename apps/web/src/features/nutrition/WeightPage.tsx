import { addDays, mondayOf, movingAverage7, parisDate, weekMean } from '@rune/domain';
import { type FormEvent, useState } from 'react';
import { Redirect } from 'wouter';
import { useServices } from '../../app-services';
import { useNutritionView, useRepos, useWeighIns, type WeighInView } from '../../repos';
import { Button, Chips, Field, formatDate, Page, useAction } from '../../ui';
import { LineChart } from '../progression/LineChart';
import { formatKg } from './format';
import { NUTRITION_TEXTS } from './nutrition-texts';
import { parseWeight } from './parse-weight';
import { WeighInSheet } from './WeighInSheet';
import styles from './weight.module.css';

const T = NUTRITION_TEXTS.weigh;
const R = T.page.ranges;

type Range = 'w4' | 'm3' | 'y1';
const RANGE_DAYS: Record<Range, number> = { w4: 28, m3: 91, y1: 365 };

/** Correction du poids d'une pesée, sur place (la date ne se corrige pas : supprimer, puis noter de nouveau). */
function EditRow(p: { weighIn: WeighInView; onDone(): void }) {
  const repos = useRepos();
  const [text, setText] = useState(formatKg(p.weighIn.weightG));
  const parsed = parseWeight(text);
  const save = useAction(async (weightG: number) => {
    await repos.weighIns.correct(p.weighIn.id, weightG);
    return true;
  });
  const error = text.trim() === '' || parsed.ok ? null : T.weightErrors[parsed.reason];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsed.ok) return;
    if (await save.run(parsed.weightG)) p.onDone();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className={styles.editForm}>
      <Field label={T.weight} error={error ?? save.error}>
        <input
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <div className={styles.rowActions}>
        <Button type="submit" disabled={!parsed.ok || save.pending}>
          {T.save}
        </Button>
        <Button variant="secondary" onClick={p.onDone}>
          {T.cancel}
        </Button>
      </div>
    </form>
  );
}

function WeighInRow(p: { weighIn: WeighInView }) {
  const repos = useRepos();
  const [editing, setEditing] = useState(false);
  const remove = useAction(() => repos.weighIns.remove(p.weighIn.id));
  const date = formatDate(p.weighIn.date);
  return (
    <li className={styles.row}>
      {editing ? (
        <EditRow weighIn={p.weighIn} onDone={() => setEditing(false)} />
      ) : (
        <>
          <span className={styles.rowText}>
            {date} · {formatKg(p.weighIn.weightG)} kg
          </span>
          <span className={styles.rowActions}>
            <button
              type="button"
              className={styles.textButton}
              aria-label={T.page.correct(date)}
              onClick={() => setEditing(true)}
            >
              {T.page.editLabel}
            </button>
            <button
              type="button"
              className={styles.textButton}
              aria-label={T.page.remove(date)}
              disabled={remove.pending}
              onClick={() => void remove.run()}
            >
              {T.page.removeLabel}
            </button>
          </span>
          {remove.error ? (
            <span role="alert" className={styles.note}>
              {remove.error}
            </span>
          ) : null}
        </>
      )}
    </li>
  );
}

function WeightContent() {
  const services = useServices();
  const weighIns = useWeighIns();
  const [range, setRange] = useState<Range>('w4');
  const [sheet, setSheet] = useState(false);
  if (weighIns === undefined) return null;

  const today = parisDate(new Date(services.now()));
  const from = addDays(today, -RANGE_DAYS[range]);
  const inRange = weighIns.filter((w) => w.date >= from && w.date <= today);
  const ascending = [...inRange].reverse();
  // La moyenne glissante se lit sur toutes les pesées : le début de la plage n'en fausse pas la première valeur.
  const averages = ascending.map((w) => (movingAverage7(weighIns, w.date) ?? w.weightG) / 1000);
  const points = ascending.map((w) => w.weightG / 1000);

  const weeks: { monday: string; count: number; meanG: number | null }[] = [];
  for (let monday = mondayOf(today); monday >= mondayOf(from); monday = addDays(monday, -7)) {
    const week = weekMean(weighIns, monday);
    if (week.count > 0) weeks.push({ monday, ...week });
  }

  return (
    <div className={styles.stack}>
      <Button onClick={() => setSheet(true)}>{NUTRITION_TEXTS.full.weight.log}</Button>
      <Chips
        name="weight-range"
        legend={R.legend}
        value={range}
        onChange={(v) => setRange(v as Range)}
        options={[
          { value: 'w4', label: R.w4 },
          { value: 'm3', label: R.m3 },
          { value: 'y1', label: R.y1 },
        ]}
      />
      {inRange.length === 0 ? (
        <p className={styles.muted}>{T.page.empty}</p>
      ) : (
        <>
          <div className={styles.chart}>
            <LineChart values={averages} points={points} dates={ascending.map((w) => w.date)} neutral />
            <p className={styles.muted}>{T.page.chartNote}</p>
          </div>
          <table className={styles.table}>
            <caption>{T.page.tableCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{T.page.colWeek}</th>
                <th scope="col">{T.page.colMean}</th>
                <th scope="col">{T.page.colCount}</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.monday}>
                  <th scope="row">{formatDate(w.monday)}</th>
                  <td>{w.meanG === null ? T.page.notEnough : formatKg(w.meanG)}</td>
                  <td>{w.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className={styles.list} aria-label={T.page.listLabel}>
            {inRange.map((w) => (
              <WeighInRow key={w.id} weighIn={w} />
            ))}
          </ul>
        </>
      )}
      <WeighInSheet open={sheet} onClose={() => setSheet(false)} />
    </div>
  );
}

/**
 * Courbe du poids (spec brique 5 §12.2) : moyenne glissante sur 7 jours en trait, pesées en points, sur 4 semaines,
 * 3 mois ou 1 an ; la table des moyennes de semaine en donne la lecture aux lecteurs d'écran ; puis la liste des pesées
 * avec correction et suppression. Rien hors du mode complet. Aucune teinte d'état, aucun jugement.
 */
export function WeightPage() {
  const view = useNutritionView();
  if (view === undefined) return null;
  if (view.mode !== 'full') return <Redirect to="/nutrition" replace />;
  return (
    <Page title={T.page.title} back="/nutrition">
      <WeightContent />
    </Page>
  );
}
