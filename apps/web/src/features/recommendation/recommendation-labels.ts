import type { ProgramTemplate } from '@rune/contracts';
import type { Recommendation, RecommendReason } from '@rune/domain';

/*
 * Textes du choix d'un programme partagés par E8 (onboarding), « Choisir un programme » et le Profil (spec brique 3
 * §7.8, R-REC-7). Ils restent hors de `features/program`, chargé à la demande : E8 et le Profil sont dans le bundle
 * initial. À relire par le propriétaire.
 */

export const RECOMMENDED_LABEL = 'Recommandé pour toi';
export const UNAVAILABLE_LABEL = 'Pas encore disponible';
export const CURRENT_PROGRAM_LABEL = 'Ton programme actuel';
/** Aucun modèle disponible (R-REC-4, `NO_TEMPLATE_AVAILABLE`) : l'appli propose la séance libre. */
export const NO_TEMPLATE_TEXT = 'Pas encore de programme disponible : tu pourras faire des séances libres.';
/** Case d'E8 (D15), cochée par défaut. */
export const START_WITH_PROGRAM = 'Commencer avec ce programme';
/** Inscription d'E8 en échec (ruling R40) : ce qu'il faut faire, lu avec la case. */
export const ENROL_FAILED_TEXT =
  "Le programme n'a pas pu être enregistré. Réessaie, ou décoche la case pour continuer sans programme.";
/** Bandeau du Profil (R-REC-7), vers `/program/choose`. */
export const BETTER_PROGRAM = 'Un autre programme te correspond mieux';

/** Une phrase par raison de `recommendTemplate` montrée sur la carte (la dernière n'a pas de carte). */
export function reasonText(reason: RecommendReason, rec: Pick<Recommendation, 'daysPerWeek'>): string {
  switch (reason) {
    case 'FEW_DAYS_FULL_BODY':
      return 'Avec tes jours disponibles, un programme en corps entier te convient mieux.';
    case 'DAYS_ADJUSTED':
      return `On part sur ${rec.daysPerWeek} jours par semaine, au plus près de ta disponibilité.`;
    case 'NO_TEMPLATE_AVAILABLE':
      return NO_TEMPLATE_TEXT;
  }
}

/** Phrases des raisons d'une recommandation qui désigne un modèle. */
export const reasonTexts = (rec: Recommendation): string[] =>
  rec.reasons.filter((r) => r !== 'NO_TEMPLATE_AVAILABLE').map((r) => reasonText(r, rec));

/** « 2 à 3 jours par semaine », ou « 2 jours par semaine » quand le modèle n'en permet qu'un nombre. */
export const daysRangeLabel = ({ min, max }: { min: number; max: number }): string =>
  min === max ? `${min} jours par semaine` : `${min} à ${max} jours par semaine`;

/** Jours et durée estimée d'un modèle : « 2 à 3 jours par semaine · 50 min environ ». */
export const templateFacts = (t: Pick<ProgramTemplate, 'daysPerWeek' | 'estimatedMinutes'>): string =>
  `${daysRangeLabel(t.daysPerWeek)} · ${t.estimatedMinutes} min environ`;
