import { FORBIDDEN_TERMS, type ForbiddenTerm } from '@rune/contracts';
import { availableGoals } from '@rune/domain';
import {
  CODES,
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
import { GUIDED_MINOR } from './coach-2-minor';
import { DATA_3, swapLine } from './coach-3-adult';

/*
 * Prompt système `coach-3/minor` (spec brique 5 §11.6), pour un fil ouvert à 16 ou 17 ans. Il reprend `coach-2/minor`
 * et ne change que la nutrition : le bloc `nutrition` du dossier est décrit, le point 12 fixe la conduite (conseils
 * qualitatifs, aucun chiffre, aucun repère, seul l'écran `mode` peut s'ouvrir), et la liste des termes interdits
 * passe à la v2 (les termes « hors mode complet » en plus). Aucune fermeture des points 7 et 8 ne bouge.
 */

const NOT_THIS_TOPIC =
  "n'aborde pas ce sujet ; renvoie vers un parent ou un adulte de confiance et vers un médecin, et parle plutôt de forme, d'énergie et de récupération";

/** Liste v2 d'un mineur : pour tous, mineur, puis « hors mode complet », sans doublon de terme. */
const MINOR_TERMS_V2: readonly ForbiddenTerm[] = [
  ...FORBIDDEN_TERMS.all,
  ...FORBIDDEN_TERMS.minor,
  ...FORBIDDEN_TERMS.notFull,
].filter((t, i, all) => all.findIndex((u) => u.term === t.term) === i);

export const NUTRITION_MINOR = `12. Nutrition
Le bloc nutrition du dossier est toujours là : nutrition.mode (qualitative ou disabled pour une personne de 16 ou 17 ans), nutrition.directives et nutrition.sheets (id et title des fiches conseils de la personne). Pour elle, les directives no_numbers, no_deficit et minor_profile valent toujours.
- Conseils généraux et qualitatifs seulement : repas réguliers, sources de protéines dans les repas de tous les jours, de quoi boire pendant la journée et autour de la séance, récupération. Tu peux citer par leur titre les fiches de nutrition.sheets.
- Chiffres : aucun chiffre (ni kcal, ni grammes, ni litres, ni pourcentage), même si elle en demande ou insiste. Dis que tu n'en donnes pas et renvoie vers un adulte de confiance (un parent) ou vers un médecin. Aucun repère, aucune cible, aucun bilan : le dossier n'en contient pas.
- Jamais : de complément, de régime nommé, de jeûne, de déficit ni de perte de poids (point 8), même si elle insiste ou dit qu'un adulte est d'accord.
- Si elle veut modifier ou désactiver son suivi nutrition, tu peux ouvrir l'écran avec open_nutrition_screen (screen mode, suggestion qualitative ou disabled), un seul écran par message ; elle confirme dans ses réglages. N'ouvre jamais un autre écran.
- Au moindre signe de trouble alimentaire : point 6, refer_to_help(eating_disorder) avant ta réponse, ton doux, aucun chiffre ; invite aussi la personne à en parler à un parent ou à un adulte de confiance.`;

const GUIDED_NUTRITION_PREFIX = '- « Bien manger quand on fait du sport »';
const GUIDED_NUTRITION_LINE =
  GUIDED_MINOR.split('\n').find((l) => l.startsWith(GUIDED_NUTRITION_PREFIX)) ?? '';

export const GUIDED_MINOR_3 = swapLine(
  GUIDED_MINOR,
  GUIDED_NUTRITION_PREFIX,
  `${GUIDED_NUTRITION_LINE} Les directives du dossier valent ici aussi (point 12).`,
);

export const COACH_3_MINOR = [
  INTRO,
  AUDIENCE,
  IDENTITY,
  SCOPE,
  numbers(
    termLines(MINOR_TERMS_V2, { ...MINOR_PHRASINGS, déficitaire: NOT_THIS_TOPIC }),
    `\nRestent permis : ${ALLOWED}.`,
  ),
  TOOLS,
  DATA_3,
  goalLines(availableGoals('minor'), GOALS_NOTE),
  SAFETY,
  SUPPLEMENTS,
  AGE,
  INSTRUCTIONS,
  FORM,
  GUIDED_MINOR_3,
  NUTRITION_MINOR,
  CODES,
].join('\n\n');
