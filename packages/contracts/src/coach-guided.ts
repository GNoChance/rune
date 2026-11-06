import { z } from 'zod';
import type { AgeBandSchema } from './api/auth';
import { EXERCISE_ID_RE } from './exercise';

type AgeBand = z.infer<typeof AgeBandSchema>;

/*
 * Parcours guidés du coach (spec brique 4.1 §2, §4.2) : la table partagée par le téléphone et le serveur. Le
 * téléphone affiche les puces et compose le texte ; le serveur le recompose à partir des seuls identifiants et ignore
 * le texte reçu. Les libellés et les gabarits sont des textes de l'appli : ils passent le filtre de sortie et le test
 * des termes interdits.
 */

export const GUIDED_FLOW_IDS = [
  'next_session',
  'new_session',
  'loads',
  'recovery',
  'nutrition',
  'adjust_program',
] as const;
export type GuidedFlowId = (typeof GUIDED_FLOW_IDS)[number];

/** Au plus une puce par étape, 2 étapes en version 1. */
export const GUIDED_MAX_CHOICES = 2;
/** Étape dont les puces sont les exercices du programme courant : le choix est un identifiant d'exercice (slug). */
export const GUIDED_PROGRAM_EXERCISES = 'program_exercises';

export interface GuidedChip {
  id: string;
  label: string;
  /** Texte inséré dans le message composé ; le libellé par défaut. */
  text?: string;
}

export interface GuidedStep {
  id: string;
  prompt: string;
  chips: readonly GuidedChip[] | typeof GUIDED_PROGRAM_EXERCISES;
}

export interface GuidedFollowUp {
  id: string;
  label: string;
  /** Message envoyé tel quel (un message ordinaire de la personne). */
  text: string;
}

export interface GuidedFlow {
  id: GuidedFlowId;
  label: string;
  audience: 'all' | AgeBand;
  steps: readonly GuidedStep[];
  /** Message composé à partir des identifiants choisis ; `names` rend le nom d'un exercice, null s'il est inconnu. */
  compose(choices: readonly string[], names: (exerciseId: string) => string | null): string;
  followUps: readonly GuidedFollowUp[];
}

/** Identifiant inconnu, ou nombre de choix faux : le serveur répond 400 `validation`. */
export class GuidedInvalidError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'GuidedInvalidError';
  }
}

const chip = (id: string, label: string, text?: string): GuidedChip =>
  text === undefined ? { id, label } : { id, label, text };

const MUSCLES: readonly GuidedChip[] = [
  chip('legs', 'Jambes', 'jambes'),
  chip('back', 'Dos', 'dos'),
  chip('chest', 'Pectoraux', 'pectoraux'),
  chip('shoulders', 'Épaules', 'épaules'),
  chip('arms', 'Bras', 'bras'),
  chip('full_body', 'Tout le corps', 'tout le corps'),
];

const DURATIONS: readonly GuidedChip[] = [
  chip('short', 'Courte (20 min)', '20 minutes'),
  chip('medium', 'Moyenne (40 min)', '40 minutes'),
  chip('long', 'Longue (60 min)', '60 minutes'),
];

const QUESTIONS: readonly GuidedChip[] = [
  chip('why', 'Pourquoi cette charge ?', 'pourquoi cette charge ?'),
  chip('too_heavy', 'Je la trouve trop lourde', 'je la trouve trop lourde'),
  chip('too_light', 'Je la trouve trop légère', 'je la trouve trop légère'),
  chip('start', 'Quelle charge pour commencer ?', 'quelle charge pour commencer ?'),
];

const RECOVERY: readonly GuidedChip[] = [
  chip('soreness', 'Courbatures', 'mes courbatures'),
  chip('sleep', 'Sommeil', 'mon sommeil'),
  chip('rest_day', 'Jour de repos', 'mon jour de repos'),
  chip('return', 'Reprise après une pause', 'ma reprise après une pause'),
];

const NUTRITION: readonly GuidedChip[] = [
  chip('before', 'Avant la séance', 'avant la séance'),
  chip('after', 'Après la séance', 'après la séance'),
  chip('protein', 'Protéines', 'les protéines'),
  chip('hydration', 'Hydratation', "l'hydratation"),
];

/** Puces de plus en mode nutrition `full` (brique 5 §11.6) : le dossier porte alors les repères et le bilan. */
const NUTRITION_FULL: readonly GuidedChip[] = [
  ...NUTRITION,
  chip('targets', 'Mes repères'),
  chip('review', 'Mon bilan de la semaine'),
];

const ADJUST: readonly GuidedChip[] = [
  chip('fewer_days', 'Moins de jours', 'moins de jours'),
  chip('more_days', 'Plus de jours', 'plus de jours'),
  chip('shorter', 'Séances plus courtes', 'des séances plus courtes'),
  chip('change_exercise', 'Changer un exercice', 'changer un exercice'),
  chip('pause_exercise', "Pause d'un exercice", 'mettre un exercice en pause'),
];

const textOf = (chips: readonly GuidedChip[], id: string | undefined): string => {
  const found = chips.find((c) => c.id === id);
  if (found === undefined) throw new GuidedInvalidError('choix inconnu');
  return found.text ?? found.label;
};

export const GUIDED_FLOWS: readonly GuidedFlow[] = [
  {
    id: 'next_session',
    label: 'Ma prochaine séance',
    audience: 'all',
    steps: [],
    compose: () => 'Explique-moi ma prochaine séance : les exercices, les charges prévues et pourquoi.',
    followUps: [],
  },
  {
    id: 'new_session',
    label: 'Nouvelle séance',
    audience: 'all',
    steps: [
      { id: 'muscle', prompt: 'Quel muscle veux-tu travailler ?', chips: MUSCLES },
      { id: 'duration', prompt: 'Combien de temps as-tu ?', chips: DURATIONS },
    ],
    compose: ([muscle, duration]) =>
      `Je voudrais une nouvelle séance : ${textOf(MUSCLES, muscle)}, environ ${textOf(DURATIONS, duration)}, avec le matériel de mon lieu principal.`,
    followUps: [
      { id: 'add', label: "L'ajouter à mon programme", text: 'Ajoute cette séance à mon programme.' },
      { id: 'another', label: 'Une autre idée', text: 'Propose-moi une autre idée de séance.' },
      { id: 'shorter', label: 'Plus courte', text: 'Propose-moi une version plus courte de cette séance.' },
    ],
  },
  {
    id: 'loads',
    label: 'Mes charges',
    audience: 'all',
    steps: [
      { id: 'exercise', prompt: 'Quel exercice ?', chips: GUIDED_PROGRAM_EXERCISES },
      { id: 'question', prompt: 'Quelle est ta question ?', chips: QUESTIONS },
    ],
    compose([exercise, question], names) {
      const name = exercise === undefined ? null : names(exercise);
      if (name === null) throw new GuidedInvalidError('exercice inconnu');
      const asked = textOf(QUESTIONS, question);
      return `À propos de ${name} : ${asked}${asked.endsWith('?') ? '' : '.'}`;
    },
    followUps: [
      {
        id: 'more',
        label: "D'autres questions sur cet exercice",
        text: "J'ai d'autres questions sur cet exercice.",
      },
      { id: 'other', label: 'Un autre exercice', text: "Parlons d'un autre exercice." },
    ],
  },
  {
    id: 'recovery',
    label: 'Récupération',
    audience: 'all',
    steps: [{ id: 'topic', prompt: 'Sur quoi veux-tu un conseil ?', chips: RECOVERY }],
    compose: ([topic]) => `Conseille-moi sur ${textOf(RECOVERY, topic)}.`,
    followUps: [],
  },
  {
    id: 'nutrition',
    label: 'Nutrition',
    audience: 'adult',
    steps: [{ id: 'topic', prompt: 'Quel repère veux-tu ?', chips: NUTRITION }],
    compose: ([topic]) => {
      if (topic === 'targets') return 'Explique-moi mes repères de nutrition.';
      if (topic === 'review') return 'Explique-moi mon bilan de la semaine.';
      return `Donne-moi des repères de nutrition : ${textOf(NUTRITION, topic)}.`;
    },
    followUps: [],
  },
  {
    // Même identifiant que `nutrition` : un fil `minor` a ce parcours à la place, sans étape (spec §2.2).
    id: 'nutrition',
    label: 'Bien manger quand on fait du sport',
    audience: 'minor',
    steps: [],
    compose: () => 'Donne-moi des conseils généraux pour bien manger quand on fait du sport.',
    followUps: [],
  },
  {
    id: 'adjust_program',
    label: 'Ajuster mon programme',
    audience: 'all',
    steps: [{ id: 'change', prompt: 'Que veux-tu changer ?', chips: ADJUST }],
    compose: ([change]) => `Je voudrais ajuster mon programme : ${textOf(ADJUST, change)}.`,
    followUps: [],
  },
];

/**
 * Parcours offerts à un public : ceux de `all`, plus ceux de ce public seulement. `nutritionFull` : mode nutrition
 * effectif `full` (brique 5 §11.6) ; le parcours Nutrition de l'adulte gagne alors deux puces. Un mineur ne les a jamais.
 */
export function guidedFlowsFor(audience: AgeBand, nutritionFull = false): GuidedFlow[] {
  return GUIDED_FLOWS.filter((f) => f.audience === 'all' || f.audience === audience).map((f) =>
    nutritionFull && audience === 'adult' && f.id === 'nutrition'
      ? { ...f, steps: [{ id: 'topic', prompt: 'Quel repère veux-tu ?', chips: NUTRITION_FULL }] }
      : f,
  );
}

function flowOf(flowId: string, audience: AgeBand, nutritionFull = false): GuidedFlow {
  const flow = guidedFlowsFor(audience, nutritionFull).find((f) => f.id === flowId);
  if (flow === undefined) throw new GuidedInvalidError('parcours inconnu');
  return flow;
}

/**
 * Message composé d'un parcours. Lève `GuidedInvalidError` sur un parcours inconnu pour ce public, un nombre de choix
 * faux, un identifiant de puce inconnu ou un exercice que `names` ne connaît pas. `audience` : adulte par défaut
 * (le parcours de nutrition d'un mineur n'est pas celui d'un adulte) ; `nutritionFull` : mode nutrition effectif
 * `full`, seul à connaître « Mes repères » et « Mon bilan de la semaine ».
 */
export function composeGuidedMessage(
  flowId: string,
  choices: readonly string[],
  names: (exerciseId: string) => string | null,
  audience: AgeBand = 'adult',
  nutritionFull = false,
): string {
  const flow = flowOf(flowId, audience, nutritionFull);
  if (choices.length !== flow.steps.length) throw new GuidedInvalidError('nombre de choix faux');
  flow.steps.forEach((step, i) => {
    const choice = choices[i] as string;
    if (step.chips === GUIDED_PROGRAM_EXERCISES) {
      if (!EXERCISE_ID_RE.test(choice)) throw new GuidedInvalidError('exercice inconnu');
    } else if (!step.chips.some((c) => c.id === choice)) {
      throw new GuidedInvalidError('choix inconnu');
    }
  });
  return flow.compose(choices, names);
}

/** Identifiants d'exercice choisis dans les étapes `program_exercises` d'un parcours : le serveur les vérifie. */
export function guidedExerciseChoices(
  flowId: string,
  choices: readonly string[],
  audience: AgeBand = 'adult',
): string[] {
  const flow = flowOf(flowId, audience);
  return flow.steps.flatMap((step, i) =>
    step.chips === GUIDED_PROGRAM_EXERCISES && choices[i] !== undefined ? [choices[i] as string] : [],
  );
}

/** Parcours d'une requête : `flow` connu, `choices` des identifiants courts dont la table vérifie le sens. */
export const GuidedRequestSchema = z.strictObject({
  flow: z.enum(GUIDED_FLOW_IDS),
  choices: z.array(z.string().min(1).max(60)).max(GUIDED_MAX_CHOICES),
});
export type GuidedRequest = z.infer<typeof GuidedRequestSchema>;
