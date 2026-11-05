import { afterEach, describe, expect, it } from 'vitest';
import {
  createLogger,
  createTestContext,
  createUser,
  insertFixtureRow,
  login,
  type TestContext,
} from '../support';

/*
 * Signalement d'une réponse du coach (spec brique 4 §16.6, §17.2) : copie de l'échange, 404 hors de ce qui est à
 * la personne, commentaire borné, journal de sécurité sans contenu (P-LOG-2).
 */

let ctx: TestContext;
let lines: string[];
afterEach(() => ctx?.close());

async function setup() {
  lines = [];
  ctx = await createTestContext({
    now: '2026-11-05T10:00:00.000Z',
    deps: { logger: createLogger((l) => lines.push(l)) },
  });
  const user = await createUser(ctx, { username: 'lea' });
  const cookie = await login(ctx, 'lea', user.password);
  const thread = await insertFixtureRow(ctx.deps.db, 'coach_thread', { userId: user.id });
  const threadId = thread.id as string;
  await insertFixtureRow(ctx.deps.db, 'coach_message', {
    threadId,
    userId: user.id,
    seq: 1,
    role: 'user',
    displayText: 'Je peux monter ma charge ?',
  });
  await insertFixtureRow(ctx.deps.db, 'coach_message', {
    threadId,
    userId: user.id,
    seq: 2,
    role: 'assistant',
    displayText: 'Oui, de 2 kg.',
  });
  return { user, cookie, threadId };
}

const report = (cookie: string, json: unknown) =>
  ctx.request('/api/coach/reports', { method: 'POST', cookie, json });

describe('POST /api/coach/reports', () => {
  it("réponse du coach : 201, copie exacte de l'échange, journal sans contenu", async () => {
    const { user, cookie, threadId } = await setup();
    const res = await report(cookie, { threadId, messageSeq: 2, category: 'unsafe', comment: 'Trop lourd' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const row = await ctx.deps.db
      .selectFrom('coachReport')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    expect(row).toMatchObject({
      userId: user.id,
      threadId,
      messageSeq: 2,
      category: 'unsafe',
      comment: 'Trop lourd',
      exchangeText: 'Toi : Je peux monter ma charge ?\n\nCoach IA : Oui, de 2 kg.',
      createdAt: '2026-11-05T10:00:00.000Z',
    });
    const events = await ctx.deps.db
      .selectFrom('securityEvent')
      .selectAll()
      .where('type', '=', 'coach_report_created')
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: user.id, details: null });
    const logged = JSON.stringify(events) + lines.join('\n');
    for (const secret of ['Je peux monter', 'Oui, de 2 kg', 'Trop lourd', 'lea']) {
      expect(logged).not.toContain(secret);
    }
  });

  it("le numéro d'un message de la personne : 404", async () => {
    const { cookie, threadId } = await setup();
    const res = await report(cookie, { threadId, messageSeq: 1, category: 'other' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(await ctx.deps.db.selectFrom('coachReport').select('id').execute()).toEqual([]);
  });

  it("un fil ou un message inexistant, ou le fil d'un autre : 404", async () => {
    const { cookie, threadId } = await setup();
    const other = await createUser(ctx, { username: 'paul' });
    const otherCookie = await login(ctx, 'paul', other.password);
    expect((await report(otherCookie, { threadId, messageSeq: 2, category: 'other' })).status).toBe(404);
    expect((await report(cookie, { threadId: 'absent', messageSeq: 2, category: 'other' })).status).toBe(404);
    expect((await report(cookie, { threadId, messageSeq: 9, category: 'other' })).status).toBe(404);
  });

  it('commentaire de 501 caractères : 400 ; 500 accepté', async () => {
    const { cookie, threadId } = await setup();
    const tooLong = await report(cookie, {
      threadId,
      messageSeq: 2,
      category: 'other',
      comment: 'a'.repeat(501),
    });
    expect(tooLong.status).toBe(400);
    const ok = await report(cookie, { threadId, messageSeq: 2, category: 'other', comment: 'a'.repeat(500) });
    expect(ok.status).toBe(201);
  });

  it('sans session : 401', async () => {
    await setup();
    const res = await ctx.request('/api/coach/reports', {
      method: 'POST',
      json: { threadId: 'x', messageSeq: 2, category: 'other' },
    });
    expect(res.status).toBe(401);
  });
});

describe('tours intermédiaires des outils', () => {
  async function withTools() {
    const base = await setup();
    const { user, threadId } = base;
    // Après le seq 2 : appel d'outil (assistant sans texte), résultat (user sans texte), réponse finale.
    await insertFixtureRow(ctx.deps.db, 'coach_message', {
      threadId,
      userId: user.id,
      seq: 3,
      role: 'assistant',
      displayText: null,
    });
    await insertFixtureRow(ctx.deps.db, 'coach_message', {
      threadId,
      userId: user.id,
      seq: 4,
      role: 'user',
      displayText: null,
    });
    await insertFixtureRow(ctx.deps.db, 'coach_message', {
      threadId,
      userId: user.id,
      seq: 5,
      role: 'assistant',
      displayText: 'Voici ma réponse finale.',
    });
    return base;
  }

  it("l'échange cite la vraie question, pas le tour de résultat d'outil", async () => {
    const { cookie, threadId } = await withTools();
    const res = await report(cookie, { threadId, messageSeq: 5, category: 'other' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const row = await ctx.deps.db
      .selectFrom('coachReport')
      .select('exchangeText')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.exchangeText).toBe('Toi : Je peux monter ma charge ?\n\nCoach IA : Voici ma réponse finale.');
  });

  it('signaler un tour intermédiaire (sans texte) : 404', async () => {
    const { cookie, threadId } = await withTools();
    const res = await report(cookie, { threadId, messageSeq: 3, category: 'other' });
    expect(res.status).toBe(404);
  });

  it('un second signalement du même message rend le même id, sans nouvelle ligne', async () => {
    const { cookie, threadId } = await setup();
    const first = (await (await report(cookie, { threadId, messageSeq: 2, category: 'other' })).json()) as {
      id: string;
    };
    const second = await report(cookie, { threadId, messageSeq: 2, category: 'unsafe' });
    expect(second.status).toBe(201);
    expect(((await second.json()) as { id: string }).id).toBe(first.id);
    expect(await ctx.deps.db.selectFrom('coachReport').select('id').execute()).toHaveLength(1);
  });
});
