import type { CoachUnavailableReason } from '@rune/contracts';
import { parisDate } from '../age';
import { COACH_CONFIG, type CoachConfig } from './config';

export interface GuardSnapshot {
  configured: boolean;
  enabled: boolean;
  suspendedUntil: string | null;
  now: string;
  consent: { active: boolean; textVersion: string | null };
  currentConsentVersion: string;
  countedToday: number;
  monthSpentUsdMicros: number;
  inProgress: boolean;
}

export type GuardRefusal =
  | { code: 'coach_unavailable'; reason: CoachUnavailableReason }
  | {
      code: 'consent_required' | 'daily_limit_reached' | 'monthly_budget_reached' | 'request_in_progress';
    };

/** Premier refus dans l'ordre du §7.3, ou null. */
export function coachAccessGuard(s: GuardSnapshot, config: CoachConfig = COACH_CONFIG): GuardRefusal | null {
  if (!s.configured) return { code: 'coach_unavailable', reason: 'not_configured' };
  if (!s.enabled) return { code: 'coach_unavailable', reason: 'disabled' };
  if (s.suspendedUntil !== null && Date.parse(s.suspendedUntil) > Date.parse(s.now)) {
    return { code: 'coach_unavailable', reason: 'suspended' };
  }
  if (!s.consent.active || s.consent.textVersion !== s.currentConsentVersion) {
    return { code: 'consent_required' };
  }
  if (s.countedToday >= config.limits.messagesPerDay) return { code: 'daily_limit_reached' };
  if (s.monthSpentUsdMicros >= config.limits.personMonthlyBudgetUsd * 1_000_000) {
    return { code: 'monthly_budget_reached' };
  }
  if (s.inProgress) return { code: 'request_in_progress' };
  return null;
}

/** Mois de Paris 'YYYY-MM' d'un jour civil 'YYYY-MM-DD'. */
export function parisMonthOf(day: string): string {
  return day.slice(0, 7);
}

/** ISO UTC du 1er du mois de Paris suivant, à minuit à Paris. */
export function nextParisMonthStart(now: Date): string {
  const [y, m] = parisMonthOf(parisDate(now)).split('-').map(Number) as [number, number];
  const firstDay = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const midnightUtc = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1);
  // Paris est à UTC+1 ou UTC+2 : minuit à Paris tombe 1 h ou 2 h avant minuit UTC.
  for (const hours of [1, 2]) {
    const candidate = new Date(midnightUtc - hours * 3_600_000);
    if (parisDate(candidate) === firstDay && parisDate(new Date(candidate.getTime() - 1)) !== firstDay) {
      return candidate.toISOString();
    }
  }
  throw new RangeError(`minuit de Paris introuvable pour ${firstDay}`);
}
