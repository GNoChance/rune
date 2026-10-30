import { describe, expect, it } from 'vitest';
import {
  CatalogBundle,
  ILLUSTRATION_FILE_RE,
  ILLUSTRATION_MEDIA_TYPE_BY_EXTENSION,
  ILLUSTRATION_MEDIA_TYPES,
  IllustrationEntry,
  IllustrationManifest,
  IllustrationRef,
} from '../src/catalog';

const SHA = `0a1b2c3d${'e'.repeat(56)}`;

/** Entrée de manifeste valide (dessin Everkinetic modifié), surchargée champ par champ. */
const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'goblet-squat-start',
  file: 'goblet-squat-start.0a1b2c3d.svg',
  sha256: SHA,
  bytes: 12_345,
  media_type: 'image/svg+xml',
  source: 'everkinetic',
  source_url: 'https://github.com/everkinetic/data/blob/0123abc/svg/goblet-squat-1.svg',
  creators: ['Greg Priday'],
  license: 'CC-BY-SA-4.0',
  license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  modifications: 'Nettoyage du SVG, optimisation, renommage.',
  replace_before_public: false,
  ...overrides,
});

describe('IllustrationEntry', () => {
  it('accepte une entrée complète, et sans modifications', () => {
    expect(IllustrationEntry.safeParse(entry()).success).toBe(true);
    const { modifications: _, ...bare } = entry();
    expect(IllustrationEntry.safeParse(bare).success).toBe(true);
  });

  it('reste un IllustrationRef', () => {
    const parsed: IllustrationRef = IllustrationEntry.parse(entry());
    expect(IllustrationRef.parse(parsed)).toEqual({ id: parsed.id, file: parsed.file });
  });

  it.each([
    ['un fichier qui ne commence pas par son id', { file: 'goblet-squat-end.0a1b2c3d.svg' }],
    [
      "une empreinte de nom de fichier qui n'est pas le début du sha256",
      { file: 'goblet-squat-start.ffffffff.svg' },
    ],
    ["un type qui ne correspond pas à l'extension", { media_type: 'image/png' }],
    ['un sha256 en majuscules', { sha256: SHA.toUpperCase() }],
    ['une source inconnue', { source: 'wger' }],
    ['une licence non admise', { license: 'CC-BY-NC-4.0' }],
    ['un créateur non identifié', { creators: [] }],
    ['une URL source en http', { source_url: 'http://example.org/a.svg' }],
    ['une taille nulle', { bytes: 0 }],
    ['une clé inconnue', { author: 'Greg Priday' }],
    ['replace_before_public absent', { replace_before_public: undefined }],
  ])('refuse %s', (_, overrides) => {
    expect(IllustrationEntry.safeParse(entry(overrides)).success).toBe(false);
  });

  it("chaque extension a son type, celui de l'entrée", () => {
    for (const [ext, mediaType] of Object.entries(ILLUSTRATION_MEDIA_TYPE_BY_EXTENSION)) {
      const file = `goblet-squat-start.0a1b2c3d.${ext}`;
      expect(IllustrationEntry.safeParse(entry({ file, media_type: mediaType })).success).toBe(true);
    }
  });

  it('IllustrationManifest est un tableau de ces entrées, vide accepté', () => {
    expect(IllustrationManifest.safeParse([]).success).toBe(true);
    expect(IllustrationManifest.safeParse([entry()]).success).toBe(true);
    expect(IllustrationManifest.safeParse([entry({ bytes: -1 })]).success).toBe(false);
  });
});

describe('IllustrationRef', () => {
  it('accepte un fichier haché', () => {
    expect(IllustrationRef.safeParse({ id: 'squat', file: 'squat.0a1b2c3d.svg' }).success).toBe(true);
  });

  it('refuse un fichier sans empreinte', () => {
    expect(IllustrationRef.safeParse({ id: 'squat', file: 'squat.svg' }).success).toBe(false);
  });

  it('refuse le tiret bas, les majuscules, les chemins et les extensions inconnues', () => {
    expect(ILLUSTRATION_FILE_RE.test('squat_a.0a1b2c3d.svg')).toBe(false);
    expect(ILLUSTRATION_FILE_RE.test('Squat.0a1b2c3d.svg')).toBe(false);
    expect(ILLUSTRATION_FILE_RE.test('squat.0a1b2c3d.gif')).toBe(false);
    expect(ILLUSTRATION_FILE_RE.test('../squat.0a1b2c3d.svg')).toBe(false);
    expect(ILLUSTRATION_FILE_RE.test('back-squat.0a1b2c3d.webp')).toBe(true);
  });

  it('chaque extension admise a son type, et rien de plus', () => {
    const byExtension = { svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' };
    for (const ext of Object.keys(byExtension))
      expect(ILLUSTRATION_FILE_RE.test(`a.0a1b2c3d.${ext}`)).toBe(true);
    expect([...ILLUSTRATION_MEDIA_TYPES].sort()).toEqual(Object.values(byExtension).sort());
  });
});

describe('CatalogBundle', () => {
  const empty = { version: 'v', exercises: [], illustrations: [], programTemplates: [], adviceSheets: [] };

  it('décrit un catalogue vide', () => {
    expect(CatalogBundle.safeParse(empty).success).toBe(true);
  });

  it('porte les entrées complètes du manifeste (crédits hors ligne, 04 §11 et §12)', () => {
    expect(CatalogBundle.safeParse({ ...empty, illustrations: [entry()] }).success).toBe(true);
    const ref = { id: 'squat', file: 'squat.0a1b2c3d.svg' };
    expect(CatalogBundle.safeParse({ ...empty, illustrations: [ref] }).success).toBe(false);
  });

  it("refuse ce qui n'est pas une fiche servie", () => {
    expect(CatalogBundle.safeParse({ ...empty, exercises: [{ id: 'squat' }] }).success).toBe(false);
  });
});
