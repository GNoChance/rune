import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AI_COACH_CONSENT_TEXT, type CoachStreamEvent, CoachStreamEventSchema } from '@rune/contracts';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeText } from '../../src/ai';
import type { AppEnv } from '../../src/app-env';
import { createSession } from '../../src/auth/session';
import { runCli } from '../../src/cli';
import { sseStream } from '../../src/coach/sse';
import { startServer } from '../../src/main';
import { grantConsent } from '../../src/privacy/consent';
import { enableCoach, login, type TestContext } from '../support';
import { exchangeKit } from '../support/coach';
import { createUser } from '../support/users';

/* Flux SSE du coach (spec brique 4 §7.2) : format, en-têtes, ping, déconnexion, arrêt du serveur. */

const decoder = new TextDecoder();

/** Événements d'un flux SSE brut, relus par le schéma du flux (les commentaires sont ignorés). */
function eventsOf(raw: string): CoachStreamEvent[] {
  return raw
    .split('\n\n')
    .filter((block) => block.startsWith('event: '))
    .map((block) => {
      const [head = '', data = ''] = block.split('\n');
      return CoachStreamEventSchema.parse({ type: head.slice(7), ...JSON.parse(data.slice(6)) });
    });
}

function appWith(run: Parameters<typeof sseStream>[1], opts?: Parameters<typeof sseStream>[2]) {
  const app = new Hono<AppEnv>();
  app.get('/s', (c) => sseStream(c, run, opts));
  return app;
}

const bodyOf = (res: Response) => res.body as ReadableStream<Uint8Array>;

afterEach(() => {
  vi.useRealTimers();
});

describe('sseStream', () => {
  it('en-têtes exacts, sans compression', async () => {
    const res = await appWith(async () => {}).request('/s');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(res.headers.get('content-encoding')).toBeNull();
    await res.text();
  });

  it("event: <type> puis data: <JSON sans type>, dans l'ordre, flux fermé à la fin de run", async () => {
    const res = await appWith(async (send) => {
      send({ type: 'text', text: 'Bonjour.' });
      send({ type: 'retry', reason: 'filter' });
      send({ type: 'error', code: 'internal' });
    }).request('/s');
    expect(await res.text()).toBe(
      'event: text\ndata: {"text":"Bonjour."}\n\nevent: retry\ndata: {"reason":"filter"}\n\nevent: error\ndata: {"code":"internal"}\n\n',
    );
  });

  it('commentaire : ping toutes les 15 s tant que run est retenu', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const gate = Promise.withResolvers<void>();
    const res = await appWith(async (send) => {
      await gate.promise;
      send({ type: 'text', text: 'Fin.' });
    }).request('/s');
    const reader = bodyOf(res).getReader();

    await vi.advanceTimersByTimeAsync(14_999);
    expect(await Promise.race([reader.read(), Promise.resolve('rien')])).toBe('rien');
    await vi.advanceTimersByTimeAsync(1);
    // La lecture lancée plus haut reçoit le premier ping.
    await vi.advanceTimersByTimeAsync(15_000);
    gate.resolve();
    const rest = [];
    for (let r = await reader.read(); !r.done; r = await reader.read()) rest.push(decoder.decode(r.value));
    expect(rest.join('')).toContain(': ping\n\n');
    expect(rest.join('')).toMatch(/event: text\ndata: \{"text":"Fin."\}\n\n$/);
  });

  it('un ping tombe à 15 s pile, un second à 30 s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const gate = Promise.withResolvers<void>();
    const res = await appWith(async () => {
      await gate.promise;
    }).request('/s');
    const reader = bodyOf(res).getReader();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(decoder.decode((await reader.read()).value)).toBe(': ping\n\n');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(decoder.decode((await reader.read()).value)).toBe(': ping\n\n');
    gate.resolve();
    expect((await reader.read()).done).toBe(true);
  });

  it('téléphone parti : les écritures sont ignorées et run va au bout', async () => {
    const gate = Promise.withResolvers<void>();
    let finished = false;
    let thrown: unknown = null;
    const res = await appWith(async (send) => {
      await gate.promise;
      try {
        send({ type: 'text', text: 'Perdu.' });
      } catch (error) {
        thrown = error;
      }
      finished = true;
    }).request('/s');
    await bodyOf(res).cancel();
    gate.resolve();
    await vi.waitFor(() => expect(finished).toBe(true));
    expect(thrown).toBeNull();
  });
});

describe('flux de /api/coach/messages', () => {
  let kit: Awaited<ReturnType<typeof exchangeKit>>;
  afterEach(() => kit?.ctx.close());

  const post = (cookie: string, text = 'Comment était ma séance ?') =>
    kit.ctx.request('/api/coach/messages', {
      method: 'POST',
      cookie,
      json: { clientMessageId: kit.ctx.deps.ids.uuidv7(), text },
    });

  it('événements dans l’ordre, de text à done, relus par le schéma', async () => {
    kit = await exchangeKit({ chat: [fakeText('Garde ton rythme actuel.')] });
    const cookie = await login(kit.ctx, kit.user.username, kit.user.password);
    const res = await post(cookie);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    const events = eventsOf(await res.text());
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
    expect(events[0]).toEqual({ type: 'text', text: 'Garde ton rythme actuel.' });
    expect(events[1]).toMatchObject({ type: 'done', userSeq: 1, assistantSeq: 2, remainingToday: 29 });
  });

  it("téléphone déconnecté au milieu : l'échange est quand même enregistré", async () => {
    const gate = Promise.withResolvers<void>();
    kit = await exchangeKit({ chat: [fakeText('Garde ton rythme.', { gate: gate.promise })] });
    const cookie = await login(kit.ctx, kit.user.username, kit.user.password);
    const res = await post(cookie);
    await vi.waitFor(() => expect(kit.fake.chatCalls.length).toBe(1));

    await bodyOf(res).cancel();
    gate.resolve();

    await vi.waitFor(() =>
      expect(kit.rows('SELECT role FROM coach_message ORDER BY seq').map((r) => r.role)).toEqual([
        'user',
        'assistant',
      ]),
    );
    await vi.waitFor(() => expect(kit.ctx.deps.coach.exchanges.inProgress(kit.user.id)).toBe(false));
  });

  it("fil du jour supprimé pendant l'échange : il n'est pas interrompu, il finit par error thread_closed", async () => {
    const gate = Promise.withResolvers<void>();
    kit = await exchangeKit({ chat: [fakeText('Garde ton rythme.', { gate: gate.promise })] });
    const cookie = await login(kit.ctx, kit.user.username, kit.user.password);
    const res = await post(cookie);
    await vi.waitFor(() => expect(kit.fake.chatCalls.length).toBe(1));
    const thread = kit.rows('SELECT id FROM coach_thread')[0]?.id as string;

    const del = await kit.ctx.request(`/api/coach/threads/${thread}`, { method: 'DELETE', cookie });
    expect(del.status).toBe(204);
    expect(kit.fake.chatCalls).toHaveLength(1);
    gate.resolve();

    const events = eventsOf(await res.text());
    expect(events.at(-1)).toEqual({ type: 'error', code: 'thread_closed' });
    expect(kit.rows('SELECT id FROM coach_message')).toEqual([]);
    expect(kit.rows('SELECT error_code FROM coach_call')).toEqual([{ error_code: 'thread_closed' }]);
  });
});

describe('arrêt du serveur', () => {
  it('RunningServer.close() pendant un flux : error shutdown reçu', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rune-sse-'));
    const env = { APP_ORIGIN: 'http://localhost:3999', RUNE_DATA_DIR: dir, HOST: '127.0.0.1', PORT: '0' };
    writeFileSync(join(dir, '.rune-volume'), '');
    const quiet = () => {};
    expect(await runCli(['init'], env, quiet, quiet)).toBe(0);
    const running = await startServer(env, { thinkingBinding: 'error' });
    try {
      const { deps } = running;
      const ctx = { deps } as TestContext;
      const gate = Promise.withResolvers<void>();
      const fake = await enableCoach(ctx, [fakeText('Jamais.', { gate: gate.promise })]);
      const user = await createUser(ctx);
      await grantConsent(deps.db, deps, user.id, 'ai_coach', AI_COACH_CONSENT_TEXT.version, null);
      const { token } = await createSession(deps.db, deps, user.id);

      const res = await fetch(`http://127.0.0.1:${running.port}/api/coach/messages`, {
        method: 'POST',
        headers: {
          Origin: env.APP_ORIGIN,
          'Content-Type': 'application/json',
          Cookie: `${deps.config.sessionCookieName}=${token}`,
        },
        body: JSON.stringify({ clientMessageId: deps.ids.uuidv7(), text: 'Salut' }),
      });
      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(fake.chatCalls.length).toBe(1));

      const closing = running.close();
      const events = eventsOf(await res.text());
      await closing;
      expect(events.at(-1)).toEqual({ type: 'error', code: 'shutdown' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
