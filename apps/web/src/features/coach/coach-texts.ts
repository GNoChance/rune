import type { ApiErrorCode, CoachStreamErrorCode, CoachToolName } from '@rune/contracts';
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

export const SUGGESTIONS = [
  'Explique ma prochaine séance',
  'Pourquoi ma charge ne monte pas ?',
  'Ajuster mon programme',
] as const;

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
  dailyLimit: "Tu as envoyé 30 messages aujourd'hui. Le coach revient demain.",
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
export const MESSAGE_CHARS = 2000;
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
  tooLong: '500 caractères au plus.',
  failed: "Le signalement n'est pas parti. Réessaie.",
} as const;
