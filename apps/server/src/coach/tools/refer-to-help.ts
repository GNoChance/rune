import { HELP_RESOURCES, ReferToHelpInput } from '@rune/contracts';
import { setSafetyPause } from '../../nutrition/screen';
import { isHealthConsentActive } from '../../privacy/consent-state';
import { defineTool } from './types';

/*
 * `refer_to_help` (spec brique 4 §10, §11.5, §16.4) : la carte d'aide d'une ressource. Le libellé et le numéro viennent
 * de `HELP_RESOURCES`, jamais du modèle ; la ressource rejoint l'état de la tentative, une fois par ressource (la carte
 * et le compteur `help_<resource>` suivent l'enregistrement de l'échange, C26). Rien n'est écrit en base, l'admin n'est
 * pas prévenu. `eating_disorder` pose aussi la pause de sécurité nutrition (brique 5 §11.3, D14), tout de suite et à
 * part de l'enregistrement de l'échange : un échange refusé ou en erreur la pose quand même.
 */

const DESCRIPTION = [
  "Affiche dans la conversation la carte d'aide d'une ressource : emergency (urgence vitale), pain (douleur), eating_disorder",
  '(troubles des conduites alimentaires), doping (dopage), pregnancy (grossesse ou allaitement), distress (détresse,',
  "idées suicidaires). L'appli affiche le libellé et le numéro de la ressource : ne les écris pas toi-même, ni aucun",
  'autre numéro. Le résultat confirme la carte affichée.',
].join(' ');

export const referToHelp = defineTool({
  name: 'refer_to_help',
  description: DESCRIPTION,
  input: ReferToHelpInput,
  async run({ resource }, ctx) {
    const help = HELP_RESOURCES.find((r) => r.id === resource);
    // Le schéma n'admet que les identifiants de `HELP_RESOURCES`.
    if (help === undefined) throw new Error('help_resource_missing');
    if (!ctx.state.helpCards.includes(resource)) ctx.state.helpCards.push(resource);
    // Sans profil nutrition (`setSafetyPause` ne fait rien) ou sans accord santé, rien n'est écrit.
    if (resource === 'eating_disorder' && (await isHealthConsentActive(ctx.db, ctx.userId))) {
      await setSafetyPause(ctx.db, ctx.deps, ctx.userId, true);
    }
    return { isError: false, result: { shown: true, resource, label: help.label, phone: help.phone } };
  },
});
