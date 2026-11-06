import { describe, expect, it } from 'vitest';
import { SAFETY_SCREEN } from '../src/index';

describe('SAFETY_SCREEN', () => {
  it('est en version 1 avec les trois questions de 07 §5.4', () => {
    expect(SAFETY_SCREEN.version).toBe(1);
    expect(SAFETY_SCREEN.questions).toEqual([
      { id: 'pregnancy', text: 'Grossesse en cours ou allaitement ?' },
      {
        id: 'eating_disorder',
        text: 'As-tu ou as-tu eu un trouble du comportement alimentaire (anorexie, boulimie, hyperphagie…) ou une relation difficile avec la nourriture ?',
      },
      {
        id: 'medical',
        text: 'As-tu une maladie ou un traitement qui demande un suivi de ton alimentation par un médecin ou un·e diététicien·ne ?',
      },
    ]);
  });
});
