import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdviceSheetFileSchema } from '@rune/contracts';
import { validateAdviceSheet } from '@rune/domain';
import { describe, expect, it } from 'vitest';

/* Les 8 brouillons de `data/advice` (spec brique 5 §10.5) : forme, contrôles de publication, longueur, audience. */

const DIR = join(__dirname, '../../../../data/advice');

const EXPECTED: Record<string, { title: string; audience: string; modes: string[] }> = {
  'eat-well-daily': { title: 'Bien manger au quotidien', audience: 'adults', modes: ['full'] },
  'eat-well-daily-simple': { title: 'Bien manger au quotidien', audience: 'adults', modes: ['qualitative'] },
  'protein-every-meal': {
    title: 'Des protéines à chaque repas',
    audience: 'all',
    modes: ['full', 'qualitative'],
  },
  'eat-around-training': {
    title: 'Manger autour de la séance',
    audience: 'adults',
    modes: ['full', 'qualitative'],
  },
  hydration: { title: "S'hydrater", audience: 'all', modes: ['full', 'qualitative'] },
  'vegetarian-training': {
    title: "S'entraîner en mangeant végétarien",
    audience: 'adults',
    modes: ['full', 'qualitative'],
  },
  'young-athletes': {
    title: "Jeunes sportifs : bien manger pour grandir et s'entraîner",
    audience: 'minors',
    modes: ['qualitative'],
  },
  'weight-fluctuations': {
    title: "Pourquoi mon poids varie d'un jour à l'autre",
    audience: 'adults',
    modes: ['full'],
  },
};

const names = (): string[] => {
  try {
    return readdirSync(DIR)
      .filter((n) => n.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
};
const words = (text: string) => text.split(/\s+/).filter((w) => /\p{L}|\d/u.test(w)).length;

describe('data/advice', () => {
  it('contient exactement les 8 fiches de la spec', () => {
    expect(names()).toEqual(
      Object.keys(EXPECTED)
        .map((id) => `${id}.json`)
        .sort(),
    );
  });

  for (const [id, expected] of Object.entries(EXPECTED)) {
    describe(id, () => {
      const read = () => JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')) as unknown;

      it('passe le schéma, avec titre, audience et modes de la spec', () => {
        const sheet = AdviceSheetFileSchema.parse(read());
        expect(sheet.id).toBe(id);
        expect(sheet.title).toBe(expected.title);
        expect(sheet.audience).toBe(expected.audience);
        expect([...sheet.visible_modes].sort()).toEqual([...expected.modes].sort());
        expect(sheet.draft_origin).toBe('ai');
      });

      it('passe les contrôles de publication', () => {
        const sheet = AdviceSheetFileSchema.parse(read());
        expect(validateAdviceSheet(sheet, 'published')).toEqual({ ok: true });
      });

      it('fait 250 à 450 mots et cite des sources datées', () => {
        const sheet = AdviceSheetFileSchema.parse(read());
        const n = words(sheet.body_md);
        expect(n).toBeGreaterThanOrEqual(250);
        expect(n).toBeLessThanOrEqual(450);
        expect(sheet.sources.length).toBeGreaterThan(0);
        for (const s of sheet.sources) {
          expect(s.title).not.toBe('');
          expect(s.url).toMatch(/^https:\/\//);
          expect(s.accessed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      });
    });
  }
});

describe("fiches fictives du jeu d'évaluation", () => {
  const dir = join(__dirname, '../../../../eval/coach/fixtures/catalog/advice');
  it('passent le schéma et les contrôles, titrées « [Test] »', () => {
    const files = readdirSync(dir).filter((n) => n.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const name of files) {
      const sheet = AdviceSheetFileSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      expect(sheet.title.startsWith('[Test]')).toBe(true);
      expect(validateAdviceSheet(sheet, 'published')).toEqual({ ok: true });
    }
  });
});
