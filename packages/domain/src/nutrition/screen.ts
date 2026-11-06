import type { ModeReason, NutritionMode, Orientation, ScreenAnswers } from '@rune/contracts';

/** Issue de l'écran de sécurité (07 §5.4). Les réponses ne sont jamais conservées. */
export function screenOutcome(answers: ScreenAnswers): {
  allowedModes: NutritionMode[];
  reason: ModeReason;
  orientations: Orientation[];
} {
  const orientations: Orientation[] = [];
  const add = (...o: Orientation[]): void => {
    for (const x of o) if (!orientations.includes(x)) orientations.push(x);
  };
  if (answers.pregnancy === 'yes') add('midwife', 'doctor');
  if (answers.eating_disorder === 'yes') add('eating_disorder_line');
  if (answers.medical === 'yes') add('doctor', 'dietitian');
  const allNo = answers.pregnancy === 'no' && answers.eating_disorder === 'no' && answers.medical === 'no';
  return allNo
    ? { allowedModes: ['full', 'qualitative', 'disabled'], reason: 'choice', orientations }
    : { allowedModes: ['qualitative', 'disabled'], reason: 'safety', orientations };
}
