import { describe, expect, it } from 'vitest';
import {
  coachAccessGuard,
  type GuardSnapshot,
  nextParisMonthStart,
  parisMonthOf,
} from '../../src/coach/guard';

const ok: GuardSnapshot = {
  configured: true,
  enabled: true,
  suspendedUntil: null,
  now: '2026-11-03T10:00:00.000Z',
  consent: { active: true, textVersion: '1.0' },
  currentConsentVersion: '1.0',
  countedToday: 0,
  monthSpentUsdMicros: 0,
  inProgress: false,
};

describe('coachAccessGuard › ordre des refus', () => {
  const cases: [string, Partial<GuardSnapshot>, unknown][] = [
    ['tout bon', {}, null],
    [
      'non configuré, même sans accord',
      { configured: false, consent: { active: false, textVersion: null } },
      { code: 'coach_unavailable', reason: 'not_configured' },
    ],
    ['désactivé', { enabled: false }, { code: 'coach_unavailable', reason: 'disabled' }],
    [
      'suspendu',
      { suspendedUntil: '2026-12-01T00:00:00.000Z' },
      { code: 'coach_unavailable', reason: 'suspended' },
    ],
    ['suspension échue', { suspendedUntil: '2026-11-03T09:00:00.000Z' }, null],
    [
      "accord d'une autre version",
      { consent: { active: true, textVersion: '0.9' } },
      { code: 'consent_required' },
    ],
    ['accord retiré', { consent: { active: false, textVersion: '1.0' } }, { code: 'consent_required' }],
    ['29 échanges', { countedToday: 29 }, null],
    ['30 échanges', { countedToday: 30 }, { code: 'daily_limit_reached' }],
    ['budget 2 999 999', { monthSpentUsdMicros: 2_999_999 }, null],
    ['budget 3 000 000', { monthSpentUsdMicros: 3_000_000 }, { code: 'monthly_budget_reached' }],
    ['échange en cours', { inProgress: true }, { code: 'request_in_progress' }],
    [
      'limite du jour et budget',
      { countedToday: 30, monthSpentUsdMicros: 3_000_000 },
      { code: 'daily_limit_reached' },
    ],
    [
      'budget et échange en cours',
      { monthSpentUsdMicros: 3_000_000, inProgress: true },
      { code: 'monthly_budget_reached' },
    ],
    [
      'indisponible avant accord',
      { enabled: false, consent: { active: false, textVersion: null } },
      { code: 'coach_unavailable', reason: 'disabled' },
    ],
  ];
  it.each(cases)('%s', (_name, patch, expected) => {
    expect(coachAccessGuard({ ...ok, ...patch })).toEqual(expected);
  });
});

describe('dates de Paris', () => {
  it('nextParisMonthStart', () => {
    expect(nextParisMonthStart(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-30T23:00:00.000Z');
    expect(nextParisMonthStart(new Date('2026-03-15T12:00:00Z'))).toBe('2026-03-31T22:00:00.000Z');
    expect(nextParisMonthStart(new Date('2026-12-15T12:00:00Z'))).toBe('2026-12-31T23:00:00.000Z');
  });
  it('parisMonthOf', () => {
    expect(parisMonthOf('2026-11-01')).toBe('2026-11');
  });
});
