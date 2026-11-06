import { AI_COACH_CONSENT_TEXT, CoachBriefSchema } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeAiClient } from '../../src/ai/fake';
import { refreshCoachConfig } from '../../src/coach/state';
import { openTodayThread } from '../../src/coach/threads';
import {
  coachBrief,
  coachStatus,
  coachThread,
  coachThreads,
  coachToday,
  loadGuardSnapshot,
  messageView,
  threadView,
} from '../../src/coach/views';
import { grantConsent } from '../../src/privacy/consent';
import {
  createTestContext,
  createUser,
  dumpDatabase,
  enableCoach,
  insertFixtureRow,
  type TestContext,
} from '../support';

/*
 * Instantané de la garde et vues du coach (spec brique 4 §7.1, §7.3) : jour et mois de Paris, messages rendus
 * (jamais les messages système ni les tours d'outils), état, dossier du fil ou aperçu.
 */

type Row = Record<string, unknown>;

const NOW = '2026-11-05T10:00:00.000Z';

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup(now = NOW): Promise<TestContext> {
  ctx = await createTestContext({ now });
  return ctx;
}

const grantCoach = (userId: string, version = AI_COACH_CONSENT_TEXT.version) =>
  grantConsent(ctx.deps.db, ctx.deps, userId, 'ai_coach', version, null);
const message = (v: Row) => insertFixtureRow(ctx.deps.db, 'coach_message', v);
const extras = (v: Row) =>
  JSON.stringify({ helpCards: [], proposalIds: [], links: [], replaced: false, ...v });

describe('loadGuardSnapshot', () => {
  it('minuit de Paris : à 23 h 30 UTC le 31 octobre, seul le 1er novembre compte, pour le jour et le mois', async () => {
    await setup('2026-10-31T23:30:00.000Z');
    const user = await createUser(ctx);
    const call = (v: Row) => insertFixtureRow(ctx.deps.db, 'coach_call', { userId: user.id, ...v });
    await call({ day: '2026-10-31', counted: 1, costUsdMicros: 1_000_000 });
    await call({ day: '2026-11-01', counted: 1, costUsdMicros: 250_000 });
    await call({ day: '2026-11-01', counted: 0, costUsdMicros: 50_000 });
    await insertFixtureRow(ctx.deps.db, 'coach_call', { day: '2026-11-01', counted: 1, costUsdMicros: 7 });

    const s = await loadGuardSnapshot(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(s).toMatchObject({
      countedToday: 1,
      monthSpentUsdMicros: 300_000,
      now: '2026-10-31T23:30:00.000Z',
    });

    // Une heure plus tôt, c'était encore le 31 octobre à Paris.
    const before = await loadGuardSnapshot(
      ctx.deps.db,
      ctx.deps,
      user.id,
      new Date('2026-10-31T22:30:00.000Z'),
    );
    expect(before).toMatchObject({ countedToday: 1, monthSpentUsdMicros: 1_000_000 });
  });

  it('réglages, accord, verrou du registre', async () => {
    await setup();
    const user = await createUser(ctx);
    const empty = await loadGuardSnapshot(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(empty).toEqual({
      configured: false,
      enabled: false,
      suspendedUntil: null,
      now: NOW,
      consent: { active: false, textVersion: null },
      currentConsentVersion: AI_COACH_CONSENT_TEXT.version,
      countedToday: 0,
      monthSpentUsdMicros: 0,
      inProgress: false,
    });

    await enableCoach(ctx, []);
    await grantCoach(user.id);
    const lease = ctx.deps.coach.exchanges.begin(user.id);
    const s = await loadGuardSnapshot(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    lease?.done();
    expect(s).toMatchObject({
      configured: true,
      enabled: true,
      consent: { active: true, textVersion: AI_COACH_CONSENT_TEXT.version },
      inProgress: true,
    });
  });
});

describe('messages et fils', () => {
  it("messages système et tours d'outils absents ; display_extras rendu en cartes, propositions, liens", async () => {
    await setup();
    const user = await createUser(ctx);
    const thread = await insertFixtureRow(ctx.deps.db, 'coach_thread', {
      userId: user.id,
      day: '2026-11-05',
    });
    const threadId = thread.id as string;
    await message({
      userId: user.id,
      threadId,
      seq: 1,
      role: 'user',
      displayText: 'Ma séance ?',
      clientMessageId: 'c-1',
    });
    await message({
      userId: user.id,
      threadId,
      seq: 2,
      role: 'assistant',
      displayText: null,
      aiGenerated: 1,
    });
    await message({ userId: user.id, threadId, seq: 3, role: 'user', displayText: null });
    await message({ userId: user.id, threadId, seq: 4, role: 'system', displayText: null });
    await message({
      userId: user.id,
      threadId,
      seq: 5,
      role: 'assistant',
      displayText: 'Repose-toi.',
      displayExtras: extras({
        helpCards: ['pain'],
        proposalIds: ['p-1'],
        links: ['program'],
        replaced: true,
      }),
      aiGenerated: 1,
      effectiveModel: 'claude-opus-5-5',
      truncated: 1,
      createdAt: '2026-11-05T10:01:00.000Z',
    });

    const { messages } = await coachThread(ctx.deps.db, user.id, threadId);
    expect(messages).toEqual([
      {
        seq: 1,
        role: 'user',
        text: 'Ma séance ?',
        createdAt: '2026-10-06T10:00:00.000Z',
        aiGenerated: false,
        model: null,
        truncated: false,
        replaced: false,
        helpCards: [],
        proposalIds: [],
        links: [],
      },
      {
        seq: 5,
        role: 'assistant',
        text: 'Repose-toi.',
        createdAt: '2026-11-05T10:01:00.000Z',
        aiGenerated: true,
        model: 'claude-opus-5-5',
        truncated: true,
        replaced: true,
        helpCards: ['pain'],
        proposalIds: ['p-1'],
        links: ['program'],
      },
    ]);
    expect((await coachToday(ctx.deps.db, ctx.deps, user.id, ctx.clock.now())).messages).toEqual(messages);
  });

  it('messageView : le parcours guidé d’un message de la personne est rendu, sans parcours rien', async () => {
    await setup();
    const guided = { flow: 'new_session', choices: ['legs', 'medium'] };
    const withGuided = await message({
      role: 'user',
      displayText: 'Une séance',
      displayExtras: extras({ guided }),
    });
    expect(messageView(withGuided as never)?.guided).toEqual(guided);
    const plain = await message({ role: 'user', displayText: 'Salut' });
    expect(messageView(plain as never)).not.toHaveProperty('guided');
  });

  it('coachThreads : la voix de chaque fil', async () => {
    await setup();
    const user = await createUser(ctx);
    const skald = await insertFixtureRow(ctx.deps.db, 'coach_thread', {
      userId: user.id,
      day: '2026-11-05',
      persona: 'skald',
    });
    const res = await coachThreads(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(res.threads).toEqual([expect.objectContaining({ id: skald.id, persona: 'skald' })]);
  });

  it('messageView : null pour un message système même avec un texte', async () => {
    await setup();
    const row = await message({ role: 'system', displayText: 'Règle rappelée.' });
    expect(messageView(row as never)).toBeNull();
  });

  it("coachThread : un fil d'un autre membre répond 404", async () => {
    await setup();
    const owner = await createUser(ctx);
    const other = await createUser(ctx);
    const thread = await insertFixtureRow(ctx.deps.db, 'coach_thread', { userId: owner.id });
    await expect(coachThread(ctx.deps.db, other.id, thread.id as string)).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('coachThreads : les fils des 90 derniers jours, le plus récent d’abord, et seulement les siens', async () => {
    await setup();
    const user = await createUser(ctx);
    const thread = (day: string, v: Row = {}) =>
      insertFixtureRow(ctx.deps.db, 'coach_thread', { userId: user.id, day, ...v });
    const today = await thread('2026-11-05', { userMessageCount: 4 });
    const limit = await thread('2026-08-07', { isOpen: 0, closedReason: 'day_over' });
    await thread('2026-08-06');
    await insertFixtureRow(ctx.deps.db, 'coach_thread', { day: '2026-11-04' });

    expect(await coachThreads(ctx.deps.db, ctx.deps, user.id, ctx.clock.now())).toEqual({
      threads: [
        { id: today.id, day: '2026-11-05', persona: expect.any(String), userMessageCount: 4, open: true },
        { id: limit.id, day: '2026-08-07', persona: expect.any(String), userMessageCount: 0, open: false },
      ],
    });
  });

  it('coachThreads : plusieurs fils le même jour, le plus récent d’abord, puis par identifiant', async () => {
    await setup();
    const user = await createUser(ctx);
    const thread = (createdAt: string, v: Row = {}) =>
      insertFixtureRow(ctx.deps.db, 'coach_thread', {
        userId: user.id,
        day: '2026-11-05',
        createdAt,
        isOpen: 0,
        closedReason: 'persona_change',
        ...v,
      });
    const early = await thread('2026-11-05T08:00:00.000Z');
    const tieA = await thread('2026-11-05T09:00:00.000Z');
    const tieB = await thread('2026-11-05T09:00:00.000Z');
    const latest = await thread('2026-11-05T10:00:00.000Z', { isOpen: 1, closedReason: null });
    const { threads } = await coachThreads(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    const tied = [tieA.id, tieB.id].sort().reverse();
    expect(threads.map((t) => t.id)).toEqual([latest.id, ...tied, early.id]);
  });

  it('coachThreads : la fenêtre suit deps.coachConfig.retention.threadDays, comme la purge', async () => {
    await setup();
    const user = await createUser(ctx);
    await insertFixtureRow(ctx.deps.db, 'coach_thread', { userId: user.id, day: '2026-11-05' });
    const old = await insertFixtureRow(ctx.deps.db, 'coach_thread', { userId: user.id, day: '2026-10-25' });
    ctx.deps.coachConfig = {
      ...ctx.deps.coachConfig,
      retention: { ...ctx.deps.coachConfig.retention, threadDays: 10 },
    };
    const { threads } = await coachThreads(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(threads.map((t) => t.day)).toEqual(['2026-11-05']);
    expect(threads.some((t) => t.id === old.id)).toBe(false);
  });

  it('coachToday : le fil du jour de Paris, sans fil null', async () => {
    await setup('2026-11-04T23:30:00.000Z');
    const user = await createUser(ctx);
    await insertFixtureRow(ctx.deps.db, 'coach_thread', { userId: user.id, day: '2026-11-04' });
    expect(await coachToday(ctx.deps.db, ctx.deps, user.id, ctx.clock.now())).toEqual({
      thread: null,
      messages: [],
      inProgress: false,
    });
    // La voix du fil est celle du profil : le fil reste ouvert.
    await insertFixtureRow(ctx.deps.db, 'training_profile', { ownerId: user.id, coach: 'skald' });
    const row = await insertFixtureRow(ctx.deps.db, 'coach_thread', {
      userId: user.id,
      day: '2026-11-05',
      audience: 'minor',
      persona: 'skald',
    });
    const today = await coachToday(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(today.thread).toEqual(threadView(row as never));
    expect(today.thread).toEqual({
      id: row.id,
      day: '2026-11-05',
      audience: 'minor',
      persona: 'skald',
      open: true,
      closedReason: null,
      userMessageCount: 0,
      createdAt: '2026-10-06T10:00:00.000Z',
    });
  });
});

describe('coachStatus', () => {
  it('compte du jour, budget en pourcentage entier, accord à renouveler, verrou', async () => {
    await setup();
    const user = await createUser(ctx);
    await enableCoach(ctx, []);
    await insertFixtureRow(ctx.deps.db, 'consent_event', {
      ownerId: user.id,
      type: 'ai_coach',
      action: 'grant',
      textVersion: '0.9',
    });
    for (let i = 0; i < 3; i += 1) {
      await insertFixtureRow(ctx.deps.db, 'coach_call', {
        userId: user.id,
        day: '2026-11-05',
        counted: 1,
        costUsdMicros: 829_999,
      });
    }
    const status = await coachStatus(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(status).toEqual({
      available: true,
      unavailableReason: null,
      suspendedUntil: null,
      consent: {
        active: true,
        textVersion: '0.9',
        currentVersion: AI_COACH_CONSENT_TEXT.version,
        needsRenewal: true,
      },
      audience: 'adult',
      persona: 'scribe',
      today: {
        threadId: null,
        open: true,
        closedReason: null,
        userMessageCount: 0,
        remaining: 27,
        inProgress: false,
      },
      // 2 489 997 µ$ sur 3 000 000 : 82,9 %, arrondi par défaut.
      budgetUsedPct: 82,
      devUnevaluated: false,
    });
  });

  it('fil du jour remplaçable (version_change) : public et voix du profil, pas ceux du fil fermé', async () => {
    await setup();
    const user = await createUser(ctx, { birthDate: '2008-11-04' });
    await insertFixtureRow(ctx.deps.db, 'training_profile', { ownerId: user.id, coach: 'ombre' });
    const before = await coachStatus(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(before).toMatchObject({ audience: 'adult', persona: 'ombre' });
    const thread = await insertFixtureRow(ctx.deps.db, 'coach_thread', {
      userId: user.id,
      day: '2026-11-05',
      audience: 'minor',
      persona: 'skald',
      isOpen: 0,
      closedReason: 'version_change',
      userMessageCount: 6,
    });
    const status = await coachStatus(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    // Fil remplaçable (version_change) : le message suivant ouvre un fil à la voix du profil.
    expect(status).toMatchObject({
      audience: 'adult',
      persona: 'ombre',
      today: { threadId: thread.id, open: true, closedReason: 'version_change', userMessageCount: 6 },
    });
  });

  it('/status : le plus strict gagne, fil adulte et profil mineur donnent mineur', async () => {
    await setup();
    const user = await createUser(ctx, { birthDate: '2010-01-01' });
    await insertFixtureRow(ctx.deps.db, 'coach_thread', {
      userId: user.id,
      day: '2026-11-05',
      audience: 'adult',
    });
    const status = await coachStatus(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(status.audience).toBe('minor');
  });

  it('fil fermé par version_change : /status rend la voix du profil, pas celle du fil', async () => {
    await setup();
    const user = await createUser(ctx, {});
    await insertFixtureRow(ctx.deps.db, 'training_profile', { ownerId: user.id, coach: 'ombre' });
    await insertFixtureRow(ctx.deps.db, 'coach_thread', {
      userId: user.id,
      day: '2026-11-05',
      persona: 'skald',
      isOpen: 0,
      closedReason: 'version_change',
      userMessageCount: 2,
    });
    const status = await coachStatus(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(status.persona).toBe('ombre');
  });

  it('indisponible : non configuré, coupé, suspendu ; budget plafonné à 100 et limite du jour à 0', async () => {
    await setup();
    const user = await createUser(ctx);
    for (let i = 0; i < 31; i += 1) {
      await insertFixtureRow(ctx.deps.db, 'coach_call', {
        userId: user.id,
        day: '2026-11-05',
        counted: 1,
        costUsdMicros: 100_000,
      });
    }
    const status = () => coachStatus(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(await status()).toMatchObject({
      available: false,
      unavailableReason: 'not_configured',
      budgetUsedPct: 100,
      today: { remaining: 0 },
    });
    await enableCoach(ctx, []);
    await ctx.deps.db.updateTable('coachState').set({ enabled: 0 }).execute();
    expect(await status()).toMatchObject({ available: false, unavailableReason: 'disabled' });
    await ctx.deps.db
      .updateTable('coachState')
      .set({ enabled: 1, suspendedUntil: '2026-11-30T23:00:00.000Z' })
      .execute();
    expect(await status()).toMatchObject({
      available: false,
      unavailableReason: 'suspended',
      suspendedUntil: '2026-11-30T23:00:00.000Z',
    });
    // Suspension passée : sans effet, et non rendue.
    await ctx.deps.db.updateTable('coachState').set({ suspendedUntil: '2026-11-01T00:00:00.000Z' }).execute();
    expect(await status()).toMatchObject({ available: true, unavailableReason: null, suspendedUntil: null });
  });

  it('devUnevaluated vrai seulement en mode dev', async () => {
    ctx = await createTestContext({
      now: NOW,
      config: { appOrigin: 'http://localhost:3000', coachDevAllowUnevaluated: true },
      deps: { ai: createFakeAiClient([]) },
    });
    const user = await createUser(ctx);
    await ctx.deps.db.updateTable('coachState').set({ enabled: 1 }).execute();
    await refreshCoachConfig(ctx.deps);
    expect(await coachStatus(ctx.deps.db, ctx.deps, user.id, ctx.clock.now())).toMatchObject({
      available: true,
      devUnevaluated: true,
    });
    ctx.close();

    await setup();
    const evaluated = await createUser(ctx);
    await enableCoach(ctx, []);
    expect(await coachStatus(ctx.deps.db, ctx.deps, evaluated.id, ctx.clock.now())).toMatchObject({
      available: true,
      devUnevaluated: false,
    });
  });
});

describe('coachBrief', () => {
  it('sans fil : aperçu calculé à l’instant, rien écrit (hors bloc servi absent)', async () => {
    await setup();
    const user = await createUser(ctx);
    const dump = () => JSON.parse(dumpDatabase(ctx.deps.sqlite)) as Record<string, Row[]>;
    const meta = (d: Record<string, Row[]>) => d.server_meta?.[0] ?? {};

    // Premier appel, sans bloc servi en mémoire : `currentCatalog` le reconstruit et peut écrire
    // `server_meta.catalog_version` (comme `GET /api/catalog`). C'est la seule écriture.
    const initial = dump();
    await coachBrief(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    const afterFirst = dump();
    const { server_meta: _before, ...others } = initial;
    const { server_meta: _after, ...othersAfter } = afterFirst;
    expect(othersAfter).toEqual(others);
    const { catalog_version: v0, catalog_updated_at: _t0, ...metaRest } = meta(initial);
    const { catalog_version: v1, catalog_updated_at: _t1, ...metaRestAfter } = meta(afterFirst);
    expect(metaRestAfter).toEqual(metaRest);
    expect(v0).toBeNull();
    expect(v1).toEqual(expect.any(String));

    // Bloc servi à jour : plus aucune écriture.
    const response = await coachBrief(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(dump()).toEqual(afterFirst);
    expect(response).toMatchObject({ threadId: null, day: '2026-11-05', preview: true });
    expect(CoachBriefSchema.parse(response.brief)).toEqual(response.brief);
    expect(response.brief).toMatchObject({ schema: 'coach-brief/2', today: '2026-11-05', audience: 'adult' });
    expect(ctx.deps.sqlite.prepare('SELECT id FROM coach_thread').all()).toEqual([]);
  });

  it('après un changement de coach : le dossier de l’ancien fil n’est plus rendu', async () => {
    await setup();
    const user = await createUser(ctx);
    const thread = await openTodayThread(ctx.deps, user.id, ctx.clock.now());
    await message({ userId: user.id, threadId: thread.id, role: 'user' });
    expect((await coachBrief(ctx.deps.db, ctx.deps, user.id, ctx.clock.now())).threadId).toBe(thread.id);
    await insertFixtureRow(ctx.deps.db, 'training_profile', { ownerId: user.id, coach: 'skald' });
    const response = await coachBrief(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(response).toMatchObject({ threadId: null, preview: true, day: '2026-11-05' });
    expect(ctx.deps.sqlite.prepare('SELECT is_open, closed_reason FROM coach_thread').all()).toEqual([
      { is_open: 0, closed_reason: 'persona_change' },
    ]);
  });

  it('avec un fil : son dossier stocké, analysé ; null après le retrait santé', async () => {
    await setup();
    const user = await createUser(ctx);
    const thread = await openTodayThread(ctx.deps, user.id, ctx.clock.now());
    const response = await coachBrief(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(response).toEqual({
      brief: JSON.parse(thread.brief ?? ''),
      threadId: thread.id,
      day: '2026-11-05',
      preview: false,
    });
    // Exactement le JSON stocké, dans l'ordre de ses clés (§9, transparence).
    expect(JSON.stringify(response.brief)).toBe(thread.brief);

    // État laissé par le crochet du retrait santé (tâche 16) : dossier effacé, fil clos.
    await ctx.deps.db
      .updateTable('coachThread')
      .set({ brief: null, isOpen: 0, closedReason: 'health_withdrawn' })
      .where('id', '=', thread.id)
      .execute();
    expect(await coachBrief(ctx.deps.db, ctx.deps, user.id, ctx.clock.now())).toEqual({
      brief: null,
      threadId: thread.id,
      day: '2026-11-05',
      preview: false,
    });
  });

  it("dossier d'un ancien brief_schema : rendu brut, sans erreur ; au schéma courant, il doit le passer", async () => {
    await setup();
    const user = await createUser(ctx);
    const stored = '{"schema":"coach-brief/0","today":"2026-11-05","ancien":{"z":1,"a":2}}';
    const thread = await insertFixtureRow(ctx.deps.db, 'coach_thread', {
      userId: user.id,
      day: '2026-11-05',
      persona: 'scribe',
      briefSchema: 'coach-brief/0',
      brief: stored,
    });
    const response = await coachBrief(ctx.deps.db, ctx.deps, user.id, ctx.clock.now());
    expect(response).toMatchObject({ threadId: thread.id, preview: false });
    expect(JSON.stringify(response.brief)).toBe(stored);

    // Même contenu sous le schéma courant : un dossier illisible est une erreur interne.
    await ctx.deps.db
      .updateTable('coachThread')
      .set({ briefSchema: ctx.deps.coachConfig.briefSchema })
      .where('id', '=', thread.id as string)
      .execute();
    await expect(coachBrief(ctx.deps.db, ctx.deps, user.id, ctx.clock.now())).rejects.toThrow();
  });
});
