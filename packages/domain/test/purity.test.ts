import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = join(__dirname, '..', 'src');
/** Tous les `.ts` de `src/`, sous-dossiers compris (`auth/`, `catalog/`), chemins relatifs écrits avec `/`. */
const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
  .map((f) => f.replaceAll('\\', '/'))
  .filter((f) => f.endsWith('.ts'))
  .sort();
const read = (f: string) => readFileSync(join(srcDir, f), 'utf8');

describe('pureté de packages/domain', () => {
  it('contient des fichiers à vérifier', () => expect(files.length).toBeGreaterThan(0));

  it('lit src/ récursivement : auth/ et catalog/ sont vérifiés', () => {
    expect(files.some((f) => f.startsWith('auth/'))).toBe(true);
    expect(files.some((f) => f.startsWith('catalog/'))).toBe(true);
  });

  it.each(files)('%s : ni horloge, ni aléa, ni node:', (f) => {
    const src = read(f);
    expect(src).not.toMatch(/\bDate\.now\s*\(/);
    expect(src).not.toMatch(/\bMath\.random\s*\(/);
    expect(src).not.toMatch(/new Date\(\s*\)/);
    expect(src).not.toMatch(/from ['"]node:/);
  });

  it('R-AGE-3 : hors age.ts, aucune règle ne lit la date de naissance', () => {
    for (const f of files.filter((n) => n !== 'age.ts')) {
      expect(read(f), f).not.toMatch(/birth_?date/i);
    }
  });
});
