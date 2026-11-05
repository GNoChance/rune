import { AI_COACH_CONSENT_TEXT, CURRENT_CONSENT_TEXTS } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExchangeLease } from '../../src/coach/registry';
import {
  createLogger,
  createTestContext,
  createUserAndLogin,
  dumpDatabase,
  insertFixtureRow,
  type TestContext,
} from '../support';

/*
 * Accord `ai_coach` (spec brique 4 §14.1, choix C36), désactivation du coach = retrait de l'accord (§6.3, §14.2,
 * choix C34), retrait de l'accord santé côté coach (§6.3, choix C13) et renvoi R-SYN-28 de l'accord coach (C35).
 */

type Row = Record<string, unknown>;
type Member = Awaited<ReturnType<typeof createUserAndLogin>>;

const NOW = '2026-11-05T10:00:00.000Z';
const IP = '100.64.0.9';
/** Contenu C2 ou C3 qui doit disparaître : dossier, blocs bruts. Jamais au journal. */
const WITNESS = 'TEMOIN-COACH-7c2e';

let ctx: TestContext;
let lines: string[];
let leases: ExchangeLease[] = [];
afterEach(() => {
  for (const lease of leases) lease.done();
  leases = [];
  ctx?.close();
});

async function setup(): Promise<{ u: Member; other: Member }> {
  lines = [];
  ctx = await createTestContext({ now: NOW, deps: { logger: createLogger((l) => lines.push(l)) } });
  const u = await createUserAndLogin(ctx, { username: 'lea' });
  const other = await createUserAndLogin(ctx, { username: 'tom' });
  return { u, other };
}

const call = (u: Member, path: string, method = 'GET', json?: unknown) =>
  ctx.request(path, { method, cookie: u.cookie, ip: IP, ...(json !== undefined ? { json } : {}) });
const grant = (u: Member, type: 'health' | 'ai_coach', textVersion = '1.0') =>
  call(u, '/api/me/consents', 'POST', { type, textVersion });
const withdraw = (u: Member, type: 'health' | 'ai_coach', password = u.password) =>
  call(u, '/api/me/consents/withdraw', 'POST', { type, password });
const replay = (u: Member, type: 'health' | 'ai_coach', withdrawnAt: unknown) =>
  call(u, `/api/me/consents/${type}/replay-withdraw`, 'POST', { withdrawnAt });

const insert = (table: string, v: Row) => insertFixtureRow(ctx.deps.db, table, v);
const rowsOf = (table: string, userColumn: string, userId: string) =>
  ctx.deps.sqlite.prepare(`SELECT * FROM ${table} WHERE ${userColumn} = ? ORDER BY id`).all(userId) as Row[];
const change = (id: unknown) =>
  ctx.deps.db
    .selectFrom('instanceChange')
    .selectAll()
    .where('id', '=', id as string)
    .executeTakeFirst();
const securityEvents = (type: string) =>
  ctx.deps.db.selectFrom('securityEvent').selectAll().where('type', '=', type).orderBy('id').execute();
const consents = async (u: Member) =>
  ((await (await call(u, '/api/me')).json()) as { consents: Record<'health' | 'aiCoach', Row> }).consents;
const syncCounter = async () =>
  (await ctx.deps.db.selectFrom('serverMeta').select('syncCounter').executeTakeFirstOrThrow()).syncCounter;

/** Tout ce que le coach garde d'une personne : fils, messages, usage, signalements et changements de programme. */
const coachState = async (userId: string) => ({
  threads: rowsOf('coach_thread', 'user_id', userId),
  messages: rowsOf('coach_message', 'user_id', userId),
  calls: rowsOf('coach_call', 'user_id', userId),
  reports: rowsOf('coach_report', 'user_id', userId),
  changes: rowsOf('instance_change', 'owner_id', userId),
});

/**
 * Fil du jour ouvert et fil clos d'un jour passé, chacun avec un message de la personne et une réponse ; une ligne
 * d'usage et un signalement du fil du jour ; une proposition du coach en attente, une acceptée, une du moteur.
 */
async function equipCoach(userId: string) {
  const brief = JSON.stringify({ limitations: [{ note: WITNESS }] });
  const blocks = JSON.stringify([{ type: 'text', text: WITNESS }]);
  const today = await insert('coach_thread', { userId, day: '2026-11-05', brief });
  const past = await insert('coach_thread', {
    userId,
    day: '2026-11-01',
    brief,
    isOpen: 0,
    closedReason: 'day_over',
  });
  const messages: Row[] = [];
  for (const thread of [today, past]) {
    messages.push(
      await insert('coach_message', {
        userId,
        threadId: thread.id,
        role: 'user',
        blocks,
        displayText: 'Bonjour',
      }),
      await insert('coach_message', {
        userId,
        threadId: thread.id,
        role: 'assistant',
        blocks,
        displayText: 'Salut, on regarde ta séance.',
        aiGenerated: 1,
      }),
    );
  }
  const usage = await insert('coach_call', { userId, threadId: today.id, day: '2026-11-05', counted: 1 });
  const report = await insert('coach_report', {
    userId,
    threadId: today.id,
    messageSeq: messages[1]?.seq,
    exchangeText: 'Bonjour / Salut, on regarde ta séance.',
  });
  const coach = { author: 'coach', reasonCode: 'COACH_PROPOSAL', aiGenerated: 1 };
  const proposed = await insert('instance_change', { ownerId: userId, ...coach, coachThreadId: today.id });
  const instanceId = proposed.instanceId;
  const accepted = await insert('instance_change', {
    ownerId: userId,
    instanceId,
    ...coach,
    coachThreadId: past.id,
    status: 'accepted',
    decidedAt: NOW,
  });
  const engine = await insert('instance_change', {
    ownerId: userId,
    instanceId,
    author: 'engine',
    reasonCode: 'STALL',
  });
  return { today, past, messages, usage, report, proposed, accepted, engine };
}

/** Échange inscrit au registre ; note si son interruption arrive pendant une transaction ouverte. */
function exchange(userId: string) {
  const lease = ctx.deps.coach.exchanges.begin(userId);
  if (lease === null) throw new Error('échange déjà en cours');
  leases.push(lease);
  const seen: { inTransaction: boolean | null } = { inTransaction: null };
  lease.signal.addEventListener('abort', () => {
    seen.inTransaction = ctx.deps.sqlite.isTransaction;
  });
  return { signal: lease.signal, seen };
}

describe('POST /api/me/consents : accord ai_coach (§14.1, choix C36)', () => {
  it('la version courante exacte rend l’accord actif et le journalise', async () => {
    const { u } = await setup();
    const res = await grant(u, 'ai_coach', AI_COACH_CONSENT_TEXT.version);
    expect(res.status).toBe(200);
    const me = (await res.json()) as { consents: { aiCoach: unknown; health: { active: boolean } } };
    expect(me.consents.aiCoach).toEqual({ active: true, textVersion: '1.0', at: NOW });
    expect(me.consents.health.active).toBe(false);
    const events = await ctx.deps.db.selectFrom('consentEvent').selectAll().execute();
    expect(events).toEqual([
      expect.objectContaining({ ownerId: u.id, type: 'ai_coach', action: 'grant', textVersion: '1.0' }),
    ]);
    const logged = await securityEvents('consent_granted');
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0]?.details ?? 'null')).toEqual({ consentType: 'ai_coach' });
  });

  it.each(['0.9', '1', '2.0'])('la version %s : 400 validation, rien d’écrit', async (version) => {
    const { u } = await setup();
    const res = await grant(u, 'ai_coach', version);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
    expect(await ctx.deps.db.selectFrom('consentEvent').selectAll().execute()).toEqual([]);
    expect(await securityEvents('consent_granted')).toEqual([]);
  });

  it('un accord identique répété n’écrit rien', async () => {
    const { u } = await setup();
    expect((await grant(u, 'ai_coach')).status).toBe(200);
    const counter = await syncCounter();
    ctx.clock.advance(1000);
    expect((await grant(u, 'ai_coach')).status).toBe(200);
    expect(await syncCounter()).toBe(counter);
    expect(await ctx.deps.db.selectFrom('consentEvent').selectAll().execute()).toHaveLength(1);
    expect(await securityEvents('consent_granted')).toHaveLength(1);
  });

  it('chaque accord exige la version de son propre texte en vigueur', async () => {
    const { u } = await setup();
    // Une nouvelle version du texte coach, le texte santé inchangé (même numéro 1.0 aujourd'hui).
    CURRENT_CONSENT_TEXTS.ai_coach = { ...AI_COACH_CONSENT_TEXT, version: '1.1' };
    try {
      expect((await grant(u, 'ai_coach', '1.0')).status).toBe(400);
      expect((await grant(u, 'health', '1.0')).status).toBe(200);
      expect((await grant(u, 'ai_coach', '1.1')).status).toBe(200);
    } finally {
      CURRENT_CONSENT_TEXTS.ai_coach = AI_COACH_CONSENT_TEXT;
    }
    expect((await consents(u)).aiCoach).toMatchObject({ active: true, textVersion: '1.1' });
  });
});

describe('désactivation du coach : POST /api/me/consents/withdraw {type: ai_coach} (§6.3, §14.2, C34)', () => {
  async function equipped() {
    const { u, other } = await setup();
    for (const m of [u, other]) {
      expect((await grant(m, 'health')).status).toBe(200);
      expect((await grant(m, 'ai_coach')).status).toBe(200);
    }
    const mine = await equipCoach(u.id);
    await equipCoach(other.id);
    ctx.clock.advance(1000);
    return { u, other, mine };
  }

  it('mot de passe faux : 401, rien d’effacé, l’échange continue', async () => {
    const { u, mine } = await equipped();
    const before = await coachState(u.id);
    const running = exchange(u.id);
    const res = await withdraw(u, 'ai_coach', 'faux faux faux faux');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_credentials' });
    expect(await coachState(u.id)).toEqual(before);
    expect(before.threads.map((t) => t.id)).toEqual([mine.today.id, mine.past.id]);
    expect((await consents(u)).aiCoach).toMatchObject({ active: true });
    expect(running.signal.aborted).toBe(false);
  });

  it('efface fils, messages et signalements ; détache l’usage et les changements ; tombe les propositions en attente', async () => {
    const { u, other, mine } = await equipped();
    const otherBefore = await coachState(other.id);
    const running = exchange(u.id);
    const neighbour = exchange(other.id);

    const res = await withdraw(u, 'ai_coach');
    expect(res.status).toBe(200);
    const me = (await res.json()) as {
      consents: { aiCoach: { active: boolean }; health: { active: boolean } };
    };
    expect(me.consents.aiCoach.active).toBe(false);
    expect(me.consents.health.active).toBe(true);

    const after = await coachState(u.id);
    expect(after.threads).toEqual([]);
    expect(after.messages).toEqual([]);
    expect(after.reports).toEqual([]);
    expect(after.calls).toEqual([
      expect.objectContaining({ id: mine.usage.id, thread_id: null, counted: 1, day: '2026-11-05' }),
    ]);

    const proposed = await change(mine.proposed.id);
    expect(proposed).toMatchObject({
      status: 'proposed',
      deletedAt: '2026-11-05T10:00:01.000Z',
      coachThreadId: null,
    });
    expect(proposed?.rev).toBeGreaterThan(mine.proposed.rev as number);
    const accepted = await change(mine.accepted.id);
    expect(accepted).toMatchObject({
      status: 'accepted',
      deletedAt: null,
      coachThreadId: null,
      aiGenerated: 1,
    });
    expect(accepted?.rev).toBeGreaterThan(mine.accepted.rev as number);
    expect(await change(mine.engine.id)).toEqual(mine.engine);

    const events = await ctx.deps.db
      .selectFrom('consentEvent')
      .select(['type', 'action', 'textVersion'])
      .where('ownerId', '=', u.id)
      .where('type', '=', 'ai_coach')
      .orderBy('createdAt')
      .execute();
    expect(events).toEqual([
      { type: 'ai_coach', action: 'grant', textVersion: '1.0' },
      { type: 'ai_coach', action: 'withdraw', textVersion: '1.0' },
    ]);
    const revoked = await securityEvents('consent_revoked');
    expect(revoked).toHaveLength(1);
    expect(revoked[0]).toMatchObject({ actorId: u.id, targetId: u.id, tailnetIp: IP, outcome: 'success' });
    expect(JSON.parse(revoked[0]?.details ?? 'null')).toEqual({ consentType: 'ai_coach' });

    // Interrompu après la validation, et seulement l'échange de la personne.
    expect(running.signal.aborted).toBe(true);
    expect(running.signal.reason).toBe('consent_withdrawn');
    expect(running.seen.inTransaction).toBe(false);
    expect(neighbour.signal.aborted).toBe(false);

    expect(await coachState(other.id)).toEqual(otherBefore);
    // Rien du contenu n'est passé par le journal technique (P-LOG-2).
    expect(lines.join('\n')).not.toContain(WITNESS);
  });

  it('un second retrait n’écrit rien', async () => {
    const { u } = await equipped();
    expect((await withdraw(u, 'ai_coach')).status).toBe(200);
    const counter = await syncCounter();
    const security = await ctx.deps.db.selectFrom('securityEvent').selectAll().execute();
    const events = await ctx.deps.db.selectFrom('consentEvent').selectAll().execute();
    expect((await withdraw(u, 'ai_coach')).status).toBe(200);
    expect(await syncCounter()).toBe(counter);
    expect(await ctx.deps.db.selectFrom('securityEvent').selectAll().execute()).toEqual(security);
    expect(await ctx.deps.db.selectFrom('consentEvent').selectAll().execute()).toEqual(events);
  });

  it('un nouvel accord rend le coach de nouveau accessible, sans rien ressusciter', async () => {
    const { u } = await equipped();
    expect((await withdraw(u, 'ai_coach')).status).toBe(200);
    expect((await grant(u, 'ai_coach')).status).toBe(200);
    expect((await consents(u)).aiCoach).toMatchObject({ active: true, textVersion: '1.0' });
    expect((await coachState(u.id)).threads).toEqual([]);
  });
});

describe('retrait de l’accord santé : crochet du coach (§6.3, choix C13)', () => {
  it('fils ouverts clos, dossiers et blocs bruts effacés, textes affichés et signalements gardés, échange interrompu', async () => {
    const { u, other } = await setup();
    for (const m of [u, other]) {
      expect((await grant(m, 'health')).status).toBe(200);
      expect((await grant(m, 'ai_coach')).status).toBe(200);
    }
    const mine = await equipCoach(u.id);
    await equipCoach(other.id);
    const otherBefore = await coachState(other.id);
    const before = await coachState(u.id);
    const running = exchange(u.id);
    ctx.clock.advance(1000);

    // Le fil du jour porte un dossier : le retrait générique n'y touche pas (pas de rev), le crochet si.
    expect(mine.today.brief).toContain(WITNESS);
    const res = await withdraw(u, 'health');
    expect(res.status).toBe(200);
    const me = (await res.json()) as {
      consents: { aiCoach: { active: boolean }; health: { active: boolean } };
    };
    expect(me.consents.health.active).toBe(false);
    expect(me.consents.aiCoach.active).toBe(true);

    const after = await coachState(u.id);
    expect(after.threads).toEqual([
      { ...before.threads[0], brief: null, is_open: 0, closed_reason: 'health_withdrawn' },
      { ...before.threads[1], brief: null, is_open: 0, closed_reason: 'day_over' },
    ]);
    expect(after.messages).toEqual(before.messages.map((m) => ({ ...m, blocks: null })));
    expect(after.messages.map((m) => m.display_text)).toEqual([
      'Bonjour',
      'Salut, on regarde ta séance.',
      'Bonjour',
      'Salut, on regarde ta séance.',
    ]);
    expect(after.reports).toEqual(before.reports);
    expect(after.reports[0]?.exchange_text).toBe('Bonjour / Salut, on regarde ta séance.');
    expect(after.calls).toEqual(before.calls);

    expect(running.signal.aborted).toBe(true);
    expect(running.signal.reason).toBe('consent_withdrawn');
    expect(running.seen.inTransaction).toBe(false);

    expect(await coachState(other.id)).toEqual(otherBefore);
    expect(JSON.stringify([after.threads, after.messages])).not.toContain(WITNESS);
    expect(lines.join('\n')).not.toContain(WITNESS);
  });

  it('plus aucune trace du dossier ni des blocs bruts dans la base', async () => {
    const { u } = await setup();
    expect((await grant(u, 'health')).status).toBe(200);
    await equipCoach(u.id);
    expect(dumpDatabase(ctx.deps.sqlite)).toContain(WITNESS);
    expect((await withdraw(u, 'health')).status).toBe(200);
    expect(dumpDatabase(ctx.deps.sqlite)).not.toContain(WITNESS);
    expect(lines.join('\n')).not.toContain(WITNESS);
  });

  it('le crochet ne fait rien sans fil', async () => {
    const { u } = await setup();
    expect((await grant(u, 'health')).status).toBe(200);
    expect((await withdraw(u, 'health')).status).toBe(200);
    expect((await consents(u)).health).toMatchObject({ active: false });
  });
});

describe('POST /api/me/consents/ai_coach/replay-withdraw (R-SYN-28, choix C35)', () => {
  /** Accord coach à 10:00 avec un fil ; époque commencée à 12:00 ; appels à 12:30. */
  async function restored() {
    const { u } = await setup();
    expect((await grant(u, 'ai_coach')).status).toBe(200);
    await equipCoach(u.id);
    await ctx.deps.db
      .updateTable('serverMeta')
      .set({ epochStartedAt: '2026-11-05T12:00:00.000Z' })
      .where('id', '=', 1)
      .execute();
    ctx.clock.set('2026-11-05T12:30:00.000Z');
    return u;
  }
  const state = async (u: Member) => ({
    counter: await syncCounter(),
    coach: await coachState(u.id),
    consents: await ctx.deps.db.selectFrom('consentEvent').selectAll().execute(),
    security: await ctx.deps.db.selectFrom('securityEvent').selectAll().execute(),
  });

  it('rejoue un retrait fait entre l’accord et le début de l’époque, sans mot de passe', async () => {
    const u = await restored();
    const running = exchange(u.id);
    const res = await replay(u, 'ai_coach', '2026-11-05T11:00:00.000Z');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { consents: { aiCoach: Row } }).consents.aiCoach).toMatchObject({
      active: false,
    });
    expect((await coachState(u.id)).threads).toEqual([]);
    const revoked = await securityEvents('consent_revoked');
    expect(revoked).toHaveLength(1);
    expect(JSON.parse(revoked[0]?.details ?? 'null')).toEqual({ consentType: 'ai_coach', replay: true });
    expect(running.signal.reason).toBe('consent_withdrawn');
    expect(running.seen.inTransaction).toBe(false);
  });

  it.each([
    ['égal à l’accord', '2026-11-05T10:00:00.000Z'],
    ['égal au début de l’époque', '2026-11-05T12:00:00.000Z'],
    ['postérieur au début de l’époque', '2026-11-05T12:10:00.000Z'],
  ])('refuse un retrait %s : 409 conflict, rien ne change', async (_label, withdrawnAt) => {
    const u = await restored();
    const before = await state(u);
    const res = await replay(u, 'ai_coach', withdrawnAt);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict' });
    expect(await state(u)).toEqual(before);
  });

  it('refuse quand l’accord coach est déjà retiré ou n’a jamais existé', async () => {
    const u = await restored();
    expect((await withdraw(u, 'ai_coach')).status).toBe(200);
    const before = await state(u);
    expect((await replay(u, 'ai_coach', '2026-11-05T11:00:00.000Z')).status).toBe(409);
    expect(await state(u)).toEqual(before);

    // L'accord santé ne vaut pas accord coach.
    const v = await createUserAndLogin(ctx, { username: 'vera' });
    expect((await grant(v, 'health')).status).toBe(200);
    const res = await replay(v, 'ai_coach', '2026-11-05T11:00:00.000Z');
    expect(res.status).toBe(409);
    expect((await consents(v)).health).toMatchObject({ active: true });
  });

  it('même limiteur que le renvoi santé : le 21e appel de l’heure, tous accords confondus, répond 429', async () => {
    const u = await restored();
    for (let i = 0; i < 10; i += 1) expect((await replay(u, 'health', 'hier')).status).toBe(400);
    for (let i = 0; i < 10; i += 1) expect((await replay(u, 'ai_coach', 'hier')).status).toBe(400);
    const before = await state(u);
    const res = await replay(u, 'ai_coach', '2026-11-05T11:00:00.000Z');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'rate_limited' });
    expect(await state(u)).toEqual(before);
  });

  it('un type inconnu n’a pas de route', async () => {
    const u = await restored();
    expect(
      (await call(u, '/api/me/consents/nutrition/replay-withdraw', 'POST', { withdrawnAt: NOW })).status,
    ).toBe(404);
  });
});
