import { NUTRITION_MODES, type NutritionMode, SAFETY_SCREEN, type ScreenAnswers } from '@rune/contracts';
import { screenOutcome } from '@rune/domain';
import { useId } from 'react';
import { Button, ChoiceList } from '../../ui';
import { TcaLine } from './NutritionFooter';
import styles from './nutrition.module.css';
import { NUTRITION_TEXTS } from './nutrition-texts';

const T = NUTRITION_TEXTS.start;

export type ScreenAnswer = ScreenAnswers[keyof ScreenAnswers];
export type ScreenQuestionId = (typeof SAFETY_SCREEN.questions)[number]['id'];

/** Étapes 3 et 4 de l'activation (§12.4) : les réponses restent dans l'état React de l'appelant, jamais ailleurs. */
export function QuestionStep(p: {
  index: number;
  onAnswer(id: ScreenQuestionId, answer: ScreenAnswer): void;
}) {
  const question = SAFETY_SCREEN.questions[p.index];
  if (!question) return null;
  const answer = (a: ScreenAnswer) => () => p.onAnswer(question.id, a);
  return (
    <section className={styles.section}>
      <p className={styles.muted}>{T.question.progress(p.index + 1, SAFETY_SCREEN.questions.length)}</p>
      <h2>{question.text}</h2>
      <div className={styles.answers}>
        <Button onClick={answer('yes')}>{T.question.yes}</Button>
        <Button onClick={answer('no')}>{T.question.no}</Button>
        <Button variant="secondary" onClick={answer('prefer_not')}>
          {T.question.preferNot}
        </Button>
      </div>
    </section>
  );
}

const MODE_ORDER: readonly NutritionMode[] = NUTRITION_MODES;

/**
 * Issue de l'écran : d'abord la ligne d'écoute si Q2 = oui, puis les orientations, puis le choix du mode parmi les
 * permis (le mode complet, grisé avec sa raison, tant que le cercle ne l'a pas ouvert).
 */
export function OutcomeStep(p: {
  answers: ScreenAnswers;
  fullOpen: boolean;
  mode: NutritionMode | null;
  onMode(mode: NutritionMode): void;
}) {
  const reasonId = useId();
  const outcome = screenOutcome(p.answers);
  const help = NUTRITION_TEXTS.help;
  const orientation = outcome.orientations.flatMap((o) =>
    o === 'midwife'
      ? [help.midwife]
      : o === 'doctor'
        ? [help.doctor]
        : o === 'dietitian'
          ? [help.dietitian]
          : [],
  );
  const tca = outcome.orientations.includes('eating_disorder_line');
  return (
    <section className={styles.section}>
      {tca ? (
        <div data-testid="tca-first" className={styles.cause}>
          <p>{help.lead}</p>
          <TcaLine />
        </div>
      ) : null}
      <h2>{T.outcome.title}</h2>
      <p>{outcome.reason === 'safety' ? T.outcome.safety : T.outcome.choice}</p>
      {orientation.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <ChoiceList<NutritionMode>
        name="nutrition-mode"
        legend={T.outcome.modeLegend}
        value={p.mode}
        onChange={p.onMode}
        options={MODE_ORDER.filter((m) => outcome.allowedModes.includes(m)).map((m) => {
          const closed = m === 'full' && !p.fullOpen;
          return {
            value: m,
            label: NUTRITION_TEXTS.entry[m],
            disabled: closed,
            describedBy: closed ? reasonId : undefined,
          };
        })}
      />
      {outcome.allowedModes.includes('full') && !p.fullOpen ? (
        <p id={reasonId} className={styles.muted}>
          {T.outcome.fullClosed}
        </p>
      ) : null}
    </section>
  );
}
