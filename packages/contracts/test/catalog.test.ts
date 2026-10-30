import { describe, expect, it } from 'vitest';
import {
  CatalogBundle,
  ILLUSTRATION_FILE_RE,
  ILLUSTRATION_MEDIA_TYPES,
  IllustrationRef,
} from '../src/catalog';

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
  it('décrit un catalogue vide', () => {
    const empty = { version: 'v', exercises: [], illustrations: [], programTemplates: [], adviceSheets: [] };
    expect(CatalogBundle.safeParse(empty).success).toBe(true);
  });
});
