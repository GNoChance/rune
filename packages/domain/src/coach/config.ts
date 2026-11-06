import {
  type AgeBand,
  COACH_EFFORTS,
  type CoachEffort,
  HELP_RESOURCES,
  type HelpResource,
} from '@rune/contracts';
import { RULES_BY_VERSION } from '../program/rules';

export interface CoachEvaluatedEntry {
  model: string;
  effort: CoachEffort;
  promptVersion: string;
  toolsVersion: string;
  briefSchema: string;
  catalogVersion: string;
  report: string;
}

export interface CoachConfig {
  defaultModel: string;
  allowedModels: readonly string[];
  evaluated: readonly CoachEvaluatedEntry[];
  effort: CoachEffort;
  maxTokens: number;
  limits: {
    messagesPerDay: number;
    messageChars: number;
    personMonthlyBudgetUsd: number;
    maxToolRounds: number;
    maxPatchCorrections: number;
    maxProposalsPerMessage: number;
    reasonChars: number;
    reportCommentChars: number;
    readTrainingMaxDays: number;
    searchLimit: number;
    briefTargetTokens: number;
    briefMaxTokens: number;
    readTrainingMaxTokens: number;
    exchangeTimeoutMs: number;
    callTimeoutMs: number;
  };
  promptVersion: string;
  toolsVersion: string;
  briefSchema: string;
  retention: { threadDays: number; usageLogMonths: number; reportDays: number };
  helpResources: readonly HelpResource[];
  allowedConstants: readonly number[];
  workspaceMonthlyLimitUsd: number;
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

const allowedConstants = [
  ...new Set(
    Object.values(RULES_BY_VERSION).flatMap((r) => [
      r.lightenPct,
      r.resume.days14.loadPct,
      r.resume.days28.loadPct,
    ]),
  ),
];

const effort: CoachEffort = COACH_EFFORTS[0];

export const COACH_CONFIG: CoachConfig = deepFreeze({
  defaultModel: 'claude-opus-5-5',
  allowedModels: ['claude-opus-5-5', 'claude-sonnet-5-5'],
  evaluated: [],
  effort,
  maxTokens: 16_000,
  limits: {
    messagesPerDay: 30,
    messageChars: 2000,
    personMonthlyBudgetUsd: 3,
    maxToolRounds: 4,
    maxPatchCorrections: 2,
    maxProposalsPerMessage: 1,
    reasonChars: 300,
    reportCommentChars: 500,
    readTrainingMaxDays: 28,
    searchLimit: 10,
    briefTargetTokens: 3000,
    briefMaxTokens: 4500,
    readTrainingMaxTokens: 4000,
    exchangeTimeoutMs: 180_000,
    callTimeoutMs: 120_000,
  },
  promptVersion: 'coach-2',
  toolsVersion: 'tools-2',
  briefSchema: 'coach-brief/2',
  retention: { threadDays: 90, usageLogMonths: 12, reportDays: 90 },
  helpResources: HELP_RESOURCES,
  allowedConstants,
  workspaceMonthlyLimitUsd: 20,
});

export function promptVariant(audience: AgeBand): 'coach-2/adult' | 'coach-2/minor' {
  return audience === 'minor' ? 'coach-2/minor' : 'coach-2/adult';
}

/** Vrai si la combinaison exacte figure dans `evaluated` (spec §5.2). */
export function isEvaluated(config: CoachConfig, combo: Omit<CoachEvaluatedEntry, 'report'>): boolean {
  return config.evaluated.some(
    (e) =>
      e.model === combo.model &&
      e.effort === combo.effort &&
      e.promptVersion === combo.promptVersion &&
      e.toolsVersion === combo.toolsVersion &&
      e.briefSchema === combo.briefSchema &&
      e.catalogVersion === combo.catalogVersion,
  );
}
