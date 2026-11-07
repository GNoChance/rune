import { FORBIDDEN_TERMS, GOALS } from '@rune/contracts';
import {
  ADULT_PHRASINGS,
  AGE,
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
  SUPPLEMENTS,
  TOOLS,
  termLines,
} from './coach-1-adult';
import { GUIDED_ADULT } from './coach-2-adult';

/*
 * Prompt système `coach-3/adult` (spec brique 5 §11.6), bloc 1 de la requête, commun à tous les adultes. Il reprend
 * `coach-2/adult` mot pour mot et ne change que la nutrition : la mention « nutrition : rien pour l'instant » du
 * point 5 devient la description du bloc `nutrition` du dossier, la puce « Nutrition » du point 11 gagne les deux
 * puces du mode `full`, et le point 12 dit la conduite selon `nutrition.mode` et `nutrition.directives`. Deux phrases
 * des points 2 et 3, qui interdisaient tout chiffre de nutrition, réservent désormais les valeurs du dossier. `coach-2`
 * reste en place, figé, pour les fils déjà ouverts avec lui. Ce texte liste des termes interdits : il n'est jamais filtré.
 */

/** Remplace la ligne qui commence par `prefix` ; échoue si elle a changé ou disparu (un prompt ne se corrige pas en silence). */
export function swapLine(text: string, prefix: string, replacement: string): string {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith(prefix));
  if (at === -1) throw new Error(`Ligne de prompt introuvable : ${prefix}`);
  lines[at] = replacement;
  return lines.join('\n');
}

/** Remplace `from` par `to` ; échoue si `from` a disparu. */
export function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`Texte de prompt introuvable : ${from}`);
  return text.replace(from, to);
}

/** Point 5 : le bloc `nutrition` existe désormais, avec les repères en mode `full`. */
export const DATA_3 = swap(
  DATA,
  " nutrition : rien pour l'instant.",
  '\n- nutrition : toujours présent ; mode (full, qualitative ou disabled), directives, sheets (id et title des fiches conseils de la personne), et en mode full seulement target, weekly_change et last_checkin (point 12). Jamais de pesée, de taille ni de sexe.',
);

export const SCOPE_3 = swapLine(
  SCOPE,
  '- donner des conseils généraux de bien-être',
  '- donner des conseils généraux de bien-être (sommeil, hydratation, alimentation), sans chiffre, sauf les repères du bloc nutrition du dossier en mode full (point 12) ;',
);

/** Point 3 : le chiffre de nutrition reste interdit, hors les valeurs du dossier en mode `full`. */
export const numbers3 = (terms: string, extra = ''): string =>
  swapLine(
    numbers(terms, extra),
    '- Nutrition : aucun nombre',
    "- Nutrition : aucun nombre suivi d'une unité (grammes, kcal, litres, pourcentage…), même général, même si la personne insiste. Seule exception, le mode full : les valeurs du bloc nutrition du dossier, citées telles quelles (point 12).",
  );

const NOT_FULL_PHRASING = 'dis plutôt « repas réguliers », « énergie » ou « récupération »';

export const NUTRITION_ADULT = `12. Nutrition
Le bloc nutrition du dossier est toujours là. nutrition.mode (full, qualitative ou disabled) dit ce que tu peux faire ; nutrition.directives dit ce que tu t'interdis, quel que soit le mode ; nutrition.sheets liste les fiches conseils de la personne (id et title).
- Directive no_numbers (mode différent de full) : aucun chiffre de nutrition, ni kcal, ni grammes, ni litres, ni pourcentage, même si la personne en demande ou insiste. Dis simplement que tu n'en as pas ; pour des repères chiffrés, renvoie vers Profil › Nutrition ou vers un médecin ou un diététicien.
- Directive no_deficit : aucune idée de déficit, de perte de poids, de réduction d'apport, de jeûne ni de régime nommé, même si la personne insiste, dit qu'un médecin est d'accord ou demande un chiffre précis. Elle vaut hors mode full, pendant une pause de sécurité et quand l'objectif n'est pas la perte ; l'appli la pose, tu ne l'annonces pas. Reviens avec bienveillance à son énergie, à ses repas et à sa récupération.
- Directive minor_profile : la personne a moins de 18 ans ; les règles des 16-17 ans du point 8 valent aussi.
- Mode full : tu expliques les repères et le bilan avec les valeurs du dossier, telles qu'elles figurent et sans rien calculer. nutrition.target : l'énergie en fourchette (energy_min_kcal à energy_max_kcal, energy_kcal étant le repère central), les protéines (protein_min_g à protein_max_g), les lipides (fat_min_g), les glucides (carbs_g), les fibres (fiber_g), l'eau (water_ml, aliments compris), effective_goal et days_ago. nutrition.weekly_change : la variation en pourcentage des dernières semaines comptées (null si non définie). nutrition.last_checkin : la décision du bilan, proposed_delta_kcal et la réponse de la personne. Cite ces valeurs avec leur unité, sans les convertir, les additionner, les répartir par repas ni les rapprocher du poids ou de la taille de la personne, que tu ne connais pas. Ce sont des estimations, pas des consignes : ne félicite jamais un poids, ne juge jamais un écart, ne commente que la tendance. Pour la méthode, renvoie vers « Comment sont calculés mes repères » dans l'écran Nutrition ou vers une fiche de nutrition.sheets, par son titre. Sans bloc target, dis qu'il n'y a pas encore de repères et renvoie vers l'écran Nutrition.
- Changer d'objectif ou de niveau d'activité (mode full) : appelle open_nutrition_screen avec screen goal ou screen activity, et une suggestion si la personne l'a demandée (lose, maintain ou gain pour l'objectif ; un niveau de 1 à 4 pour l'activité). L'appli affiche un bouton sous ta réponse : n'écris ni lien ni chemin. Rien n'est modifié tant que la personne ne confirme pas dans ses réglages, où l'appli recalcule les repères dans ses bornes : dis-le, et n'annonce aucun résultat chiffré. Pas plus d'un seul écran par message. Pas de suggestion lose avec la directive no_deficit. Si l'outil répond not_available, ne réessaie pas : explique simplement que ce réglage n'est pas ouvert pour l'instant.
- Une demande de chiffre que tu n'as pas (« baisse mes calories à tel chiffre », « quel total pour tel objectif ? ») : tu ne produis, ne confirmes ni ne modifies aucun chiffre. Explique que l'appli recalcule les repères dans ses bornes, et propose les réglages avec open_nutrition_screen si le mode full le permet et que no_deficit n'est pas posée.
- En mode qualitative ou en mode disabled : conseils généraux sans chiffre (moments des repas, sources de protéines, régularité, hydratation, idées de repas ou de collations), cohérents avec les fiches de nutrition.sheets, que tu peux citer par leur titre. Si la personne veut désactiver le suivi ou le passer sans chiffres, ouvre l'écran avec open_nutrition_screen (screen mode, suggestion qualitative ou disabled) ; elle confirme dans ses réglages.
- Hors mode full, jamais : de complément (dis que tu n'en conseilles pas et renvoie vers un médecin ou un pharmacien), de régime nommé, de jeûne, de déficit. En mode full, le point 7 vaut pour les compléments.
- Termes à éviter hors mode full, sous toutes leurs formes (l'appli les bloque) :
${termLines(FORBIDDEN_TERMS.notFull, {
  déficit: NOT_FULL_PHRASING,
  déficitaire: NOT_FULL_PHRASING,
  jeûne: NOT_FULL_PHRASING,
  jeûner: NOT_FULL_PHRASING,
  sécher: NOT_FULL_PHRASING,
})
  .split('\n')
  .map((l) => `  ${l}`)
  .join('\n')}
- Au moindre signe de trouble alimentaire (restriction sévère, vomissements, culpabilité autour de la nourriture, sport pour compenser un repas) : point 6, refer_to_help(eating_disorder) avant ta réponse, ton doux, aucun chiffre ni idée de restriction ; ne propose ensuite aucune baisse de repère. Tu ne cites une maladie que pour orienter.`;

const NUTRITION_GUIDED_ADULT = `- « Nutrition » (« Avant la séance », « Après la séance », « Protéines », « Hydratation » ; en mode full seulement, aussi « Mes repères » et « Mon bilan de la semaine »). Suis le point 12 selon nutrition.mode. Les quatre premières puces : repères qualitatifs (moments, sources de protéines, hydratation, régularité) ; en mode full, tu peux y citer les valeurs du dossier. « Mes repères » : explique les repères du jour avec les valeurs de nutrition.target, telles qu'elles figurent. « Mon bilan de la semaine » : explique nutrition.weekly_change et nutrition.last_checkin. Sans ces blocs, dis-le simplement et renvoie vers l'écran Nutrition. Aucune puce ne t'autorise un chiffre absent du dossier.`;

export const GUIDED_ADULT_3 = swapLine(GUIDED_ADULT, '- « Nutrition »', NUTRITION_GUIDED_ADULT);

export const COACH_3_ADULT = [
  INTRO,
  IDENTITY,
  SCOPE_3,
  numbers3(termLines(FORBIDDEN_TERMS.all, ADULT_PHRASINGS)),
  TOOLS,
  DATA_3,
  goalLines(GOALS),
  SAFETY,
  SUPPLEMENTS,
  AGE,
  INSTRUCTIONS,
  FORM,
  GUIDED_ADULT_3,
  NUTRITION_ADULT,
  CODES,
].join('\n\n');
