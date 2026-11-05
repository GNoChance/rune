import type { CoachProposalEvent, CoachTodayResponse } from '@rune/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CoachState, coachStoreFor } from '../../src/features/coach/coach-store';
import { deleteMeta, setMeta } from '../../src/local-db/meta';
import { coachRepoFor } from '../../src/repos/coach-repo';
import { createTestServices, makeMe } from '../support/render';
import { until } from '../support/wait';

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

const THREAD = {
  id: 't1',
  day: '2026-10-06',
  audience: 'adult',
  persona: 'ombre',
  open: true,
  closedReason: null,
  userMessageCount: 1,
  createdAt: '2026-10-06T10:00:00.000Z',
};

const EMPTY_TODAY = { thread: null, messages: [], inProgress: false };

function message(seq: number, role: 'user' | 'assistant', text: string) {
  return {
    seq,
    role,
    text,
    createdAt: '2026-10-06T10:00:00.000Z',
    aiGenerated: role === 'assistant',
    model: null,
    truncated: false,
    replaced: false,
    helpCards: [],
    proposalIds: [],
    links: [],
  };
}

const TODAY_WITH_USER: CoachTodayResponse = {
  thread: THREAD,
  messages: [message(1, 'user', 'Salut'), message(2, 'assistant', 'Bonjour')],
  inProgress: false,
} as CoachTodayResponse;

const sse = (frames: string) => ({
  status: 200,
  headers: { 'Content-Type': 'text/event-stream' },
  body: frames,
});

const DONE = (proposalIds: string[] = []) =>
  `event: done\ndata: ${JSON.stringify({
    threadId: 't1',
    userSeq: 1,
    assistantSeq: 2,
    truncated: false,
    replaced: false,
    proposalIds,
    remainingToday: 29,
  })}\n\n`;

const TEXT = (text: string) => `event: text\ndata: ${JSON.stringify({ text })}\n\n`;
const ERROR = (code: string) => `event: error\ndata: ${JSON.stringify({ code })}\n\n`;

const PROPOSAL: CoachProposalEvent = {
  type: 'proposal',
  id: 'p1',
  baseRevision: 3,
  operations: [{ op: 'start_deload' }],
  reasonCode: 'COACH_PROPOSAL',
  reason: null,
  expiresAt: '2026-10-07T10:00:00.000Z',
};

async function setup(opts: { today?: unknown } = {}) {
  const t = await createTestServices();
  t.api
    .on('GET', '/api/coach/status', { status: 200, body: STATUS })
    .on('GET', '/api/coach/today', { status: 200, body: opts.today ?? EMPTY_TODAY });
  const store = coachStoreFor(t.services);
  const states: CoachState[] = [];
  store.subscribe(() => states.push(store.getState()));
  const calls = (method: string, path: string) =>
    t.api.calls.filter((c) => c.method === method && c.path === path);
  return { ...t, store, states, calls };
}

/** Attend que l'utilisateur de l'appareil ait été lu une première fois, comme le magasin l'a fait. */
async function userKnown(services: Parameters<typeof coachRepoFor>[0]): Promise<void> {
  let known = false;
  const stop = coachRepoFor(services).watchUser(() => {
    known = true;
  });
  await until(() => known);
  stop();
}

describe('CoachStore', () => {
  afterEach(() => vi.useRealTimers());

  it('un seul magasin par services', async () => {
    const { services, store } = await setup();
    expect(coachStoreFor(services)).toBe(store);
  });

  it('load : flushBefore puis status et today', async () => {
    const { store, sync } = await setup();
    await store.load();
    expect(sync.triggers.filter((x) => x === 'coach')).toHaveLength(1);
    const s = store.getState();
    expect(s.status?.persona).toBe('ombre');
    expect(s.today).toEqual(EMPTY_TODAY);
    expect(s.phase).toBe('idle');
  });

  it('load hors ligne : phase error, offline', async () => {
    const { store, api } = await setup();
    api.setOffline('reject');
    await store.load();
    expect(store.getState()).toMatchObject({ phase: 'error', error: 'offline' });
  });

  it("text s'ajoute à bubble, tool_running pose l'outil, proposal et help_card s'accumulent", async () => {
    const { store, api, states } = await setup();
    const { type: _t, ...proposalData } = PROPOSAL;
    api.on(
      'POST',
      '/api/coach/messages',
      sse(
        `event: tool_running\ndata: {"tool":"read_training"}\n\n${TEXT('Bonjour. ')}${TEXT('Ça va ?')}` +
          `event: proposal\ndata: ${JSON.stringify(proposalData)}\n\n` +
          `event: help_card\ndata: {"resource":"pain"}\n\n${DONE()}`,
      ),
    );
    await store.load();
    store.setDraft('Salut');
    await store.send();
    const pendings = states.map((s) => s.pending).filter((p) => p !== null);
    expect(pendings.map((p) => p.bubble)).toContain('Bonjour. ');
    expect(pendings.map((p) => p.bubble)).toContain('Bonjour. Ça va ?');
    expect(pendings.some((p) => p.tool === 'read_training')).toBe(true);
    const last = pendings.at(-1);
    expect(last?.proposals).toEqual([PROPOSAL]);
    expect(last?.helpCards).toEqual(['pain']);
    expect(states.some((s) => s.phase === 'streaming')).toBe(true);
  });

  it('retry efface la bulle et les cartes', async () => {
    const { store, api, states } = await setup();
    api.on(
      'POST',
      '/api/coach/messages',
      sse(
        `${TEXT('Brouillon')}event: help_card\ndata: {"resource":"pain"}\n\n` +
          `event: retry\ndata: {"reason":"filter"}\n\n${TEXT('Version propre')}${DONE()}`,
      ),
    );
    await store.load();
    store.setDraft('Salut');
    await store.send();
    const bubbles = states.flatMap((s) => (s.pending ? [s.pending] : []));
    const draftIdx = bubbles.findIndex((p) => p.bubble === 'Brouillon' && p.helpCards.length === 1);
    const clearedIdx = bubbles.findIndex(
      (p, i) => i > draftIdx && p.bubble === '' && p.helpCards.length === 0 && p.proposals.length === 0,
    );
    expect(draftIdx).toBeGreaterThanOrEqual(0);
    expect(clearedIdx).toBeGreaterThan(draftIdx);
    expect(bubbles.some((p) => p.bubble === 'Version propre')).toBe(true);
    expect(bubbles.some((p) => p.bubble === 'BrouillonVersion propre')).toBe(false);
  });

  it('done relit today, vide le champ, rend la main ; pullNow seulement avec des proposalIds', async () => {
    const { store, api, sync, calls } = await setup();
    api.on('POST', '/api/coach/messages', sse(`${TEXT('Bonjour')}${DONE(['p1'])}`));
    await store.load();
    const todayReads = calls('GET', '/api/coach/today').length;
    api.on('GET', '/api/coach/today', { status: 200, body: TODAY_WITH_USER });
    store.setDraft('Salut');
    await store.send();
    expect(calls('GET', '/api/coach/today').length).toBe(todayReads + 1);
    expect(sync.pullCount).toBe(1);
    expect(store.getState()).toMatchObject({ draft: '', pending: null, phase: 'idle', error: null });
    expect(store.getState().today?.messages).toHaveLength(2);

    api.on('POST', '/api/coach/messages', sse(`${TEXT('Re')}${DONE([])}`));
    store.setDraft('Encore');
    await store.send();
    expect(sync.pullCount).toBe(1);
  });

  it.each(['api_unavailable', 'timeout', 'thread_closed'])(
    'error %s : le texte revient au champ, today est relu',
    async (code) => {
      const { store, api, calls } = await setup();
      api.on('POST', '/api/coach/messages', sse(`${TEXT('Début')}${ERROR(code)}`));
      await store.load();
      const reads = calls('GET', '/api/coach/today').length;
      store.setDraft('Mon texte');
      await store.send();
      expect(store.getState()).toMatchObject({ draft: 'Mon texte', phase: 'error', error: code });
      expect(store.getState().pending?.bubble).toBe('');
      expect(calls('GET', '/api/coach/today').length).toBe(reads + 1);
    },
  );

  it("error consent_withdrawn : status relu, l'accord absent s'y lit (le panneau « Activer le coach » en sort)", async () => {
    const { store, api, calls } = await setup();
    api.on('POST', '/api/coach/messages', sse(`${TEXT('Début')}${ERROR('consent_withdrawn')}`));
    await store.load();
    const reads = calls('GET', '/api/coach/status').length;
    api.on('GET', '/api/coach/status', {
      status: 200,
      body: { ...STATUS, consent: { ...STATUS.consent, active: false, textVersion: null } },
    });
    store.setDraft('Mon texte');
    await store.send();
    expect(calls('GET', '/api/coach/status').length).toBe(reads + 1);
    expect(store.getState().status?.consent.active).toBe(false);
    expect(store.getState()).toMatchObject({
      draft: 'Mon texte',
      phase: 'error',
      error: 'consent_withdrawn',
    });
  });

  it("accord redonné : le load suivant efface l'erreur consent_withdrawn", async () => {
    const { store, api } = await setup();
    api.on('POST', '/api/coach/messages', sse(ERROR('consent_withdrawn')));
    api.on('GET', '/api/coach/status', {
      status: 200,
      body: { ...STATUS, consent: { ...STATUS.consent, active: false, textVersion: null } },
    });
    await store.load();
    store.setDraft('Mon texte');
    await store.send();
    expect(store.getState().error).toBe('consent_withdrawn');
    api.on('GET', '/api/coach/status', { status: 200, body: STATUS });
    await store.load();
    expect(store.getState()).toMatchObject({ draft: 'Mon texte', phase: 'idle', error: null });
  });

  it("withdraw : l'appel, puis plus rien du fil en mémoire (fil, brouillon, échange), statut relu", async () => {
    const { store, api, calls } = await setup({ today: TODAY_WITH_USER });
    api.on('POST', '/api/me/consents/withdraw', { status: 200, body: makeMe() });
    await store.load();
    store.setDraft('brouillon');
    expect(store.getState().today?.messages).toHaveLength(2);
    api.on('GET', '/api/coach/today', { status: 200, body: EMPTY_TODAY });
    api.on('GET', '/api/coach/status', {
      status: 200,
      body: { ...STATUS, consent: { ...STATUS.consent, active: false, textVersion: null } },
    });
    await store.withdraw('le bon');
    expect(calls('POST', '/api/me/consents/withdraw').map((c) => c.body)).toEqual([
      { type: 'ai_coach', password: 'le bon' },
    ]);
    expect(store.getState()).toMatchObject({ draft: '', pending: null, phase: 'idle', error: null });
    expect(store.getState().today?.messages ?? []).toEqual([]);
    expect(store.getState().status?.consent.active).toBe(false);
  });

  it("withdraw refusé (mot de passe) : l'erreur remonte, l'état du fil reste", async () => {
    const { store, api } = await setup({ today: TODAY_WITH_USER });
    api.on('POST', '/api/me/consents/withdraw', { status: 401, body: { error: 'invalid_credentials' } });
    await store.load();
    store.setDraft('brouillon');
    await expect(store.withdraw('faux')).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(store.getState().draft).toBe('brouillon');
    expect(store.getState().today?.messages).toHaveLength(2);
  });

  it('grant : le texte en vigueur est envoyé, puis le statut est relu', async () => {
    const { store, api, calls } = await setup();
    api.on('POST', '/api/me/consents', { status: 200, body: makeMe() });
    await store.load();
    const reads = calls('GET', '/api/coach/status').length;
    await store.grant();
    expect(calls('POST', '/api/me/consents').map((c) => c.body)).toEqual([
      { type: 'ai_coach', textVersion: '1.0' },
    ]);
    expect(calls('GET', '/api/coach/status').length).toBe(reads + 1);
  });

  it('refused : bulle effacée, texte gardé au champ, rien de réessayable', async () => {
    const { store, api } = await setup();
    api.on('POST', '/api/coach/messages', sse(`${TEXT('x')}event: refused\ndata: {"message":"non"}\n\n`));
    await store.load();
    store.setDraft('Salut');
    await store.send();
    expect(store.getState()).toMatchObject({
      draft: 'Salut',
      phase: 'refused',
      pending: null,
      refusalMessage: 'non',
    });
  });

  it('refusalMessage est remis à null par un nouvel envoi et par load', async () => {
    const { store, api } = await setup();
    api.on('POST', '/api/coach/messages', sse('event: refused\ndata: {"message":"non"}\n\n'));
    await store.load();
    store.setDraft('Salut');
    await store.send();
    expect(store.getState().refusalMessage).toBe('non');
    await store.load();
    expect(store.getState().refusalMessage).toBeNull();

    await store.send();
    expect(store.getState().refusalMessage).toBe('non');
    api.on('POST', '/api/coach/messages', sse(`${TEXT('ok')}${DONE()}`));
    await store.send();
    expect(store.getState()).toMatchObject({ refusalMessage: null, phase: 'idle' });
  });

  it("done, today illisible puis load réussi : l'échec est effacé", async () => {
    const { store, api } = await setup();
    await store.load();
    api.on('POST', '/api/coach/messages', sse(`${TEXT('Bonjour')}${DONE()}`));
    api.on('GET', '/api/coach/today', { status: 500, body: { error: 'internal' } });
    store.setDraft('Salut');
    await store.send();
    expect(store.getState()).toMatchObject({ phase: 'error', error: 'internal' });
    api.on('GET', '/api/coach/today', { status: 200, body: TODAY_WITH_USER });
    await store.load();
    expect(store.getState()).toMatchObject({ phase: 'idle', pending: null, error: null });
    expect(store.getState().today?.messages).toHaveLength(2);
  });

  it("erreur JSON avant le flux : code de l'API, texte gardé", async () => {
    const { store, api } = await setup();
    api.on('POST', '/api/coach/messages', { status: 409, body: { error: 'request_in_progress' } });
    await store.load();
    store.setDraft('Salut');
    await store.send();
    expect(store.getState()).toMatchObject({ draft: 'Salut', phase: 'error', error: 'request_in_progress' });
  });

  it('hors ligne : erreur offline, texte gardé, retry possible ensuite', async () => {
    const { store, api } = await setup();
    await store.load();
    api.setOffline('reject');
    store.setDraft('Salut');
    await store.send();
    expect(store.getState()).toMatchObject({ draft: 'Salut', phase: 'error', error: 'offline' });
    api.setOffline(false);
    api.on('POST', '/api/coach/messages', sse(`${TEXT('ok')}${DONE()}`));
    await store.retry();
    expect(store.getState()).toMatchObject({ draft: '', phase: 'idle', error: null });
  });

  it('retry() réutilise le clientMessageId (UUIDv7) ; send() en crée un neuf', async () => {
    const { store, api, calls } = await setup();
    api.on('POST', '/api/coach/messages', sse(ERROR('api_unavailable')));
    await store.load();
    store.setDraft('Salut');
    await store.send();
    api.on('POST', '/api/coach/messages', sse(`${TEXT('ok')}${DONE()}`));
    await store.retry();
    store.setDraft('Autre');
    await store.send();
    const bodies = calls('POST', '/api/coach/messages').map(
      (c) => c.body as { clientMessageId: string; text: string },
    );
    expect(bodies).toHaveLength(3);
    expect(bodies[0]?.clientMessageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]?.clientMessageId).not.toBe(bodies[0]?.clientMessageId);
    expect(bodies[2]?.text).toBe('Autre');
  });

  it('409 duplicate_message : today relu, champ vidé', async () => {
    const { store, api, calls } = await setup();
    api.on('POST', '/api/coach/messages', sse(ERROR('api_unavailable')));
    await store.load();
    store.setDraft('Salut');
    await store.send();
    api.on('POST', '/api/coach/messages', { status: 409, body: { error: 'duplicate_message', seq: 1 } });
    api.on('GET', '/api/coach/today', { status: 200, body: TODAY_WITH_USER });
    const reads = calls('GET', '/api/coach/today').length;
    await store.retry();
    expect(calls('GET', '/api/coach/today').length).toBe(reads + 1);
    expect(store.getState()).toMatchObject({ draft: '', pending: null, phase: 'idle', error: null });
    expect(store.getState().today?.messages).toHaveLength(2);
  });

  it('flux qui se tait 30 s : erreur silence, today relu', async () => {
    const { services, store, api, calls } = await setup();
    await store.load();
    vi.useFakeTimers();
    services.transport = {
      fetch: async (path, init) =>
        path === '/api/coach/messages'
          ? new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 })
          : api.transport.fetch(path, init),
    };
    const reads = calls('GET', '/api/coach/today').length;
    store.setDraft('Salut');
    const sending = store.send();
    await vi.advanceTimersByTimeAsync(30_000);
    await sending;
    expect(store.getState()).toMatchObject({ draft: 'Salut', phase: 'error', error: 'silence' });
    expect(calls('GET', '/api/coach/today').length).toBe(reads + 1);
  });

  it('flushBefore(4000) par load et avant le premier message du jour seulement', async () => {
    const { store, api, sync } = await setup();
    api.on('POST', '/api/coach/messages', sse(`${TEXT('ok')}${DONE()}`));
    const spy = vi.spyOn(sync, 'flushBefore');
    const flushes = () => spy.mock.calls.length;
    await store.load();
    expect(flushes()).toBe(1);
    store.setDraft('Premier');
    await store.send();
    expect(flushes()).toBe(2);
    api.on('GET', '/api/coach/today', { status: 200, body: TODAY_WITH_USER });
    await store.load();
    expect(flushes()).toBe(3);
    store.setDraft('Deuxième');
    await store.send();
    expect(flushes()).toBe(3);
    expect(spy.mock.calls.every(([ms]) => ms === 4000)).toBe(true);
  });

  it("pollInProgress : today toutes les 2 s, s'arrête dès inProgress: false", async () => {
    const { store, api, calls } = await setup();
    await store.load();
    vi.useFakeTimers();
    let n = 0;
    api.on('GET', '/api/coach/today', () => ({
      status: 200,
      body: { ...TODAY_WITH_USER, inProgress: ++n < 3 },
    }));
    const base = calls('GET', '/api/coach/today').length;
    const polling = store.pollInProgress();
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls('GET', '/api/coach/today').length).toBe(base);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls('GET', '/api/coach/today').length).toBe(base + 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls('GET', '/api/coach/today').length).toBe(base + 2);
    await vi.advanceTimersByTimeAsync(2000);
    await polling;
    expect(calls('GET', '/api/coach/today').length).toBe(base + 3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls('GET', '/api/coach/today').length).toBe(base + 3);
    expect(store.getState().today?.inProgress).toBe(false);
  });

  it("pollInProgress : s'arrête au plus tard à 3 minutes", async () => {
    const { store, api, calls } = await setup();
    await store.load();
    vi.useFakeTimers();
    api.on('GET', '/api/coach/today', { status: 200, body: { ...TODAY_WITH_USER, inProgress: true } });
    const base = calls('GET', '/api/coach/today').length;
    const polling = store.pollInProgress();
    await vi.advanceTimersByTimeAsync(180_000);
    await polling;
    expect(calls('GET', '/api/coach/today').length).toBe(base + 90);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls('GET', '/api/coach/today').length).toBe(base + 90);
  });

  it("quitter /coach pendant le flux : le flux va jusqu'à done, un seul POST", async () => {
    const { store, api, calls } = await setup();
    await store.load();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    api.on('POST', '/api/coach/messages', async () => {
      await gate;
      return sse(`${TEXT('Bonjour')}${DONE()}`);
    });
    const unsubscribe = store.subscribe(() => {});
    store.setDraft('Salut');
    const sending = store.send();
    await until(() => calls('POST', '/api/coach/messages').length === 1);
    unsubscribe();
    // L'écran revient : il relit sans relancer ni écraser l'échange en cours.
    await store.load();
    await store.send();
    expect(store.getState().phase).toBe('streaming');
    api.on('GET', '/api/coach/today', { status: 200, body: TODAY_WITH_USER });
    release();
    await sending;
    expect(store.getState()).toMatchObject({ phase: 'idle', pending: null, draft: '' });
    expect(store.getState().today?.messages).toHaveLength(2);
    expect(calls('POST', '/api/coach/messages')).toHaveLength(1);
  });

  it('rien dans Dexie, localStorage ni sessionStorage', async () => {
    const { store, api, db } = await setup();
    api.on('POST', '/api/coach/messages', sse(`${TEXT('ok')}${DONE(['p1'])}`));
    const dump = async () =>
      JSON.stringify(await Promise.all(db.tables.map(async (t) => [t.name, await t.toArray()])));
    const before = await dump();
    await store.load();
    store.setDraft('Salut');
    await store.send();
    expect(await dump()).toBe(before);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("déconnexion : l'état est vidé", async () => {
    const { store, api, db, services } = await setup();
    api.on('POST', '/api/coach/messages', sse(ERROR('api_unavailable')));
    await store.load();
    await userKnown(services);
    store.setDraft('Salut');
    await store.send();
    expect(store.getState().status).not.toBeNull();
    await deleteMeta(db, 'userId');
    await until(() => store.getState().status === null);
    expect(store.getState()).toMatchObject({
      status: null,
      today: null,
      draft: '',
      pending: null,
      phase: 'idle',
      error: null,
    });
  });

  it("changement d'utilisateur : l'état est vidé", async () => {
    const { store, db, services } = await setup();
    await store.load();
    await userKnown(services);
    store.setDraft('brouillon');
    await setMeta(db, 'userId', 'autre-utilisateur');
    await until(() => store.getState().status === null);
    expect(store.getState().draft).toBe('');
  });

  it('done puis today illisible : erreur rendue, bulle gardée, champ vidé', async () => {
    const { store, api } = await setup();
    await store.load();
    api.on('POST', '/api/coach/messages', sse(`${TEXT('Bonjour')}${DONE()}`));
    api.on('GET', '/api/coach/today', { status: 500, body: { error: 'internal' } });
    store.setDraft('Salut');
    await store.send();
    expect(store.getState()).toMatchObject({ draft: '', phase: 'error', error: 'internal' });
    expect(store.getState().pending?.bubble).toBe('Bonjour');
  });

  it("pollInProgress n'écrit rien pendant un envoi", async () => {
    const { store, api, calls } = await setup();
    await store.load();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    api.on('POST', '/api/coach/messages', async () => {
      await gate;
      return sse(`${TEXT('ok')}${DONE()}`);
    });
    store.setDraft('Salut');
    const sending = store.send();
    await until(() => calls('POST', '/api/coach/messages').length === 1);
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const todayBefore = store.getState().today;
    api.on('GET', '/api/coach/today', { status: 200, body: { ...TODAY_WITH_USER, inProgress: true } });
    const reads = calls('GET', '/api/coach/today').length;
    const polling = store.pollInProgress();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls('GET', '/api/coach/today').length).toBe(reads + 1);
    expect(store.getState()).toMatchObject({ phase: 'streaming', error: null });
    expect(store.getState().today).toBe(todayBefore);
    api.on('GET', '/api/coach/today', { status: 200, body: TODAY_WITH_USER });
    release();
    await sending;
    await vi.advanceTimersByTimeAsync(2000);
    await polling;
    expect(store.getState().phase).toBe('idle');
  });

  it('un nouveau compte peut sonder tout de suite', async () => {
    const { store, db, services, calls } = await setup();
    await store.load();
    await userKnown(services);
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    void store.pollInProgress();
    await setMeta(db, 'userId', 'autre-utilisateur');
    await until(() => store.getState().status === null);
    const reads = calls('GET', '/api/coach/today').length;
    const second = store.pollInProgress();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls('GET', '/api/coach/today').length).toBe(reads + 1);
    await vi.advanceTimersByTimeAsync(180_000);
    await second;
  });
});
