import { GUIDED_FLOWS, GUIDED_PROGRAM_EXERCISES, guidedAllowedValues } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { type FilterContext, outputFilterText } from '../../src/coach/filter';
import { allowedValues } from '../../src/coach/values';

/*
 * Textes des parcours guidés (spec 4.1 §2.1) : des textes de l'appli, ils passent `outputFilterText` et les termes
 * interdits, pour un adulte comme pour un mineur, avec les durées que le parcours autorise.
 */

const names = (id: string): string | null => (id === 'squat-barre' ? 'Squat avec barre' : null);

function texts(): { text: string; flow: string }[] {
  const out: { text: string; flow: string }[] = [];
  for (const flow of GUIDED_FLOWS) {
    out.push({ text: flow.label, flow: flow.id });
    for (const f of flow.followUps)
      out.push({ text: f.label, flow: flow.id }, { text: f.text, flow: flow.id });
    // Toutes les combinaisons de puces.
    let combos: string[][] = [[]];
    for (const step of flow.steps) {
      out.push({ text: step.prompt, flow: flow.id });
      const ids = step.chips === GUIDED_PROGRAM_EXERCISES ? ['squat-barre'] : step.chips.map((c) => c.id);
      if (step.chips !== GUIDED_PROGRAM_EXERCISES) {
        for (const c of step.chips) out.push({ text: c.label, flow: flow.id });
      }
      combos = combos.flatMap((c) => ids.map((id) => [...c, id]));
    }
    for (const choices of combos) out.push({ text: flow.compose(choices, names), flow: flow.id });
  }
  return out;
}

describe('textes des parcours guidés', () => {
  it('couvre tous les parcours, avec des textes en nombre', () => {
    expect(texts().length).toBeGreaterThan(60);
  });

  it.each(['adult', 'minor'] as const)(
    'chaque libellé et chaque message passe le filtre (%s)',
    (audience) => {
      for (const { text, flow } of texts()) {
        const { duration_min } = guidedAllowedValues(flow, []);
        const ctx: FilterContext = {
          audience,
          nutritionMode: 'none',
          allowed: allowedValues({
            brief: {},
            toolResults: [],
            constants: [],
            nutritionFull: false,
            durationsMin: duration_min,
          }),
        };
        expect(outputFilterText(text, ctx), text).toEqual({ ok: true });
      }
    },
  );
});
