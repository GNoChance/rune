import type { AdviceSheetFile } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { validateAdviceSheet } from '../../src/nutrition';

const SOURCE = { title: 'ANSES', url: 'https://www.anses.fr/fr', accessed_on: '2026-11-01' };

const sheet = (over: Partial<AdviceSheetFile> = {}): AdviceSheetFile => ({
  id: 'hydration',
  title: 'Boire régulièrement',
  body_md:
    "## Repères\n\nBois de l'eau tout au long de la journée.\n\n- un verre au réveil\n- **une gourde** à portée",
  audience: 'all',
  visible_modes: ['full', 'qualitative'],
  tags: ['eau'],
  sources: [SOURCE],
  draft_origin: 'ai',
  ...over,
});

const codes = (s: AdviceSheetFile, phase: 'reviewed' | 'published' = 'published') => {
  const verdict = validateAdviceSheet(s, phase);
  return verdict.ok ? [] : verdict.issues.map((i) => i.code);
};

describe('validateAdviceSheet', () => {
  it('accepte une fiche propre, aux deux phases', () => {
    expect(validateAdviceSheet(sheet(), 'reviewed')).toEqual({ ok: true });
    expect(validateAdviceSheet(sheet(), 'published')).toEqual({ ok: true });
  });

  it('refuse une fiche sans source', () => {
    expect(codes(sheet({ sources: [] }))).toEqual(['no_source']);
  });

  it('refuse un nombre avec unité dans une fiche « all »', () => {
    const verdict = validateAdviceSheet(sheet({ body_md: 'Mange 500 g de viande.' }), 'published');
    expect(verdict).toEqual({
      ok: false,
      issues: [{ code: 'numbers_not_allowed', detail: '500 g' }],
    });
  });

  it('refuse un volume ou un pourcentage dans une fiche visible en qualitatif', () => {
    expect(codes(sheet({ audience: 'adults', body_md: 'Bois 2 L par jour.' }))).toEqual([
      'numbers_not_allowed',
    ]);
    expect(codes(sheet({ audience: 'adults', body_md: 'Vise 30 % de lipides.' }))).toEqual([
      'numbers_not_allowed',
    ]);
  });

  it('accepte « 500 g » dans une fiche adultes visible en mode complet seulement', () => {
    expect(
      codes(sheet({ audience: 'adults', visible_modes: ['full'], body_md: 'Mange 500 g de légumes.' })),
    ).toEqual([]);
  });

  it('refuse un nombre avec unité dans une fiche mineurs, même en mode complet', () => {
    expect(codes(sheet({ audience: 'minors', visible_modes: ['full'], body_md: 'Mange 500 g.' }))).toEqual([
      'numbers_not_allowed',
    ]);
  });

  it('laisse passer un nombre sans unité nutritionnelle', () => {
    expect(codes(sheet({ body_md: 'Prends 3 repas et 2 collations.' }))).toEqual([]);
  });

  it('refuse un terme de la liste mineurs dans une fiche minors ou all', () => {
    expect(codes(sheet({ audience: 'minors', body_md: 'Prends de la créatine.' }))).toEqual([
      'forbidden_term',
    ]);
    expect(codes(sheet({ audience: 'all', body_md: 'Prends de la créatine.' }))).toEqual(['forbidden_term']);
    expect(
      codes(sheet({ audience: 'adults', visible_modes: ['full'], body_md: 'Prends de la créatine.' })),
    ).toEqual([]);
  });

  it('refuse un terme « hors mode complet » dans une fiche visible en qualitatif', () => {
    expect(
      codes(sheet({ audience: 'adults', visible_modes: ['qualitative'], body_md: 'Essaie le jeûne.' })),
    ).toEqual(['forbidden_term']);
    expect(
      codes(sheet({ audience: 'adults', visible_modes: ['full'], body_md: 'Essaie le jeûne.' })),
    ).toEqual([]);
  });

  it('refuse un terme « pour tous » dans toute fiche, titre compris', () => {
    expect(codes(sheet({ audience: 'adults', visible_modes: ['full'], body_md: 'Fais un régime.' }))).toEqual(
      ['forbidden_term'],
    );
    expect(codes(sheet({ title: 'Le régime idéal' }))).toEqual(['forbidden_term']);
  });

  it('refuse une image ou un tableau Markdown', () => {
    expect(codes(sheet({ body_md: 'Voici ![schéma](https://www.anses.fr/fr/a.png)' }))).toEqual([
      'markdown_not_allowed',
    ]);
    expect(codes(sheet({ body_md: '| a | b |\n| --- | --- |\n| 1 | 2 |' }))).toEqual([
      'markdown_not_allowed',
    ]);
  });

  it('refuse un lien vers une URL absente des sources, accepte celui des sources', () => {
    const verdict = validateAdviceSheet(
      sheet({ body_md: 'Lis [ceci](https://example.com/x).' }),
      'published',
    );
    expect(verdict).toEqual({
      ok: false,
      issues: [{ code: 'link_not_in_sources', detail: 'https://example.com/x' }],
    });
    expect(codes(sheet({ body_md: 'Lis [la source](https://www.anses.fr/fr).' }))).toEqual([]);
  });

  it('cumule les problèmes', () => {
    expect(codes(sheet({ sources: [], body_md: 'Fais un régime de 500 g.' }))).toEqual([
      'no_source',
      'numbers_not_allowed',
      'forbidden_term',
    ]);
  });
});
