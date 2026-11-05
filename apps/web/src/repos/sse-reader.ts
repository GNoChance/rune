import { type CoachStreamEvent, CoachStreamEventSchema } from '@rune/contracts';

/** Le serveur envoie un `: ping` toutes les 15 s ; 30 s sans octet ferment la lecture (spec brique 4 §7.2, C21). */
export const SSE_SILENCE_MS = 30_000;

/** Aucun octet (événement ou commentaire) pendant `silenceMs`. */
export class SseSilenceError extends Error {
  constructor() {
    super('Flux muet');
    this.name = 'SseSilenceError';
  }
}

/** `data` qui n'est pas du JSON, ou qui ne correspond pas au schéma de l'événement. */
export class SseDataError extends Error {
  constructor(event: string) {
    super(`Événement illisible : ${event}`);
    this.name = 'SseDataError';
  }
}

const KNOWN_EVENTS: ReadonlySet<string> = new Set(
  CoachStreamEventSchema.options.map((o) => o.shape.type.value),
);

/**
 * Un bloc (lignes entre deux lignes vides) : `event:` et `data:` ; les commentaires (`:`) et les autres champs sont
 * ignorés. Le serveur envoie les données sans `type` : le nom de l'événement le fournit.
 */
function dispatch(block: string, onEvent: (e: CoachStreamEvent) => void): void {
  let name = '';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') name = value;
    else if (field === 'data') data.push(value);
  }
  if (name === '' || !KNOWN_EVENTS.has(name)) return;
  let json: unknown;
  try {
    json = JSON.parse(data.join('\n'));
  } catch {
    throw new SseDataError(name);
  }
  const parsed = CoachStreamEventSchema.safeParse(
    typeof json === 'object' && json !== null ? { ...json, type: name } : json,
  );
  if (!parsed.success) throw new SseDataError(name);
  onEvent(parsed.data);
}

/**
 * Lit un flux SSE jusqu'à sa fin. Les morceaux peuvent être coupés n'importe où (octets d'un caractère compris) ;
 * chaque événement est validé par `CoachStreamEventSchema`, un nom inconnu est ignoré. Chaque morceau reçu, ping
 * compris, remet le compte du silence à zéro.
 */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: CoachStreamEvent) => void,
  opts: { silenceMs?: number } = {},
): Promise<void> {
  const silenceMs = opts.silenceMs ?? SSE_SILENCE_MS;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Un `\r` en bout de morceau attend le suivant : un `\r\n` coupé en deux reste une seule fin de ligne.
  let carry = '';
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const silence = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SseSilenceError()), silenceMs);
      });
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([reader.read(), silence]);
      } finally {
        clearTimeout(timer);
      }
      if (chunk.done) break;
      let text = carry + decoder.decode(chunk.value, { stream: true });
      carry = text.endsWith('\r') ? '\r' : '';
      if (carry) text = text.slice(0, -1);
      buffer += text.replace(/\r\n?/g, '\n');
      let end = buffer.indexOf('\n\n');
      while (end !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        dispatch(block, onEvent);
        end = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
