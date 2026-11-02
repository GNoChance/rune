import { MachineStepRequest } from '@rune/contracts';
import { useState } from 'react';
import { useRepos } from '../../repos';
import {
  Banner,
  BottomSheet,
  Button,
  Field,
  formatKg,
  formatKgValue,
  NETWORK_REQUIRED_MESSAGE,
  useAction,
} from '../../ui';
import styles from './live.module.css';
import { parseKg } from './number-input';

/*
 * « Pas de cette machine » (05 §12, spec brique 3 §6) : l'écart entre deux crans de la machine de cet exercice, gardé
 * dans l'état (slot, exercice) par l'API en ligne et repris au rejeu. Hors ligne, l'entrée du menu est grisée ; si le
 * réseau tombe la feuille ouverte, elle le dit et n'envoie rien. Bornes de l'API : 0,5 à 10 kg.
 */

const RANGE = 'Entre 0,5 et 10 kg.';

export function MachineStepSheet(p: {
  name: string;
  /** Id déterministe de l'état (slot, exercice). */
  stateId: string;
  /** Pas fixé pour cette machine ; null : celui du lieu. */
  stepG: number | null;
  placeStepG: number;
  offline: boolean;
  onClose(): void;
}) {
  const repos = useRepos();
  const [text, setText] = useState(() => formatKgValue(p.stepG ?? p.placeStepG));
  const [error, setError] = useState<string | null>(null);
  const save = useAction((stepG: number | null) => repos.program.setMachineStep(p.stateId, stepG), {
    validation: RANGE,
  });

  const send = async (stepG: number | null) => {
    if ((await save.run(stepG)) !== undefined) p.onClose();
  };

  const submit = () => {
    const parsed = parseKg(text);
    const stepG = parsed.ok ? parsed.g : null;
    if (stepG === null || !MachineStepRequest.safeParse({ stepG }).success) {
      setError(RANGE);
      return;
    }
    setError(null);
    void send(stepG);
  };

  const locked = p.offline || save.pending;
  return (
    <BottomSheet
      open
      title="Pas de cette machine"
      onClose={p.onClose}
      actions={
        <>
          <Button block disabled={locked} onClick={submit}>
            Enregistrer
          </Button>
          {p.stepG === null ? null : (
            <Button variant="secondary" block disabled={locked} onClick={() => void send(null)}>
              {`Revenir au pas du lieu (${formatKg(p.placeStepG)})`}
            </Button>
          )}
          <Button variant="secondary" block onClick={p.onClose}>
            Annuler
          </Button>
        </>
      }
    >
      <p className={styles.sheetDetail}>{p.name}</p>
      {p.offline ? <Banner tone="warning">{NETWORK_REQUIRED_MESSAGE}</Banner> : null}
      {save.error ? (
        <p role="alert" className={styles.saveError}>
          {save.error}
        </p>
      ) : null}
      <Field label="Pas en kg" help="L'écart entre deux crans de la pile, pour cet exercice." error={error}>
        <input
          className={styles.input}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setError(null);
            save.reset();
          }}
        />
      </Field>
    </BottomSheet>
  );
}
