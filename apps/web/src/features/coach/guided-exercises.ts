import { currentChainExercise, findState } from '@rune/domain';
import type { ProgramEditContext, ProgramView } from '../../repos';

export interface GuidedExercise {
  id: string;
  name: string;
}

/**
 * Exercices que « Mes charges » propose : ceux que le serveur accepte (`apps/server/src/coach/guided.ts`), c'est-à-dire
 * la liste de chaque slot du programme courant et, pour un slot à chaîne, l'exercice courant de la chaîne (jamais son
 * identifiant). Dans l'ordre du programme, sans doublon, par le nom de la fiche servie ; une fiche absente du
 * catalogue de l'appareil n'est pas proposée (le serveur ne la nommerait pas non plus).
 */
export function programExercises(view: ProgramView, ctx: ProgramEditContext): GuidedExercise[] {
  const cautious = ctx.profile === 'cautious';
  const names = new Map(ctx.sheets.map((s) => [s.id, s.name]));
  const ids = view.program.template.workouts.flatMap((w) =>
    w.slots.flatMap((s) => {
      if (s.chain === undefined) return s.exercises ?? [];
      const step = currentChainExercise(
        ctx.sheets,
        s.chain,
        cautious,
        findState(view.slotStates, s.id, s.chain),
      );
      return step === undefined ? [] : [step.id];
    }),
  );
  return [...new Set(ids)].flatMap((id) => {
    const name = names.get(id);
    return name === undefined ? [] : [{ id, name }];
  });
}
