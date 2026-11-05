import { type CoachStreamEvent, CoachStreamEventSchema } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeText } from '../../src/ai';
import { createUserAndLogin, login } from '../support';
import { type ExchangeKit, exchangeKit } from '../support/coach';

/* Routes /api/coach (spec brique 4 §7.1, §7.3). */

let kit: ExchangeKit;
let cookie: string;
afterEach(() => kit?.ctx.close());

async function setup(chat: Parameters<typeof exchangeKit>[0]['chat'] = [fakeText('Garde ton rythme.')]) {
  kit = await exchangeKit({ chat });
  cookie = await login(kit.ctx, kit.user.username, kit.user.password);
}

const req = (
  path: string,
  init: { method?: string; json?: unknown; cookie?: string | null; origin?: string | null } = {},
) =>
  kit.ctx.request(path, {
    ...(init.method === undefined ? {} : { method: init.method }),
    ...(init.json === undefined ? {} : { json: init.json }),
    ...(init.origin === undefined ? {} : { origin: init.origin }),
    ...(init.cookie === null ? {} : { cookie: init.cookie ?? cookie }),
  });

const post = (json: unknown, o: { cookie?: string | null; origin?: string | null } = {}) =>
  req('/api/coach/messages', { method: 'POST', json, ...o });
const body = (text: string, clientMessageId = kit.ctx.deps.ids.uuidv7()) => ({ clientMessageId, text });

async function events(res: Response): Promise<CoachStreamEvent[]> {
  return (await res.text())
    .split('\n\n')
    .filter((b) => b.startsWith('event: '))
    .map((b) => {
      const [head = '', data = ''] = b.split('\n');
      return CoachStreamEventSchema.parse({ type: head.slice(7), ...JSON.parse(data.slice(6)) });
    });
}

describe('POST /messages : refus avant le flux (JSON)', () => {
  it('sans session : 401', async () => {
    await setup();
    expect((await post(body('Salut'), { cookie: null })).status).toBe(401);
  });

  it('Origin étrangère : 403', async () => {
    await setup();
    const res = await post(body('Salut'), { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'origin_mismatch' });
  });

  it('second envoi pendant le premier : 409 request_in_progress', async () => {
    const gate = Promise.withResolvers<void>();
    await setup([fakeText('Garde ton rythme.', { gate: gate.promise })]);
    const first = await post(body('Premier'));
    expect(first.status).toBe(200);
    const second = await post(body('Second'));
    expect(second.status).toBe(409);
    expect(second.headers.get('content-type')).toContain('application/json');
    expect(await second.json()).toMatchObject({ error: 'request_in_progress' });
    gate.resolve();
    await first.text();
  });

  it('même clientMessageId : 409 duplicate_message avec le seq', async () => {
    await setup([fakeText('Une.'), fakeText('Deux.')]);
    const id = kit.ctx.deps.ids.uuidv7();
    await (await post(body('Salut', id))).text();
    const again = await post(body('Salut', id));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'duplicate_message', seq: 1 });
  });

  it.each([
    ['vide', ''],
    ['de blancs', '   \n\t '],
    ['de 2 001 points de code', 'a'.repeat(2001)],
    ['de 2 001 « 💪 »', '💪'.repeat(2001)],
  ])('texte %s : 400 validation', async (_name, text) => {
    await setup();
    const res = await post(body(text));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
  });

  it('corps invalide : 400 validation', async () => {
    await setup();
    expect((await post({ text: 'Salut' })).status).toBe(400);
  });

  it('2 000 « 💪 » : accepté', async () => {
    await setup();
    const res = await post(body('💪'.repeat(2000)));
    expect(res.status).toBe(200);
    expect((await events(res)).at(-1)?.type).toBe('done');
  });

  it('fil fermé : 409 thread_closed avec la raison', async () => {
    await setup();
    await (await post(body('Salut'))).text();
    kit.ctx.deps.sqlite.exec("UPDATE coach_thread SET is_open = 0, closed_reason = 'version_change'");
    const res = await post(body('Encore'));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'thread_closed', reason: 'version_change' });
  });

  it('sans accord : 403 consent_required', async () => {
    await setup();
    const other = await createUserAndLogin(kit.ctx);
    const res = await post(body('Salut'), { cookie: other.cookie });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'consent_required' });
  });

  it('coach coupé : 503 coach_unavailable', async () => {
    await setup();
    kit.ctx.deps.sqlite.exec('UPDATE coach_state SET enabled = 0');
    const res = await post(body('Salut'));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'coach_unavailable', reason: 'disabled' });
  });
});

describe('lectures', () => {
  it('GET /status : état du coach, devUnevaluated compris', async () => {
    await setup();
    const res = await req('/api/coach/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      available: true,
      unavailableReason: null,
      consent: { active: true },
      today: { threadId: null, open: true, userMessageCount: 0, remaining: 30, inProgress: false },
      devUnevaluated: false,
    });
  });

  it('GET /status : devUnevaluated vrai en mode dev', async () => {
    await setup();
    kit.ctx.deps.coach.configured = { ok: true, devUnevaluated: true, catalogVersion: 'x' };
    expect(await (await req('/api/coach/status')).json()).toMatchObject({ devUnevaluated: true });
  });

  it('GET /today : fil du jour et messages rendus', async () => {
    await setup();
    expect(await (await req('/api/coach/today')).json()).toEqual({
      thread: null,
      messages: [],
      inProgress: false,
    });
    await (await post(body('Salut'))).text();
    const today = (await (await req('/api/coach/today')).json()) as {
      thread: { id: string };
      messages: { seq: number; role: string; text: string }[];
    };
    expect(today.thread.id).toBeTruthy();
    expect(today.messages.map((m) => [m.seq, m.role, m.text])).toEqual([
      [1, 'user', 'Salut'],
      [2, 'assistant', 'Garde ton rythme.'],
    ]);
  });

  it('GET /threads : fils des 90 derniers jours, pas au-delà', async () => {
    await setup();
    await (await post(body('Salut'))).text();
    const old = (day: string) =>
      kit.ctx.deps.sqlite.exec(
        `CREATE TEMP TABLE copie AS SELECT * FROM coach_thread WHERE day = '2026-11-05';
         UPDATE copie SET id = '${day}', day = '${day}', is_open = 0;
         INSERT INTO coach_thread SELECT * FROM copie;
         DROP TABLE copie;`,
      );
    old('2026-08-07'); // 90 jours avant le 5 novembre : gardé
    old('2026-08-06'); // 91 jours : écarté
    const { threads } = (await (await req('/api/coach/threads')).json()) as {
      threads: { id: string; day: string; userMessageCount: number; open: boolean }[];
    };
    expect(threads.map((t) => t.day)).toEqual(['2026-11-05', '2026-08-07']);
    expect(threads[0]).toMatchObject({ userMessageCount: 1, open: true });
  });

  it('GET /threads/:id : le fil en lecture seule', async () => {
    await setup();
    await (await post(body('Salut'))).text();
    const id = kit.rows('SELECT id FROM coach_thread')[0]?.id as string;
    const res = await req(`/api/coach/threads/${id}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { thread: { id: string }; messages: unknown[] };
    expect(data.thread.id).toBe(id);
    expect(data.messages).toHaveLength(2);
  });

  it('GET /brief : le JSON stocké exact ; sans fil, un aperçu', async () => {
    await setup();
    const preview = (await (await req('/api/coach/brief')).json()) as Record<string, unknown>;
    expect(preview).toMatchObject({ threadId: null, preview: true });
    expect(preview.brief).toBeTruthy();
    expect(kit.rows('SELECT id FROM coach_thread')).toEqual([]);

    await (await post(body('Salut'))).text();
    const stored = kit.rows('SELECT id, brief FROM coach_thread')[0] as { id: string; brief: string };
    const res = (await (await req('/api/coach/brief')).json()) as Record<string, unknown>;
    expect(res).toMatchObject({ threadId: stored.id, day: '2026-11-05', preview: false });
    expect(res.brief).toEqual(JSON.parse(stored.brief));
  });

  it("GET /brief : un dossier d'un schéma antérieur passe tel quel", async () => {
    await setup();
    await (await post(body('Salut'))).text();
    const old = { ancien: true, profil: { age: 30 } };
    kit.ctx.deps.sqlite
      .prepare("UPDATE coach_thread SET brief_schema = 'coach-brief/0', brief = ?")
      .run(JSON.stringify(old));
    const res = await req('/api/coach/brief');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ brief: old, preview: false });
  });
});

describe('suppressions et propriété', () => {
  it('DELETE /threads/:id et DELETE /threads : 204', async () => {
    await setup([fakeText('Une.')]);
    await (await post(body('Salut'))).text();
    const id = kit.rows('SELECT id FROM coach_thread')[0]?.id as string;
    expect((await req(`/api/coach/threads/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect(kit.rows('SELECT id FROM coach_thread')).toEqual([]);
    expect((await req(`/api/coach/threads/${id}`, { method: 'DELETE' })).status).toBe(404);

    await (await post(body('Encore'))).text().catch(() => '');
    expect((await req('/api/coach/threads', { method: 'DELETE' })).status).toBe(204);
    expect(kit.rows('SELECT id FROM coach_thread')).toEqual([]);
  });

  it("identifiant d'un autre membre : 404, session admin comprise", async () => {
    await setup();
    await (await post(body('Salut'))).text();
    const id = kit.rows('SELECT id FROM coach_thread')[0]?.id as string;
    const admin = await createUserAndLogin(kit.ctx, { role: 'admin' });
    const member = await createUserAndLogin(kit.ctx);
    for (const other of [admin.cookie, member.cookie]) {
      expect((await req(`/api/coach/threads/${id}`, { cookie: other })).status).toBe(404);
      expect((await req(`/api/coach/threads/${id}`, { method: 'DELETE', cookie: other })).status).toBe(404);
    }
    expect(kit.rows('SELECT id FROM coach_thread')).toHaveLength(1);
  });

  it('suppression sans Origin : 403', async () => {
    await setup();
    expect((await req('/api/coach/threads', { method: 'DELETE', origin: null })).status).toBe(403);
  });

  it('lectures sans session : 401', async () => {
    await setup();
    for (const path of ['status', 'today', 'threads', 'brief']) {
      expect((await req(`/api/coach/${path}`, { cookie: null })).status).toBe(401);
    }
  });
});
