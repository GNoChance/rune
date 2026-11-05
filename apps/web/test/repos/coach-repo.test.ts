import { describe, expect, it } from 'vitest';
import { ApiError, NetworkRequiredError } from '../../src/api/client';
import { coachRepoFor } from '../../src/repos/coach-repo';
import { createTestServices, makeMe } from '../support/render';

const ID = '01970000-0000-7000-8000-000000000001';

const STATUS = {
  available: true,
  unavailableReason: null,
  suspendedUntil: null,
  consent: { active: true, textVersion: 'v1', currentVersion: 'v1', needsRenewal: false },
  audience: 'adult',
  persona: 'ombre',
  today: {
    threadId: null,
    open: false,
    closedReason: null,
    userMessageCount: 0,
    remaining: 30,
    inProgress: false,
  },
  budgetUsedPct: 0,
  devUnevaluated: false,
};

describe('coachRepo', () => {
  it("send : POST du corps exact, événements rendus dans l'ordre", async () => {
    const { services, api } = await createTestServices();
    api.on('POST', '/api/coach/messages', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: 'event: text\ndata: {"text":"Bonjour"}\n\nevent: refused\ndata: {"message":"non"}\n\n',
    });
    const events: unknown[] = [];
    await coachRepoFor(services).send({ clientMessageId: ID, text: 'Salut' }, (e) => events.push(e));
    const call = api.calls.find((c) => c.path === '/api/coach/messages');
    expect(call?.method).toBe('POST');
    expect(call?.body).toEqual({ clientMessageId: ID, text: 'Salut' });
    expect(call?.headers.get('Content-Type')).toBe('application/json');
    expect(events).toEqual([
      { type: 'text', text: 'Bonjour' },
      { type: 'refused', message: 'non' },
    ]);
  });

  it('send : un 409 request_in_progress avant le flux est une ApiError', async () => {
    const { services, api } = await createTestServices();
    api.on('POST', '/api/coach/messages', { status: 409, body: { error: 'request_in_progress' } });
    const error = await coachRepoFor(services)
      .send({ clientMessageId: ID, text: 'Salut' }, () => {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'request_in_progress' });
  });

  it("send : hors ligne → NetworkRequiredError, rien d'écrit dans Dexie", async () => {
    const { services, api, db } = await createTestServices();
    api.setOffline('reject');
    const outboxBefore = await db.table('outbox').count();
    await expect(
      coachRepoFor(services).send({ clientMessageId: ID, text: 'x' }, () => {}),
    ).rejects.toBeInstanceOf(NetworkRequiredError);
    expect(await db.table('outbox').count()).toBe(outboxBefore);
  });

  it('lectures : status, today, threads, thread, brief', async () => {
    const { services, api } = await createTestServices();
    const thread = {
      id: 't1',
      day: '2026-10-06',
      audience: 'adult',
      persona: 'ombre',
      open: true,
      closedReason: null,
      userMessageCount: 1,
      createdAt: '2026-10-06T10:00:00.000Z',
    };
    api
      .on('GET', '/api/coach/status', { status: 200, body: STATUS })
      .on('GET', '/api/coach/today', { status: 200, body: { thread: null, messages: [], inProgress: false } })
      .on('GET', '/api/coach/threads', {
        status: 200,
        body: { threads: [{ id: 't1', day: '2026-10-06', userMessageCount: 1, open: true }] },
      })
      .on('GET', '/api/coach/threads/:id', { status: 200, body: { thread, messages: [] } })
      .on('GET', '/api/coach/brief', {
        status: 200,
        body: { brief: null, threadId: null, day: '2026-10-06', preview: true },
      });
    const repo = coachRepoFor(services);
    expect((await repo.status()).persona).toBe('ombre');
    expect((await repo.today()).inProgress).toBe(false);
    expect((await repo.threads()).threads).toHaveLength(1);
    expect((await repo.thread('t1')).thread.id).toBe('t1');
    expect((await repo.brief()).preview).toBe(true);
  });

  it('écritures : suppressions, signalement, accord, retrait', async () => {
    const { services, api } = await createTestServices();
    api
      .on('DELETE', '/api/coach/threads/:id', { status: 204 })
      .on('DELETE', '/api/coach/threads', { status: 204 })
      .on('POST', '/api/coach/reports', { status: 201, body: { id: 'r1' } })
      .on('POST', '/api/me/consents', { status: 200, body: makeMe() })
      .on('POST', '/api/me/consents/withdraw', { status: 200, body: makeMe() });
    const repo = coachRepoFor(services);
    await repo.deleteThread('t 1');
    await repo.deleteAllThreads();
    await repo.report({ threadId: 't1', messageSeq: 2, category: 'unsafe' });
    await repo.grant('coach-1');
    await repo.withdraw('secret');
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'DELETE /api/coach/threads/t%201',
      'DELETE /api/coach/threads',
      'POST /api/coach/reports',
      'POST /api/me/consents',
      'POST /api/me/consents/withdraw',
    ]);
    expect(api.calls[2]?.body).toEqual({ threadId: 't1', messageSeq: 2, category: 'unsafe' });
    expect(api.calls[3]?.body).toEqual({ type: 'ai_coach', textVersion: 'coach-1' });
    expect(api.calls[4]?.body).toEqual({ type: 'ai_coach', password: 'secret' });
  });
});
