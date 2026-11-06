import { isSuspiciousEntry, parisDate } from '@rune/domain';
import { type FormEvent, useState } from 'react';
import { useServices } from '../../app-services';
import { useRepos, useWeighIns } from '../../repos';
import { BottomSheet, Button, Field, useAction } from '../../ui';
import { NUTRITION_TEXTS } from './nutrition-texts';
import { parseWeight } from './parse-weight';
import styles from './weight.module.css';

const T = NUTRITION_TEXTS.weigh;

function WeighInForm(p: { onClose(): void; onSaved?: () => void }) {
  const services = useServices();
  const repos = useRepos();
  const weighIns = useWeighIns() ?? [];
  const today = parisDate(new Date(services.now()));
  const [date, setDate] = useState(today);
  const [text, setText] = useState('');
  const parsed = parseWeight(text);
  const save = useAction(async (day: string, weightG: number) => {
    await repos.weighIns.save({ date: day, weightG });
    return true;
  });

  const future = date > today;
  const weightError = text.trim() === '' || parsed.ok ? null : T.weightErrors[parsed.reason];
  const taken = weighIns.some((w) => w.date === date);
  const suspicious = parsed.ok && !future && isSuspiciousEntry(weighIns, parsed.weightG, date);
  const canSave = parsed.ok && date !== '' && !future && !save.pending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsed.ok || !canSave) return;
    const done = await save.run(date, parsed.weightG);
    if (done) {
      p.onSaved?.();
      p.onClose();
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className={styles.form}>
      <Field label={T.weight} help={T.weightHelp} error={weightError}>
        <input
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <Field label={T.date} error={future ? T.future : null}>
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {taken ? <p className={styles.note}>{T.replaces}</p> : null}
      {suspicious ? (
        <p role="status" className={styles.note}>
          {T.check}
        </p>
      ) : null}
      <p className={styles.advice}>{T.advice}</p>
      {save.error ? (
        <p role="alert" className={styles.note}>
          {save.error}
        </p>
      ) : null}
      <div className={styles.formActions}>
        <Button type="submit" block disabled={!canSave}>
          {T.save}
        </Button>
        <Button variant="secondary" block onClick={p.onClose}>
          {T.cancel}
        </Button>
      </div>
    </form>
  );
}

/**
 * Feuille de pesée (spec brique 5 §12.3) : poids à 0,1 kg près, date du jour par défaut (passée possible, future
 * jamais), « Remplace la pesée de ce jour » si la date est prise, « Vérifie ta saisie » au-delà de 3 kg d'écart sans
 * bloquer, et le conseil de 07 §5.7.1.5 en petit. L'enregistrement passe par l'outbox, donc hors ligne aussi.
 * `onSaved` : appelé après un enregistrement réussi (la feuille se ferme ensuite).
 */
export function WeighInSheet(p: { open: boolean; onClose(): void; onSaved?: () => void }) {
  return (
    <BottomSheet open={p.open} onClose={p.onClose} title={T.sheetTitle} actions={null}>
      <WeighInForm onClose={p.onClose} onSaved={p.onSaved} />
    </BottomSheet>
  );
}
