// Écart annoncé à la spec §13 : prompts et voix en modules .ts, pas en .md (ni esbuild ni tsx n'importent un .md). Toute modification d'un prompt ou d'une voix crée une nouvelle prompt_version.
import type { CoachId } from '@rune/contracts';
import type { FilterRule } from '@rune/domain';
import type { CachedBlock } from '../../ai';
import { COACH_1_ADULT } from './coach-1-adult';
import { COACH_1_MINOR } from './coach-1-minor';
import { STYLE_OMBRE } from './style-ombre';
import { STYLE_SCRIBE } from './style-scribe';
import { STYLE_SKALD } from './style-skald';

/*
 * Prompts du coach (spec brique 4 §8.2, §8.5, §13) : bloc 1 = prompt figé de la variante, commun à tous les membres de
 * ce public ; bloc 2 = voix du fil puis dossier ; textes fixes de l'appli (réponse type, refus, notes de régénération).
 */

/** Variante stockée dans `coach_thread.prompt_version` (`promptVariant`). */
export type PromptVersion = 'coach-1/adult' | 'coach-1/minor';

export const PROMPTS: Record<PromptVersion, string> = {
  'coach-1/adult': COACH_1_ADULT,
  'coach-1/minor': COACH_1_MINOR,
};

export const STYLES: Record<CoachId, string> = {
  ombre: STYLE_OMBRE,
  skald: STYLE_SKALD,
  scribe: STYLE_SCRIBE,
};

/** Les deux blocs `system`, chacun point de cache (§8.2) ; `briefJson` : le dossier figé du fil, tel que stocké. */
export function systemBlocks(
  promptVersion: PromptVersion,
  persona: CoachId,
  briefJson: string,
): CachedBlock[] {
  return [
    { text: PROMPTS[promptVersion], cache: true },
    { text: `${STYLES[persona]}\n\n<dossier>\n${briefJson}\n</dossier>`, cache: true },
  ];
}

/**
 * Note de la régénération (§8.5), une par règle du filtre, envoyée en dernier après le message de la personne. Elle ne
 * nomme jamais ce qui a bloqué (ruling P13) : aucun chiffre, aucun numéro, aucun terme interdit, elle passe le filtre.
 */
const REGENERATION_NOTES: Record<FilterRule, string> = {
  phone:
    "Note de l'appli : une première version de ta réponse à ce message a été bloquée, car elle contenait un numéro de téléphone. Réponds de nouveau sans écrire aucun numéro : si une aide est utile, utilise refer_to_help, dont la carte affiche les numéros. Ne parle pas de ce blocage à la personne.",
  unit: "Note de l'appli : une première version de ta réponse à ce message a été bloquée, car elle contenait un nombre suivi d'une unité (charge, pourcentage ou valeur nutritionnelle) absent du dossier et des résultats d'outils. Réponds de nouveau sans ce nombre : cite seulement les valeurs du dossier ou des outils, telles quelles et sans rien calculer, ou renvoie vers Mon programme. Ne parle pas de ce blocage à la personne.",
  forbidden_term:
    "Note de l'appli : une première version de ta réponse à ce message a été bloquée, car elle contenait un terme interdit, l'un des termes à éviter de tes consignes. Réponds de nouveau sans ce terme ni aucune de ses formes, avec les tournures à préférer de tes consignes. Ne parle pas de ce blocage à la personne.",
};

export function regenerationNote(rule: FilterRule): string {
  return REGENERATION_NOTES[rule];
}

/** Réponse type après un second blocage (§8.5, D12), enregistrée comme réponse du coach. */
export const STANDARD_REPLY =
  'Je préfère ne pas te répondre avec un chiffre ou un mot que je ne peux pas vérifier. Tes repères sont dans Mon programme, et la page « Bien utiliser le coach » explique ce que je peux faire pour toi.';

/** Message d'un refus du modèle (§7.2 `refused`, §16.2) ; rien n'est enregistré. */
export const REFUSAL_MESSAGE = 'Le coach ne peut pas répondre à cette demande.';
