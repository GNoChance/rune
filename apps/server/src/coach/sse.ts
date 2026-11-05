import type { CoachStreamEvent } from '@rune/contracts';
import type { Context } from 'hono';
import type { AppEnv } from '../app-env';

/*
 * Flux SSE du coach (spec brique 4 §7.2). `event: <type>` puis `data: <JSON sans type>`, un commentaire `: ping`
 * toutes les 15 s (le téléphone ferme la lecture après 30 s sans octet). Le flux n'est pas lié au téléphone : une
 * fois celui-ci parti, les écritures sont ignorées et `run` va au bout (l'échange se termine et s'enregistre).
 */

export const SSE_PING_MS = 15_000;

const encoder = new TextEncoder();

/** `event: <type>\ndata: <JSON sans type>\n\n`. */
function frame(event: CoachStreamEvent): string {
  const { type, ...data } = event;
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function sseStream(
  c: Context<AppEnv>,
  run: (send: (e: CoachStreamEvent) => void) => Promise<void>,
  opts: { pingMs?: number } = {},
): Response {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let open = true;
  let timer: NodeJS.Timeout | undefined;

  const write = (chunk: string): void => {
    if (!open || controller === undefined) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      open = false;
    }
  };
  const stop = (): void => {
    open = false;
    clearInterval(timer);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
      timer = setInterval(() => write(': ping\n\n'), opts.pingMs ?? SSE_PING_MS);
      timer.unref();
      void run((e) => write(frame(e)))
        .catch(() => write(frame({ type: 'error', code: 'internal' })))
        .finally(() => {
          const wasOpen = open;
          stop();
          if (!wasOpen) return;
          try {
            ctrl.close();
          } catch {
            // Déjà fermé par le lecteur.
          }
        });
    },
    cancel: stop,
  });

  return c.body(stream, 200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
}
