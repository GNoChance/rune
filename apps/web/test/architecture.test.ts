import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '../src');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const rel = (f: string) => relative(SRC, f).replaceAll('\\', '/');
const code = (f: string) => /\.(ts|tsx)$/.test(f);

/** Écrans et composants : Dexie seulement derrière `repos/` (01 §2 et §3). */
const isScreen = (path: string) =>
  path.startsWith('features/') ||
  path.startsWith('ui/') ||
  path === 'App.tsx' ||
  (path.startsWith('sw/') && path.endsWith('.tsx'));

/** `import … from 'x'`, `export … from 'x'`, `import('x')` et import pour effet de bord `import 'x'`. */
const IMPORT =
  /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

/** Toute lecture de `onLine` : `navigator.onLine`, `navigator?.onLine`, `['onLine']`, déstructuration. */
const ON_LINE = /\bonLine\b/;

const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const specifiers = (text: string): string[] =>
  [...text.matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');

const imports = (file: string): string[] => specifiers(withoutComments(readFileSync(file, 'utf8')));

/** Imports gardés dans le bundle du fichier : `import … from`, `export … from`, effet de bord ; ni `import type` ni `import()`. */
const STATIC_IMPORT =
  /(?:import|export)\s+(?!type\s)[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;

const staticSpecifiers = (text: string): string[] =>
  [...withoutComments(text).matchAll(STATIC_IMPORT)].map((m) => m[1] ?? m[2] ?? '');

/** Pierres des rangs D à S (≈ 30 ko gzip), hors du bundle initial. */
const UPPER_STONES = /(^|\/)art\/RankStoneUpper$/;

/** Réglages de charge des lieux et des salles : chargés à la demande (routes /places/:id/load et /gyms/:id/load). */
const LOAD_SETTINGS_PAGE = /(^|\/)LoadSettingsPage$/;

/** Écrans de la brique 3 (séance, historique, programme) : chargés à la demande, jamais dans le bundle initial. */
const LAZY_FEATURE = /(^|\/)features\/(workout|history|program)(\/|$)/;
const inLazyFeature = (path: string) => /^features\/(workout|history|program)\//.test(path);

describe('architecture', () => {
  const files = [...walk(SRC)].filter(code);

  it('features/, ui/, App.tsx et src/sw/**/*.tsx n’importent ni dexie ni local-db/', () => {
    const screens = files.filter((f) => isScreen(rel(f)));
    expect(screens.length).toBeGreaterThan(5);
    for (const file of screens) {
      for (const spec of imports(file)) {
        expect(spec, rel(file)).not.toMatch(/^dexie(\/|$)/);
        expect(spec, rel(file)).not.toMatch(/(^|\/)local-db(\/|$)/);
      }
    }
  });

  it('aucune lecture de onLine dans le code de src/ (R-SYN-30, commentaires exclus)', () => {
    for (const file of files) {
      expect(withoutComments(readFileSync(file, 'utf8')), rel(file)).not.toMatch(ON_LINE);
    }
  });

  it('le motif onLine voit toutes les formes, pas les commentaires', () => {
    for (const sample of [
      'const a = navigator.onLine;',
      'const a = navigator?.onLine;',
      "const a = navigator['onLine'];",
      'const { onLine } = navigator;',
    ]) {
      expect(withoutComments(sample), sample).toMatch(ON_LINE);
    }
    expect(withoutComments('// navigator.onLine\n/* navigator.onLine */ x')).not.toMatch(ON_LINE);
    expect('const online = true; window.ononline = f;').not.toMatch(ON_LINE);
  });

  it('pierres D à S (ui/art/RankStoneUpper) : seulement par import(), jamais dans le bundle initial', () => {
    const dynamic = files.filter((f) => imports(f).some((spec) => UPPER_STONES.test(spec)));
    expect(dynamic.map(rel)).toEqual(['ui/RankBadge.tsx']);
    for (const file of files) {
      for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
        expect(spec, rel(file)).not.toMatch(UPPER_STONES);
      }
    }
  });

  it('réglages de charge (LoadSettingsPage) : seulement par import() depuis App.tsx, jamais dans le bundle initial', () => {
    const dynamic = files.filter((f) => imports(f).some((spec) => LOAD_SETTINGS_PAGE.test(spec)));
    expect(dynamic.map(rel)).toEqual(['App.tsx']);
    for (const file of files) {
      for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
        expect(spec, rel(file)).not.toMatch(LOAD_SETTINGS_PAGE);
      }
    }
  });

  it('séance, historique et programme (features/workout, history, program) : seulement par import() depuis App.tsx, jamais dans le bundle initial', () => {
    const dynamic = files.filter(
      (f) => imports(f).some((spec) => LAZY_FEATURE.test(spec)) && !inLazyFeature(rel(f)),
    );
    expect(dynamic.map(rel)).toEqual(['App.tsx']);
    for (const file of files) {
      if (inLazyFeature(rel(file))) continue;
      for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
        expect(spec, rel(file)).not.toMatch(LAZY_FEATURE);
      }
    }
  });

  it('le motif des imports statiques laisse import() et import type, garde le reste', () => {
    const sample = [
      "import { RankStoneUpper } from './art/RankStoneUpper';",
      "import type { UpperRank } from './art/RankStoneUpper';",
      "export { RankStoneUpper } from './art/RankStoneUpper';",
      "import './art/RankStoneUpper';",
      "const m = import('./art/RankStoneUpper');",
    ].join('\n');
    expect(staticSpecifiers(sample)).toEqual([
      './art/RankStoneUpper',
      './art/RankStoneUpper',
      './art/RankStoneUpper',
    ]);
  });

  it('le motif détecte bien un import interdit, effet de bord compris', () => {
    const sample = [
      "import { getMeta } from '../../local-db/meta';",
      "import Dexie from 'dexie';",
      "import 'dexie';",
      "export { x } from './local-db/db';",
      "const m = import('dexie');",
    ].join('\n');
    expect(specifiers(sample)).toEqual(['../../local-db/meta', 'dexie', 'dexie', './local-db/db', 'dexie']);
  });
});
