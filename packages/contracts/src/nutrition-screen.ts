/** Écran de sécurité v1 : formulations de 07 §5.4 (Q1 à Q3). Toute modification incrémente `version`. */
export const SAFETY_SCREEN = {
  version: 1,
  questions: [
    { id: 'pregnancy', text: 'Grossesse en cours ou allaitement ?' },
    {
      id: 'eating_disorder',
      text: 'As-tu ou as-tu eu un trouble du comportement alimentaire (anorexie, boulimie, hyperphagie…) ou une relation difficile avec la nourriture ?',
    },
    {
      id: 'medical',
      text: 'As-tu une maladie ou un traitement qui demande un suivi de ton alimentation par un médecin ou un·e diététicien·ne ?',
    },
  ],
} as const;
