import type { CheckinDecision, ModeCause, NutritionMode } from '@rune/contracts';
import { formatGrams, formatKcal, formatLitres } from './format';

/*
 * Tous les textes du module Nutrition (spec brique 5 §12.6) : tutoiement, vocabulaire de 07 §5.10, nombres au
 * format français. Ce fichier est parcouru par le test des termes interdits v2 (texts.test.ts) : aucun mot de la
 * liste « pour tous » (« régime », « échec », « poids idéal »…), jamais l'IMC, jamais de numéro de téléphone (ils
 * viennent de `HELP_RESOURCES`). Une phrase qui porte une valeur est une fonction : la valeur vient de la cible ou
 * du bilan, jamais d'un calcul de l'écran.
 */

/** Ligne qui explique pourquoi le mode n'est pas celui que la personne a choisi (§12.2, mode `qualitative`). */
interface CauseText {
  line: string;
  /** Action possible : libellé et page. */
  action: { label: string; href: string } | null;
}

export const NUTRITION_TEXTS = {
  title: 'Nutrition',

  /** Sous-titre de l'entrée Profil › Entraînement › Nutrition (§12.1), selon le mode effectif. */
  entry: {
    disabled: 'Désactivée',
    qualitative: 'Conseils sans chiffres',
    full: 'Repères chiffrés',
  } satisfies Record<NutritionMode, string>,

  /** Carte de l'accueil (§12.1) : présente hors du mode `disabled`. */
  home: {
    title: 'Nutrition',
    qualitativeTitle: 'Conseils nutrition',
    energyRange: (min: number, max: number) => `${formatKcal(min)} à ${formatKcal(max)} kcal aujourd'hui`,
    checkinReady: 'Bilan de la semaine prêt',
    openFull: 'Voir mes repères',
    openQualitative: 'Voir les conseils',
  },

  disabled: {
    intro: 'Nutrition te donne des repères et des conseils pour manger en accord avec ton entraînement.',
    does: 'Tu y trouves des fourchettes et des fiches, que tu es libre de suivre ou non.',
    doesNot: "Ce n'est ni un plan à suivre à la lettre, ni un avis médical.",
    minor: 'À ton âge, ce sont des conseils sans chiffres : de quoi bien manger et bien récupérer.',
    activate: 'Activer',
    activateMinor: 'Activer les conseils',
  },

  qualitative: {
    title: 'Conseils sans chiffres',
    sheets: 'Fiches',
    noSheets: 'Les fiches arrivent dès que tu es connecté.',
    settings: 'Réglages',
  },

  causes: {
    stored: null,
    minor: {
      line: "À ton âge, Nutrition reste en conseils sans chiffres. Les repères chiffrés s'ouvrent à 18 ans.",
      action: null,
    },
    over_max_age: {
      line: "Les repères chiffrés s'arrêtent à 78 ans. Les conseils sans chiffres restent disponibles.",
      action: null,
    },
    no_health_consent: {
      line: "Les repères chiffrés demandent ton accord santé, qui n'est pas actif.",
      action: { label: 'Donner mon accord santé', href: '/profile/health' },
    },
    screen_outdated: {
      line: 'Les questions de sécurité ont changé. Repasse-les pour retrouver tes repères chiffrés.',
      action: { label: 'Repasser les questions', href: '/nutrition/start' },
    },
    full_closed: {
      line: 'Les repères chiffrés ne sont pas encore ouverts dans ce cercle.',
      action: null,
    },
  } satisfies Record<ModeCause, CauseText | null>,

  /** Mode `full` (§12.2). */
  full: {
    targets: {
      title: 'Tes repères',
      estimate: 'Une estimation, pas une consigne.',
      how: 'Comment sont calculés mes repères',
      energy: 'Énergie',
      protein: 'Protéines',
      fat: 'Lipides',
      carbs: 'Glucides',
      fiber: 'Fibres',
      water: 'Eau',
      energyRange: (min: number, max: number) => `${formatKcal(min)} à ${formatKcal(max)} kcal`,
      energyCentre: (kcal: number) => `repère : ${formatKcal(kcal)} kcal`,
      proteinRange: (min: number, max: number) => `${formatGrams(min)} à ${formatGrams(max)} g`,
      fatMin: (g: number) => `au moins ${formatGrams(g)} g`,
      carbsAbout: (g: number) => `environ ${formatGrams(g)} g`,
      fiberValue: (g: number) => `${formatGrams(g)} g`,
      waterValue: (ml: number) => `${formatLitres(ml)} L, aliments compris`,
      goalOnMaintenance: 'Ton objectif est réglé sur le maintien.',
    },
    checkin: {
      title: 'Bilan de la semaine',
      ready: 'Bilan de la semaine prêt',
      accept: 'Accepter',
      keep: 'Garder mes repères',
      nonRepresentative: "Cette semaine n'était pas représentative (maladie, voyage…)",
      whyWeightVaries: 'Pourquoi mon poids varie',
      noFollowUp: 'Sans suite',
    },
    weight: {
      title: 'Poids',
      log: 'Noter mon poids',
      curve: 'Voir la courbe',
      mean7: (kg: string) => `Moyenne sur 7 jours : ${kg} kg`,
      change: (pct: string) => `${pct} % sur la semaine`,
      none: 'Aucune pesée pour le moment.',
    },
    sheets: 'Fiches',
    settings: 'Réglages',
  },

  /** Pesée (feuille du bas, §12.3) et courbe du poids (§12.2). Neutre : ni félicitation, ni jugement. */
  weigh: {
    sheetTitle: 'Noter mon poids',
    weight: 'Poids (kg)',
    weightHelp: 'À 0,1 kg près.',
    weightErrors: {
      empty: 'Indique ton poids.',
      format: 'Écris ton poids en kilos, par exemple 72,4.',
      decimals: 'Une décimale au plus.',
      range: 'Indique un poids entre 30 et 250 kg.',
    },
    date: 'Date',
    future: "Choisis un jour qui n'est pas encore passé.",
    replaces: 'Remplace la pesée de ce jour',
    check: 'Vérifie ta saisie',
    advice:
      'Pèse-toi 3 fois par semaine ou plus, le matin, avant de manger, dans la même tenue, pour un bilan fiable.',
    save: 'Enregistrer',
    cancel: 'Annuler',
    modeError: 'Les pesées ne sont pas disponibles dans ce mode.',
    page: {
      title: 'Poids',
      ranges: { legend: 'Période', w4: '4 semaines', m3: '3 mois', y1: '1 an' },
      empty: 'Aucune pesée sur cette période.',
      tableCaption: 'Moyennes par semaine',
      colWeek: 'Semaine du',
      colMean: 'Moyenne (kg)',
      colCount: 'Pesées',
      notEnough: 'Moins de 3 pesées',
      listLabel: 'Mes pesées',
      editLabel: 'Corriger',
      removeLabel: 'Supprimer',
      correct: (date: string) => `Corriger la pesée du ${date}`,
      remove: (date: string) => `Supprimer la pesée du ${date}`,
      chartNote: 'Trait : moyenne sur 7 jours. Points : tes pesées.',
    },
  },

  /** Phrases des décisions du bilan (§13). */
  decisions: {
    insufficient_data:
      'Pas assez de pesées cette semaine pour un bilan. À partir de 3 pesées, le bilan se fait.',
    non_representative_week: 'Semaine mise de côté. Le bilan reprend la semaine prochaine.',
    in_band: 'Ta tendance est dans la fourchette visée. Rien à changer.',
    out_of_band_pending: {
      above:
        'Ta tendance est au-dessus de la fourchette visée. On attend une deuxième semaine avant de proposer quoi que ce soit.',
      below:
        'Ta tendance est en dessous de la fourchette visée. On attend une deuxième semaine avant de proposer quoi que ce soit.',
    },
    proposal: (from: number, to: number) =>
      `Proposition : ton repère d'énergie passe de ${formatKcal(from)} à ${formatKcal(to)} kcal.`,
    rapid_loss: (from: number, to: number) =>
      `Ton poids baisse plus vite que prévu. Proposition : ton repère d'énergie passe de ${formatKcal(from)} à ${formatKcal(to)} kcal.`,
    limit_reached: {
      down: 'On ne descend pas plus. Un rythme plus lent est normal.',
      up: 'On ne monte pas plus. Un rythme plus lent est normal.',
    },
    safety_pause: {
      pause: "Pas de baisse proposée pour l'instant. Tu peux repasser les questions quand tu veux.",
      rule2: 'Ton objectif passe au maintien.',
    },
  } satisfies Record<CheckinDecision, unknown>,

  /** Pied du module, toujours là (§12.2, 07 §5.11.3). */
  footer: {
    title: "Besoin d'en parler ?",
    lead: "Si ton rapport à l'alimentation te préoccupe, tu peux en parler.",
    helpLink: "Demander de l'aide",
  },

  /** Page publique `/help/nutrition` (§10.6) : la ligne TCA vient de `HELP_RESOURCES`, jamais d'ici. */
  help: {
    title: "Demander de l'aide",
    lead: "Si manger te pèse, te préoccupe ou t'angoisse, tu n'as pas à rester seul avec ça.",
    listenTitle: "Une ligne d'écoute",
    listenLead: 'Des écoutants te répondent, sans jugement.',
    referralsTitle: 'Des professionnels pour en parler',
    doctor: "Ton médecin traitant peut faire le point avec toi et t'orienter vers la bonne personne.",
    dietitian:
      "Un·e diététicien·ne peut t'accompagner pour ton alimentation, en tenant compte de ton histoire et de ta santé.",
    midwife:
      'Grossesse ou allaitement : demande conseil à ton médecin ou à une sage-femme avant de changer ton alimentation.',
    source: 'Source',
  },

  /** Rubrique de la page Aide (§12.1). */
  helpEntry: {
    section: "Alimentation : demander de l'aide",
    link: "Demander de l'aide",
  },

  /** Activation et écran de sécurité (§12.4) : une étape par écran, rien d'envoyé avant la dernière. */
  start: {
    begin: 'Commencer',
    next: 'Continuer',
    send: 'Valider',
    consent: {
      title: 'Accord santé',
      lead: 'Les repères chiffrés utilisent des données de santé : ton accord est nécessaire pour les activer.',
      accept: "J'accepte",
      refuse: 'Conseils sans chiffres',
    },
    question: {
      progress: (index: number, total: number) => `Question ${index} sur ${total}`,
      yes: 'Oui',
      no: 'Non',
      preferNot: 'Je préfère ne pas répondre',
    },
    outcome: {
      title: 'Ce que tu peux choisir',
      safety: "D'après tes réponses, les conseils sans chiffres sont les plus adaptés.",
      choice: 'Choisis comment utiliser Nutrition. Tu pourras changer à tout moment.',
      modeLegend: 'Mode',
      fullClosed: 'Pas encore ouvert dans ce cercle',
    },
    setup: {
      title: 'Tes repères de départ',
      lead: 'Quelques informations pour estimer tes repères.',
      sexLegend: 'Sexe pour le calcul',
      male: 'Homme',
      female: 'Femme',
      unspecified: 'Je préfère ne pas le dire',
      height: 'Taille (cm)',
      heightError: 'Indique une taille entre 120 et 220 cm.',
      weight: 'Première pesée (kg)',
      weightHelp: 'À 0,1 kg près.',
      weightErrors: {
        empty: 'Indique ton poids.',
        format: 'Écris ton poids en kilos, par exemple 72,4.',
        decimals: 'Une décimale au plus.',
        range: 'Indique un poids entre 30 et 250 kg.',
      },
      activityLegend: "Niveau d'activité",
      activity: {
        1: 'Plutôt assis : travail ou études assis, peu de marche',
        2: 'Un peu actif : assis la plupart du temps, mais marche ou vélo au quotidien, ou 2 à 4 séances par semaine',
        3: 'Actif : métier debout ou physique léger, ou sport la plupart des jours',
        4: 'Très actif : métier physique, ou entraînement intense presque tous les jours',
      },
      goalLegend: 'Objectif',
      goals: { lose: 'Perte de gras', maintain: 'Maintien', gain: 'Prise de muscle' },
    },
  },

  offline: 'Nécessite le réseau',
} as const;
