import { describe, expect, it } from 'vitest';
import { TrainingProfilePatch } from '../src/api/profile';
import {
  COACH_AGE_BANDS,
  COACH_CLOSED_REASONS,
  COACH_COUNTER_FROM,
  COACH_COUNTER_KINDS,
  COACH_EFFORTS,
  COACH_IDS,
  COACH_LINKS,
  COACH_MESSAGE_ROLES,
  COACH_REPORT_CATEGORIES,
  COACH_STREAM_ERROR_CODES,
  COACH_TOOL_NAMES,
  COACH_UNAVAILABLE_REASONS,
  CoachAdminView,
  CoachIdSchema,
  CoachMessageRequest,
  CoachMessageView,
  CoachOperationSchema,
  CoachReportDetail,
  CoachReportRequest,
  CoachStatusView,
  CoachStreamEventSchema,
  CoachTodayResponse,
  cleanCoachText,
  coachTextLength,
  DisplayExtras,
  ProposeProgramChangeInput,
  ReadTrainingInput,
  ReferToHelpInput,
  SearchExercisesInput,
} from '../src/coach';
import { CoachBriefResponse, CoachBriefSchema, CoachBriefStoredSchema } from '../src/coach-brief';
import { entityRules } from '../src/entity-rules';
import { InstanceChangeOperationSchema, REASON_TEXTS } from '../src/program';

describe('coach (spec refonte §8)', () => {
  it('trois coachs, dans cet ordre', () => {
    expect(COACH_IDS).toEqual(['ombre', 'skald', 'scribe']);
  });

  it('CoachIdSchema refuse tout autre identifiant', () => {
    for (const id of COACH_IDS) expect(CoachIdSchema.parse(id)).toBe(id);
    for (const bad of ['berserker', 'Skald', '', null, 1])
      expect(CoachIdSchema.safeParse(bad).success).toBe(false);
  });

  it("TrainingProfilePatch accepte un coach, jamais null : un coach choisi se change, il ne s'efface pas", () => {
    for (const coach of COACH_IDS) expect(TrainingProfilePatch.parse({ coach })).toEqual({ coach });
    expect(TrainingProfilePatch.safeParse({ coach: null }).success).toBe(false);
    expect(TrainingProfilePatch.safeParse({ coach: 'berserker' }).success).toBe(false);
  });

  it("colonne C1 du profil d'entraînement, écrite par l'API seulement (classe E)", () => {
    const rule = entityRules.training_profile;
    expect(rule?.columns).toContain('coach');
    expect(rule?.category).toBe('C1');
    expect(rule?.syncClass).toBe('E');
    expect(rule?.c2Columns).not.toContain('coach');
    expect(rule?.clientWritable).toEqual([]);
  });
});

describe('constantes du coach IA (spec brique 4)', () => {
  it('valeurs des tables (§6.1), des outils (§10), du flux (§7.2) et de la garde (§7.1)', () => {
    expect(COACH_EFFORTS).toEqual(['low', 'medium', 'high']);
    expect(COACH_CLOSED_REASONS).toEqual([
      'version_change',
      'health_withdrawn',
      'day_over',
      'persona_change',
      'nutrition_mode_change',
    ]);
    expect(COACH_MESSAGE_ROLES).toEqual(['user', 'assistant', 'system']);
    expect(COACH_REPORT_CATEGORIES).toEqual(['inaccurate', 'unsafe', 'inappropriate', 'other']);
    expect(COACH_COUNTER_KINDS).toEqual([
      'help_emergency',
      'help_pain',
      'help_eating_disorder',
      'help_doping',
      'help_pregnancy',
      'help_distress',
      'filter_block',
      'refusal',
    ]);
    expect(COACH_LINKS).toEqual(['program', 'coach_help']);
    expect(COACH_TOOL_NAMES).toEqual([
      'propose_program_change',
      'read_training',
      'refer_to_help',
      'search_exercises',
    ]);
    expect([...COACH_TOOL_NAMES].sort()).toEqual(COACH_TOOL_NAMES);
    expect(COACH_STREAM_ERROR_CODES).toEqual([
      'api_unavailable',
      'spend_limit',
      'monthly_budget_reached',
      'tool_rounds_exceeded',
      'timeout',
      'shutdown',
      'consent_withdrawn',
      'thread_closed',
      'internal',
    ]);
    expect(COACH_UNAVAILABLE_REASONS).toEqual(['disabled', 'suspended', 'not_configured']);
    expect(COACH_AGE_BANDS).toEqual(['16-17', '18-29', '30-39', '40-49', '50-59', '60+']);
    expect(COACH_COUNTER_FROM).toBe(1800);
  });
});

/** Une opération valide par variante du coach (toutes sauf `resume_slot`). */
const COACH_OPERATIONS = [
  { op: 'replace_exercise', slot: 'A1', exercise: 'goblet-squat' },
  { op: 'change_sets', slot: 'A1', delta: -1 },
  { op: 'set_rep_range', slot: 'A1', min: 8, max: 12 },
  { op: 'set_target_rir', slot: 'A1', value: 2 },
  { op: 'set_rest', slot: 'A1', seconds: 90 },
  { op: 'lighten_exercise', slot: 'A1' },
  { op: 'start_deload' },
  { op: 'suspend_slot', slot: 'A1' },
  { op: 'remove_slot', slot: 'A2' },
  { op: 'add_slot', workout: 'A', movementPattern: 'elbow_flexion', exercises: ['curl'] },
  { op: 'set_days_per_week', days: 3 },
  { op: 'switch_template', templateId: 'gym-beginner-full-body-ab' },
];

describe('CoachOperationSchema (§10, dérivé de OPERATION_AUTHORS)', () => {
  it('sans resume_slot : refusé, les 12 autres opérations acceptées', () => {
    expect(CoachOperationSchema.safeParse({ op: 'resume_slot', slot: 'a' }).success).toBe(false);
    expect(InstanceChangeOperationSchema.safeParse({ op: 'resume_slot', slot: 'a' }).success).toBe(true);
    expect(COACH_OPERATIONS).toHaveLength(12);
    for (const op of COACH_OPERATIONS) expect(CoachOperationSchema.safeParse(op).success, op.op).toBe(true);
  });

  it('chaque variante est celle de Programmes, bornes comprises', () => {
    const ops = CoachOperationSchema.options.map((o) => o.shape.op.value);
    const all = InstanceChangeOperationSchema.options.map((o) => o.shape.op.value);
    expect(ops).toEqual(all.filter((op) => op !== 'resume_slot'));
    expect(CoachOperationSchema.safeParse({ op: 'change_sets', slot: 'A1', delta: 2 }).success).toBe(false);
    expect(CoachOperationSchema.safeParse({ op: 'lighten_exercise', slot: 'A1', pct: 10 }).success).toBe(
      false,
    );
  });
});

describe("entrées d'outils (§10)", () => {
  it('ReadTrainingInput : since_days 28 accepté, 29 et 90 refusés avec « 28 jours au plus »', () => {
    expect(ReadTrainingInput.safeParse({ since_days: 28 }).success).toBe(true);
    expect(ReadTrainingInput.safeParse({ since_days: 1, exercise_id: 'goblet-squat' }).success).toBe(true);
    for (const since_days of [29, 90]) {
      const r = ReadTrainingInput.safeParse({ since_days });
      expect(r.success).toBe(false);
      expect(r.error?.issues.map((i) => i.message)).toEqual(['28 jours au plus']);
    }
    expect(ReadTrainingInput.safeParse({ since_days: 0 }).success).toBe(false);
    expect(ReadTrainingInput.safeParse({ since_days: 7.5 }).success).toBe(false);
    expect(ReadTrainingInput.safeParse({ since_days: 7, exercise_id: 'Goblet Squat' }).success).toBe(false);
    expect(ReadTrainingInput.safeParse({ since_days: 7, sinceDays: 7 }).success).toBe(false);
  });

  it('ProposeProgramChangeInput : 6 opérations et un motif de 301 caractères refusés', () => {
    const ok = { base_revision: 4, operations: [{ op: 'start_deload' }], reason: 'Tu récupères mal.' };
    expect(ProposeProgramChangeInput.safeParse(ok).success).toBe(true);
    const five = Array(5).fill({ op: 'start_deload' });
    expect(ProposeProgramChangeInput.safeParse({ ...ok, operations: five }).success).toBe(true);
    expect(ProposeProgramChangeInput.safeParse({ ...ok, operations: [...five, five[0]] }).success).toBe(
      false,
    );
    expect(ProposeProgramChangeInput.safeParse({ ...ok, operations: [] }).success).toBe(false);
    expect(ProposeProgramChangeInput.safeParse({ ...ok, reason: 'a'.repeat(300) }).success).toBe(true);
    expect(ProposeProgramChangeInput.safeParse({ ...ok, reason: 'a'.repeat(301) }).success).toBe(false);
    expect(ProposeProgramChangeInput.safeParse({ ...ok, reason: '' }).success).toBe(false);
    expect(ProposeProgramChangeInput.safeParse({ ...ok, base_revision: -1 }).success).toBe(false);
    const resume = { ...ok, operations: [{ op: 'resume_slot', slot: 'A1' }] };
    expect(ProposeProgramChangeInput.safeParse(resume).success).toBe(false);
  });

  it('SearchExercisesInput : tout facultatif, texte de 80 caractères au plus, codes de la taxonomie', () => {
    expect(SearchExercisesInput.safeParse({}).success).toBe(true);
    const full = {
      query: 'a'.repeat(80),
      muscle: 'quadriceps',
      movement_pattern: 'squat',
      available_equipment_only: false,
    };
    expect(SearchExercisesInput.safeParse(full).success).toBe(true);
    expect(SearchExercisesInput.safeParse({ query: 'a'.repeat(81) }).success).toBe(false);
    expect(SearchExercisesInput.safeParse({ muscle: 'mollet' }).success).toBe(false);
    expect(SearchExercisesInput.safeParse({ movementPattern: 'squat' }).success).toBe(false);
  });

  it("ReferToHelpInput : une ressource d'aide connue", () => {
    expect(ReferToHelpInput.safeParse({ resource: 'eating_disorder' }).success).toBe(true);
    expect(ReferToHelpInput.safeParse({ resource: 'nutrition' }).success).toBe(false);
  });
});

describe('texte du coach (§7.3, §16.2)', () => {
  it('nettoyage : contrôles et inversions de sens retirés sauf \\n, \\r\\n → \\n, espaces de bord retirés', () => {
    expect(cleanCoachText(' a\r\nb\u202Ec\u0007 ')).toBe('a\nbc');
    expect(cleanCoachText('\u202Aa\u202Bb\u202Cc\u202Dd\u2066e\u2067f\u2068g\u2069h')).toBe('abcdefgh');
    expect(cleanCoachText('a\u0000b\u001Fc\u007Fd\u0085e\tf\rg')).toBe('abcdefg');
    expect(cleanCoachText('\n\n un\n\ndeux \n')).toBe('un\n\ndeux');
    expect(cleanCoachText(' \u202E\u0007 ')).toBe('');
  });

  it('longueur en points de code (Review Focus 3)', () => {
    // 💪, 🏽 (modificateur de teinte), e, accent aigu combinant : 4 points de code, 6 unités UTF-16.
    expect(coachTextLength('\u{1F4AA}\u{1F3FD}e\u0301')).toBe(4);
    // Le même texte avec « é » précomposé : 3 points de code.
    expect(coachTextLength('\u{1F4AA}\u{1F3FD}\u00E9')).toBe(3);
    const flexes = '\u{1F4AA}'.repeat(1000);
    expect(flexes.length).toBe(2000);
    expect(coachTextLength(flexes)).toBe(1000);
  });
});

const NOW = '2026-11-03T10:00:00.000Z';
const THREAD_ID = '019a4a00-0000-7000-8000-000000000001';

/** Un exemple de chacun des 8 événements du §7.2, avec ses données. */
const EVENTS = [
  { type: 'text', text: 'Ta prochaine séance est la B. ' },
  { type: 'tool_running', tool: 'read_training' },
  {
    type: 'proposal',
    id: 'c-1',
    baseRevision: 4,
    operations: [{ op: 'set_rest', slot: 'A1', seconds: 120 }],
    reasonCode: 'COACH_PROPOSAL',
    reason: null,
    expiresAt: '2026-11-10T10:00:00.000Z',
  },
  { type: 'help_card', resource: 'distress' },
  { type: 'retry', reason: 'filter' },
  {
    type: 'done',
    threadId: THREAD_ID,
    userSeq: 3,
    assistantSeq: 4,
    truncated: false,
    replaced: false,
    proposalIds: ['c-1'],
    remainingToday: 28,
  },
  { type: 'refused', message: 'Le coach ne peut pas répondre à cette demande.' },
  { type: 'error', code: 'api_unavailable' },
];

describe('CoachStreamEventSchema (§7.2)', () => {
  it('chacun des 8 événements passe avec ses données', () => {
    expect(EVENTS.map((e) => e.type)).toEqual([
      'text',
      'tool_running',
      'proposal',
      'help_card',
      'retry',
      'done',
      'refused',
      'error',
    ]);
    for (const e of EVENTS) expect(CoachStreamEventSchema.parse(e), e.type).toEqual(e);
    const withReason = { ...EVENTS[2], reason: 'Tu récupères mal entre les séries.' };
    expect(CoachStreamEventSchema.safeParse(withReason).success).toBe(true);
  });

  it('error : chacun des 9 codes accepté, un code hors liste refusé', () => {
    for (const code of COACH_STREAM_ERROR_CODES)
      expect(CoachStreamEventSchema.safeParse({ type: 'error', code }).success, code).toBe(true);
    expect(CoachStreamEventSchema.safeParse({ type: 'error', code: 'boom' }).success).toBe(false);
    expect(CoachStreamEventSchema.safeParse({ type: 'error', code: 'daily_limit_reached' }).success).toBe(
      false,
    );
  });

  it('refuse un type inconnu, une donnée manquante ou en trop, une proposition hors des opérations du coach', () => {
    const proposal = EVENTS[2];
    const parse = (e: unknown) => CoachStreamEventSchema.safeParse(e).success;
    expect(parse({ type: 'typing' })).toBe(false);
    expect(parse({ type: 'text' })).toBe(false);
    expect(parse({ type: 'text', text: 'a', extra: 1 })).toBe(false);
    expect(parse({ type: 'tool_running', tool: 'open_nutrition_screen' })).toBe(false);
    expect(parse({ type: 'retry', reason: 'other' })).toBe(false);
    expect(parse({ ...proposal, reasonCode: 'USER_CHANGE' })).toBe(false);
    expect(parse({ ...proposal, operations: [{ op: 'resume_slot', slot: 'A1' }] })).toBe(false);
  });
});

const MESSAGE = {
  seq: 2,
  role: 'assistant',
  text: 'Ta prochaine séance est la B.',
  createdAt: NOW,
  aiGenerated: true,
  model: 'claude-opus-5-5',
  truncated: false,
  replaced: false,
  helpCards: [],
  proposalIds: ['c-1'],
  links: [],
};

describe('vues et requêtes (§7.1, §17.2)', () => {
  it('CoachMessageRequest : clientMessageId en UUIDv7', () => {
    const ok = { clientMessageId: '019a4a00-0000-7000-8000-000000000002', text: 'Salut' };
    expect(CoachMessageRequest.safeParse(ok).success).toBe(true);
    const v4 = { ...ok, clientMessageId: '019a4a00-0000-4000-8000-000000000002' };
    expect(CoachMessageRequest.safeParse(v4).success).toBe(false);
    expect(CoachMessageRequest.safeParse({ ...ok, threadId: THREAD_ID }).success).toBe(false);
  });

  it('CoachStatusView : les champs du §7.1', () => {
    const status = {
      available: true,
      unavailableReason: null,
      suspendedUntil: null,
      consent: { active: true, textVersion: '1.0', currentVersion: '1.0', needsRenewal: false },
      audience: 'minor',
      persona: 'skald',
      today: {
        threadId: THREAD_ID,
        open: true,
        closedReason: null,
        userMessageCount: 1,
        remaining: 29,
        inProgress: false,
      },
      budgetUsedPct: 12,
      devUnevaluated: false,
    };
    expect(CoachStatusView.parse(status)).toEqual(status);
    const off = { ...status, available: false, unavailableReason: 'suspended', suspendedUntil: NOW };
    expect(CoachStatusView.safeParse(off).success).toBe(true);
    expect(CoachStatusView.safeParse({ ...status, unavailableReason: 'broken' }).success).toBe(false);
  });

  it("CoachMessageView : jamais de message système ; CoachTodayResponse : le fil du jour, s'il existe", () => {
    expect(CoachMessageView.parse(MESSAGE)).toEqual(MESSAGE);
    expect(CoachMessageView.safeParse({ ...MESSAGE, role: 'system' }).success).toBe(false);
    const guided = { flow: 'loads', choices: ['goblet-squat', 'why'] };
    expect(CoachMessageView.parse({ ...MESSAGE, role: 'user', guided }).guided).toEqual(guided);
    expect(CoachMessageView.safeParse({ ...MESSAGE, guided: { flow: 'nope', choices: [] } }).success).toBe(
      false,
    );
    const thread = {
      id: THREAD_ID,
      day: '2026-11-03',
      audience: 'adult',
      persona: 'ombre',
      open: false,
      closedReason: 'version_change',
      userMessageCount: 1,
      createdAt: NOW,
    };
    const today = { thread, messages: [MESSAGE], inProgress: false };
    expect(CoachTodayResponse.parse(today)).toEqual(today);
    expect(CoachTodayResponse.safeParse({ thread: null, messages: [], inProgress: true }).success).toBe(true);
  });

  it('DisplayExtras : cartes, propositions, liens et remplacement', () => {
    const extras = {
      helpCards: ['pain'],
      proposalIds: ['c-1'],
      links: ['program', 'coach_help'],
      replaced: true,
    };
    expect(DisplayExtras.parse(extras)).toEqual(extras);
    expect(DisplayExtras.safeParse({ ...extras, links: ['settings'] }).success).toBe(false);
  });

  it('CoachReportRequest : messageSeq ≥ 1, catégorie connue, commentaire de 500 caractères au plus', () => {
    const ok = { threadId: THREAD_ID, messageSeq: 2, category: 'unsafe' };
    expect(CoachReportRequest.safeParse(ok).success).toBe(true);
    expect(CoachReportRequest.safeParse({ ...ok, comment: 'a'.repeat(500) }).success).toBe(true);
    expect(CoachReportRequest.safeParse({ ...ok, comment: 'a'.repeat(501) }).success).toBe(false);
    expect(CoachReportRequest.safeParse({ ...ok, messageSeq: 0 }).success).toBe(false);
    expect(CoachReportRequest.safeParse({ ...ok, category: 'spam' }).success).toBe(false);
  });

  it("administration : état, coûts du mois, compteurs anonymes ; détail d'un signalement", () => {
    const admin = {
      state: {
        enabled: true,
        suspendedUntil: null,
        configured: false,
        notConfiguredCause: 'not_evaluated',
        catalogChanged: false,
      },
      month: '2026-11',
      totalUsd: 1.23,
      workspaceLimitUsd: 20,
      members: [{ username: 'kevin', costUsd: 1.23, budgetUsd: 3 }],
      counters: [{ month: '2026-10', kind: 'filter_block', count: 2 }],
      openReports: 1,
    };
    expect(CoachAdminView.parse(admin)).toEqual(admin);
    const badCause = { ...admin, state: { ...admin.state, notConfiguredCause: 'no_price' } };
    expect(CoachAdminView.safeParse(badCause).success).toBe(false);
    const detail = {
      id: 'r-1',
      createdAt: NOW,
      category: 'inaccurate',
      username: 'kevin',
      minor: false,
      exchangeText: 'Toi : Salut\n\nCoach IA : Bonjour.',
      comment: null,
    };
    expect(CoachReportDetail.parse(detail)).toEqual(detail);
  });
});

/** Dossier complet : programme, deux lieux, une séance, records, santé. */
const BRIEF = {
  schema: 'coach-brief/2',
  today: '2026-11-03',
  audience: 'adult',
  age_band: '30-39',
  profile: {
    level: 'beginner',
    goal: 'strength',
    days_per_week: 3,
    session_minutes: 60,
    cautious_mode: false,
    engine_profile: 'adult',
    context: { kind: 'gym', sport_code: null },
  },
  places: [
    {
      name: 'lieu_1',
      kind: 'gym',
      primary: true,
      equipment: ['barbell', 'dumbbells'],
      load_settings: { bar_kg: 20, smallest_plate_kg: 1.25, machine_step_kg: 5 },
    },
    { name: 'lieu_2', kind: 'home', primary: false, equipment: [] },
  ],
  program: {
    template: { id: 'gym-beginner-full-body-ab', name: 'Salle · Débutant · Corps entier A/B', version: 1 },
    revision: 4,
    week: 3,
    block_week: null,
    next_workout_id: 'B',
    days_per_week: 3,
    workouts: [
      {
        id: 'A',
        name: 'Séance A',
        slots: [
          {
            id: 'A1',
            role: 'main',
            movement_pattern: 'squat',
            exercise: { id: 'goblet-squat', name: 'Squat gobelet' },
            sets: 3,
            reps: { min: 8, max: 12 },
            target_rir: 2,
            rest_s: 150,
            engine: { mode: 'double', load_kg: 14, target_reps: 10 },
            last_decision: {
              days_ago: 2,
              result: 'PROGRESS',
              reason_code: 'REPS_UP',
            },
          },
          {
            id: 'A5',
            role: 'accessory',
            movement_pattern: 'core_anti_extension',
            sets: 3,
            duration_s: { min: 20, max: 60 },
            target_rir: 2,
          },
          {
            id: 'A6',
            role: 'accessory',
            movement_pattern: 'calf_raise',
            exercise: { id: 'calf-raise', name: 'Mollets debout' },
            sets: 2,
            reps: { min: 10, max: 15 },
            target_rir: 2,
            rest_s: 60,
            engine: { mode: 'double', target_reps: 12, calibration_left: 1, suspended: true },
          },
        ],
      },
    ],
    pending_proposals: [{ author: 'engine', operations: [{ op: 'start_deload' }], days_left: 5 }],
    templates: [
      {
        id: 'gym-beginner-full-body-ab',
        name: 'Salle · Débutant · Corps entier A/B',
        summary: 'Deux séances qui alternent, 2 ou 3 fois par semaine.',
        context: 'gym',
        level: 'beginner',
        days_min: 2,
        days_max: 3,
      },
    ],
  },
  history: {
    sessions: [
      {
        days_ago: 2,
        name: 'Séance A',
        place: 'lieu_1',
        exercises: [
          {
            id: 'goblet-squat',
            name: 'Squat gobelet',
            sets: [
              [14, 10, null, 'ok'],
              [14, 9, null, null],
            ],
            pain: 'none',
          },
          { id: 'front-plank', name: 'Gainage ventral', sets: [[null, null, 40, 'hard']] },
        ],
        user_notes: 'Bonne séance.',
      },
    ],
    truncated: false,
  },
  records: [
    {
      exercise_id: 'goblet-squat',
      name: 'Squat gobelet',
      best_set: { load_kg: 14, reps: 10 },
      most_reps: 10,
      longest_s: null,
      e1rm_kg: 18.67,
    },
    { exercise_id: 'front-plank', name: 'Gainage ventral', best_set: null, most_reps: null, longest_s: 40 },
  ],
  health: { limitations: [{ area: 'knee', side: 'left', severity: 'mild', note: null }] },
  nutrition: {
    mode: 'qualitative',
    directives: ['no_deficit', 'no_numbers'],
    sheets: [{ id: 'hydration', title: 'Bien boire' }],
  },
};

const TARGET = {
  energy_kcal: 2400,
  energy_min_kcal: 2300,
  energy_max_kcal: 2500,
  protein_min_g: 130,
  protein_max_g: 175,
  fat_min_g: 65,
  carbs_g: 300,
  fiber_g: 30,
  water_ml: 2500,
  effective_goal: 'lose',
  applied_rules: ['bmr_floor'],
  algo_version: 'nutri-1.0.0',
  days_ago: 3,
};

describe('CoachBriefSchema (coach-brief/2, §9 et brique 5 §11.1)', () => {
  it('bloc nutrition complet (mode full) passe', () => {
    const full = {
      mode: 'full',
      directives: [],
      sheets: [],
      target: TARGET,
      weekly_change: [
        { weeks_ago: 1, change_pct: -0.4 },
        { weeks_ago: 2, change_pct: null },
      ],
      last_checkin: { weeks_ago: 1, decision: 'proposal', proposed_delta_kcal: -100 },
    };
    expect(CoachBriefSchema.parse({ ...BRIEF, nutrition: full })).toEqual({ ...BRIEF, nutrition: full });
  });

  it('refuse une clé hors liste dans le bloc nutrition (pesée, bmr, tdee, mode_reason) et nutrition: null', () => {
    const parse = (n: unknown) => CoachBriefSchema.safeParse({ ...BRIEF, nutrition: n }).success;
    const base = { mode: 'full', directives: [], sheets: [], target: TARGET };
    expect(parse(base)).toBe(true);
    expect(parse({ ...base, weight_g: 70000 })).toBe(false);
    expect(parse({ ...base, mode_reason: 'x' })).toBe(false);
    expect(parse({ ...base, target: { ...TARGET, bmr_kcal: 1700 } })).toBe(false);
    expect(parse({ ...base, target: { ...TARGET, tdee_kcal: 2400 } })).toBe(false);
    expect(parse(null)).toBe(false);
    expect(parse({ ...base, last_checkin: { weeks_ago: 1, decision: 'proposal', response: null } })).toBe(
      false,
    );
  });

  it('CoachBriefStoredSchema relit un dossier coach-brief/1 (nutrition: null) et un coach-brief/2', () => {
    const v1 = { ...BRIEF, schema: 'coach-brief/1', nutrition: null };
    expect(CoachBriefStoredSchema.parse(v1)).toEqual(v1);
    expect(CoachBriefSchema.safeParse(v1).success).toBe(false);
    expect(CoachBriefStoredSchema.parse(BRIEF)).toEqual(BRIEF);
    expect(CoachBriefStoredSchema.safeParse({ ...v1, nutrition: {} }).success).toBe(false);
  });
});

describe('CoachBriefSchema (socle coach-brief/1, §9)', () => {
  it('un dossier complet passe', () => {
    expect(CoachBriefSchema.parse(BRIEF)).toEqual(BRIEF);
  });

  it('une séance à place: null (lieu inconnu) passe aussi ; un membre sans programme ni lieu ni séance aussi', () => {
    const [session] = BRIEF.history.sessions;
    const unknownPlace = { ...BRIEF, history: { ...BRIEF.history, sessions: [{ ...session, place: null }] } };
    expect(CoachBriefSchema.safeParse(unknownPlace).success).toBe(true);
    const { health: _health, ...noHealth } = BRIEF;
    const empty = {
      ...noHealth,
      places: [],
      program: null,
      history: { sessions: [], truncated: false },
      records: [],
    };
    expect(CoachBriefSchema.safeParse(empty).success).toBe(true);
  });

  it('refuse une clé pseudo, un lieu nommé ou identifié, une date de naissance, un bloc nutrition vide', () => {
    const [primary] = BRIEF.places;
    const parse = (b: unknown) => CoachBriefSchema.safeParse(b).success;
    expect(parse({ ...BRIEF, pseudo: 'kevin' })).toBe(false);
    expect(parse({ ...BRIEF, places: [{ ...primary, name: 'Salle Canari' }] })).toBe(false);
    expect(parse({ ...BRIEF, places: [{ ...primary, id: 'place-1' }] })).toBe(false);
    expect(parse({ ...BRIEF, profile: { ...BRIEF.profile, birth_date: '2001-07-13' } })).toBe(false);
    expect(parse({ ...BRIEF, schema: 'coach-brief/3' })).toBe(false);
    expect(parse({ ...BRIEF, nutrition: {} })).toBe(false);
  });

  it('dernière décision : le code seul, sans sa phrase (la table REASON_TEXTS est dans le prompt)', () => {
    type Slots = { last_decision?: Record<string, unknown> }[];
    const brief = structuredClone(BRIEF) as unknown as { program: { workouts: { slots: Slots }[] } };
    const decision = brief.program.workouts[0]?.slots.find(
      (s) => s.last_decision !== undefined,
    )?.last_decision;
    if (!decision) throw new Error('décision absente');
    decision.reason_text = REASON_TEXTS.REPS_UP;
    expect(CoachBriefSchema.safeParse(brief).success).toBe(false);
  });

  it('slots compacts : ni champ nul, ni valeur par défaut écrite', () => {
    type Slot = Record<string, unknown> & { engine: Record<string, unknown> };
    const withSlot = (patch: Record<string, unknown>, engine: Record<string, unknown> = {}) => {
      const brief = structuredClone(BRIEF) as unknown as { program: { workouts: { slots: Slot[] }[] } };
      const slots = brief.program.workouts[0]?.slots ?? [];
      const [first] = slots;
      if (first === undefined) throw new Error('slot absent');
      slots[0] = { ...first, engine: { ...first.engine, ...engine }, ...patch };
      return CoachBriefSchema.safeParse(brief).success;
    };
    expect(withSlot({})).toBe(true);
    for (const key of ['exercise', 'reps', 'duration_s', 'rest_s', 'engine', 'last_decision']) {
      expect(withSlot({ [key]: null }), key).toBe(false);
    }
    for (const key of ['load_kg', 'target_reps', 'variant_rank', 'duration_s']) {
      expect(withSlot({}, { [key]: null }), key).toBe(false);
    }
    expect(withSlot({}, { suspended: false })).toBe(false);
    expect(withSlot({}, { calibration_left: 0 })).toBe(false);
  });

  it('CoachBriefResponse : le dossier analysé, ou null après le retrait santé', () => {
    const stored = { brief: BRIEF, threadId: THREAD_ID, day: '2026-11-03', preview: false };
    expect(CoachBriefResponse.parse(stored)).toEqual(stored);
    const preview = { brief: BRIEF, threadId: null, day: '2026-11-03', preview: true };
    expect(CoachBriefResponse.safeParse(preview).success).toBe(true);
    expect(CoachBriefResponse.safeParse({ ...stored, brief: null }).success).toBe(true);
    expect(CoachBriefResponse.safeParse({ ...stored, brief: JSON.stringify(BRIEF) }).success).toBe(false);
  });
});
