import {
  ApiErrorBody,
  CoachBriefResponse,
  type CoachMessageRequest,
  type CoachReportRequest,
  CoachStatusView,
  type CoachStreamEvent,
  CoachThreadResponse,
  CoachThreadsResponse,
  CoachTodayResponse,
  MeResponse,
  PROTOCOL_HEADER,
  SYNC_PROTOCOL,
  SYNC_TIMEOUT_MS,
} from '@rune/contracts';
import { liveQuery } from 'dexie';
import { z } from 'zod';
import { ApiError, NetworkRequiredError } from '../api/client';
import type { AppServices } from '../app-services';
import { getMeta } from '../local-db/meta';
import { readSse } from './sse-reader';

const CreatedReport = z.object({ id: z.string() });

export interface CoachRepo {
  status(): Promise<CoachStatusView>;
  today(): Promise<CoachTodayResponse>;
  /**
   * POST du message puis lecture du flux SSE, événement par événement. Une erreur JSON avant le flux est une
   * `ApiError` ; hors ligne, `NetworkRequiredError`. Aucune écriture locale.
   */
  send(
    input: CoachMessageRequest,
    onEvent: (e: CoachStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  threads(): Promise<CoachThreadsResponse>;
  thread(id: string): Promise<CoachThreadResponse>;
  deleteThread(id: string): Promise<void>;
  deleteAllThreads(): Promise<void>;
  brief(): Promise<CoachBriefResponse>;
  report(req: CoachReportRequest): Promise<{ id: string }>;
  /** Accord `ai_coach` pour la version exacte du texte en vigueur. */
  grant(textVersion: string): Promise<MeResponse>;
  /** Retrait de l'accord `ai_coach` : l'appel HTTP seulement, le retrait local relève de l'écran (R-SYN-28). */
  withdraw(password: string): Promise<MeResponse>;
  /** Appelle `fn` avec l'utilisateur de l'appareil, à l'abonnement puis à chaque changement (`null` : déconnecté). */
  watchUser(fn: (userId: string | null) => void): () => void;
}

const MESSAGES_PATH = '/api/coach/messages';

/** Les en-têtes arrivent dans le délai de la synchro ; ensuite le flux est surveillé par `readSse`. */
async function fetchStream(s: AppServices, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, SYNC_TIMEOUT_MS);
  try {
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
    aborted.catch(() => {});
    return await Promise.race([
      s.transport.fetch(MESSAGES_PATH, { ...init, signal: controller.signal }),
      aborted,
    ]);
  } catch (error) {
    if (signal?.aborted) throw error;
    s.sync.reportOffline();
    throw new NetworkRequiredError();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function apiErrorOf(res: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = undefined;
  }
  const parsed = ApiErrorBody.safeParse(body);
  return parsed.success
    ? new ApiError(res.status, parsed.data.error, parsed.data)
    : new ApiError(res.status, 'internal', {});
}

export function createCoachRepo(s: AppServices): CoachRepo {
  return {
    status: () => s.api.get('/api/coach/status', CoachStatusView),
    today: () => s.api.get('/api/coach/today', CoachTodayResponse),
    async send(input, onEvent, signal) {
      const res = await fetchStream(
        s,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { [PROTOCOL_HEADER]: String(SYNC_PROTOCOL), 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        signal,
      );
      s.sync.reportReachable();
      if (!res.ok) {
        const error = await apiErrorOf(res);
        if (error.code === 'unauthenticated') void s.sync.syncNow('manual');
        throw error;
      }
      if (!res.body) throw new ApiError(res.status, 'internal', {});
      try {
        await readSse(res.body, onEvent);
      } catch (error) {
        // Coupure du réseau pendant la lecture : même issue qu'avant le flux.
        if (!signal?.aborted && (error instanceof TypeError || (error as Error).name === 'AbortError')) {
          s.sync.reportOffline();
          throw new NetworkRequiredError();
        }
        throw error;
      }
    },
    threads: () => s.api.get('/api/coach/threads', CoachThreadsResponse),
    thread: (id) => s.api.get(`/api/coach/threads/${encodeURIComponent(id)}`, CoachThreadResponse),
    async deleteThread(id) {
      await s.api.send('DELETE', `/api/coach/threads/${encodeURIComponent(id)}`);
    },
    async deleteAllThreads() {
      await s.api.send('DELETE', '/api/coach/threads');
    },
    brief: () => s.api.get('/api/coach/brief', CoachBriefResponse),
    report: (req) => s.api.send('POST', '/api/coach/reports', req, CreatedReport),
    grant: (textVersion) =>
      s.api.send('POST', '/api/me/consents', { type: 'ai_coach', textVersion }, MeResponse),
    withdraw: (password) =>
      s.api.send('POST', '/api/me/consents/withdraw', { type: 'ai_coach', password }, MeResponse),
    watchUser(fn) {
      const subscription = liveQuery(async () => (await getMeta(s.db, 'userId')) ?? null).subscribe({
        next: fn,
        error: () => {},
      });
      return () => subscription.unsubscribe();
    },
  };
}

const cache = new WeakMap<AppServices, CoachRepo>();

/** Le même dépôt pour les écrans et le magasin d'un même `AppServices`. */
export function coachRepoFor(s: AppServices): CoachRepo {
  let repo = cache.get(s);
  if (!repo) {
    repo = createCoachRepo(s);
    cache.set(s, repo);
  }
  return repo;
}
