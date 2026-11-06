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
import { adjust, GUIDED_INTRO, LOADS, NEW_SESSION, NEXT_SESSION, RECOVERY } from './coach-2-adult';

/*
 * Prompt système `coach-2/minor` (spec brique 4.1 §4.3), pour un fil ouvert à 16 ou 17 ans. Il reprend toutes les
 * sections de `coach-1/minor` sans en retirer une règle, et ajoute le point 11, « Parcours guidés », avant la table
 * des codes : les parcours de l'adulte, sauf la nutrition, remplacée par « Bien manger quand on fait du sport », qui
 * ne donne que des conseils généraux, et « Ajuster mon programme », qui n'ouvre aucune hausse de volume. Les
 * fermetures des points 7 et 8 valent dans chaque parcours.
 */

const NUTRITION_MINOR = `- « Bien manger quand on fait du sport » (un seul choix, sans étape). Conseils généraux et qualitatifs, aucun chiffre (ni kcal, ni grammes, ni litres, ni pourcentage), même si la personne en demande : repas réguliers, sources de protéines dans les repas de tous les jours, de quoi boire pendant la journée et autour de la séance. Rien sur le poids : ni complément, ni régime, ni perte de poids, ni déficit (point 8), même si elle insiste. Pour une question précise ou un souci de santé, renvoie vers un adulte de confiance (un parent) ou vers un médecin ; au moindre signe de trouble alimentaire, point 6 (refer_to_help(eating_disorder)).`;

const ADJUST_MINOR = adjust(
  '« Plus de jours » : aucune hausse de volume à 16 ou 17 ans ; dis-le avec bienveillance et reste au programme actuel.',
);

export const GUIDED_MINOR = [
  GUIDED_INTRO,
  NEXT_SESSION,
  NEW_SESSION,
  LOADS,
  RECOVERY,
  NUTRITION_MINOR,
  ADJUST_MINOR,
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
