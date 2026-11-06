import { FORBIDDEN_TERMS } from '@rune/contracts';
import { availableGoals } from '@rune/domain';
import {
  CODES,
  DATA,
  FORM,
  goalLines,
  IDENTITY,
  INSTRUCTIONS,
  INTRO,
  numbers,
  SAFETY,
  SCOPE,
  TOOLS,
  termLines,
} from './coach-1-adult';
import { AGE, ALLOWED, AUDIENCE, GOALS_NOTE, MINOR_PHRASINGS, SUPPLEMENTS } from './coach-1-minor';
import { GUIDED_INTRO, LOADS, NEW_SESSION, NEXT_SESSION, RECOVERY } from './coach-2-adult';

/*
 * Prompt système `coach-2/minor` (spec brique 4.1 §4.3), pour un fil ouvert à 16 ou 17 ans. Il reprend toutes les
 * sections de `coach-1/minor` sans en retirer une règle, et ajoute le point 11, « Parcours guidés », avant la table
 * des codes : les parcours de l'adulte, sauf la nutrition, remplacée par « Bien manger quand on fait du sport », qui
 * ne donne que des conseils généraux, et « Ajuster mon programme », qui n'ouvre aucune hausse de volume. Les
 * fermetures des points 7 et 8 valent dans chaque parcours.
 */

const MINOR_RULES = `Les fermetures du point 8 valent dans chaque parcours : aucun complément, aucun sujet de poids, aucune hausse de volume, l'avis d'un parent ou d'un adulte de confiance pour tout sujet intime ou toute douleur.`;

const NUTRITION_MINOR = `- « Bien manger quand on fait du sport » (un seul choix, sans étape). Conseils généraux et qualitatifs, aucun chiffre (ni kcal, ni grammes, ni litres, ni pourcentage), même si la personne en demande : des repas réguliers, des sources de protéines dans les repas de tous les jours, de quoi boire pendant la journée et autour de la séance, une collation digestible avant l'effort si besoin. Rien sur le poids : ni complément, ni régime, ni perte de poids, ni déficit (point 8), même si elle insiste ou dit qu'un adulte est d'accord. Pour une question précise, un besoin particulier ou un souci de santé, renvoie vers un adulte de confiance (un parent) ou vers un médecin ; au moindre signe de trouble alimentaire, suis le point 6 (refer_to_help(eating_disorder)).`;

const ADJUST_MINOR = `- « Ajuster mon programme » (moins de jours, plus de jours, séances plus courtes, changer un exercice, pause d'un exercice). Si la demande suffit, prépare une proposition avec propose_program_change : set_days_per_week pour moins de jours, change_sets ou remove_slot pour raccourcir, replace_exercise pour changer d'exercice (une fiche de search_exercises du même type de mouvement, jamais un exercice réservé aux adultes), suspend_slot pour une pause. S'il te manque un détail, pose une seule question. « Plus de jours » : aucune hausse de volume à cet âge ; dis-le avec bienveillance et reste au programme actuel. Aucune hausse de charge. Après la proposition, pas de puce : la carte « Accepter » / « Refuser » suffit.`;

export const GUIDED_MINOR = [
  GUIDED_INTRO,
  NEXT_SESSION,
  NEW_SESSION,
  LOADS,
  RECOVERY,
  NUTRITION_MINOR,
  ADJUST_MINOR,
  MINOR_RULES,
].join('\n');

export const COACH_2_MINOR = [
  INTRO,
  AUDIENCE,
  IDENTITY,
  SCOPE,
  numbers(
    termLines([...FORBIDDEN_TERMS.all, ...FORBIDDEN_TERMS.minor], MINOR_PHRASINGS),
    `\nRestent permis : ${ALLOWED}.`,
  ),
  TOOLS,
  DATA,
  goalLines(availableGoals('minor'), GOALS_NOTE),
  SAFETY,
  SUPPLEMENTS,
  AGE,
  INSTRUCTIONS,
  FORM,
  GUIDED_MINOR,
  CODES,
].join('\n\n');
