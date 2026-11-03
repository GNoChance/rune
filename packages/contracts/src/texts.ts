import type { ConsentType } from './api/consent';

export interface VersionedText {
  readonly version: string;
  readonly text: string;
}

export const HEALTH_CONSENT_TEXT: VersionedText = {
  version: '1.0',
  text: "J'accepte que Rune enregistre mes données de santé : limitations et zones sensibles, réponses de prudence, douleurs signalées pendant les séances, taille, poids, profil et suivi nutritionnels. Elles servent uniquement à adapter mes séances et mes repères. Elles restent sur le serveur du cercle et l'administrateur ne les consulte pas dans l'appli. Je peux retirer cet accord à tout moment : elles seront alors supprimées.",
};

/**
 * Accord du coach IA (spec brique 4 §14.1, choix C37), distinct de l'accord santé (P-CST-1). Texte juridique : toute
 * modification change la version et exige un nouvel accord avant le message suivant (`needsRenewal`).
 */
export const AI_COACH_CONSENT_TEXT: VersionedText = {
  version: '1.0',
  text: "J'accepte que mes messages au coach IA et les informations utiles soient envoyés à Anthropic, la société qui fournit l'IA Claude : ma tranche d'âge, mon objectif, mon niveau, mon matériel, mon programme, mon historique des 4 dernières semaines, mes records et, seulement si j'ai donné l'accord santé, mes limitations et mes douleurs signalées. Mon pseudo, ma date de naissance et le nom de ma salle ne sont jamais envoyés. Le traitement a lieu aux États-Unis (région « global » d'Anthropic), encadré par des clauses contractuelles types via Anthropic Ireland. Anthropic n'entraîne pas ses modèles sur ces données et les efface sous 30 jours, sauf si ses filtres de sécurité signalent un échange : il peut alors le garder jusqu'à 2 ans. Rune garde mes conversations 90 jours après le dernier message, et je peux les supprimer à tout moment. L'administrateur a un accès technique au serveur, mais il ne lit pas mes conversations dans l'appli, sauf un échange que je signale moi-même. Je peux retirer cet accord à tout moment : mes conversations seront supprimées de Rune, mais pas ce qu'Anthropic a déjà reçu.",
};

/** Texte en vigueur de chaque accord : seule la version exacte vaut accord (choix C36). */
export const CURRENT_CONSENT_TEXTS: Record<ConsentType, VersionedText> = {
  health: HEALTH_CONSENT_TEXT,
  ai_coach: AI_COACH_CONSENT_TEXT,
};

// À faire relire par l'admin avant la mise en service (ce qui changera la version).
export const HEALTH_QUESTIONNAIRE = {
  version: '1.0',
  questions: [
    'As-tu un problème cardiaque connu, ou pratiques-tu une activité physique sous surveillance médicale ?',
    'As-tu ressenti une douleur à la poitrine pendant un effort, ou perdu connaissance, au cours des 12 derniers mois ?',
    'As-tu une maladie ou un traitement qui limite ton activité physique ?',
    "As-tu un problème d'os, d'articulation ou de muscle qui s'aggrave à l'effort ?",
  ],
} as const;

const VERSION = /^\d+\.\d+$/;

export function majorOf(version: string): number {
  if (!VERSION.test(version)) throw new RangeError(`version invalide : ${version}`);
  return Number(version.split('.')[0]);
}
