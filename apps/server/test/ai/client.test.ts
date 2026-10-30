import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiError,
  type AiRequest,
  costUsd,
  createAnthropicClient,
  createFakeAiClient,
  DEFAULT_MAX_TOKENS,
  toStructuredSchema,
} from '../../src/ai';

/** JSON Schema de sortie, tel que `z.toJSONSchema` le produit (bornes que l'API refuse comprises). */
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    names: {
      minItems: 2,
      maxItems: 4,
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 60 },
    },
    muscle: { type: 'string', enum: ['chest', 'lats'] },
    tags: { minItems: 0, maxItems: 3, type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
    steps: {
      minItems: 1,
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string', maxLength: 160 } },
        required: ['text'],
      },
    },
    note: { type: 'string', maxLength: 2000 },
  },
  required: ['names', 'muscle', 'tags', 'steps'],
  additionalProperties: false,
};

const request = (extra: Partial<AiRequest> = {}): AiRequest => ({
  model: 'claude-opus-5-5',
  effort: 'high',
  system: [{ text: 'Consignes fixes.' }, { text: 'Guide de style.', cache: true }],
  user: 'Squelette de la fiche.',
  schema,
  ...extra,
});

/** Aucun appel réseau : le `fetch` global échoue et ne doit jamais être appelé. */
let networkFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  networkFetch = vi.fn(() => {
    throw new Error('Appel réseau interdit dans les tests.');
  });
  vi.stubGlobal('fetch', networkFetch);
});
afterEach(() => {
  expect(networkFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('toStructuredSchema', () => {
  it('garde ce que la sortie structurée accepte et range le reste dans la description', () => {
    const strict = toStructuredSchema(schema);
    expect(strict).toEqual({
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string', description: '{minLength: 1, maxLength: 60}' },
          description: '{minItems: 2, maxItems: 4}',
        },
        muscle: { type: 'string', enum: ['chest', 'lats'] },
        tags: {
          type: 'array',
          items: { type: 'string', enum: ['a', 'b'] },
          minItems: 0,
          description: '{maxItems: 3}',
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string', description: '{maxLength: 160}' } },
            required: ['text'],
            additionalProperties: false,
          },
          minItems: 1,
        },
        note: { type: 'string', description: '{maxLength: 2000}' },
      },
      required: ['names', 'muscle', 'tags', 'steps'],
      additionalProperties: false,
    });
  });

  it('ne modifie pas le schéma reçu', () => {
    const copy = structuredClone(schema);
    toStructuredSchema(schema);
    expect(schema).toEqual(copy);
  });

  it('ajoute les bornes retirées à une description existante', () => {
    expect(toStructuredSchema({ type: 'string', description: 'Un nom.', maxLength: 60 })).toEqual({
      type: 'string',
      description: 'Un nom.\n\n{maxLength: 60}',
    });
  });
});

describe('costUsd', () => {
  it('applique les prix de Claude Opus 5.5 relevés dans NOTES.md', () => {
    const million = 1_000_000;
    expect(costUsd('claude-opus-5-5', { input_tokens: million, output_tokens: 0 })).toBeCloseTo(4);
    expect(costUsd('claude-opus-5-5', { input_tokens: 0, output_tokens: million })).toBeCloseTo(20);
    expect(
      costUsd('claude-opus-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: million }),
    ).toBeCloseTo(0.2);
    expect(
      costUsd('claude-opus-5-5', {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 2 * million,
        cache_creation: { ephemeral_5m_input_tokens: million, ephemeral_1h_input_tokens: million },
      }),
    ).toBeCloseTo(5 + 8);
  });

  it('sans détail par durée, une écriture en cache est comptée à 5 minutes', () => {
    expect(
      costUsd('claude-opus-5-5', {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(5);
  });

  it('refuse un modèle dont le prix est inconnu', () => {
    expect(() => costUsd('claude-inconnu', { input_tokens: 1, output_tokens: 1 })).toThrow(/claude-inconnu/);
  });
});

describe('createFakeAiClient', () => {
  it("rend les réponses dans l'ordre et garde les requêtes", async () => {
    const fake = createFakeAiClient([{ value: { a: 1 }, costUsd: 0.5 }, { text: '{"b":2}' }]);
    const first = await fake.complete(request());
    const second = await fake.complete(request({ user: 'Deuxième.' }));
    expect(first).toEqual({
      value: { a: 1 },
      stopReason: 'end_turn',
      costUsd: 0.5,
      model: 'claude-opus-5-5',
    });
    expect(second.value).toEqual({ b: 2 });
    expect(fake.calls.map((c) => c.user)).toEqual(['Squelette de la fiche.', 'Deuxième.']);
    await expect(fake.complete(request())).rejects.toThrow(/aucune réponse prévue/);
  });

  it('accepte une fonction de la requête, éventuellement asynchrone', async () => {
    const fake = createFakeAiClient(async (req, call) => ({ value: { user: req.user, call } }));
    expect((await fake.complete(request())).value).toEqual({ user: 'Squelette de la fiche.', call: 0 });
  });

  it('stop_reason max_tokens : erreur claire, coût conservé', async () => {
    const fake = createFakeAiClient([{ text: '{"names": ["a"', stopReason: 'max_tokens', costUsd: 0.3 }]);
    const error = await fake.complete(request({ maxTokens: 8000 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: 'max_tokens', stopReason: 'max_tokens', costUsd: 0.3, fatal: false });
    expect((error as Error).message).toMatch(/max_tokens/);
    expect((error as Error).message).toMatch(/8000/);
  });

  it('stop_reason refusal ou inattendu : erreur, pas de valeur', async () => {
    const fake = createFakeAiClient([
      { value: {}, stopReason: 'refusal' },
      { value: {}, stopReason: 'pause_turn' },
    ]);
    await expect(fake.complete(request())).rejects.toMatchObject({ code: 'refusal' });
    await expect(fake.complete(request())).rejects.toMatchObject({ code: 'stop_reason' });
  });

  it("texte qui n'est pas du JSON : erreur invalid_json", async () => {
    const fake = createFakeAiClient([{ text: 'Voici la fiche :' }]);
    await expect(fake.complete(request())).rejects.toMatchObject({ code: 'invalid_json' });
  });

  it("refuse plus de 4 points de cache, comme l'API", async () => {
    const fake = createFakeAiClient([{ value: {} }]);
    const system = Array.from({ length: 5 }, (_, i) => ({ text: `Bloc ${i}`, cache: true }));
    await expect(fake.complete(request({ system }))).rejects.toThrow(/4 points de cache/);
  });
});

/** Réponse de l'API Messages, au format JSON documenté. */
const apiMessage = (extra: Record<string, unknown> = {}) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [
    { type: 'thinking', thinking: '', signature: 'sig' },
    {
      type: 'text',
      text: '{"names":["Pompe","Push-up"],"muscle":"chest","tags":[],"steps":[{"text":"Pose"}]}',
    },
  ],
  stop_reason: 'end_turn',
  stop_sequence: null,
  stop_details: null,
  usage: {
    input_tokens: 1000,
    output_tokens: 2000,
    cache_creation_input_tokens: 10_000,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 10_000, ephemeral_1h_input_tokens: 0 },
  },
  ...extra,
});

/** `fetch` injecté dans le SDK : garde chaque requête et rend `responses` dans l'ordre. */
function stubFetch(...responses: { status?: number; body: unknown }[]) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    const next = responses[requests.length - 1] ?? { status: 500, body: { error: 'aucune réponse prévue' } };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
    });
  });
  return { fetch, requests };
}

describe('createAnthropicClient (fetch injecté, aucun appel réseau)', () => {
  it('envoie modèle, effort, sortie structurée et cache, sans paramètre de réflexion', async () => {
    const { fetch, requests } = stubFetch({ body: apiMessage() });
    const client = createAnthropicClient({ apiKey: 'cle-de-test', model: 'claude-opus-5-5', fetch });
    await client.complete(request());

    expect(requests).toHaveLength(1);
    const [sent] = requests;
    expect(sent?.url).toMatch(/\/v1\/messages$/);
    expect(sent?.headers.get('x-api-key')).toBe('cle-de-test');
    expect(sent?.headers.get('authorization')).toBeNull();
    expect(sent?.body).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: DEFAULT_MAX_TOKENS,
      system: [
        { type: 'text', text: 'Consignes fixes.' },
        { type: 'text', text: 'Guide de style.', cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: 'Squelette de la fiche.' }],
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: toStructuredSchema(schema) },
      },
    });
  });

  it('lit le texte, stop_reason, le modèle et calcule le coût depuis usage', async () => {
    const { fetch } = stubFetch({ body: apiMessage() });
    const client = createAnthropicClient({ apiKey: 'cle-de-test', model: 'claude-opus-5-5', fetch });
    const result = await client.complete<{ names: string[] }>(request());
    expect(result.value).toEqual({
      names: ['Pompe', 'Push-up'],
      muscle: 'chest',
      tags: [],
      steps: [{ text: 'Pose' }],
    });
    expect(result.stopReason).toBe('end_turn');
    expect(result.model).toBe('claude-opus-5-5');
    // 1 000 × 4 $ + 2 000 × 20 $ + 10 000 × 5 $ (écriture 5 min), par million de jetons.
    expect(result.costUsd).toBeCloseTo(0.094);
  });

  it('modèle de la requête, sinon celui du client ; max_tokens de la requête', async () => {
    const { fetch, requests } = stubFetch({ body: apiMessage() }, { body: apiMessage() });
    const client = createAnthropicClient({ apiKey: 'cle-de-test', model: 'claude-opus-5-5', fetch });
    expect(client.model).toBe('claude-opus-5-5');
    await client.complete(request({ model: 'claude-sonnet-5-5', maxTokens: 8000 }));
    const { model: _omitted, ...withoutModel } = request();
    await client.complete(withoutModel);
    expect(requests.map((r) => [r.body.model, r.body.max_tokens])).toEqual([
      ['claude-sonnet-5-5', 8000],
      ['claude-opus-5-5', DEFAULT_MAX_TOKENS],
    ]);
  });

  it("stop_reason max_tokens : erreur claire avec le coût de l'appel", async () => {
    const { fetch } = stubFetch({ body: apiMessage({ stop_reason: 'max_tokens' }) });
    const client = createAnthropicClient({ apiKey: 'cle-de-test', model: 'claude-opus-5-5', fetch });
    const error = await client.complete(request()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'max_tokens', fatal: false });
    expect((error as AiError).costUsd).toBeCloseTo(0.094);
  });

  it('refusal : erreur avec la catégorie', async () => {
    const { fetch } = stubFetch({
      body: apiMessage({
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'bio', explanation: '' },
      }),
    });
    const client = createAnthropicClient({ apiKey: 'cle-de-test', model: 'claude-opus-5-5', fetch });
    await expect(client.complete(request())).rejects.toMatchObject({
      code: 'refusal',
      message: expect.stringMatching(/bio/),
    });
  });

  it('erreur 401 ou 400 : fatale (même requête pour toutes les fiches), sans nouvel essai', async () => {
    for (const status of [400, 401]) {
      const { fetch } = stubFetch({
        status,
        body: { type: 'error', error: { type: 'invalid_request_error', message: 'refusé' } },
      });
      const client = createAnthropicClient({ apiKey: 'cle-de-test', model: 'claude-opus-5-5', fetch });
      await expect(client.complete(request())).rejects.toMatchObject({ code: 'api', fatal: true });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('erreur 529 après les essais du SDK : non fatale', async () => {
    const overloaded = {
      status: 529,
      body: { type: 'error', error: { type: 'overloaded_error', message: '' } },
    };
    const { fetch } = stubFetch(overloaded);
    const client = createAnthropicClient({
      apiKey: 'cle-de-test',
      model: 'claude-opus-5-5',
      fetch,
      maxRetries: 0,
    });
    await expect(client.complete(request())).rejects.toMatchObject({ code: 'api', fatal: false });
  });

  it('refuse un modèle sans prix connu dès la création', () => {
    expect(() => createAnthropicClient({ apiKey: 'cle-de-test', model: 'claude-inconnu' })).toThrow(
      /claude-inconnu/,
    );
  });
});
