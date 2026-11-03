import type { Clock } from '../deps';

/*
 * Registre des échanges du coach (spec §7.3, §17) : un seul échange à la fois par membre, un délai global et un
 * arrêt propre. L'échange en cours porte un `AbortSignal` dont la `reason` dit pourquoi il s'arrête.
 */

export type ExchangeAbortReason = 'shutdown' | 'consent_withdrawn' | 'timeout';

export interface ExchangeLease {
  signal: AbortSignal;
  /** Libère le membre ; sans effet s'il l'est déjà. */
  done(): void;
}

export interface ExchangeRegistry {
  /**
   * Bail de l'échange, ou null si le membre en a déjà un en cours. Le membre reste « en cours » jusqu'au `done`,
   * même après un délai dépassé ou un `abortFor` : le consommateur appelle toujours `done` dans un `finally`.
   * Une fois `abortAll` appelé, `begin` rend un bail déjà aborté (`shutdown`) dont `done` est sans effet, jamais null.
   */
  begin(userId: string): ExchangeLease | null;
  inProgress(userId: string): boolean;
  abortFor(userId: string, reason: 'consent_withdrawn'): void;
  /**
   * Ferme le registre (définitivement), aborte les échanges pas encore avortés puis attend les `done` de tous, 2 s au plus.
   * Les appels suivants rendent la même promesse. Attend les `done` de tous les échanges en cours, avortés ou non.
   */
  abortAll(reason: 'shutdown'): Promise<void>;
}

export const ABORT_ALL_WAIT_MS = 2000;

type Entry = { controller: AbortController; timer: NodeJS.Timeout; finished: Promise<void> };

/** `_clock` : horloge de l'application, gardée pour la signature ; les délais passent par les minuteurs du processus. */
export function createExchangeRegistry(_clock: Clock, timeoutMs: number): ExchangeRegistry {
  const active = new Map<string, Entry>();
  let closing = false;
  let closed: Promise<void> | undefined;
  return {
    begin(userId) {
      if (closing) {
        const refused = new AbortController();
        refused.abort('shutdown' satisfies ExchangeAbortReason);
        return { signal: refused.signal, done() {} };
      }
      if (active.has(userId)) return null;
      const controller = new AbortController();
      const { promise: finished, resolve: release } = Promise.withResolvers<void>();
      const timer = setTimeout(() => controller.abort('timeout' satisfies ExchangeAbortReason), timeoutMs);
      const entry: Entry = { controller, timer, finished };
      active.set(userId, entry);
      return {
        signal: controller.signal,
        done() {
          if (active.get(userId) !== entry) return;
          clearTimeout(timer);
          active.delete(userId);
          release();
        },
      };
    },
    inProgress: (userId) => active.has(userId),
    abortFor(userId, reason) {
      active.get(userId)?.controller.abort(reason);
    },
    abortAll(reason) {
      closed ??= (async () => {
        closing = true;
        const entries = [...active.values()];
        for (const entry of entries) {
          if (!entry.controller.signal.aborted) entry.controller.abort(reason);
        }
        if (entries.length === 0) return;
        let timer: NodeJS.Timeout | undefined;
        const late = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, ABORT_ALL_WAIT_MS);
        });
        try {
          await Promise.race([Promise.all(entries.map((entry) => entry.finished)), late]);
        } finally {
          clearTimeout(timer);
          for (const entry of entries) clearTimeout(entry.timer);
        }
      })();
      return closed;
    },
  };
}
