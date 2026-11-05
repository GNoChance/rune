import type { CoachStreamEvent } from '@rune/contracts';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSse, SseDataError, SseSilenceError } from '../../src/repos/sse-reader';

const encoder = new TextEncoder();

const FRAMES = [
  'event: text\ndata: {"text":"Salut é 💪"}\n\n',
  ': ping\n\n',
  'event: tool_running\ndata: {"tool":"read_training"}\n\n',
  'event: inconnu\ndata: {"x":1}\n\n',
  'event: help_card\ndata: {"resource":"emergency"}\n\n',
  'event: retry\ndata: {"reason":"filter"}\n\n',
  'event: done\ndata: {"threadId":"t1","userSeq":1,"assistantSeq":2,"truncated":false,"replaced":false,"proposalIds":[],"remainingToday":29}\n\n',
];
const WIRE = encoder.encode(FRAMES.join(''));

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    },
  });
}

function cut(bytes: Uint8Array, points: number[]): Uint8Array[] {
  const sorted = [...new Set(points)].sort((a, b) => a - b);
  const out: Uint8Array[] = [];
  let from = 0;
  for (const p of sorted) {
    out.push(bytes.slice(from, p));
    from = p;
  }
  out.push(bytes.slice(from));
  return out;
}

async function collect(body: ReadableStream<Uint8Array>): Promise<CoachStreamEvent[]> {
  const events: CoachStreamEvent[] = [];
  await readSse(body, (e) => events.push(e));
  return events;
}

function liveStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return { body, push: (s: string) => controller.enqueue(encoder.encode(s)), end: () => controller.close() };
}

describe('readSse', () => {
  afterEach(() => vi.useRealTimers());

  it('rend les événements, ignore le commentaire et le nom inconnu', async () => {
    const events = await collect(streamOf([WIRE]));
    expect(events.map((e) => e.type)).toEqual(['text', 'tool_running', 'help_card', 'retry', 'done']);
    expect(events[0]).toEqual({ type: 'text', text: 'Salut é 💪' });
  });

  it('un flux coupé à chaque octet rend les mêmes événements', async () => {
    const whole = await collect(streamOf([WIRE]));
    const bytes = Array.from(WIRE, (_, i) => WIRE.slice(i, i + 1));
    expect(await collect(streamOf(bytes))).toEqual(whole);
  });

  it('un flux coupé à des positions arbitraires rend les mêmes événements', async () => {
    const whole = await collect(streamOf([WIRE]));
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat({ max: WIRE.length }), { maxLength: 30 }), async (points) => {
        expect(await collect(streamOf(cut(WIRE, points)))).toEqual(whole);
      }),
      { numRuns: 100 },
    );
  });

  it('accepte \\r\\n et un data sans espace', async () => {
    const wire = encoder.encode('event: text\r\ndata:{"text":"a"}\r\n\r\n');
    expect(await collect(streamOf([wire]))).toEqual([{ type: 'text', text: 'a' }]);
  });

  it("un data qui n'est pas du JSON est une erreur", async () => {
    const wire = encoder.encode('event: text\ndata: pas du json\n\n');
    await expect(collect(streamOf([wire]))).rejects.toBeInstanceOf(SseDataError);
  });

  it('un data qui ne passe pas le schéma est une erreur', async () => {
    const wire = encoder.encode('event: text\ndata: {"texte":"a"}\n\n');
    await expect(collect(streamOf([wire]))).rejects.toBeInstanceOf(SseDataError);
  });

  it("des ping pendant 29 s puis un événement : pas d'erreur", async () => {
    vi.useFakeTimers();
    const { body, push, end } = liveStream();
    const events: CoachStreamEvent[] = [];
    const done = readSse(body, (e) => events.push(e));
    for (let i = 1; i <= 29; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      if (i % 15 === 0) push(': ping\n\n');
    }
    // 14 s depuis le dernier ping : un événement arrive juste à temps.
    push('event: text\ndata: {"text":"ok"}\n\n');
    end();
    await done;
    expect(events).toEqual([{ type: 'text', text: 'ok' }]);
  });

  it('un ping remet le compte à zéro', async () => {
    vi.useFakeTimers();
    const { body, push, end } = liveStream();
    const done = readSse(body, () => {});
    await vi.advanceTimersByTimeAsync(20_000);
    push(': ping\n\n');
    await vi.advanceTimersByTimeAsync(20_000);
    end();
    await expect(done).resolves.toBeUndefined();
  });

  it('30 s sans octet : SseSilenceError', async () => {
    vi.useFakeTimers();
    const { body } = liveStream();
    const done = readSse(body, () => {});
    const assertion = expect(done).rejects.toBeInstanceOf(SseSilenceError);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('le délai se règle', async () => {
    vi.useFakeTimers();
    const { body } = liveStream();
    const done = readSse(body, () => {}, { silenceMs: 1000 });
    const assertion = expect(done).rejects.toBeInstanceOf(SseSilenceError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});
