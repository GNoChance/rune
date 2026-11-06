import type {
  ApiErrorCode,
  CoachAdminView,
  CoachId,
  CoachStreamErrorCode,
  CoachToolName,
} from '@rune/contracts';
import { COACH_CONFIG } from '@rune/domain';
import { formatDate } from '../../ui/format';
import { ANTHROPIC_RETENTION_TEXT } from '../privacy/messages';
import type { CoachError } from './coach-store';

/*
 * Textes du coach produits par l'appli (spec brique 4 §16.2, 06 §14). Chacun passe `outputFilter` et
 * `FORBIDDEN_TERMS` dans coach-texts.test.ts. Les numéros d'urgence du bandeau (15 et 112) sont ceux de
 * `HELP_RESOURCES`, que le filtre admet.
 */

/** Bandeau IA (06 §14), mot pour mot. */
export const AI_BANNER =
  "Tu échanges avec une intelligence artificielle (Claude, d'Anthropic), pas avec un humain. Ses conseils sont généraux et ne remplacent pas un professionnel de santé. En cas d'urgence : 15 ou 112.";

export const WELCOME = 'Pose-moi une question sur ton programme, ta technique ou ta récupération.';

/** Voix du coach, avec l'article : « Voix : le Skald », « Conversation avec l'Ombre » (spec 4.1 §4.4). */
export const VOICES: Readonly<Record<CoachId, string>> = {
  ombre: "l'Ombre",
  skald: 'le Skald',
  scribe: 'le Scribe',
};

/** Parcours guidés (spec brique 4.1 §2) : les libellés des parcours et des puces viennent de `contracts`. */
export const GUIDED_TEXTS = {
  open: 'Parcours guidés',
  /** Mention sous un message de la personne venu d'un parcours. */
  chosen: 'Choisi dans un parcours',
  back: 'Retour',
  cancel: 'Annuler',
  noProgram: "Choisis d'abord un programme",
} as const;

/** Début de message proposé par « Ajuster mon programme avec le coach » (§16.1). */
export const PROGRAM_PREFILL = 'Je voudrais ajuster mon programme : ';

export const DEV_BANNER = 'Mode dev : combinaison non évaluée';

/** Tableau des états du §16.2, mot pour mot, et les libellés de leurs boutons. */
export const STATE_TEXTS = {
  consentMissing: 'Le coach IA a besoin de ton accord.',
  consentActivate: 'Activer le coach',
  consentChanged: "Le texte de l'accord a changé.",
  paused: 'Le coach est en pause pour le cercle.',
  suspended: "Le coach est en pause pour tout le cercle jusqu'au 1er du mois.",
  dailyLimit: `Tu as envoyé ${COACH_CONFIG.limits.messagesPerDay} messages aujourd'hui. Le coach revient demain.`,
  monthlyBudget: 'Tu as atteint la limite du mois pour le coach. Il revient le 1er.',
  threadClosed: 'Ta conversation du jour est close. Reviens demain.',
  previousThreads: 'Conversations précédentes',
  inProgress: 'Le coach termine une réponse…',
  offline: 'Hors ligne : le coach a besoin du réseau.',
  offlineEmpty: 'Connecte-toi pour parler au coach.',
  unavailable: 'Coach indisponible, réessaie plus tard.',
  retry: 'Réessayer',
  refusal: 'Le coach ne peut pas répondre à cette demande.',
} as const;

/** Indicateur d'outil : réel, posé par `tool_running`. */
export const TOOL_LABELS: Readonly<Record<CoachToolName, string>> = {
  read_training: 'Le coach consulte ton historique…',
  search_exercises: 'Le coach cherche des exercices…',
  propose_program_change: 'Le coach prépare une proposition…',
  refer_to_help: "Le coach prépare une carte d'aide…",
  open_nutrition_screen: 'Le coach prépare un réglage nutrition…',
};

/** Un texte par code de l'événement `error` du flux. */
export const ERROR_TEXTS: Readonly<Record<CoachStreamErrorCode, string>> = {
  api_unavailable: STATE_TEXTS.unavailable,
  spend_limit: STATE_TEXTS.suspended,
  monthly_budget_reached: STATE_TEXTS.monthlyBudget,
  tool_rounds_exceeded: STATE_TEXTS.unavailable,
  timeout: STATE_TEXTS.unavailable,
  shutdown: STATE_TEXTS.unavailable,
  consent_withdrawn: STATE_TEXTS.consentMissing,
  thread_closed: STATE_TEXTS.threadClosed,
  internal: STATE_TEXTS.unavailable,
};

/** Codes d'API (réponse avant le flux) qui ont leur propre texte. */
const API_ERROR_TEXTS: Partial<Record<ApiErrorCode, string>> = {
  coach_unavailable: STATE_TEXTS.paused,
  consent_required: STATE_TEXTS.consentMissing,
  daily_limit_reached: STATE_TEXTS.dailyLimit,
  monthly_budget_reached: STATE_TEXTS.monthlyBudget,
  thread_closed: STATE_TEXTS.threadClosed,
  request_in_progress: STATE_TEXTS.inProgress,
};

/** Texte d'une erreur du magasin : flux, API, réseau absent ; tout le reste est « indisponible ». */
export function errorText(code: CoachError): string {
  if (code === 'offline') return STATE_TEXTS.offline;
  if (code in ERROR_TEXTS) return ERROR_TEXTS[code as CoachStreamErrorCode];
  return API_ERROR_TEXTS[code as ApiErrorCode] ?? STATE_TEXTS.unavailable;
}

/** Plafond d'un message, en points de code (spec §5.2 `messageChars`). */
export const MESSAGE_CHARS = COACH_CONFIG.limits.messageChars;
/** Le compteur apparaît à partir de là (§16.2). */
export const COUNTER_FROM = 1800;
/** « Il te reste N messages » apparaît à partir de là. */
export const REMAINING_FROM = 5;
/** « Tu as utilisé N % de ton budget » apparaît à partir de là. */
export const BUDGET_FROM_PCT = 80;

/** Milliers séparés par une espace : 1950 → « 1 950 ». */
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export const remainingText = (n: number) =>
  `Il te reste ${n} ${n === 1 ? 'message' : 'messages'} aujourd'hui`;

export const budgetText = (pct: number) => `Tu as utilisé ${pct} % de ton budget du mois`;

export const counterText = (n: number) => `${thousands(n)} / ${thousands(MESSAGE_CHARS)}`;

/** Carte d'aide (spec §16.4). */
export const HELP_OPEN = "Ouvrir l'aide";
/** Ligne ajoutée aux cartes d'aide d'un mineur (C39). */
export const PARENT_LINE = 'Parles-en aussi à un parent ou à un adulte de confiance.';
/** Note d'une ressource, sous ses numéros (à relire par le propriétaire). */
export const HELP_NOTES = { eating_disorder: "Un médecin peut aussi t'aider." } as const;
/** Libellé d'un lien `tel:` ; `label` est le numéro tel que `helpPhones` le rend. */
export const callText = (label: string) => `Appeler le ${label}`;

/** Feuille « Signaler » (spec §16.6). */
export const REPORT_TEXTS = {
  title: 'Signaler cette réponse',
  categoryLegend: "Qu'est-ce qui ne va pas ?",
  categories: {
    inaccurate: 'Inexact',
    unsafe: 'Dangereux',
    inappropriate: 'Inapproprié',
    other: 'Autre',
  },
  commentLabel: 'Un commentaire (facultatif)',
  warning: "L'admin pourra lire cet échange (ton message et la réponse) et saura qu'il vient de toi.",
  send: 'Envoyer',
  close: 'Fermer',
  thanks: "Merci, l'admin le lira.",
  tooLong: `${COACH_CONFIG.limits.reportCommentChars} caractères au plus.`,
  failed: "Le signalement n'est pas parti. Réessaie.",
} as const;

/** Accord du coach (spec §14.1) : `/coach/consent`. */
export const CONSENT_TEXTS = {
  title: 'Accord pour le coach IA',
  intro:
    'Lis ce que tu acceptes avant de parler au coach. Tu peux retirer ton accord à tout moment, depuis Mon coach.',
  checkbox: "J'ai lu ce texte et j'accepte.",
  adultLink: 'Bien utiliser le coach',
  minorLink: 'Tu as 16 ou 17 ans',
} as const;

/** Mon coach › Coach IA (spec §16.7) et désactivation (§14.2). */
export const MY_COACH_TEXTS = {
  title: 'Coach IA',
  intro:
    'Le coach IA répond à tes questions sur ton programme, ta technique et ta récupération. Ses conseils sont généraux : il ne remplace pas un professionnel de santé.',
  disabled: 'Le coach IA est désactivé.',
  active: 'Le coach IA est actif.',
  paused: 'Le coach IA est en pause.',
  unknown: 'Le coach IA est indisponible pour le moment.',
  activate: 'Activer le coach IA',
  open: 'Ouvrir la conversation',
  brief: 'Ce que le coach voit',
  usage: 'Bien utiliser le coach',
  deleteAll: 'Supprimer mes conversations',
  deleteAllBody: 'Toutes tes conversations avec le coach seront supprimées. Tu ne pourras pas les retrouver.',
  deactivate: 'Désactiver le coach IA',
  deactivateIntro: 'Seront supprimés :',
  deactivateItems: [
    'Tes conversations avec le coach.',
    'Tes signalements.',
    'Les propositions du coach encore en attente.',
  ],
  deactivateKept: 'Les propositions que tu as acceptées restent dans ton programme.',
  deactivateAnthropic: ANTHROPIC_RETENTION_TEXT,
  deactivateExport: "Télécharger mes données d'abord",
  nextTone:
    "Le nouveau ton s'applique dès ton prochain message. Ta conversation de ce jour restera dans Conversations précédentes.",
  delete: 'Supprimer',
  cancel: 'Annuler',
} as const;

/** Conversations précédentes (spec §16.3). */
export const THREAD_TEXTS = {
  title: STATE_TEXTS.previousThreads,
  empty: 'Aucune conversation pour le moment.',
  deleteAll: 'Supprimer toutes mes conversations',
  deleteAllBody: 'Toutes tes conversations avec le coach seront supprimées. Tu ne pourras pas les retrouver.',
  deleteOne: 'Supprimer cette conversation',
  deleteOneBody: 'Cette conversation sera supprimée. Tu ne pourras pas la retrouver.',
  unavailable: "Cette conversation n'existe plus.",
  /** « Conversation avec le Skald, du mar. 28 oct. · 6 messages » : la voix du fil, son jour de Paris, les messages envoyés. */
  label: (day: string, userMessages: number, persona: CoachId) =>
    `Conversation avec ${VOICES[persona]}, du ${dayLabel(day)} · ${userMessages} ${userMessages < 2 ? 'message' : 'messages'}`,
} as const;

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** « 2025-10-28 » → « mar. 28 oct. » : le jour de Paris du fil, lu comme une date civile. */
export function dayLabel(day: string): string {
  return DAY_FORMAT.format(new Date(`${day}T12:00:00Z`));
}

/** Ce que le coach voit (spec §16.5) et la liste « Jamais envoyé » du §9. */
export const BRIEF_TEXTS = {
  title: 'Ce que le coach voit',
  intro:
    'Voici le dossier que le coach lit pour te répondre. Les sections te le présentent ; le JSON exact est ce qui part vraiment, rien de plus.',
  preview: 'Aperçu : ton dossier sera figé à ton premier message du jour.',
  gone: "Ce dossier n'est plus disponible : il a été effacé quand tu as retiré ton accord santé.",
  legacy: "Ce dossier date d'une ancienne version du coach : voici son JSON exact.",
  nutrition: "Nutrition : rien pour l'instant",
  neverSentTitle: 'Jamais envoyé',
  neverSent: [
    'Ton pseudo.',
    "Ta date de naissance : seule ta tranche d'âge est envoyée.",
    'Tes identifiants internes (personne, lieu, salle, séance, instance).',
    'Le nom de tes lieux et de ta salle, leur enseigne et leur ville.',
    'Les autres membres du cercle et les invitations.',
    'Ton appareil et ton adresse IP.',
    'Tes pesées, ta taille et ton sexe.',
    'Tes réponses au questionnaire de santé.',
  ],
} as const;

/** Entrées vers le coach (§16.1) : accueil, Mon programme, fin de séance. Hors ligne : `NETWORK_REQUIRED_MESSAGE`. */
export const ENTRY_TEXTS = {
  talk: 'Parler au coach',
  discover: 'Découvrir le coach IA',
  adjust: 'Ajuster mon programme avec le coach',
  question: 'Une question sur cette séance ?',
} as const;

/** `1,23 $` : dollars à 2 décimales, virgule française. */
export const usd2 = (n: number) => `${n.toFixed(2).replace('.', ',')} $`;
/** `20 $` ou `2,5 $` : un plafond, sans décimale inutile. */
export const usdLimit = (n: number) => `${String(n).replace('.', ',')} $`;

/** Administration du coach (§17.1), en français et tutoiement ; l'admin ne voit jamais d'autre contenu que les signalements. */
export const COACH_ADMIN_TEXTS = {
  switchLabel: 'Coach IA pour le cercle',
  stateTitle: 'État',
  active: 'Coach actif',
  off: 'Coach coupé',
  suspended: (date: string) => `Coach suspendu jusqu'au ${date}`,
  notConfigured: (reason: string) => `Non configuré : ${reason}`,
  reasons: {
    no_key: 'clé absente',
    model_not_allowed: 'modèle hors liste',
    not_evaluated: 'combinaison non évaluée',
  },
  catalogChanged:
    "Le catalogue a changé depuis l'évaluation : relance la campagne avant la prochaine mise en service.",
  resume: 'Relancer le coach',
  resumeHelp: "Relève d'abord la limite du workspace dans la Console Claude.",
  costsTitle: 'Coûts du mois',
  total: (usd: number) => `Total du mois : ${usd2(usd)}`,
  limit: (usd: number) => `Limite du workspace : ${usdLimit(usd)}`,
  memberCost: (cost: number, budget: number) => `${usd2(cost)} sur ${usdLimit(budget)}`,
  reportsTitle: 'Signalements',
  noReports: 'Aucun signalement à lire.',
  minor: 'Mineur',
  detailTitle: 'Signalement',
  exchange: "L'échange signalé",
  comment: 'Commentaire',
  classify: 'Classer',
  classifyTitle: 'Classer ce signalement',
  classifyWarning: 'Le signalement sera supprimé pour de bon.',
  cutAll: 'Couper le coach pour tous',
  cutAllWarning: 'Plus personne ne pourra parler au coach tant que tu ne le rallumes pas.',
  anthropicReminder:
    "Si l'échange enfreint la politique d'Anthropic, signale-le à Anthropic avant de le classer.",
  countersTitle: 'Compteurs anonymes',
  month: 'Mois',
  kinds: {
    help_emergency: 'Urgence',
    help_pain: 'Douleur',
    help_eating_disorder: 'Alimentation',
    help_doping: 'Dopage',
    help_pregnancy: 'Grossesse',
    help_distress: 'Détresse',
    filter_block: 'Filtre',
    refusal: 'Refus',
  },
  healthTitle: 'Coach IA',
  homeReports: (n: number) => `Signalements du coach : ${n} à lire`,
  homeSuspended: 'Coach suspendu : limite de dépense atteinte',
} as const;

/**
 * Ligne d'état du coach pour l'admin (écran Coach et page Serveur) : coupé, non configuré avec sa raison,
 * suspendu jusqu'à la date de Paris, sinon actif.
 */
export function coachStateLine(state: CoachAdminView['state']): string {
  const t = COACH_ADMIN_TEXTS;
  if (!state.enabled) return t.off;
  if (!state.configured && state.notConfiguredCause !== null) {
    return t.notConfigured(t.reasons[state.notConfiguredCause]);
  }
  if (state.suspendedUntil !== null) return t.suspended(formatDate(state.suspendedUntil));
  return t.active;
}
