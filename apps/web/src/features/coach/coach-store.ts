import type {
  ApiErrorCode,
  CoachProposalEvent,
  CoachStatusView,
  CoachStreamErrorCode,
  CoachStreamEvent,
  CoachTodayResponse,
  CoachToolName,
  HelpResourceId,
} from '@rune/contracts';
import { useMemo, useSyncExternalStore } from 'react';
import { ApiError, NetworkRequiredError } from '../../api/client';
import { type AppServices, useServices } from '../../app-services';
import { coachRepoFor } from '../../repos/coach-repo';
import { SseSilenceError } from '../../repos/sse-reader';

/** Réponse en cours : ce que le flux a déjà apporté, avant que `today` ne la contienne. */
export interface PendingExchange {
  clientMessageId: string;
  text: string;
  bubble: string;
  tool: CoachToolName | null;
  helpCards: HelpResourceId[];
  proposals: CoachProposalEvent[];
}

export type CoachPhase = 'idle' | 'loading' | 'streaming' | 'error' | 'refused';
export type CoachError = CoachStreamErrorCode | ApiErrorCode | 'offline' | 'silence';

export interface CoachState {
  status: CoachStatusView | null;
  today: CoachTodayResponse | null;
  draft: string;
  pending: PendingExchange | null;
  phase: CoachPhase;
  error: CoachError | null;
}

export interface CoachStore {
  getState(): CoachState;
  subscribe(onChange: () => void): () => void;
  /** `flushBefore(4000)` puis `status` et `today`. */
  load(): Promise<void>;
  setDraft(text: string): void;
  /** Envoie le texte du champ avec un identifiant neuf. Sans effet pendant un échange. */
  send(): Promise<void>;
  /** Renvoie le dernier message avec le même identifiant (« Réessayer »). */
  retry(): Promise<void>;
  /** Relit `today` toutes les 2 s tant qu'une réponse se termine ailleurs, 3 minutes au plus. */
  pollInProgress(): Promise<void>;
}

const FLUSH_MS = 4000;
const POLL_EVERY_MS = 2000;
const POLL_MAX_MS = 180_000;

const INITIAL: CoachState = {
  status: null,
  today: null,
  draft: '',
  pending: null,
  phase: 'idle',
  error: null,
};

function errorOf(e: unknown): CoachError {
  if (e instanceof NetworkRequiredError) return 'offline';
  if (e instanceof SseSilenceError) return 'silence';
  if (e instanceof ApiError) return e.code;
  return 'internal';
}

function emptied(p: PendingExchange): PendingExchange {
  return { ...p, bubble: '', tool: null, helpCards: [], proposals: [] };
}

/**
 * Fil du jour et saisie, en mémoire seulement (spec brique 4 C17) : ni Dexie ni stockage du navigateur. Le magasin
 * appartient aux services, pas à l'écran : quitter `/coach` pendant un flux ne l'interrompt pas, le flux va jusqu'à
 * `done` et un écran qui revient voit la réponse finie.
 */
export function createCoachStore(s: AppServices): CoachStore {
  const repo = coachRepoFor(s);
  const listeners = new Set<() => void>();
  let state = INITIAL;
  // Change à la déconnexion et au changement d'utilisateur : un échange ou une relecture en cours s'arrête là.
  let generation = 0;
  let polling = false;
  let watching = false;

  const set = (patch: Partial<CoachState>) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  };

  const updatePending = (fn: (p: PendingExchange) => PendingExchange) => {
    if (state.pending) set({ pending: fn(state.pending) });
  };

  const reset = () => {
    generation += 1;
    state = INITIAL;
    for (const fn of listeners) fn();
  };

  const isStreaming = () => state.phase === 'streaming';

  const watchUser = () => {
    if (watching) return;
    watching = true;
    let known: string | null | undefined;
    repo.watchUser((userId) => {
      if (known !== undefined && userId !== known) reset();
      known = userId;
    });
  };

  const flush = () => s.sync.flushBefore(FLUSH_MS).catch(() => {});

  async function reloadToday(gen: number): Promise<void> {
    try {
      const today = await repo.today();
      if (gen === generation) set({ today });
    } catch {
      // La relecture est un confort : l'état courant reste.
    }
  }

  async function fail(gen: number, pending: PendingExchange, code: CoachError): Promise<void> {
    set({ pending: emptied(pending), draft: pending.text, phase: 'error', error: code });
    if (code !== 'offline') await reloadToday(gen);
  }

  async function run(pending: PendingExchange, firstOfDay: boolean): Promise<void> {
    const gen = generation;
    set({ pending, phase: 'streaming', error: null });
    if (firstOfDay) await flush();
    if (gen !== generation) return;

    const seen: {
      done: Extract<CoachStreamEvent, { type: 'done' }> | null;
      error: CoachStreamErrorCode | null;
      refused: boolean;
    } = { done: null, error: null, refused: false };
    const onEvent = (e: CoachStreamEvent) => {
      if (gen !== generation) return;
      switch (e.type) {
        case 'text':
          updatePending((p) => ({ ...p, bubble: p.bubble + e.text, tool: null }));
          break;
        case 'tool_running':
          updatePending((p) => ({ ...p, tool: e.tool }));
          break;
        case 'proposal':
          updatePending((p) => ({ ...p, proposals: [...p.proposals, e] }));
          break;
        case 'help_card':
          updatePending((p) => ({ ...p, helpCards: [...p.helpCards, e.resource] }));
          break;
        case 'retry':
          updatePending(emptied);
          break;
        case 'done':
          seen.done = e;
          break;
        case 'refused':
          seen.refused = true;
          break;
        case 'error':
          seen.error = e.code;
          break;
      }
    };

    try {
      await repo.send({ clientMessageId: pending.clientMessageId, text: pending.text }, onEvent);
    } catch (e) {
      if (gen !== generation) return;
      if (e instanceof ApiError && e.code === 'duplicate_message') {
        // Le serveur a déjà ce message : le fil du jour le contient.
        await reloadToday(gen);
        if (gen === generation) set({ draft: '', pending: null, phase: 'idle', error: null });
        return;
      }
      await fail(gen, pending, errorOf(e));
      return;
    }
    if (gen !== generation) return;

    const { done, error, refused } = seen;
    if (error !== null) return fail(gen, pending, error);
    if (refused) {
      set({ pending: null, draft: pending.text, phase: 'refused', error: null });
      return;
    }
    // Un flux fermé sans `done` ni `error` : la réponse s'est peut-être enregistrée, `today` le dira.
    if (done === null) return fail(gen, pending, 'silence');

    const [today, status] = await Promise.all([
      repo.today().catch(() => null),
      repo.status().catch(() => null),
    ]);
    if (gen !== generation) return;
    if (done.proposalIds.length > 0) {
      await s.sync.pullNow().catch(() => {});
      if (gen !== generation) return;
    }
    set({
      today: today ?? state.today,
      status: status ?? state.status,
      draft: '',
      // Sans la relecture, la bulle reste affichée plutôt que de disparaître.
      pending: today ? null : state.pending,
      phase: 'idle',
      error: null,
    });
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  return {
    getState: () => state,
    subscribe(onChange) {
      watchUser();
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    async load() {
      // Un flux en cours est la source de vérité : on ne le recouvre pas.
      if (isStreaming()) return;
      watchUser();
      const gen = generation;
      if (state.status === null) set({ phase: 'loading', error: null });
      try {
        await flush();
        const [status, today] = await Promise.all([repo.status(), repo.today()]);
        if (gen !== generation || isStreaming()) return;
        const keepFailure = state.pending !== null && (state.phase === 'error' || state.phase === 'refused');
        set(keepFailure ? { status, today } : { status, today, phase: 'idle', error: null });
      } catch (e) {
        if (gen !== generation || isStreaming()) return;
        set({ phase: 'error', error: errorOf(e) });
      }
    },
    setDraft(text) {
      set({ draft: text });
    },
    async send() {
      if (state.phase === 'streaming' || state.draft.trim() === '') return;
      const firstOfDay = !state.today?.messages.some((m) => m.role === 'user');
      await run(
        {
          clientMessageId: s.newOpId(),
          text: state.draft,
          bubble: '',
          tool: null,
          helpCards: [],
          proposals: [],
        },
        firstOfDay,
      );
    },
    async retry() {
      if (state.phase === 'streaming' || state.pending === null) return;
      await run(emptied(state.pending), false);
    },
    async pollInProgress() {
      if (polling) return;
      polling = true;
      const gen = generation;
      try {
        for (let elapsed = 0; elapsed < POLL_MAX_MS; elapsed += POLL_EVERY_MS) {
          await sleep(POLL_EVERY_MS);
          if (gen !== generation) return;
          try {
            const today = await repo.today();
            if (gen !== generation) return;
            set({ today });
            if (!today.inProgress) {
              const status = await repo.status().catch(() => null);
              if (gen === generation && status) set({ status });
              return;
            }
          } catch (e) {
            if (gen === generation) set({ phase: 'error', error: errorOf(e) });
            return;
          }
        }
      } finally {
        polling = false;
      }
    },
  };
}

const stores = new WeakMap<AppServices, CoachStore>();

/** Un seul magasin par `AppServices`. */
export function coachStoreFor(s: AppServices): CoachStore {
  let store = stores.get(s);
  if (!store) {
    store = createCoachStore(s);
    stores.set(s, store);
  }
  return store;
}

export function useCoachStore(): { state: CoachState; store: CoachStore } {
  const services = useServices();
  const store = useMemo(() => coachStoreFor(services), [services]);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { state, store };
}
