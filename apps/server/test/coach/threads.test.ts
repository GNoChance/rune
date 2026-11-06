import { AI_COACH_CONSENT_TEXT } from '@rune/contracts';
import { buildCoachBrief, sortedJson } from '@rune/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBriefInput } from '../../src/coach/brief-input';
import { COACH_STARTUP_TASK } from '../../src/coach/state';
import {
  COACH_THREADS_STARTUP_TASK,
  closeIfFrozenStale,
  currentVersions,
  deleteAllThreads,
  deleteThread,
  openTodayThread,
  threadSlotAliases,
  todayThread,
} from '../../src/coach/threads';
import { HttpError } from '../../src/http/errors';
import { grantConsent } from '../../src/privacy/consent';
import { STARTUP_TASKS } from '../../src/startup';
import { createLogger, createTestContext, createUser, insertFixtureRow, type TestContext } from '../support';
import { enroll, programTemplate, seedProgramCatalog } from '../support/program';

/*
 * Fils du coach (spec brique 4 §6.4) : ouverture au premier message du jour de Paris (public, voix, versions,
 * dossier figé avec la table des alias), gel, tâche de démarrage, suppression et détachement des fils.
 */

type Row = Record<string, unknown>;

const NOW = '2026-11-05T10:00:00.000Z';

let ctx: TestContext;
let lines: string[];
afterEach(() => ctx?.close());

async function setup(now = NOW): Promise<TestContext> {
  lines = [];
  ctx = await createTestContext({ now, deps: { logger: createLogger((l) => lines.push(l)) } });
  return ctx;
}

const rowsOf = (sql: string, ...params: string[]) => ctx.deps.sqlite.prepare(sql).all(...params) as Row[];
const rowOf = (table: string, id: string) =>
  ctx.deps.sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
const open = (userId: string) => openTodayThread(ctx.deps, userId, ctx.clock.now());

describe('openTodayThread', () => {
  it('requireConsent : sans accord ai_coach actif, aucun fil neuf (consent_required) ; un fil existant se rend', async () => {
    await setup();
    const user = await createUser(ctx);
    const strict = () => openTodayThread(ctx.deps, user.id, ctx.clock.now(), { requireConsent: true });
    await expect(strict()).rejects.toMatchObject({ code: 'consent_required', status: 403 });
    expect(rowsOf('SELECT id FROM coach_thread')).toEqual([]);

    await grantConsent(ctx.deps.db, ctx.deps, user.id, 'ai_coach', AI_COACH_CONSENT_TEXT.version, null);
    const thread = await strict();
    expect(rowsOf('SELECT id FROM coach_thread')).toHaveLength(1);
    // Le fil existe : rendu tel quel, sans relire l'accord.
    ctx.deps.sqlite.exec("DELETE FROM consent_event WHERE type = 'ai_coach'");
    expect((await strict()).id).toBe(thread.id);
  });

  it('ouverture concurrente : les deux appels rendent le même fil, une seule ligne', async () => {
    await setup();
    const user = await createUser(ctx);
    const [a, b] = await Promise.all([open(user.id), open(user.id)]);
    expect(a.id).toBe(b.id);
    expect(rowsOf('SELECT id FROM coach_thread')).toHaveLength(1);
    expect((await open(user.id)).id).toBe(a.id);
    expect(a).toMatchObject({
      userId: user.id,
      day: '2026-11-05',
      isOpen: 1,
      closedReason: null,
      userMessageCount: 0,
      createdAt: NOW,
      lastMessageAt: null,
      ...currentVersions(ctx.deps, 'adult'),
    });
    expect(await todayThread(ctx.deps.db, user.id, '2026-11-05')).toEqual(a);
  });

  it('public : né le 2008-11-04, mineur la veille de ses 18 ans, adulte dès minuit à Paris', async () => {
    await setup('2026-11-03T10:00:00.000Z');
    const user = await createUser(ctx, { birthDate: '2008-11-04' });
    const before = await open(user.id);
    expect(before).toMatchObject({ day: '2026-11-03', audience: 'minor', promptVersion: 'coach-3/minor' });
    expect(JSON.parse(before.brief ?? '')).toMatchObject({ audience: 'minor', age_band: '16-17' });

    // 23 h 30 UTC le 3 : déjà le 4 à Paris.
    ctx.clock.set('2026-11-03T23:30:00.000Z');
    const after = await open(user.id);
    expect(after).toMatchObject({ day: '2026-11-04', audience: 'adult', promptVersion: 'coach-3/adult' });
    expect(JSON.parse(after.brief ?? '')).toMatchObject({ audience: 'adult', age_band: '18-29' });
  });

  it('voix : celle du profil, scribe si elle est nulle ou sans profil', async () => {
    await setup();
    const skald = await createUser(ctx);
    await insertFixtureRow(ctx.deps.db, 'training_profile', { ownerId: skald.id, coach: 'skald' });
    const nulle = await createUser(ctx);
    await insertFixtureRow(ctx.deps.db, 'training_profile', { ownerId: nulle.id, coach: null });
    const sans = await createUser(ctx);
    expect((await open(skald.id)).persona).toBe('skald');
    expect((await open(nulle.id)).persona).toBe('scribe');
    expect((await open(sans.id)).persona).toBe('scribe');
  });

  it('alias figés avec le fil : JSON trié, relu par threadSlotAliases, absents du dossier', async () => {
    await setup();
    const user = await createUser(ctx);
    const template = programTemplate();
    await seedProgramCatalog(ctx, [template]);
    const instanceId = await enroll(ctx, user.id, template);
    const added: string[] = [];
    for (const [i, exercise] of ['leg-press', 'goblet-squat'].entries()) {
      const change = await insertFixtureRow(ctx.deps.db, 'instance_change', {
        ownerId: user.id,
        instanceId,
        status: 'accepted',
        operations: JSON.stringify([
          { op: 'add_slot', workout: 'A', movementPattern: 'squat', exercises: [exercise] },
        ]),
        decidedAt: `2026-10-0${i + 1}T10:00:00.000Z`,
      });
      added.push(`A-${change.id as string}`);
    }
    const thread = await open(user.id);
    const expected = new Map([
      ['A-x1', added[0] ?? ''],
      ['A-x2', added[1] ?? ''],
    ]);
    expect(thread.slotAliases).toBe(sortedJson(Object.fromEntries(expected)));
    expect(threadSlotAliases(thread)).toEqual(expected);
    const built = buildCoachBrief(await loadBriefInput(ctx.deps.db, ctx.deps, user.id, ctx.clock.now()));
    expect(threadSlotAliases(thread)).toEqual(built.slotAliases);
    for (const id of added) expect(thread.brief).not.toContain(id);
    expect(thread.brief).toContain('"A-x1"');
  });

  it('sans slot ajouté : table vide', async () => {
    await setup();
    const thread = await open((await createUser(ctx)).id);
    expect(thread.slotAliases).toBe('{}');
    expect(threadSlotAliases(thread)).toEqual(new Map());
  });

  it('dossier trop gros : coach_brief_oversize journalisé avec les seuls jetons estimés, fil ouvert quand même', async () => {
    await setup();
    const user = await createUser(ctx);
    const template = programTemplate();
    await seedProgramCatalog(ctx, [template]);
    const instanceId = await enroll(ctx, user.id, template);
    const heavy = Array.from({ length: 5 }, () => ({
      op: 'add_slot',
      workout: 'A',
      movementPattern: 'squat',
      exercises: Array.from({ length: 12 }, (_, i) => `exercice-tres-long-numero-${i + 1}`),
    }));
    for (let i = 0; i < 12; i += 1) {
      await insertFixtureRow(ctx.deps.db, 'instance_change', {
        ownerId: user.id,
        instanceId,
        author: 'engine',
        reasonCode: 'STALL',
        operations: JSON.stringify(heavy),
        expiresAt: '2026-11-10T10:00:00.000Z',
      });
    }
    const built = buildCoachBrief(await loadBriefInput(ctx.deps.db, ctx.deps, user.id, ctx.clock.now()));
    expect(built.oversize).toBe(true);
    const thread = await open(user.id);
    expect(thread.brief).toBe(built.json);
    const entries = lines.map((l) => JSON.parse(l)).filter((e) => e.msg === 'coach_brief_oversize');
    expect(entries).toEqual([
      { level: 'warn', msg: 'coach_brief_oversize', count: built.estimatedTokens, time: expect.any(String) },
    ]);
    expect(lines.join('\n')).not.toContain(user.id);
    expect(lines.join('\n')).not.toContain('exercice-tres-long');
  });

  it('dossier sous le plafond : rien au journal', async () => {
    await setup();
    await open((await createUser(ctx)).id);
    expect(lines).toEqual([]);
  });
});

describe('gel', () => {
  it('un réglage figé qui change ferme le fil (version_change) ; sans changement, rien', async () => {
    await setup();
    const thread = await open((await createUser(ctx)).id);
    await insertFixtureRow(ctx.deps.db, 'coach_message', {
      userId: thread.userId,
      threadId: thread.id,
      role: 'user',
    });
    expect(await closeIfFrozenStale(ctx.deps.db, ctx.deps, thread)).toBe(false);
    expect(rowOf('coach_thread', thread.id)).toMatchObject({ is_open: 1, closed_reason: null });

    ctx.deps.config = { ...ctx.deps.config, coachModel: 'claude-sonnet-5-5' };
    expect(await closeIfFrozenStale(ctx.deps.db, ctx.deps, thread)).toBe(true);
    expect(rowOf('coach_thread', thread.id)).toMatchObject({ is_open: 0, closed_reason: 'version_change' });

    const closed = await todayThread(ctx.deps.db, thread.userId, thread.day);
    if (!closed) throw new Error('fil introuvable');
    expect(await closeIfFrozenStale(ctx.deps.db, ctx.deps, closed)).toBe(false);
  });

  it('la tâche de démarrage ferme tous les fils ouverts concernés, et seulement eux', async () => {
    await setup();
    const adult = currentVersions(ctx.deps, 'adult');
    const minor = currentVersions(ctx.deps, 'minor');
    const thread = (v: Row) => insertFixtureRow(ctx.deps.db, 'coach_thread', { ...adult, ...v });
    const current = await thread({});
    const currentMinor = await thread({ ...minor, audience: 'minor' });
    const otherModel = await thread({ model: 'claude-sonnet-5-5' });
    const otherPrompt = await thread({ promptVersion: 'coach-1/minor' });
    const otherEffort = await thread({ effort: 'medium' });
    const otherTools = await thread({ toolsVersion: 'tools-0' });
    const otherBrief = await thread({ briefSchema: 'coach-brief/0' });
    const alreadyClosed = await thread({ model: 'claude-sonnet-5-5', isOpen: 0, closedReason: 'day_over' });
    // Un fil sans message de la personne n'est pas gardé en lecture : on en donne un à chacun.
    for (const t of [current, currentMinor, otherModel, otherPrompt, otherEffort, otherTools, otherBrief]) {
      await insertFixtureRow(ctx.deps.db, 'coach_message', {
        userId: t.userId,
        threadId: t.id,
        role: 'user',
      });
    }

    await COACH_THREADS_STARTUP_TASK.run(ctx.deps);

    const state = (r: Row) => rowOf('coach_thread', r.id as string);
    for (const kept of [current, currentMinor]) {
      expect(state(kept)).toMatchObject({ is_open: 1, closed_reason: null });
    }
    for (const stale of [otherModel, otherPrompt, otherEffort, otherTools, otherBrief]) {
      expect(state(stale)).toMatchObject({ is_open: 0, closed_reason: 'version_change' });
    }
    expect(state(alreadyClosed)).toMatchObject({ is_open: 0, closed_reason: 'day_over' });
  });

  it('la tâche de démarrage suit celle du coach', () => {
    expect(STARTUP_TASKS.indexOf(COACH_THREADS_STARTUP_TASK)).toBeGreaterThan(
      STARTUP_TASKS.indexOf(COACH_STARTUP_TASK),
    );
    expect(STARTUP_TASKS.indexOf(COACH_STARTUP_TASK)).toBeGreaterThanOrEqual(0);
  });
});

describe('suppression', () => {
  /** Un fil avec un message, un changement et une ligne d'usage qui le citent. */
  async function threadWithTraces(userId: string, thread?: Row) {
    const t = thread ?? (await insertFixtureRow(ctx.deps.db, 'coach_thread', { userId }));
    const id = t.id as string;
    const message = await insertFixtureRow(ctx.deps.db, 'coach_message', { userId, threadId: id });
    const change = await insertFixtureRow(ctx.deps.db, 'instance_change', {
      ownerId: userId,
      author: 'coach',
      reasonCode: 'COACH_PROPOSAL',
      aiGenerated: 1,
      coachThreadId: id,
    });
    const call = await insertFixtureRow(ctx.deps.db, 'coach_call', { userId, threadId: id });
    return { id, message, change, call };
  }

  it('fil du jour supprimé : messages partis, changement et usage détachés, nouveau fil le même jour', async () => {
    await setup();
    const user = await createUser(ctx);
    const first = await threadWithTraces(user.id, await open(user.id));
    const other = await threadWithTraces(user.id);

    await ctx.deps.db.transaction().execute((trx) => deleteThread(trx, ctx.deps, user.id, first.id));

    expect(rowOf('coach_thread', first.id)).toBeUndefined();
    expect(rowOf('coach_message', first.message.id as string)).toBeUndefined();
    const change = rowOf('instance_change', first.change.id as string);
    expect(change).toMatchObject({ coach_thread_id: null });
    expect(change?.rev as number).toBeGreaterThan(first.change.rev as number);
    expect(rowOf('coach_call', first.call.id as string)).toMatchObject({ thread_id: null });

    // L'autre fil et ce qui le cite ne bougent pas.
    expect(rowOf('coach_thread', other.id)).toBeDefined();
    expect(rowOf('coach_message', other.message.id as string)).toBeDefined();
    expect(rowOf('instance_change', other.change.id as string)).toMatchObject({
      coach_thread_id: other.id,
      rev: other.change.rev,
    });
    expect(rowOf('coach_call', other.call.id as string)).toMatchObject({ thread_id: other.id });

    const second = await open(user.id);
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({ day: '2026-11-05', isOpen: 1 });
  });

  it("le fil d'un autre membre : 404, rien de supprimé ni détaché", async () => {
    await setup();
    const owner = await createUser(ctx);
    const intruder = await createUser(ctx);
    const t = await threadWithTraces(owner.id);
    const attempt = ctx.deps.db
      .transaction()
      .execute((trx) => deleteThread(trx, ctx.deps, intruder.id, t.id));
    await expect(attempt).rejects.toBeInstanceOf(HttpError);
    await expect(attempt).rejects.toMatchObject({ status: 404, code: 'not_found' });
    expect(rowOf('coach_thread', t.id)).toBeDefined();
    expect(rowOf('instance_change', t.change.id as string)).toMatchObject({ coach_thread_id: t.id });
    expect(rowOf('coach_call', t.call.id as string)).toMatchObject({ thread_id: t.id });
  });

  it('deleteAllThreads : tous les fils de la personne, et seulement les siens', async () => {
    await setup();
    const user = await createUser(ctx);
    const neighbour = await createUser(ctx);
    const mine = [await threadWithTraces(user.id), await threadWithTraces(user.id)];
    const theirs = await threadWithTraces(neighbour.id);

    await ctx.deps.db.transaction().execute((trx) => deleteAllThreads(trx, ctx.deps, user.id));

    expect(rowsOf('SELECT id FROM coach_thread WHERE user_id = ?', user.id)).toEqual([]);
    for (const t of mine) {
      expect(rowOf('coach_message', t.message.id as string)).toBeUndefined();
      expect(rowOf('instance_change', t.change.id as string)).toMatchObject({ coach_thread_id: null });
      expect(rowOf('coach_call', t.call.id as string)).toMatchObject({ thread_id: null });
    }
    expect(rowOf('coach_thread', theirs.id)).toBeDefined();
    expect(rowOf('instance_change', theirs.change.id as string)).toMatchObject({
      coach_thread_id: theirs.id,
    });
    expect(rowOf('coach_call', theirs.call.id as string)).toMatchObject({ thread_id: theirs.id });
  });
});
