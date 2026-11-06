import {
  GUIDED_PROGRAM_EXERCISES,
  type GuidedChip,
  type GuidedFlow as GuidedFlowDef,
  type GuidedRequest,
} from '@rune/contracts';
import { useState } from 'react';
import styles from './coach-page.module.css';
import { GUIDED_TEXTS } from './coach-texts';
import type { GuidedExercise } from './guided-exercises';

/**
 * Parcours guidés (spec brique 4.1 §2) : la liste des parcours, puis, pour celui qu'on choisit, une étape à la fois
 * avec « Retour » et « Annuler ». Tout reste local : seul le dernier toucher appelle `onChoose` (un parcours sans
 * étape part au premier). `disabled` grise les puces (hors ligne, limite, réponse ailleurs) ; « Retour » et
 * « Annuler » restent actifs, ils ne touchent pas au réseau. `onCancel` : « Annuler » depuis une étape, après
 * quoi la liste revient (l'écran peut aussi la fermer). Les étapes d'exercice viennent du programme courant ;
 * sans programme, « Mes charges » est grisé et dit pourquoi.
 */
export function GuidedFlow(p: {
  flows: readonly GuidedFlowDef[];
  exercises: readonly GuidedExercise[];
  disabled: boolean;
  onChoose(guided: GuidedRequest): void;
  onCancel?(): void;
}) {
  const [flowId, setFlowId] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const flow = p.flows.find((f) => f.id === flowId) ?? null;

  const reset = () => {
    setFlowId(null);
    setChoices([]);
  };

  const choose = (guided: GuidedRequest) => {
    reset();
    p.onChoose(guided);
  };

  if (flow === null) {
    return (
      <div className={styles.guidedChips}>
        {p.flows.map((f) => {
          const needsProgram = f.steps[0]?.chips === GUIDED_PROGRAM_EXERCISES && p.exercises.length === 0;
          return (
            <button
              key={f.id}
              type="button"
              className={styles.guidedChip}
              disabled={p.disabled || needsProgram}
              onClick={() => {
                if (f.steps.length === 0) choose({ flow: f.id, choices: [] });
                else {
                  setFlowId(f.id);
                  setChoices([]);
                }
              }}
            >
              {f.label}
              {needsProgram ? <span className={styles.guidedHint}>{GUIDED_TEXTS.noProgram}</span> : null}
            </button>
          );
        })}
      </div>
    );
  }

  const step = flow.steps[choices.length] as (typeof flow.steps)[number];
  const chips: readonly GuidedChip[] =
    step.chips === GUIDED_PROGRAM_EXERCISES
      ? p.exercises.map((e) => ({ id: e.id, label: e.name }))
      : step.chips;

  return (
    <div className={styles.guided}>
      <p className={styles.guidedPrompt}>{step.prompt}</p>
      <div className={styles.guidedChips}>
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            className={styles.guidedChip}
            disabled={p.disabled}
            onClick={() => {
              const next = [...choices, c.id];
              if (next.length === flow.steps.length) choose({ flow: flow.id, choices: next });
              else setChoices(next);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className={styles.guidedLinks}>
        <button
          type="button"
          className={styles.guidedLink}
          onClick={() => (choices.length === 0 ? reset() : setChoices(choices.slice(0, -1)))}
        >
          {GUIDED_TEXTS.back}
        </button>
        <button
          type="button"
          className={styles.guidedLink}
          onClick={() => {
            reset();
            p.onCancel?.();
          }}
        >
          {GUIDED_TEXTS.cancel}
        </button>
      </div>
    </div>
  );
}
