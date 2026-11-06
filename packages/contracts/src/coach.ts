import { z } from 'zod';
import { AgeBandSchema } from './api/auth';
import { GuidedRequestSchema } from './coach-guided';
import { EXERCISE_ID_RE } from './exercise';
import { HELP_RESOURCE_IDS } from './help-resources';
import {
  type ChangeReasonCode,
  InstanceChangeOperationSchema,
  MAX_CHANGE_OPERATIONS,
  OPERATION_AUTHORS,
} from './program';
import { MovementPatternSchema, MuscleSchema } from './taxonomy';

/**
 * Coachs au choix (spec refonte §8) : L'Ombre, Le Skald, Le Scribe. Colonne `training_profile.coach`
 * (migration 0002_coach) ; choisi à la première étape de l'onboarding, exigé pour le terminer.
 */
export const COACH_IDS = ['ombre', 'skald', 'scribe'] as const;
export const CoachIdSchema = z.enum(COACH_IDS);
export type CoachId = z.infer<typeof CoachIdSchema>;

/*
 * Coach IA (spec brique 4) : constantes des tables (§6.1), entrées des outils (§10), flux (§7.2), vues et requêtes
 * (§7.1, §17.2). Le dossier envoyé (`coach-brief/1`, §9) est dans `coach-brief.ts`.
 */

// ---------------------------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------------------------

/** Effort figé avec le fil (`coach_thread.effort`). */
export const COACH_EFFORTS = ['low', 'medium', 'high'] as const;
export type CoachEffort = (typeof COACH_EFFORTS)[number];

/** Raison de la fermeture d'un fil (`coach_thread.closed_reason`, §6.4). */
export const COACH_CLOSED_REASONS = [
  'version_change',
  'health_withdrawn',
  'day_over',
  'persona_change',
  'nutrition_mode_change',
] as const;
export type CoachClosedReason = (typeof COACH_CLOSED_REASONS)[number];

/** Rôle d'un message stocké (`coach_message.role`) ; un message `system` n'est jamais rendu au téléphone. */
export const COACH_MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export type CoachMessageRole = (typeof COACH_MESSAGE_ROLES)[number];

/** Catégorie d'un signalement (`coach_report.category`, §16.6). */
export const COACH_REPORT_CATEGORIES = ['inaccurate', 'unsafe', 'inappropriate', 'other'] as const;
export type CoachReportCategory = (typeof COACH_REPORT_CATEGORIES)[number];

/** Compteurs anonymes du cercle (`coach_safety_counter.kind`, C0). */
export const COACH_COUNTER_KINDS = [
  'help_emergency',
  'help_pain',
  'help_eating_disorder',
  'help_doping',
  'help_pregnancy',
  'help_distress',
  'filter_block',
  'refusal',
] as const;
export type CoachCounterKind = (typeof COACH_COUNTER_KINDS)[number];

/** Liens d'une réponse du coach (`display_extras.links`) : Mon programme, Bien utiliser le coach. */
export const COACH_LINKS = ['program', 'coach_help'] as const;
export type CoachLink = (typeof COACH_LINKS)[number];

/** Outils de `tools-1`, triés par nom (§10). */
export const COACH_TOOL_NAMES = [
  'propose_program_change',
  'read_training',
  'refer_to_help',
  'search_exercises',
] as const;
export type CoachToolName = (typeof COACH_TOOL_NAMES)[number];

/** Codes de l'événement `error` du flux (§7.2). */
export const COACH_STREAM_ERROR_CODES = [
  'api_unavailable',
  'spend_limit',
  'monthly_budget_reached',
  'tool_rounds_exceeded',
  'timeout',
  'shutdown',
  'consent_withdrawn',
  'thread_closed',
  'internal',
] as const;
export type CoachStreamErrorCode = (typeof COACH_STREAM_ERROR_CODES)[number];

/** Raison d'un coach indisponible (`coach_unavailable`, premier contrôle de la garde, §7.3). */
export const COACH_UNAVAILABLE_REASONS = ['disabled', 'suspended', 'not_configured'] as const;
export type CoachUnavailableReason = (typeof COACH_UNAVAILABLE_REASONS)[number];

/** Tranche d'âge envoyée dans le dossier (`age_band`, §9) : jamais la date de naissance. */
export const COACH_AGE_BANDS = ['16-17', '18-29', '30-39', '40-49', '50-59', '60+'] as const;
export type CoachAgeBand = (typeof COACH_AGE_BANDS)[number];

const HelpResourceIdSchema = z.enum(HELP_RESOURCE_IDS);
const CoachLinkSchema = z.enum(COACH_LINKS);
const ClosedReasonSchema = z.enum(COACH_CLOSED_REASONS);
const ReportCategorySchema = z.enum(COACH_REPORT_CATEGORIES);
const Slug = z.string().max(60).regex(EXERCISE_ID_RE);
const IsoDateTime = z.iso.datetime();
/** Jour de Paris, `YYYY-MM-DD`. */
const ParisDay = z.iso.date();
/** Mois de Paris, `YYYY-MM`. */
const ParisMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Count = z.number().int().min(0);
const Seq = z.number().int().min(1);

// ---------------------------------------------------------------------------------------------------------------
// Texte de la personne (§7.3, §16.2)
// ---------------------------------------------------------------------------------------------------------------

/** La saisie affiche son compteur à partir de 1 800 caractères (« 1 950 / 2 000 »). */
export const COACH_COUNTER_FROM = 1800;

const CONTROLS_BUT_NEWLINE = /(?!\n)\p{Cc}/gu;
const DIRECTION_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/gu;

/**
 * Seul nettoyage d'un texte libre (messages, notes du dossier) : `\r\n` → `\n`, caractères de contrôle retirés sauf
 * `\n`, caractères d'inversion de sens retirés (U+202A à U+202E, U+2066 à U+2069), espaces de bord retirés.
 */
export function cleanCoachText(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(CONTROLS_BUT_NEWLINE, '').replace(DIRECTION_OVERRIDES, '').trim();
}

/** Longueur en points de code, pas en unités UTF-16 : 2 000 « 💪 » font 2 000 caractères (Review Focus 3). */
export function coachTextLength(text: string): number {
  return [...text].length;
}

// ---------------------------------------------------------------------------------------------------------------
// Opérations et entrées des outils (§10) : `.strict()`, clés en snake_case
// ---------------------------------------------------------------------------------------------------------------

type OperationVariant = (typeof InstanceChangeOperationSchema.options)[number];

/**
 * Variantes de Programmes dont `OPERATION_AUTHORS` permet le coach (toutes sauf `resume_slot`), dérivées par code :
 * une opération ajoutée à Programmes rejoint l'outil, à `tools_version` près.
 */
const COACH_VARIANTS = InstanceChangeOperationSchema.options.filter((o) =>
  OPERATION_AUTHORS[o.shape.op.value].includes('coach'),
) as [OperationVariant, ...OperationVariant[]];

export const CoachOperationSchema = z.discriminatedUnion('op', COACH_VARIANTS);

export const ReadTrainingInput = z.strictObject({
  since_days: z.number().int().min(1).max(28, { message: '28 jours au plus' }),
  exercise_id: Slug.optional(),
});
export type ReadTrainingInput = z.infer<typeof ReadTrainingInput>;

/** `available_equipment_only` absent : vrai (le gestionnaire l'applique). */
export const SearchExercisesInput = z.strictObject({
  query: z.string().max(80).optional(),
  muscle: MuscleSchema.optional(),
  movement_pattern: MovementPatternSchema.optional(),
  available_equipment_only: z.boolean().optional(),
});
export type SearchExercisesInput = z.infer<typeof SearchExercisesInput>;

export const ProposeProgramChangeInput = z.strictObject({
  base_revision: z.number().int().min(0),
  operations: z.array(CoachOperationSchema).min(1).max(MAX_CHANGE_OPERATIONS),
  reason: z.string().min(1).max(300),
});
export type ProposeProgramChangeInput = z.infer<typeof ProposeProgramChangeInput>;

export const ReferToHelpInput = z.strictObject({ resource: HelpResourceIdSchema });
export type ReferToHelpInput = z.infer<typeof ReferToHelpInput>;

// ---------------------------------------------------------------------------------------------------------------
// Vues et requêtes (§7.1)
// ---------------------------------------------------------------------------------------------------------------

/** `coach_message.display_extras` : cartes et liens d'une réponse, à leur place dans le fil. */
export const DisplayExtras = z.strictObject({
  helpCards: z.array(HelpResourceIdSchema),
  proposalIds: z.array(z.string()),
  links: z.array(CoachLinkSchema),
  replaced: z.boolean(),
  /** Message de la personne venu d'un parcours guidé : la mention et les puces de suite (spec 4.1 §2.3). */
  guided: GuidedRequestSchema.optional(),
});
export type DisplayExtras = z.infer<typeof DisplayExtras>;

/** `text` est nettoyé et compté par le serveur (`cleanCoachText`, `coachTextLength`). */
export const CoachMessageRequest = z.strictObject({
  clientMessageId: z.uuid({ version: 'v7' }),
  text: z.string(),
  /** Message d'un parcours guidé : le serveur recompose le texte à partir de ces identifiants (spec 4.1 §4.2). */
  guided: GuidedRequestSchema.optional(),
});
export type CoachMessageRequest = z.infer<typeof CoachMessageRequest>;

export const CoachStatusView = z.strictObject({
  available: z.boolean(),
  unavailableReason: z.enum(COACH_UNAVAILABLE_REASONS).nullable(),
  suspendedUntil: IsoDateTime.nullable(),
  consent: z.strictObject({
    active: z.boolean(),
    textVersion: z.string().nullable(),
    currentVersion: z.string(),
    needsRenewal: z.boolean(),
  }),
  audience: AgeBandSchema,
  persona: CoachIdSchema,
  today: z.strictObject({
    threadId: z.string().nullable(),
    open: z.boolean(),
    closedReason: ClosedReasonSchema.nullable(),
    userMessageCount: Count,
    remaining: Count,
    inProgress: z.boolean(),
  }),
  budgetUsedPct: Count,
  /** Vrai seulement en mode dev (`COACH_DEV_ALLOW_UNEVALUATED`, §5.2). */
  devUnevaluated: z.boolean(),
});
export type CoachStatusView = z.infer<typeof CoachStatusView>;

/** Les messages système et les tours d'outils ne sont jamais rendus. */
export const CoachMessageView = z.strictObject({
  seq: Seq,
  role: z.enum(COACH_MESSAGE_ROLES).exclude(['system']),
  text: z.string(),
  createdAt: IsoDateTime,
  aiGenerated: z.boolean(),
  model: z.string().nullable(),
  truncated: z.boolean(),
  replaced: z.boolean(),
  helpCards: z.array(HelpResourceIdSchema),
  proposalIds: z.array(z.string()),
  links: z.array(CoachLinkSchema),
  /** Message de la personne venu d'un parcours guidé : la mention et les puces de suite (spec 4.1 §2.3). */
  guided: GuidedRequestSchema.optional(),
});
export type CoachMessageView = z.infer<typeof CoachMessageView>;

export const CoachThreadView = z.strictObject({
  id: z.string(),
  day: ParisDay,
  audience: AgeBandSchema,
  persona: CoachIdSchema,
  open: z.boolean(),
  closedReason: ClosedReasonSchema.nullable(),
  userMessageCount: Count,
  createdAt: IsoDateTime,
});
export type CoachThreadView = z.infer<typeof CoachThreadView>;

export const CoachTodayResponse = z.strictObject({
  thread: CoachThreadView.nullable(),
  messages: z.array(CoachMessageView),
  inProgress: z.boolean(),
});
export type CoachTodayResponse = z.infer<typeof CoachTodayResponse>;

/** Fils des 90 derniers jours. */
export const CoachThreadsResponse = z.strictObject({
  threads: z.array(
    z.strictObject({
      id: z.string(),
      day: ParisDay,
      /** Voix du fil : « Conversation avec le Skald » (spec 4.1 §4.4). */
      persona: CoachIdSchema,
      userMessageCount: Count,
      open: z.boolean(),
    }),
  ),
});
export type CoachThreadsResponse = z.infer<typeof CoachThreadsResponse>;

/** Un fil en lecture seule. */
export const CoachThreadResponse = z.strictObject({
  thread: CoachThreadView,
  messages: z.array(CoachMessageView),
});
export type CoachThreadResponse = z.infer<typeof CoachThreadResponse>;

export const CoachReportRequest = z.strictObject({
  threadId: z.string().min(1),
  messageSeq: Seq,
  category: ReportCategorySchema,
  comment: z.string().max(500).optional(),
});
export type CoachReportRequest = z.infer<typeof CoachReportRequest>;

// ---------------------------------------------------------------------------------------------------------------
// Flux (§7.2) : `event: <type>` puis `data: <JSON>` ; l'union porte le type et ses données à plat
// ---------------------------------------------------------------------------------------------------------------

/** Proposition validée par le gestionnaire ; elle n'existe en base qu'à l'enregistrement de l'échange (§12.1). */
export const CoachProposalEvent = z.strictObject({
  type: z.literal('proposal'),
  id: z.string(),
  baseRevision: z.number().int().min(0),
  operations: z.array(CoachOperationSchema).min(1).max(MAX_CHANGE_OPERATIONS),
  reasonCode: z.literal('COACH_PROPOSAL' satisfies ChangeReasonCode),
  /** Motif (C2) : nul sans l'accord santé. */
  reason: z.string().nullable(),
  expiresAt: IsoDateTime,
});
export type CoachProposalEvent = z.infer<typeof CoachProposalEvent>;

export const CoachStreamEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  z.strictObject({ type: z.literal('tool_running'), tool: z.enum(COACH_TOOL_NAMES) }),
  CoachProposalEvent,
  z.strictObject({ type: z.literal('help_card'), resource: HelpResourceIdSchema }),
  z.strictObject({ type: z.literal('retry'), reason: z.literal('filter') }),
  z.strictObject({
    type: z.literal('done'),
    threadId: z.string(),
    userSeq: Seq,
    assistantSeq: Seq,
    truncated: z.boolean(),
    replaced: z.boolean(),
    proposalIds: z.array(z.string()),
    remainingToday: Count,
  }),
  z.strictObject({ type: z.literal('refused'), message: z.string() }),
  z.strictObject({ type: z.literal('error'), code: z.enum(COACH_STREAM_ERROR_CODES) }),
]);
export type CoachStreamEvent = z.infer<typeof CoachStreamEventSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Administration (§17)
// ---------------------------------------------------------------------------------------------------------------

/** Aucun nombre de messages par personne : coûts du mois de Paris et compteurs anonymes seulement. */
export const CoachAdminView = z.strictObject({
  state: z.strictObject({
    enabled: z.boolean(),
    suspendedUntil: IsoDateTime.nullable(),
    configured: z.boolean(),
    notConfiguredCause: z.enum(['no_key', 'model_not_allowed', 'not_evaluated']).nullable(),
    catalogChanged: z.boolean(),
  }),
  month: ParisMonth,
  totalUsd: z.number().min(0),
  workspaceLimitUsd: z.number().min(0),
  members: z.array(
    z.strictObject({ username: z.string(), costUsd: z.number().min(0), budgetUsd: z.number().min(0) }),
  ),
  counters: z.array(z.strictObject({ month: ParisMonth, kind: z.enum(COACH_COUNTER_KINDS), count: Count })),
  openReports: Count,
});
export type CoachAdminView = z.infer<typeof CoachAdminView>;

export const SetCoachEnabledRequest = z.strictObject({ enabled: z.boolean() });
export type SetCoachEnabledRequest = z.infer<typeof SetCoachEnabledRequest>;

export const CoachReportSummary = z.strictObject({
  id: z.string(),
  createdAt: IsoDateTime,
  category: ReportCategorySchema,
  username: z.string(),
  minor: z.boolean(),
});
export type CoachReportSummary = z.infer<typeof CoachReportSummary>;

/** Seule donnée C3 lisible par l'admin (P-ADM-1) : l'échange que la personne a choisi de signaler. */
export const CoachReportDetail = CoachReportSummary.extend({
  exchangeText: z.string(),
  comment: z.string().nullable(),
});
export type CoachReportDetail = z.infer<typeof CoachReportDetail>;
