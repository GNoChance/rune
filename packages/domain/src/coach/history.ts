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
 *
 * Sécurité : un `tool_use` retiré emporte les `tool_result` des messages suivants qui le citent (sinon l'API répond
 * 400), et un message laissé sans bloc est écarté. Règle de fond (tâche 20) : un `tool_use` avant le dernier
 * `fallback` appartient à la réponse refusée et n'est jamais exécuté, donc n'a pas de `tool_result`.
 */
export function historyForApi(messages: readonly StoredApiMessage[]): ApiMessage[] {
  const removedToolUses = new Set<unknown>();
  const out: ApiMessage[] = [];
  for (const m of messages) {
    const lastFallback = m.blocks.findLastIndex((b) => b.type === 'fallback');
    const content = m.blocks.filter((b, i) => {
      if (b.type === 'tool_result' && removedToolUses.has(b.tool_use_id)) return false;
      if (i < lastFallback && DROPPED_BEFORE_FALLBACK.has(b.type)) {
        if (b.type === 'tool_use') removedToolUses.add(b.id);
        return false;
      }
      return true;
    });
    if (content.length > 0 || m.blocks.length === 0) out.push({ role: m.role, content });
  }
  return out;
}
