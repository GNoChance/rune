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

  describe('appariement des tool_result', () => {
    const use = (id: string) => b('tool_use', { id });
    const result = (id: string) => b('tool_result', { tool_use_id: id });

    it('écarte le message user dont tous les résultats sont orphelins', () => {
      const out = historyForApi([
        { role: 'assistant', blocks: [b('thinking'), use('A'), b('fallback'), b('text')] },
        { role: 'user', blocks: [result('A')] },
      ]);
      expect(out).toEqual([{ role: 'assistant', content: [b('fallback'), b('text')] }]);
    });

    it("message user écarté entre deux messages assistant : ceux-ci n'en font qu'un, jamais deux de suite", () => {
      const input: StoredApiMessage[] = [
        { role: 'user', blocks: [b('text', { text: 'Salut.' })] },
        { role: 'assistant', blocks: [use('A'), b('fallback'), b('text', { text: 'Je regarde.' })] },
        { role: 'user', blocks: [result('A')] },
        { role: 'assistant', blocks: [b('text', { text: 'Voilà.' })] },
        { role: 'user', blocks: [b('text', { text: 'Merci.' })] },
      ];
      const snapshot = structuredClone(input);
      expect(historyForApi(input)).toEqual([
        { role: 'user', content: [b('text', { text: 'Salut.' })] },
        {
          role: 'assistant',
          content: [b('fallback'), b('text', { text: 'Je regarde.' }), b('text', { text: 'Voilà.' })],
        },
        { role: 'user', content: [b('text', { text: 'Merci.' })] },
      ]);
      expect(input).toEqual(snapshot);
    });

    it('ne garde que le résultat du tool_use conservé', () => {
      const out = historyForApi([
        { role: 'assistant', blocks: [use('A'), b('fallback'), use('B')] },
        { role: 'user', blocks: [result('A'), result('B')] },
      ]);
      expect(out[1]).toEqual({ role: 'user', content: [result('B')] });
    });

    it("ne touche jamais le résultat d'un tool_use gardé", () => {
      const input: StoredApiMessage[] = [
        { role: 'assistant', blocks: [use('A'), b('text')] },
        { role: 'user', blocks: [result('A')] },
      ];
      expect(historyForApi(input)).toEqual([
        { role: 'assistant', content: input[0]?.blocks },
        { role: 'user', content: input[1]?.blocks },
      ]);
    });

    it("ne modifie pas l'entrée", () => {
      const input: StoredApiMessage[] = [
        { role: 'assistant', blocks: [use('A'), b('fallback'), use('B')] },
        { role: 'user', blocks: [result('A'), result('B')] },
      ];
      const snapshot = structuredClone(input);
      historyForApi(input);
      expect(input).toEqual(snapshot);
    });
  });
});
