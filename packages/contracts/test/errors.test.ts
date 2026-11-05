import { describe, expect, it } from 'vitest';
import { ApiErrorBody, ApiErrorCode, ERROR_STATUS, HealthResponse } from '../src/index';

const GROUPS: Record<number, string[]> = {
  400: [
    'validation',
    'password_rejected',
    'username_invalid',
    'under_min_age',
    'invitation_expired',
    'invitation_used',
    'invitation_revoked',
    'invitation_unknown',
    'reset_invalid',
  ],
  401: ['unauthenticated', 'invalid_credentials'],
  403: [
    'forbidden',
    'origin_mismatch',
    'account_disabled',
    'password_change_required',
    'health_consent_required',
    'reset_self_forbidden',
    'self_health_flag',
    'consent_required',
  ],
  404: ['not_found'],
  409: [
    'conflict',
    'username_taken',
    'last_admin',
    'gym_duplicate',
    'gym_in_use',
    'place_exists',
    'last_place',
    'primary_required',
    'onboarding_incomplete',
    'revision_conflict',
    'not_reviewable',
    'already_enrolled',
    'stale_revision',
    'expired',
    'not_proposed',
    'session_in_progress',
    'request_in_progress',
    'thread_closed',
    'duplicate_message',
  ],
  410: ['account_deleted', 'watermark_expired'],
  415: ['unsupported_media_type'],
  422: [
    'transition_blocked',
    'template_unavailable',
    'days_out_of_range',
    'invalid_change',
    'coach_load_increase',
    'coach_load_unverifiable',
  ],
  426: ['protocol_unsupported'],
  429: ['rate_limited', 'daily_limit_reached', 'monthly_budget_reached'],
  500: ['internal'],
  503: ['coach_unavailable'],
};

describe('ApiErrorCode et ERROR_STATUS', () => {
  it('compte 54 codes', () => {
    expect(ApiErrorCode.options).toHaveLength(54);
  });

  it("refus de la garde de hausse à l'acceptation d'une proposition du coach : 422 (spec brique 4 §12.2)", () => {
    expect(ERROR_STATUS.coach_load_increase).toBe(422);
    expect(ERROR_STATUS.coach_load_unverifiable).toBe(422);
  });

  it('porte les codes de la garde du coach et de son envoi avec leur statut (spec brique 4 §7.3)', () => {
    expect(ERROR_STATUS).toMatchObject({
      coach_unavailable: 503,
      consent_required: 403,
      daily_limit_reached: 429,
      monthly_budget_reached: 429,
      request_in_progress: 409,
      thread_closed: 409,
      duplicate_message: 409,
    });
  });

  it('porte les codes de la relecture avec leur statut (spec brique 2 §3.6)', () => {
    expect(ERROR_STATUS.revision_conflict).toBe(409);
    expect(ERROR_STATUS.transition_blocked).toBe(422);
    expect(ERROR_STATUS.not_reviewable).toBe(409);
    expect(ERROR_STATUS.self_health_flag).toBe(403);
  });

  it('associe chaque code au statut de son groupe', () => {
    const expected: Record<string, number> = {};
    for (const [status, codes] of Object.entries(GROUPS)) for (const c of codes) expected[c] = Number(status);
    expect(Object.keys(expected).sort()).toEqual([...ApiErrorCode.options].sort());
    for (const code of ApiErrorCode.options) expect(ERROR_STATUS[code]).toBe(expected[code]);
  });
});

describe('ApiErrorBody', () => {
  it('conserve les champs supplémentaires', () => {
    expect(ApiErrorBody.parse({ error: 'protocol_unsupported', serverProtocol: 1, minProtocol: 1 })).toEqual({
      error: 'protocol_unsupported',
      serverProtocol: 1,
      minProtocol: 1,
    });
  });

  it('refuse un code inconnu', () => {
    expect(ApiErrorBody.safeParse({ error: 'boum' }).success).toBe(false);
  });
});

describe('HealthResponse', () => {
  it('accepte une époque nulle', () => {
    const body = {
      status: 'error',
      version: 'dev',
      db: 'error',
      protocol: 1,
      minProtocol: 1,
      epoch: null,
      swKill: false,
    };
    expect(HealthResponse.parse(body)).toEqual(body);
  });
});
