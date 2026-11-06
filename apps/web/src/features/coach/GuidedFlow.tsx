import {
  GUIDED_PROGRAM_EXERCISES,
  type GuidedChip,
  type GuidedFlow as GuidedFlowDef,
  type GuidedRequest,
} from '@rune/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import styles from './coach-page.module.css';
import { GUIDED_TEXTS } from './coach-texts';
import type { GuidedExercise } from './guided-exercises';

/**
 * Parcours guidés (spec brique 4.1 §2) : la liste des parcours, puis, pour celui qu'on choisit, une étape à la fois
 * avec « Retour » et « Annuler ». Tout reste local : seul le dernier toucher appelle `onChoose` (un parcours sans
 * étape part au premier). `disabled` grise les puces (hors ligne, limite, réponse ailleurs) ; « Retour » et
 * « Annuler » restent actifs, ils ne touchent pas au réseau. `onCancel` : « Annuler » depuis une étape, après
 * quoi la liste revient (l'écran peut aussi la fermer). Les étapes d'exercice viennent du programme courant
 * (`null` tant qu'il se charge) ; sans programme, « Mes charges » est grisé et un texte, hors du bouton, dit pourquoi.
 * Focus : à chaque étape il va sur la question (le bouton touché disparaît) ; de retour à la liste, sur son premier
 * parcours.
 */
export function GuidedFlow(p: {
  flows: readonly GuidedFlowDef[];
  exercises: readonly GuidedExercise[] | null;
  disabled: boolean;
  onChoose(guided: GuidedRequest): void;
  onCancel?(): void;
}) {
  const [flowId, setFlowId] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const promptId = useId();
  const hintId = useId();
  const prompt = useRef<HTMLParagraphElement>(null);
  const firstFlow = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  const flow = p.flows.find((f) => f.id === flowId) ?? null;
  const stepIndex = choices.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: le focus suit le parcours et l'étape
  useEffect(() => {
    if (flowId !== null) {
      moved.current = true;
      prompt.current?.focus();
    } else if (moved.current) {
      moved.current = false;
      firstFlow.current?.focus();
    }
  }, [flowId, stepIndex]);

  const reset = () => {
    setFlowId(null);
    setChoices([]);
  };

  const choose = (guided: GuidedRequest) => {
    moved.current = false;
    reset();
    p.onChoose(guided);
  };

  if (flow === null) {
    const noProgram = p.exercises !== null && p.exercises.length === 0;
    const needsProgram = (f: GuidedFlowDef) => f.steps[0]?.chips === GUIDED_PROGRAM_EXERCISES;
    return (
      <div className={styles.guided}>
        <div className={styles.guidedChips}>
          {p.flows.map((f, i) => (
            <button
              key={f.id}
              ref={i === 0 ? firstFlow : undefined}
              type="button"
              className={styles.guidedChip}
              disabled={p.disabled || (needsProgram(f) && (p.exercises === null || noProgram))}
              aria-describedby={needsProgram(f) && noProgram ? hintId : undefined}
              onClick={() => {
                if (f.steps.length === 0) choose({ flow: f.id, choices: [] });
                else {
                  setFlowId(f.id);
                  setChoices([]);
                }
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        {noProgram && p.flows.some(needsProgram) ? (
          <p id={hintId} className={styles.guidedHint}>
            {GUIDED_TEXTS.noProgram}
          </p>
        ) : null}
      </div>
    );
  }

  const step = flow.steps[stepIndex] as (typeof flow.steps)[number];
  const chips: readonly GuidedChip[] =
    step.chips === GUIDED_PROGRAM_EXERCISES
      ? (p.exercises ?? []).map((e) => ({ id: e.id, label: e.name }))
      : step.chips;

  return (
    <div className={styles.guided}>
      <p id={promptId} ref={prompt} tabIndex={-1} className={styles.guidedPrompt}>
        {step.prompt}
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: un fieldset imposerait sa mise en forme ; la question est son nom */}
      <div role="group" aria-labelledby={promptId} className={styles.guidedChips}>
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
