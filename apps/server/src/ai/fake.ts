/**
 * Faux client IA, déterministe, pour les tests : aucun appel réseau. Il applique les mêmes contrôles et la même
 * lecture de `stop_reason` que le vrai client (`checkRequest`, `readOutput`).
 */
import {
  type AiClient,
  type AiRequest,
  type AiResult,
  checkRequest,
  DEFAULT_MAX_TOKENS,
  readOutput,
} from './client';

/**
 * Réponse prévue : une valeur (rendue en JSON) ou un texte brut, avec sa raison d'arrêt (`end_turn` par défaut)
 * et son coût (0 par défaut) ; ou une erreur levée telle quelle (erreur d'API simulée).
 */
export type FakeAiResponse =
  | { value: unknown; stopReason?: string; costUsd?: number; model?: string }
  | { text: string; stopReason?: string; costUsd?: number; model?: string }
  | { error: Error };

/** Réponses dans l'ordre des appels, ou calculées depuis la requête (utile quand les appels sont parallèles). */
export type FakeAiResponses =
  | readonly FakeAiResponse[]
  | ((req: AiRequest, call: number) => FakeAiResponse | Promise<FakeAiResponse>);

export type FakeAiClient = AiClient & {
  /** Requêtes reçues, dans l'ordre des appels. */
  readonly calls: readonly AiRequest[];
};

export function createFakeAiClient(
  responses: FakeAiResponses,
  options: { model?: string } = {},
): FakeAiClient {
  const calls: AiRequest[] = [];
  const defaultModel = options.model ?? 'fake-model';
  return {
    model: defaultModel,
    calls,
    async complete<T>(req: AiRequest): Promise<AiResult<T>> {
      checkRequest(req);
      const call = calls.length;
      calls.push(req);
      const response = typeof responses === 'function' ? await responses(req, call) : responses[call];
      if (response === undefined) {
        throw new Error(`Faux client IA : aucune réponse prévue pour l'appel ${call + 1}.`);
      }
      if ('error' in response) throw response.error;
      return readOutput<T>({
        text: 'text' in response ? response.text : JSON.stringify(response.value),
        stopReason: response.stopReason ?? 'end_turn',
        costUsd: response.costUsd ?? 0,
        model: response.model ?? req.model ?? defaultModel,
        maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      });
    },
  };
}
