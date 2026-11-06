import { OpenNutritionScreenInput } from '@rune/contracts';
import { loadNutritionContext } from '../../nutrition/context';
import { currentTarget } from '../../nutrition/targets-service';
import { defineTool, type ToolOutcome } from './types';

/*
 * `open_nutrition_screen` (spec brique 5 §11.2) : propose à la personne d'ouvrir un écran de ses réglages nutrition
 * (objectif, activité, mode), avec une suggestion présélectionnée. L'outil n'écrit rien : il ajoute l'écran à l'état
 * de la tentative, d'où part l'événement `nutrition_screen` (un bouton au plus par message) ; rien n'est enregistré
 * sans la confirmation de la personne, dans l'écran.
 */

const DESCRIPTION = [
  "Propose à la personne d'ouvrir un écran de ses réglages nutrition : goal (objectif), activity (niveau d'activité de 1",
  'à 4) ou mode (nutrition qualitative ou désactivée). `suggestion` est facultative : un objectif (lose, maintain,',
  'gain) pour goal, un niveau de 1 à 4 pour activity, qualitative ou disabled pour mode. goal et activity ne',
  "s'ouvrent qu'avec le suivi chiffré actif ; lose est refusé pendant une pause de sécurité, quand l'objectif est",
  "imposé au maintien et pour un mineur ; un mineur ne peut ouvrir que mode. Un seul écran par message. L'appli",
  "affiche le bouton « Ouvrir mes réglages nutrition » sous ta réponse : n'écris ni lien ni chemin. Rien n'est",
  "modifié tant que la personne n'a pas confirmé. Le résultat confirme l'écran proposé.",
].join(' ');

const notAvailable: ToolOutcome = { isError: true, result: { error: 'not_available' } };

export const openNutritionScreen = defineTool({
  name: 'open_nutrition_screen',
  description: DESCRIPTION,
  input: OpenNutritionScreenInput,
  async run({ screen, suggestion }, ctx) {
    if (ctx.state.nutritionScreens.length > 0) return { isError: true, result: { error: 'already_shown' } };
    const nutrition = await loadNutritionContext(ctx.db, ctx.deps, ctx.userId);
    const minor = nutrition.age < 18;
    if (screen !== 'mode' && (minor || nutrition.effective.mode !== 'full')) return notAvailable;
    if (suggestion === 'lose') {
      const imposed = (await currentTarget(ctx.db, ctx.userId))?.appliedRules.includes('no_deficit_low_bmi');
      if (nutrition.profile?.safetyPause === 1 || imposed === true || minor) return notAvailable;
    }
    ctx.state.nutritionScreens.push(suggestion === undefined ? { screen } : { screen, suggestion });
    return { isError: false, result: { shown: true, screen } };
  },
});
