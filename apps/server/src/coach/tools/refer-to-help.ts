import { HELP_RESOURCES, ReferToHelpInput } from '@rune/contracts';
import { defineTool } from './types';

/*
 * `refer_to_help` (spec brique 4 §10, §11.5, §16.4) : la carte d'aide d'une ressource. Le libellé et le numéro viennent
 * de `HELP_RESOURCES`, jamais du modèle ; la ressource rejoint l'état de la tentative, une fois par ressource (la carte
 * et le compteur `help_<resource>` suivent l'enregistrement de l'échange, C26). Rien n'est écrit en base, l'admin n'est
 * pas prévenu.
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
    return { isError: false, result: { shown: true, resource, label: help.label, phone: help.phone } };
  },
});
