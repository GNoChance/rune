import {
  BODY_AREAS,
  CHANGE_AUTHORS,
  CHANGE_STATUSES,
  COACH_CLOSED_REASONS,
  COACH_COUNTER_KINDS,
  COACH_EFFORTS,
  COACH_IDS,
  COACH_MESSAGE_ROLES,
  COACH_REPORT_CATEGORIES,
  COMMENT_BODY_MAX,
  COMMENT_BODY_MIN,
  COMMENT_PARTS,
  CONSENT_ACTIONS,
  CONSENT_TYPES,
  DAYS_PER_WEEK,
  DECISION_RESULTS,
  EFFORTS,
  EXERCISE_LEVELS,
  EXERCISE_NAME_MAX,
  EXERCISE_STATUSES,
  EXPERIENCES,
  GOALS,
  GYM_CITY_MAX,
  GYM_CITY_MIN,
  GYM_NAME_MAX,
  GYM_NAME_MIN,
  GymHistoryAction,
  ILLUSTRATION_LICENSES,
  ILLUSTRATION_MEDIA_TYPES,
  ILLUSTRATION_SOURCES,
  INVITATION_NOTE_MAX,
  LIMITATION_NOTE_MAX,
  LIMITATION_SEVERITIES,
  LIMITATION_SIDES,
  LOAD_MODES,
  MAX_CHANGE_OPERATIONS,
  MEASURES,
  MECHANICS,
  NEXT_ADJUSTMENTS,
  ONBOARDING_STEPS,
  PAIN_LEVELS,
  PLACE_KINDS,
  PLACE_NAME_MAX,
  PushResult,
  RejectionCode,
  RoleSchema,
  SECURITY_OUTCOMES,
  SESSION_MINUTES,
  SESSION_PROFILES,
  SESSION_REVOKED_REASONS,
  SESSION_STATUSES,
  SET_KINDS,
  SIDES,
  SLOT_MODES,
  SPORT_OTHER_LABEL_MAX,
  SWAP_REASONS,
  UserStatusSchema,
  WEEK_TYPES,
} from '@rune/contracts';
import { currentRules } from '@rune/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../support';

// 01 §9.1.4 : chaque énumération et chaque borne du DDL a sa constante dans contracts, et les deux concordent.
const { setBounds, noteMaxLength } = currentRules();

const ENUMS: Record<string, readonly (string | number)[]> = {
  'applied_op.status': PushResult.shape.status.options,
  'coach_message.role': COACH_MESSAGE_ROLES,
  'coach_report.category': COACH_REPORT_CATEGORIES,
  'coach_safety_counter.kind': COACH_COUNTER_KINDS,
  'coach_thread.audience': ['adult', 'minor'],
  'coach_thread.closed_reason': COACH_CLOSED_REASONS,
  'coach_thread.effort': COACH_EFFORTS,
  'coach_thread.persona': COACH_IDS,
  'consent_event.type': CONSENT_TYPES,
  'consent_event.action': CONSENT_ACTIONS,
  'exercise.status': EXERCISE_STATUSES,
  'exercise.mechanics': MECHANICS,
  'exercise.measure': MEASURES,
  'exercise.load_mode': LOAD_MODES,
  'exercise.level': EXERCISE_LEVELS,
  'exercise_comment.part': COMMENT_PARTS,
  'exercise_revision.status': EXERCISE_STATUSES,
  'engine_decision.profile': SESSION_PROFILES,
  'engine_decision.result': DECISION_RESULTS,
  'gym_history.action': GymHistoryAction.options,
  'illustration.media_type': ILLUSTRATION_MEDIA_TYPES,
  'illustration.source': ILLUSTRATION_SOURCES,
  'illustration.license': ILLUSTRATION_LICENSES,
  'instance_change.author': CHANGE_AUTHORS,
  'instance_change.status': CHANGE_STATUSES,
  'limitation.body_area': BODY_AREAS,
  'limitation.side': LIMITATION_SIDES,
  'limitation.severity': LIMITATION_SEVERITIES,
  'performed_exercise.next_adjustment': NEXT_ADJUSTMENTS,
  'performed_exercise.pain_level': PAIN_LEVELS,
  'performed_exercise.swap_reason': SWAP_REASONS,
  'performed_set.effort': EFFORTS,
  'performed_set.kind': SET_KINDS,
  'performed_set.load_mode': LOAD_MODES,
  'performed_set.side': SIDES,
  'place.kind': PLACE_KINDS,
  'program_instance.status': ['active', 'ended'],
  'security_event.outcome': SECURITY_OUTCOMES,
  'session.revoked_reason': SESSION_REVOKED_REASONS,
  'slot_state.mode': SLOT_MODES,
  'sync_rejection.code': RejectionCode.options,
  'training_profile.goal': GOALS,
  'training_profile.experience': EXPERIENCES,
  'training_profile.session_minutes': SESSION_MINUTES,
  'training_profile.coach': COACH_IDS,
  'user.role': RoleSchema.options,
  'user.status': UserStatusSchema.options,
  'user.onboarding_step': ONBOARDING_STEPS,
  'workout_session.profile': SESSION_PROFILES,
  'workout_session.status': SESSION_STATUSES,
  'workout_session.week_type': WEEK_TYPES,
};

// `exercise.batch` (motif, pas une liste) est vérifié contre BatchSchema dans schema.test.
const BOUNDS: Record<string, { min: number | null; max: number }> = {
  'coach_report.comment': { min: null, max: 500 },
  'exercise.name': { min: null, max: EXERCISE_NAME_MAX },
  'exercise_comment.body': { min: COMMENT_BODY_MIN, max: COMMENT_BODY_MAX },
  'gym.name': { min: GYM_NAME_MIN, max: GYM_NAME_MAX },
  'gym.city': { min: GYM_CITY_MIN, max: GYM_CITY_MAX },
  'instance_change.operations': { min: 1, max: MAX_CHANGE_OPERATIONS },
  'invitation.note': { min: null, max: INVITATION_NOTE_MAX },
  'limitation.note': { min: null, max: LIMITATION_NOTE_MAX },
  'performed_exercise.note': { min: null, max: noteMaxLength },
  'performed_exercise.position': { min: setBounds.position[0], max: setBounds.position[1] },
  'performed_set.duration_s': { min: setBounds.durationS[0], max: setBounds.durationS[1] },
  'performed_set.load_g': { min: setBounds.loadG[0], max: setBounds.loadG[1] },
  'performed_set.position': { min: setBounds.position[0], max: setBounds.position[1] },
  'performed_set.reps': { min: setBounds.reps[0], max: setBounds.reps[1] },
  'place.name': { min: null, max: PLACE_NAME_MAX },
  'program_instance.days_per_week': { min: Math.min(...DAYS_PER_WEEK), max: Math.max(...DAYS_PER_WEEK) },
  'training_profile.days_per_week': { min: Math.min(...DAYS_PER_WEEK), max: Math.max(...DAYS_PER_WEEK) },
  'training_profile.sport_other_label': { min: null, max: SPORT_OTHER_LABEL_MAX },
  'workout_session.note': { min: null, max: noteMaxLength },
};

const IN_RE = /\b(\w+) IN \(([^)]*)\)/g;
const BETWEEN_RE = /(?:length\((\w+)\)|\b(\w+)) BETWEEN (\d+) AND (\d+)/g;
const MAX_RE = /length\((\w+)\) <= (\d+)/g;

function parseList(raw: string): (string | number)[] {
  return raw.split(',').map((v) => {
    const t = v.trim();
    return t.startsWith("'") ? t.slice(1, -1) : Number(t);
  });
}

const sorted = (v: readonly (string | number)[]) => [...v].map(String).sort();

let ctx: TestContext;
afterEach(() => ctx?.close());

async function schemaChecks() {
  ctx = await createTestContext();
  const tables = ctx.deps.sqlite
    .prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all() as { name: string; sql: string }[];
  const enums = new Map<string, (string | number)[]>();
  const bounds = new Map<string, { min: number | null; max: number }>();
  for (const { name, sql } of tables) {
    for (const m of sql.matchAll(IN_RE)) {
      const values = parseList(m[2] as string);
      if (sorted(values).join() === '0,1') continue; // booléen
      enums.set(`${name}.${m[1]}`, values);
    }
    for (const m of sql.matchAll(BETWEEN_RE)) {
      bounds.set(`${name}.${m[1] ?? m[2]}`, { min: Number(m[3]), max: Number(m[4]) });
    }
    for (const m of sql.matchAll(MAX_RE)) bounds.set(`${name}.${m[1]}`, { min: null, max: Number(m[2]) });
  }
  return { enums, bounds };
}

describe('cohérence du DDL et des constantes de contracts (01 §9.1.4)', () => {
  it('chaque énumération IN (...) du schéma égale la constante de sa colonne', async () => {
    const { enums } = await schemaChecks();
    expect(enums.size).toBeGreaterThan(0);
    for (const [column, values] of enums) {
      const expected = ENUMS[column];
      expect(expected, `colonne sans constante : ${column}`).toBeDefined();
      expect(sorted(values), column).toEqual(sorted(expected ?? []));
    }
    expect([...enums.keys()].sort()).toEqual(Object.keys(ENUMS).sort());
  });

  it('chaque borne du schéma égale la constante de sa colonne', async () => {
    const { bounds } = await schemaChecks();
    for (const [column, bound] of bounds) {
      expect(BOUNDS[column], `colonne sans constante : ${column}`).toBeDefined();
      expect(bound, column).toEqual(BOUNDS[column]);
    }
    expect([...bounds.keys()].sort()).toEqual(Object.keys(BOUNDS).sort());
  });
});
