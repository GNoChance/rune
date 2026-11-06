import {
  ACTIVITY_LEVELS,
  type ActivityLevel,
  type Goal,
  NUTRITION_GOALS,
  type NutritionGoal,
  SEX_FOR_CALC,
  type SexForCalc,
} from '@rune/contracts';
import { bmiBelow, preselectActivity, preselectGoal } from '@rune/domain';
import { useState } from 'react';
import { Banner, Button, ChoiceList, Field } from '../../ui';
import styles from './nutrition.module.css';
import { NUTRITION_TEXTS } from './nutrition-texts';
import { parseWeight } from './parse-weight';

const T = NUTRITION_TEXTS.start.setup;

/** Ce que l'étape 5 recueille ; la pesée devient `weigh_in` (identifiant et date) chez l'appelant. */
export interface SetupAnswers {
  sex: SexForCalc;
  heightCm: number;
  weightG: number;
  activity: ActivityLevel;
  goal: NutritionGoal;
}

const SEX_LABELS: Record<SexForCalc, string> = {
  male: T.male,
  female: T.female,
  unspecified: T.unspecified,
};

/**
 * Étape 5 (§12.4) : sexe pour le calcul, taille, première pesée, niveau d'activité et objectif, ces deux derniers
 * présélectionnés d'après le profil mais modifiables. Sous un IMC de 18,5, « perte » n'est pas proposé, sans message
 * (l'IMC n'est jamais affiché). Les valeurs vivent dans l'état de l'écran seulement.
 */
export function SetupStep(p: {
  onboardingGoal: Goal | null;
  sportCode: string | null;
  pending: boolean;
  error: string | null;
  onSubmit(setup: SetupAnswers): void;
}) {
  const [sex, setSex] = useState<SexForCalc | null>(null);
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [activity, setActivity] = useState<ActivityLevel | null>(null);
  const [goal, setGoal] = useState<NutritionGoal | null>(null);

  const heightCm = /^\d{3}$/.test(height.trim()) ? Number(height.trim()) : null;
  const heightOk = heightCm !== null && heightCm >= 120 && heightCm <= 220;
  const parsed = parseWeight(weight);
  const weightError = weight.trim() === '' || parsed.ok ? null : T.weightErrors[parsed.reason];
  const heightError = height.trim() !== '' && !heightOk ? T.heightError : null;
  const known = heightOk && parsed.ok ? { heightCm, weightG: parsed.weightG } : null;

  const lowBmi = known ? bmiBelow(known.heightCm, known.weightG, '18.5') : false;
  const goals = NUTRITION_GOALS.filter((g) => !(g === 'lose' && lowBmi));
  const preselected = known ? preselectGoal(p.onboardingGoal, known.heightCm, known.weightG) : null;
  const chosenGoal = goal !== null && goals.includes(goal) ? goal : preselected;
  const chosenActivity = activity ?? preselectActivity(p.sportCode);
  const ready = sex !== null && known !== null && chosenGoal !== null;

  return (
    <section className={styles.section}>
      <h2>{T.title}</h2>
      <p>{T.lead}</p>
      <ChoiceList<SexForCalc>
        name="nutrition-sex"
        legend={T.sexLegend}
        value={sex}
        onChange={setSex}
        options={SEX_FOR_CALC.map((s) => ({ value: s, label: SEX_LABELS[s] }))}
      />
      <Field label={T.height} error={heightError}>
        <input inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} />
      </Field>
      <Field label={T.weight} help={T.weightHelp} error={weightError}>
        <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
      </Field>
      <ChoiceList<ActivityLevel>
        name="nutrition-activity"
        legend={T.activityLegend}
        value={chosenActivity}
        onChange={setActivity}
        options={ACTIVITY_LEVELS.map((level) => ({ value: level, label: T.activity[level] }))}
      />
      {known ? (
        <ChoiceList<NutritionGoal>
          name="nutrition-goal"
          legend={T.goalLegend}
          value={chosenGoal}
          onChange={setGoal}
          options={goals.map((g) => ({ value: g, label: T.goals[g] }))}
        />
      ) : null}
      {p.error ? <Banner tone="error">{p.error}</Banner> : null}
      <Button
        disabled={!ready || p.pending}
        onClick={() => {
          if (sex !== null && known !== null && chosenGoal !== null) {
            p.onSubmit({
              sex,
              heightCm: known.heightCm,
              weightG: known.weightG,
              activity: chosenActivity,
              goal: chosenGoal,
            });
          }
        }}
      >
        {NUTRITION_TEXTS.start.send}
      </Button>
    </section>
  );
}
