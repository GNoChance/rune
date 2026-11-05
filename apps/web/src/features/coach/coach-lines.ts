import type { CoachId } from '@rune/contracts';
import { parisDate } from '@rune/domain';
import { COACH_NAMES } from '../../ui';

/** Textes d'un coach, écrits à l'avance (spec refonte §8) : `{pseudo}` et `{jours}` sont remplacés à l'affichage. */
export interface CoachTexts {
  name: string;
  /** Tempérament, sur la carte du choix. */
  temper: string;
  /** Aperçu de sa voix, sur la carte du choix. */
  sample: string;
  /** Présentation, après le choix (« Message d'accueil »). */
  intro: string;
  /** Démonstration du mode nutrition (« Aperçu ») : jamais de chiffre nutritionnel. */
  nutri: string;
  /** Mot de la fin de l'onboarding. */
  ready: string;
  /** Lignes du jour de l'accueil, une par jour civil de Paris, à tour de rôle. */
  daily: readonly string[];
  /**
   * Bulle de la fin de séance (moment `session_end`, spec brique 3 §7.4), une par jour civil de Paris de la séance,
   * à tour de rôle : la régularité et la saisie, jamais la charge, l'échec ni un record (D8), et aucun chiffre.
   */
  sessionEnd: readonly string[];
}

/**
 * Textes des trois coachs, mot pour mot (spec refonte §8, garde-fous de la spec 06 : aucun chiffre
 * nutritionnel, rien qui pousse à forcer, vocabulaire non prescriptif). Ce ne sont pas des réponses d'IA.
 */
export const COACHES: Readonly<Record<CoachId, CoachTexts>> = {
  ombre: {
    name: COACH_NAMES.ombre,
    temper: 'Froid et laconique. Exigeant, jamais humiliant.',
    sample: 'Quête acceptée. Rang E. Montre-moi ta discipline.',
    intro:
      "Je suis L'Ombre. Je fixe tes quêtes, tu les accomplis. Active le coach IA dans Mon coach : je répondrai à tes questions, sans détour.",
    nutri: "Bois régulièrement. Après l'effort, un vrai repas. La récupération fait partie de la quête.",
    ready: 'Éveil validé. Rang E. Le reste se gagne en séance.',
    daily: [
      'Jour 1. Rang E. La discipline se prouve, elle ne se promet pas.',
      'Une quête attend. Ton rang aussi.',
      "Pas d'excuse aujourd'hui. Juste la suite.",
    ],
    sessionEnd: [
      'Travail noté. Récupère : la suite se gagne.',
      'Une séance de plus. Le rang suit la régularité.',
      "Discipline prouvée aujourd'hui. Recommence à la prochaine séance.",
    ],
  },
  skald: {
    name: COACH_NAMES.skald,
    temper: 'Mentor chaleureux. Il raconte, il explique.',
    sample: 'Chaque saga commence par un premier pas, {pseudo}. Je serai là pour la raconter.',
    intro:
      "Je suis le Skald. Je raconterai ta saga, séance après séance, et je t'expliquerai chaque étape. Active le coach IA dans Mon coach : nous pourrons parler de ton programme.",
    nutri: "À table aussi, la saga s'écrit, {pseudo}. Un vrai repas après ta séance t'aidera à récupérer.",
    ready: 'Le prologue est écrit, {pseudo}. La saga commence.',
    daily: [
      "Le premier chapitre de ta saga s'ouvre aujourd'hui, {pseudo}. Les grands récits commencent toujours ainsi.",
      'Chaque jour ajoute une ligne à ta saga.',
      'Les héros aussi ont commencé au rang E.',
    ],
    sessionEnd: [
      'Un chapitre de plus dans ta saga, {pseudo}. Repose-toi : le récit continue.',
      'Belle séance, {pseudo}. Chaque série notée ajoute une ligne à ta saga.',
      'Le chapitre du jour est écrit. Les grandes sagas se bâtissent séance après séance.',
    ],
  },
  scribe: {
    name: COACH_NAMES.scribe,
    temper: 'Calme et précis. Il aime les plans clairs et les bilans.',
    sample: "Trois séances par semaine : c'est un rythme tenable. Je note tout.",
    intro:
      'Je suis le Scribe. Je prépare un plan clair et je note chaque série pour faire le point avec toi. Active le coach IA dans Mon coach : je répondrai à tes questions.',
    nutri: 'Note du jour : bois régulièrement, et prévois un vrai repas après ta séance.',
    ready: 'Profil complet, lieu noté. Le plan arrivera ici.',
    daily: [
      'Profil complet, lieu noté, rythme de {jours} séances par semaine. Le plan arrivera ici.',
      'Point du jour : ton profil est à jour.',
      'Je consigne. Les premières séances arriveront bientôt.',
    ],
    sessionEnd: [
      'Séance consignée. Ton bilan est à jour.',
      'Tout est noté. La récupération fait aussi partie du plan.',
      'Bilan enregistré. La régularité compte plus que tout le reste.',
    ],
  },
};

const DAY_MS = 86_400_000;

/** Numéro du jour civil de Paris : jours écoulés depuis le 1970-01-01, jamais le jour UTC. */
function parisDayNumber(date: Date): number {
  return Math.floor(Date.parse(`${parisDate(date)}T00:00:00Z`) / DAY_MS);
}

/** Texte fixe d'un coach (aperçu, présentation, nutrition, mot de la fin), `{pseudo}` remplacé. */
export function coachText(
  coach: CoachId,
  key: 'sample' | 'intro' | 'nutri' | 'ready',
  pseudo: string,
): string {
  return COACHES[coach][key].replaceAll('{pseudo}', pseudo);
}

/** Moments où le coach parle avec une ligne tournante : l'accueil, la fin d'une séance. */
export type CoachMoment = 'daily' | 'session_end';

/**
 * Ligne d'un moment, à tour de rôle par jour civil de Paris (`lignes[jourParis % lignes.length]`) : `daily` pour
 * l'accueil (date du jour), `session_end` pour la fin de séance (début de la séance : rouvrir le résumé rend la même
 * ligne). `{pseudo}` et `{jours}` (`daysPerWeek` du profil, que l'accueil passe) remplacés. Sans rythme connu (null ou
 * omis), une ligne qui dit `{jours}` cède la place à la suivante : jamais de valeur inventée à l'écran.
 */
export function coachLine(
  coach: CoachId,
  moment: CoachMoment,
  date: Date,
  pseudo: string,
  daysPerWeek: number | null = null,
): string {
  const lines = moment === 'daily' ? COACHES[coach].daily : COACHES[coach].sessionEnd;
  const day = parisDayNumber(date);
  for (let offset = 0; offset < lines.length; offset++) {
    // Modulo toujours positif, même avant 1970.
    const line = lines[(((day + offset) % lines.length) + lines.length) % lines.length] ?? '';
    if (line.includes('{jours}') && daysPerWeek === null) continue;
    return line.replaceAll('{pseudo}', pseudo).replaceAll('{jours}', String(daysPerWeek));
  }
  return '';
}
