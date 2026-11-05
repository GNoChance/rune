import type { CoachStatusView } from '@rune/contracts';
import type { FakeApi } from './fake-api';

/** Statut du coach : accord actif, adulte, disponible ; `patch` remplace ce qu'il nomme. */
export function coachStatus(
  patch: Partial<Omit<CoachStatusView, 'consent'>> & { consent?: Partial<CoachStatusView['consent']> } = {},
): CoachStatusView {
  return {
    available: true,
    unavailableReason: null,
    suspendedUntil: null,
    audience: 'adult',
    persona: 'skald',
    today: {
      threadId: null,
      open: false,
      closedReason: null,
      userMessageCount: 0,
      remaining: 30,
      inProgress: false,
    },
    budgetUsedPct: 0,
    devUnevaluated: false,
    ...patch,
    consent: {
      active: true,
      textVersion: '1.0',
      currentVersion: '1.0',
      needsRenewal: false,
      ...patch.consent,
    },
  };
}

export const EMPTY_TODAY = { thread: null, messages: [], inProgress: false };

/** Sert `status` et un fil du jour vide. */
export function serveCoach(api: FakeApi, status: CoachStatusView): FakeApi {
  return api
    .on('GET', '/api/coach/status', { status: 200, body: status })
    .on('GET', '/api/coach/today', { status: 200, body: EMPTY_TODAY });
}

export function coachMessage(
  seq: number,
  role: 'user' | 'assistant',
  text: string,
  extra: Record<string, unknown> = {},
) {
  return {
    seq,
    role,
    text,
    createdAt: '2025-10-28T10:00:00.000Z',
    aiGenerated: role === 'assistant',
    model: null,
    truncated: false,
    replaced: false,
    helpCards: [],
    proposalIds: [],
    links: [],
    ...extra,
  };
}
