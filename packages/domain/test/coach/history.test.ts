import { describe, expect, it } from 'vitest';
import { historyForApi, type StoredApiMessage } from '../../src/coach/history';

const b = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });
const assistantTypes = (...types: string[]) =>
  historyForApi([{ role: 'assistant', blocks: types.map((t) => b(t)) }])[0]?.content.map((x) => x.type);

describe('historyForApi', () => {
  const cases: [string, string[], string[]][] = [
    ['sans fallback : tout gardé', ['thinking', 'text'], ['thinking', 'text']],
    [
      'avant un fallback',
      ['thinking', 'tool_use', 'fallback', 'thinking', 'text'],
      ['fallback', 'thinking', 'text'],
    ],
    [
      'seul le dernier fallback compte',
      ['thinking', 'fallback', 'redacted_thinking', 'fallback', 'text'],
      ['fallback', 'fallback', 'text'],
    ],
    ['text avant fallback gardé', ['text', 'thinking', 'fallback', 'text'], ['text', 'fallback', 'text']],
  ];
  it.each(cases)('%s', (_n, input, expected) => {
    expect(assistantTypes(...input)).toEqual(expected);
  });

  it('user et system inchangés', () => {
    for (const role of ['user', 'system'] as const) {
      const m: StoredApiMessage = { role, blocks: [b('text'), b('tool_result')] };
      expect(historyForApi([m])).toEqual([{ role, content: m.blocks }]);
    }
  });

  it('blocs tels que stockés, entrée non modifiée', () => {
    const input: StoredApiMessage[] = [
      {
        role: 'assistant',
        blocks: [b('thinking', { thinking: 'x' }), b('fallback'), b('text', { text: 'ok' })],
      },
    ];
    const snapshot = structuredClone(input);
    const out = historyForApi(input);
    expect(out[0]?.content[1]).toEqual({ type: 'text', text: 'ok' });
    expect(input).toEqual(snapshot);
    expect(out[0]?.content).not.toBe(input[0]?.blocks);
  });
});
