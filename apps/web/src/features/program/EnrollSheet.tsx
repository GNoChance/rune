import type { ProgramTemplate } from '@rune/contracts';
import { currentRules } from '@rune/domain';
import { useId, useState } from 'react';
import { BottomSheet, Button, Chips } from '../../ui';
import { ActionError, OfflineNotice } from './ActionError';
import styles from './program.module.css';
import { SWITCH_WARNING } from './program-labels';
import { useProgramAction } from './use-change';

/** Jours permis par un modèle : ses bornes, dans 2 à 4 (05 §15, `set_days_per_week`). */
export function daysOptions(t: Pick<ProgramTemplate, 'daysPerWeek'>): number[] {
  const [low, high] = currentRules().programBounds.days;
  const out: number[] = [];
  for (let d = Math.max(t.daysPerWeek.min, low); d <= Math.min(t.daysPerWeek.max, high); d += 1) out.push(d);
  return out;
}

/** `days` ramené dans les jours permis du modèle. */
export function clampDays(t: Pick<ProgramTemplate, 'daysPerWeek'>, days: number): number {
  const options = daysOptions(t);
  const first = options[0] ?? t.daysPerWeek.default;
  const last = options.at(-1) ?? t.daysPerWeek.default;
  return Math.min(Math.max(days, first), last);
}

/**
 * Feuille d'inscription (spec §7.8) : jours par semaine dans les bornes du modèle, préréglés ; avec un programme
 * actif, l'avertissement de la calibration (un changement de programme ou de version). `submit` inscrit ou change de
 * modèle ; son refus s'affiche sous l'action, la feuille reste ouverte.
 */
export function EnrollSheet(p: {
  template: Pick<ProgramTemplate, 'name' | 'daysPerWeek'>;
  title: string;
  confirmLabel: string;
  defaultDays: number;
  /** Un programme est en cours : il s'arrête (avertissement). */
  switching: boolean;
  offline: boolean;
  submit(days: number): Promise<unknown>;
  onDone(): void;
  onClose(): void;
}) {
  const [days, setDays] = useState(String(clampDays(p.template, p.defaultDays)));
  const warningId = useId();
  const action = useProgramAction();
  const confirm = async () => {
    if (await action.run('enroll', () => p.submit(Number(days)))) p.onDone();
  };
  return (
    <BottomSheet
      open
      title={p.title}
      onClose={p.onClose}
      describedBy={p.switching ? warningId : undefined}
      actions={
        <>
          <Button block disabled={p.offline || action.pending} onClick={() => void confirm()}>
            {p.confirmLabel}
          </Button>
          <ActionError message={action.errorOf('enroll')} />
          <Button variant="secondary" block onClick={p.onClose}>
            Annuler
          </Button>
        </>
      }
    >
      <OfflineNotice offline={p.offline} />
      {p.switching ? (
        <p id={warningId} className={styles.warning}>
          {SWITCH_WARNING}
        </p>
      ) : null}
      <Chips
        name="days-per-week"
        legend="Jours par semaine"
        value={days}
        onChange={setDays}
        options={daysOptions(p.template).map((d) => ({ value: String(d), label: String(d) }))}
      />
    </BottomSheet>
  );
}
