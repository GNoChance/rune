export type ApiBlock = { type: string } & Record<string, unknown>;

export interface StoredApiMessage {
  role: 'user' | 'assistant' | 'system';
  blocks: readonly ApiBlock[];
}

export interface ApiMessage {
  role: StoredApiMessage['role'];
  content: ApiBlock[];
}

const DROPPED_BEFORE_FALLBACK = new Set(['thinking', 'redacted_thinking', 'tool_use']);

/**
 * Historique renvoyé à l'API : chaque bloc tel que stocké, sauf, dans un message, la réflexion et les appels d'outil
 * situés avant le dernier bloc `fallback` (règle de l'API après un repli en cours de sortie, spec §8.6).
 */
export function historyForApi(messages: readonly StoredApiMessage[]): ApiMessage[] {
  return messages.map((m) => {
    const lastFallback = m.blocks.findLastIndex((b) => b.type === 'fallback');
    return {
      role: m.role,
      content: m.blocks.filter((b, i) => i >= lastFallback || !DROPPED_BEFORE_FALLBACK.has(b.type)),
    };
  });
}
