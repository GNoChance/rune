import type { IllustrationEntry } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import {
  type CreditSheet,
  frozenSource,
  illustrationCreditLine,
  illustrationCredits,
} from '../../src/catalog/credits';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const OTHER_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';

/** Entrée de manifeste cohérente ; seule l'empreinte du nom compte ici. */
function entry(id: string, overrides: Partial<IllustrationEntry> = {}): IllustrationEntry {
  const sha256 = `0a1b2c3d${'e'.repeat(56)}`;
  return {
    id,
    file: `${id}.0a1b2c3d.svg`,
    sha256,
    bytes: 1234,
    media_type: 'image/svg+xml',
    source: 'everkinetic',
    source_url: `https://github.com/everkinetic/data/blob/${COMMIT}/svg/${id}.svg`,
    creators: ['Greg Priday'],
    license: 'CC-BY-SA-4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    modifications: 'Nettoyage du SVG, commentaire de crédit, renommage.',
    replace_before_public: false,
    ...overrides,
  };
}

const sheet = (
  id: string,
  name: string,
  status: string,
  illustrations?: CreditSheet['illustrations'],
): CreditSheet => ({ id, name, status, ...(illustrations ? { illustrations } : {}) });

describe('illustrationCreditLine (ligne de crédit sous une illustration, 04 §12)', () => {
  it('créateurs, licence, puis « modifiée » quand nous avons modifié le fichier', () => {
    expect(illustrationCreditLine(entry('a'))).toBe('Illustration : Greg Priday · CC BY-SA 4.0 · modifiée');
  });

  it('sans modification : pas de « modifiée » ; plusieurs créateurs séparés par une virgule', () => {
    const { modifications: _, ...bare } = entry('a', {
      creators: ['Bryl Lim', 'Greg Priday'],
      license: 'CC-BY-4.0',
    });
    expect(illustrationCreditLine(bare)).toBe('Illustration : Bryl Lim, Greg Priday · CC BY 4.0');
  });
});

describe("frozenSource (commit figé d'une URL source, 04 §12 règle 1)", () => {
  it.each([
    [
      `https://github.com/everkinetic/data/blob/${COMMIT}/svg/squat-1.svg`,
      'https://github.com/everkinetic/data',
    ],
    [
      `https://github.com/bryllim/workout-guide/raw/${COMMIT}/img/a.png`,
      'https://github.com/bryllim/workout-guide',
    ],
    [`https://github.com/everkinetic/data/tree/${COMMIT}`, 'https://github.com/everkinetic/data'],
    [
      `https://raw.githubusercontent.com/everkinetic/data/${COMMIT}/svg/squat-1.svg`,
      'https://github.com/everkinetic/data',
    ],
  ])('%s → dépôt et commit', (url, repository) => {
    expect(frozenSource(url)).toEqual({ repository, commit: COMMIT });
  });

  it.each([
    'https://github.com/everkinetic/data/blob/main/svg/squat-1.svg',
    'https://github.com/everkinetic/data/blob/0123abc/svg/squat-1.svg',
    `https://example.org/${COMMIT}/a.svg`,
  ])('%s → null (branche, commit abrégé, hôte inconnu)', (url) => {
    expect(frozenSource(url)).toBeNull();
  });
});

describe('illustrationCredits (page Crédits, 04 §12 et §13 critère 12)', () => {
  const manifest = [
    entry('squat-start'),
    entry('squat-end'),
    entry('lunge-start', { source_url: `https://github.com/everkinetic/data/blob/${OTHER_COMMIT}/l.svg` }),
    entry('pike-start', {
      source: 'workout_guide',
      source_url: `https://github.com/bryllim/workout-guide/blob/${COMMIT}/img/pike-1.png`,
      file: 'pike-start.0a1b2c3d.png',
      media_type: 'image/png',
      creators: ['Bryl Lim'],
      replace_before_public: true,
    }),
    entry('derived-start', {
      source: 'workout_guide',
      source_url: `https://github.com/bryllim/workout-guide/blob/${COMMIT}/img/derived-1.png`,
      creators: ['Bryl Lim', 'Greg Priday'],
      license: 'CC-BY-4.0',
    }),
    entry('draft-only-start'),
    entry('unused-start'),
  ];

  const sheets = [
    sheet('goblet-squat', 'Squat goblet', 'published', [
      { illustration_id: 'squat-end', role: 'end' },
      { illustration_id: 'squat-start', role: 'start' },
    ]),
    // Même illustration que la fiche précédente : un seul fichier, deux usages ; « Écart » avant « Fente » et
    // « Squat » en collation française (l'ordre binaire mettrait É après S).
    sheet('box-squat', 'Écart sumo', 'published', [{ illustration_id: 'squat-start', role: 'start' }]),
    sheet('lunge', 'Fente avant', 'published', [{ illustration_id: 'lunge-start', role: 'start' }]),
    sheet('pike', 'Pike', 'published', [{ illustration_id: 'pike-start', role: 'start' }]),
    // Fiche retirée, encore affichée depuis l'historique : son illustration reste créditée.
    sheet('old', 'Ancien exercice', 'retired', [{ illustration_id: 'derived-start', role: 'mid' }]),
    // Statuts jamais servis : ignorés, comme une illustration absente du manifeste.
    sheet('draft', 'Brouillon', 'draft', [{ illustration_id: 'draft-only-start', role: 'start' }]),
    sheet('reviewed', 'Relue', 'reviewed', [{ illustration_id: 'draft-only-start', role: 'start' }]),
    sheet('ghost', 'Fantôme', 'published', [{ illustration_id: 'absent', role: 'start' }]),
    sheet('bare', 'Sans illustration', 'published'),
  ];

  it("chaque illustration de chaque fiche servie, groupée par source, dans l'ordre des sources", () => {
    const credits = illustrationCredits(sheets, manifest);
    expect(credits.map((s) => [s.source, s.label])).toEqual([
      ['everkinetic', 'Everkinetic'],
      ['workout_guide', 'workout-guide'],
    ]);
    expect(credits.map((s) => s.files.map((f) => f.entry.id))).toEqual([
      ['squat-start', 'lunge-start', 'squat-end'],
      ['derived-start', 'pike-start'],
    ]);
  });

  it('usages : fiche et pose, triés par nom (collation française), puis pose', () => {
    const [everkinetic, workoutGuide] = illustrationCredits(sheets, manifest);
    const squatStart = everkinetic?.files.find((f) => f.entry.id === 'squat-start');
    expect(squatStart?.uses).toEqual([
      { exerciseId: 'box-squat', exerciseName: 'Écart sumo', role: 'start' },
      { exerciseId: 'goblet-squat', exerciseName: 'Squat goblet', role: 'start' },
    ]);
    expect(workoutGuide?.files.map((f) => f.uses[0]?.exerciseName)).toEqual(['Ancien exercice', 'Pike']);
  });

  it('chaque fichier porte sa ligne de crédit', () => {
    const [, workoutGuide] = illustrationCredits(sheets, manifest);
    expect(workoutGuide?.files.map((f) => f.line)).toEqual([
      'Illustration : Bryl Lim, Greg Priday · CC BY 4.0 · modifiée',
      'Illustration : Bryl Lim · CC BY-SA 4.0 · modifiée',
    ]);
  });

  it('par source : créateurs et licences distincts, commits figés distincts', () => {
    const [everkinetic, workoutGuide] = illustrationCredits(sheets, manifest);
    expect(everkinetic?.creators).toEqual(['Greg Priday']);
    expect(everkinetic?.licenses).toEqual(['CC-BY-SA-4.0']);
    expect(everkinetic?.frozen).toEqual([
      { repository: 'https://github.com/everkinetic/data', commit: COMMIT },
      { repository: 'https://github.com/everkinetic/data', commit: OTHER_COMMIT },
    ]);
    expect(workoutGuide?.creators).toEqual(['Bryl Lim', 'Greg Priday']);
    expect(workoutGuide?.licenses).toEqual(['CC-BY-SA-4.0', 'CC-BY-4.0']);
    expect(workoutGuide?.frozen).toEqual([
      { repository: 'https://github.com/bryllim/workout-guide', commit: COMMIT },
    ]);
  });

  it("ni fichier d'un brouillon ou d'une fiche relue, ni fichier inutilisé, ni id absent du manifeste", () => {
    const ids = illustrationCredits(sheets, manifest).flatMap((s) => s.files.map((f) => f.entry.id));
    expect(ids).not.toContain('draft-only-start');
    expect(ids).not.toContain('unused-start');
    expect(ids).not.toContain('absent');
  });

  it("aucune fiche illustrée : aucune source ; ordre d'entrée sans effet", () => {
    expect(illustrationCredits([sheet('bare', 'Sans illustration', 'published')], manifest)).toEqual([]);
    expect(illustrationCredits([...sheets].reverse(), [...manifest].reverse())).toEqual(
      illustrationCredits(sheets, manifest),
    );
  });
});
