import { AI_COACH_CONSENT_TEXT } from '@rune/contracts';
import { estimateTokens, sortedJson } from '@rune/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { openTodayThread } from '../../../src/coach/threads';
import { runTool } from '../../../src/coach/tools';
import { fitReadTraining, type ReadTrainingResult } from '../../../src/coach/tools/read-training';
import { grantConsent } from '../../../src/privacy/consent';
import { insertConsentEvent } from '../../../src/privacy/consent-state';
import {
  createLogger,
  createTestContext,
  createUserAndLogin,
  insertFixtureRow,
  seedSheet,
  sheetFixture,
  syncPush,
  type TestContext,
} from '../../support';
import { toolContext } from '../../support/coach';
import {
  dayAt,
  enroll,
  grantHealth,
  PROGRAM_SHEETS,
  programTemplate,
  type SessionSpec,
  seedProgramCatalog,
  sessionOps,
} from '../../support/program';
import { rebuild } from '../../support/review';

/*
 * `read_training` (spec brique 4 §10, choix C49) : 28 jours au plus, formes du dossier, douleur seulement avec
 * l'accord santé actif à l'instant de l'appel, pas d'e1rm pour un mineur, séances les plus anciennes retirées
 * au-delà de 4 000 jetons estimés, slots sous les alias de la table figée du fil.
 */

type Member = Awaited<ReturnType<typeof createUserAndLogin>>;
type Row = Record<string, unknown>;

const NOW = '2026-11-05T10:00:00.000Z';
const TEMPLATE = programTemplate();
/** 8 octobre, 28 jours avant le 5 novembre ; le 7, 29 jours ; le 4 novembre, la veille. */
const DAY_28 = 37;
const DAY_29 = 36;
const YESTERDAY = 64;
/** Changements `add_slot` acceptés (UUIDv7 : leur identifiant ne doit jamais sortir). */
const FIRST_ADD = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a01';
const SECOND_ADD = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a02';
/** Toute forme d'UUID, n'importe où dans une chaîne (le canari du dossier). */
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup(o: { birthDate?: string; lines?: string[] } = {}): Promise<Member> {
  const lines = o.lines;
  ctx = await createTestContext({
    now: NOW,
    ...(lines === undefined ? {} : { deps: { logger: createLogger((l) => lines.push(l)) } }),
  });
  await seedProgramCatalog(ctx, [TEMPLATE]);
  return createUserAndLogin(ctx, o.birthDate === undefined ? {} : { birthDate: o.birthDate });
}

async function push(u: Member, ...specs: SessionSpec[]): Promise<void> {
  const ops = specs.flatMap((spec) => sessionOps(u.id, spec).ops);
  const res = await syncPush(ctx, u.cookie, ops);
  expect(res.status).toBe(200);
  expect(res.body.results.every((r: Row) => r.status === 'applied')).toBe(true);
}

const grantCoach = (userId: string) =>
  grantConsent(ctx.deps.db, ctx.deps, userId, 'ai_coach', AI_COACH_CONSENT_TEXT.version, null);

type Thread = { id?: string; audience?: 'adult' | 'minor' };

async function read(userId: string, input: unknown, thread?: Thread) {
  const tc = toolContext(ctx, userId, thread === undefined ? {} : { thread });
  return runTool('read_training', input, tc);
}

/** Résultat d'un appel réussi. */
async function result(userId: string, input: unknown, thread?: Thread): Promise<Row> {
  const outcome = await read(userId, input, thread);
  expect(outcome.isError).toBe(false);
  return outcome.result as Row;
}

/** `add_slot` accepté sur la séance A de l'instance, décidé à `decidedAt`. */
function addSlot(ownerId: string, instanceId: string, id: string, decidedAt: string) {
  return insertFixtureRow(ctx.deps.db, 'instance_change', {
    id,
    ownerId,
    instanceId,
    status: 'accepted',
    author: 'user',
    reasonCode: 'USER_CHANGE',
    operations: JSON.stringify([
      { op: 'add_slot', workout: 'A', movementPattern: 'squat', exercises: ['leg-press'] },
    ]),
    decidedAt,
  });
}

const slotIds = (r: Row): string[] =>
  ((r.program as { workouts: { slots: { id: string }[] }[] }).workouts[0]?.slots ?? []).map((s) => s.id);

describe('read_training : période', () => {
  it('since_days 28 accepté ; 29 et 90 refusés par le schéma, « 28 jours au plus »', async () => {
    const u = await setup();
    expect((await read(u.id, { since_days: 28 })).isError).toBe(false);
    for (const since_days of [29, 90]) {
      const outcome = await read(u.id, { since_days });
      expect(outcome.isError).toBe(true);
      expect(outcome.result).toMatchObject({
        error: 'invalid_input',
        issues: [{ path: 'since_days', message: '28 jours au plus' }],
      });
    }
  });

  it("la séance d'il y a 29 jours est absente ; since_days restreint la période", async () => {
    const u = await setup();
    await push(
      u,
      { instanceId: null, startedAt: dayAt(DAY_29), exercises: [{ slotId: null }] },
      { instanceId: null, startedAt: dayAt(DAY_28), exercises: [{ slotId: null }] },
      { instanceId: null, startedAt: dayAt(YESTERDAY), exercises: [{ slotId: null }] },
    );
    const all = await result(u.id, { since_days: 28 });
    expect((all.sessions as Row[]).map((s) => s.days_ago)).toEqual([1, 28]);
    const week = await result(u.id, { since_days: 7 });
    expect((week.sessions as Row[]).map((s) => s.days_ago)).toEqual([1]);
  });

  it('exercise_id : séances, décisions et records de cet exercice seulement', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    await push(u, {
      instanceId,
      startedAt: dayAt(YESTERDAY),
      exercises: [{}, { exerciseId: 'dumbbell-romanian-deadlift' }],
    });
    const r = await result(u.id, { since_days: 28, exercise_id: 'dumbbell-romanian-deadlift' });
    const sessions = r.sessions as { exercises: { id: string }[] }[];
    expect(sessions.flatMap((s) => s.exercises.map((e) => e.id))).toEqual(['dumbbell-romanian-deadlift']);
    expect((r.decisions as Row[]).map((d) => [d.slot, d.exercise_id])).toEqual([
      ['A2', 'dumbbell-romanian-deadlift'],
    ]);
    expect((r.records as Row[]).map((rec) => rec.exercise_id)).toEqual(['dumbbell-romanian-deadlift']);
  });
});

describe("read_training : santé et âge à l'instant de l'appel", () => {
  it('accord santé actif → pain ; retiré entre deux appels → absent, relu en base', async () => {
    const u = await setup();
    await grantHealth(ctx, u.id);
    await grantCoach(u.id);
    await push(u, {
      instanceId: null,
      startedAt: dayAt(YESTERDAY),
      exercises: [{ slotId: null, painLevel: 'discomfort' }],
    });
    const before = await result(u.id, { since_days: 7 });
    expect((before.sessions as { exercises: Row[] }[])[0]?.exercises[0]?.pain).toBe('discomfort');

    // Retrait sans l'effacement qui le suit : la douleur est encore en base, seul l'accord a changé.
    await insertConsentEvent(ctx.deps.db, ctx.deps, u.id, 'health', 'withdraw', '1.0');
    const after = await result(u.id, { since_days: 7 });
    expect(after.sessions).toHaveLength(1);
    expect(JSON.stringify(after)).not.toContain('"pain"');
  });

  it('mineur : aucun e1rm_kg ; adulte : e1rm_kg', async () => {
    const minor = await setup({ birthDate: '2009-06-01' });
    const adult = await createUserAndLogin(ctx);
    for (const u of [minor, adult]) {
      await push(u, {
        instanceId: null,
        startedAt: dayAt(YESTERDAY),
        exercises: [{ slotId: null, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5, effort: 'ok' }] }],
      });
    }
    const ofMinor = await result(minor.id, { since_days: 28 });
    expect(ofMinor.records).not.toEqual([]);
    expect(JSON.stringify(ofMinor)).not.toContain('e1rm_kg');
    const ofAdult = await result(adult.id, { since_days: 28 });
    expect((ofAdult.records as Row[])[0]).toHaveProperty('e1rm_kg');
  });

  it('fil minor le jour des 18 ans : mineur pour les deux outils (ni e1rm_kg, ni fiche not_for_minors)', async () => {
    // Né le 5 novembre 2008 : adulte à l'instant de l'appel, mais le fil a été ouvert pour un mineur.
    const u = await setup({ birthDate: '2008-11-05' });
    await seedSheet(
      ctx,
      sheetFixture('box-jump', { equipment_options: [[]], load_mode: 'bodyweight', not_for_minors: true }),
    );
    await rebuild(ctx, [TEMPLATE]);
    await push(u, {
      instanceId: null,
      startedAt: dayAt(YESTERDAY),
      exercises: [{ slotId: null, sets: [{ reps: 5 }, { reps: 5 }, { reps: 5, effort: 'ok' }] }],
    });
    const asMinor = await result(u.id, { since_days: 28 }, { audience: 'minor' });
    expect(asMinor.records).not.toEqual([]);
    expect(JSON.stringify(asMinor)).not.toContain('e1rm_kg');
    expect((await result(u.id, { since_days: 28 })).records).toEqual([
      expect.objectContaining({ e1rm_kg: expect.any(Number) }),
    ]);

    const search = async (audience: 'adult' | 'minor') => {
      const outcome = await runTool('search_exercises', {}, toolContext(ctx, u.id, { thread: { audience } }));
      return (outcome.result as { exercises: { id: string }[] }).exercises.map((e) => e.id);
    };
    expect(await search('minor')).not.toContain('box-jump');
    expect(await search('adult')).toContain('box-jump');
  });
});

describe('read_training : taille', () => {
  it('60 séances : truncated, 4 000 jetons au plus, les plus récentes gardées avec leurs décisions', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    const specs: SessionSpec[] = Array.from({ length: 60 }, (_, i) => ({
      instanceId,
      startedAt: dayAt(DAY_28 + (i % 28), Math.floor(i / 28)),
      exercises: [{}, { exerciseId: 'dumbbell-romanian-deadlift' }],
    }));
    for (let i = 0; i < specs.length; i += 20) await push(u, ...specs.slice(i, i + 20));

    const r = await result(u.id, { since_days: 28 });
    expect(r.truncated).toBe(true);
    expect(estimateTokens(sortedJson(r))).toBeLessThanOrEqual(4000);
    const sessions = r.sessions as Row[];
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.length).toBeLessThan(60);
    expect(sessions[0]?.days_ago).toBe(1);
    const oldest = sessions.at(-1)?.days_ago as number;
    const decisions = r.decisions as Row[];
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((d) => (d.days_ago as number) <= oldest)).toBe(true);
    expect(r.program).not.toBeNull();
  });

  it('petite lecture : truncated faux', async () => {
    const u = await setup();
    await push(u, { instanceId: null, startedAt: dayAt(YESTERDAY), exercises: [{ slotId: null }] });
    expect((await result(u.id, { since_days: 28 })).truncated).toBe(false);
  });

  /** Plafond de `read_training` abaissé à `max` jetons. */
  const lowerLimit = (max: number) => {
    const config = ctx.deps.coachConfig;
    ctx.deps.coachConfig = { ...config, limits: { ...config.limits, readTrainingMaxTokens: max } };
  };

  it('plafond dépassé après les séances : records coupés à 10, programme intact, truncated', async () => {
    const u = await setup();
    const extras = Array.from({ length: 6 }, (_, i) => `extra-${i + 1}`);
    for (const id of extras) await seedSheet(ctx, sheetFixture(id, { equipment_options: [[]] }));
    await rebuild(ctx, [TEMPLATE]);
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    const all = [...PROGRAM_SHEETS.map((s) => s.id), ...extras];
    await push(
      u,
      {
        instanceId,
        startedAt: dayAt(YESTERDAY - 1),
        exercises: [{}, { exerciseId: 'dumbbell-romanian-deadlift' }],
      },
      {
        instanceId: null,
        startedAt: dayAt(YESTERDAY),
        exercises: all.map((exerciseId) => ({ slotId: null, exerciseId })),
      },
    );
    const full = await result(u.id, { since_days: 28 });
    expect(full.truncated).toBe(false);
    expect((full.records as Row[]).length).toBe(all.length);
    expect(full.decisions).not.toEqual([]);

    lowerLimit(300);
    const r = await result(u.id, { since_days: 28 });
    expect(r.sessions).toEqual([]);
    expect(r.decisions).toEqual([]);
    expect(r.records).toEqual((full.records as Row[]).slice(0, 10));
    expect(r.program).toEqual(full.program);
    expect(r.pending_proposals).toEqual(full.pending_proposals);
    // Le programme seul dépasse le plafond : il n'est jamais coupé, et le résultat le dit.
    expect(estimateTokens(sortedJson(r))).toBeGreaterThan(300);
    expect(r.truncated).toBe(true);
  });

  it('sans séance au départ et au-dessus du plafond : truncated', async () => {
    const u = await setup();
    await enroll(ctx, u.id, TEMPLATE);
    lowerLimit(50);
    const r = await result(u.id, { since_days: 28 });
    expect(r.sessions).toEqual([]);
    expect(r.program).not.toBeNull();
    expect(r.truncated).toBe(true);
  });

  it('fitReadTraining : les décisions les plus anciennes en dernier recours ; rien à couper → inchangé', () => {
    const decision = (days_ago: number) => ({
      days_ago,
      slot: 'A1',
      exercise_id: 'goblet-squat',
      result: 'PROGRESS' as const,
      reason_code: 'LOAD_UP' as const,
    });
    const base: ReadTrainingResult = {
      revision: null,
      program: null,
      sessions: [],
      decisions: Array.from({ length: 30 }, (_, i) => decision(i)),
      records: [],
      pending_proposals: [],
      truncated: false,
    };
    const cut = fitReadTraining(base, 300);
    expect(cut.truncated).toBe(true);
    expect(estimateTokens(sortedJson(cut))).toBeLessThanOrEqual(300);
    expect(cut.decisions.length).toBeGreaterThan(0);
    expect(cut.decisions).toEqual(base.decisions.slice(0, cut.decisions.length));
    expect(fitReadTraining(base, 4000)).toBe(base);
  });
});

describe('read_training : programme et alias du fil', () => {
  it('membre sans programme ni séance (Review Focus 4) : program null, listes vides', async () => {
    const u = await setup();
    expect(await read(u.id, { since_days: 28 })).toEqual({
      isError: false,
      result: {
        revision: null,
        program: null,
        sessions: [],
        decisions: [],
        records: [],
        pending_proposals: [],
        truncated: false,
      },
    });
  });

  it('programme, révision et propositions en attente : ceux du dossier du fil, alias compris', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    await addSlot(u.id, instanceId, FIRST_ADD, '2026-11-01T10:00:00.000Z');
    await insertFixtureRow(ctx.deps.db, 'instance_change', {
      ownerId: u.id,
      instanceId,
      author: 'engine',
      reasonCode: 'STALL',
      operations: JSON.stringify([{ op: 'set_rest', slot: `A-${FIRST_ADD}`, seconds: 60 }]),
      expiresAt: '2026-11-08T10:00:00.000Z',
    });
    await push(u, { instanceId, startedAt: dayAt(YESTERDAY), exercises: [{}] });
    const thread = await openTodayThread(ctx.deps, u.id, ctx.clock.now());
    const brief = JSON.parse(thread.brief ?? '') as { program: Row };

    const r = await result(u.id, { since_days: 28 }, thread);
    expect(r.program).toEqual(brief.program);
    expect(r.revision).toBe(brief.program.revision);
    expect(r.pending_proposals).toEqual(brief.program.pending_proposals);
    expect(r.pending_proposals).toEqual([
      { author: 'engine', operations: [{ op: 'set_rest', slot: 'A-x1', seconds: 60 }], days_left: 3 },
    ]);
    expect(JSON.stringify(r)).not.toContain(FIRST_ADD);
  });

  it('table figée du fil : alias gardé ; slot ajouté après le gel au-delà du plus grand', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    await addSlot(u.id, instanceId, FIRST_ADD, '2026-11-01T10:00:00.000Z');
    await addSlot(u.id, instanceId, SECOND_ADD, '2026-11-05T09:00:00.000Z');
    const thread = await insertFixtureRow(ctx.deps.db, 'coach_thread', {
      userId: u.id,
      day: '2026-11-05',
      slotAliases: JSON.stringify({ 'A-x3': `A-${FIRST_ADD}` }),
    });

    const frozen = await result(u.id, { since_days: 28 }, { id: thread.id as string });
    expect(slotIds(frozen).slice(-2)).toEqual(['A-x3', 'A-x4']);
    // Sans fil en base, pas de table figée : les alias du rang.
    expect(slotIds(await result(u.id, { since_days: 28 })).slice(-2)).toEqual(['A-x1', 'A-x2']);
    // Le fil d'un autre ne prête pas sa table.
    const other = await createUserAndLogin(ctx);
    const foreign = await insertFixtureRow(ctx.deps.db, 'coach_thread', {
      userId: other.id,
      day: '2026-11-05',
      slotAliases: JSON.stringify({ 'A-x7': `A-${FIRST_ADD}` }),
    });
    expect(slotIds(await result(u.id, { since_days: 28 }, { id: foreign.id as string })).slice(-2)).toEqual([
      'A-x1',
      'A-x2',
    ]);
    expect(JSON.stringify(frozen)).not.toContain(FIRST_ADD);
    expect(JSON.stringify(frozen)).not.toContain(SECOND_ADD);
  });

  it('slot ajouté, travaillé une fois, puis retiré : aucun UUID dans read_training ni dans search_exercises', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    await addSlot(u.id, instanceId, FIRST_ADD, '2026-11-01T10:00:00.000Z');
    await push(u, {
      instanceId,
      startedAt: dayAt(YESTERDAY),
      exercises: [{}, { slotId: `A-${FIRST_ADD}`, exerciseId: 'leg-press' }],
    });
    await insertFixtureRow(ctx.deps.db, 'instance_change', {
      ownerId: u.id,
      instanceId,
      status: 'accepted',
      author: 'user',
      reasonCode: 'USER_CHANGE',
      operations: JSON.stringify([{ op: 'remove_slot', slot: `A-${FIRST_ADD}` }]),
      decidedAt: '2026-11-05T09:00:00.000Z',
    });
    // Le fil s'ouvre après le retrait : sa table figée ne connaît pas le slot.
    const thread = await openTodayThread(ctx.deps, u.id, ctx.clock.now());
    expect(thread.slotAliases).toBe('{}');

    const r = await result(u.id, { since_days: 28 }, thread);
    expect(slotIds(r)).not.toContain(`A-${FIRST_ADD}`);
    const decision = (r.decisions as Row[]).find((d) => d.exercise_id === 'leg-press');
    // Espace distinct des slots retirés (ruling de la tâche 18) : jamais un alias `A-x<n>` d'un slot ajouté.
    expect(decision?.slot).toMatch(/^R-x\d+$/);
    expect(JSON.stringify(r)).not.toMatch(UUID_ANYWHERE);

    const found = await runTool(
      'search_exercises',
      { available_equipment_only: false },
      toolContext(ctx, u.id),
    );
    expect(found.isError).toBe(false);
    expect(JSON.stringify(found)).not.toMatch(UUID_ANYWHERE);
  });
});

describe('read_training : journaux', () => {
  it('rien du contenu dans les journaux, même quand le rejeu est écarté', async () => {
    const lines: string[] = [];
    const u = await setup({ lines });
    await grantHealth(ctx, u.id);
    await grantCoach(u.id);
    await push(u, {
      instanceId: null,
      startedAt: dayAt(YESTERDAY),
      exercises: [{ slotId: null, painLevel: 'discomfort' }],
    });
    // Changement accepté illisible : le programme est écarté, et journalisé par son seul code.
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    await insertFixtureRow(ctx.deps.db, 'instance_change', {
      ownerId: u.id,
      instanceId,
      status: 'accepted',
      operations: '[{"op":"inconnue"}]',
    });
    lines.length = 0;
    const r = await result(u.id, { since_days: 28 });
    expect(r.program).toBeNull();
    await runTool('search_exercises', { query: 'goblet' }, toolContext(ctx, u.id));
    expect(lines.join('\n')).toContain('coach_replay_skipped');
    expect(lines.join('\n')).not.toMatch(/goblet|Exercice|Séance|discomfort|lieu_|days_ago/i);
    expect(lines.join('\n')).not.toContain(u.id);
  });
});
