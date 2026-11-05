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

/** Page d'un exercice de la Progression (courbe et records) : chargée à la demande (route /progression/exercises/:id). */
const EXERCISE_PROGRESS = /(^|\/)progression\/ExerciseProgress$/;

/** Écrans de la brique 3 (séance, historique, programme) : chargés à la demande, jamais dans le bundle initial. */
const LAZY_FEATURE = /(^|\/)features\/(workout|history|program)(\/|$)/;
const inLazyFeature = (path: string) => /^features\/(workout|history|program)\//.test(path);

/** Mon programme et Choisir un programme (`features/program`) : chargés à la demande (routes /program…). */
const PROGRAM_SCREENS = /(^|\/)features\/program\/|^\.\.?\/program\//;
const inProgram = (path: string) => path.startsWith('features/program/');

/** Écrans du coach chargés à la demande : conversation, accord, conversations précédentes (routes /coach…). Les tâches 28 et 29 y ajoutent les leurs. */
const COACH_SCREENS =
  /(^|\/)(coach\/(CoachPage|ConsentPage|ThreadsPage|ThreadPage|BriefPage)|public\/CoachHelpPage)$/;

/** Administration du coach : chargée à la demande (route /admin/coach). */
const ADMIN_COACH_PAGE = /(^|\/)admin\/AdminCoachPage$/;

/** Cartes d'aide et feuille de signalement : dans le chunk de /coach, jamais dans le bundle initial. */
const COACH_PARTS = /(^|\/)(HelpCard|ReportSheet)$/;

/**
 * La conversation (chargée à la demande) est le seul écran hors du programme qui en importe une carte
 * (`ProposalCard`) : le code du programme reste dans le chunk de /coach, jamais dans le bundle initial.
 */
const COACH_PAGE = 'features/coach/CoachPage.tsx';
/** Un fil lu en lecture seule garde les cartes d'aide et de proposition à leur place : même chunk que la conversation. */
const COACH_THREAD = 'features/coach/ThreadPage.tsx';
const inCoachChunk = (path: string) => path === COACH_PAGE || path === COACH_THREAD;

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

  it("page d'un exercice de la Progression (ExerciseProgress) : seulement par import() depuis App.tsx, jamais dans le bundle initial", () => {
    const dynamic = files.filter((f) => imports(f).some((spec) => EXERCISE_PROGRESS.test(spec)));
    expect(dynamic.map(rel)).toEqual(['App.tsx']);
    for (const file of files) {
      for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
        expect(spec, rel(file)).not.toMatch(EXERCISE_PROGRESS);
      }
    }
  });

  it('séance, historique et programme (features/workout, history, program) : seulement par import() depuis App.tsx, jamais dans le bundle initial', () => {
    const dynamic = files.filter(
      (f) =>
        imports(f).some((spec) => LAZY_FEATURE.test(spec)) && !inLazyFeature(rel(f)) && !inCoachChunk(rel(f)),
    );
    expect(dynamic.map(rel)).toEqual(['App.tsx']);
    for (const file of files) {
      if (inLazyFeature(rel(file)) || inCoachChunk(rel(file))) continue;
      for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
        expect(spec, rel(file)).not.toMatch(LAZY_FEATURE);
      }
    }
  });

  it('écrans du programme (features/program) : seulement par import() depuis App.tsx, jamais dans le bundle initial', () => {
    const outside = files.filter((f) => !inProgram(rel(f)) && !inCoachChunk(rel(f)));
    const dynamic = outside.filter((f) => imports(f).some((spec) => PROGRAM_SCREENS.test(spec)));
    expect(dynamic.map(rel)).toEqual(['App.tsx']);
    for (const file of outside) {
      for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
        expect(spec, rel(file)).not.toMatch(PROGRAM_SCREENS);
      }
    }
  });

  it('écrans du coach (CoachPage, ConsentPage, ThreadsPage, ThreadPage, BriefPage, CoachHelpPage) : seulement par import() depuis App.tsx, jamais dans le bundle initial', () => {
    const dynamic = files.filter((f) => imports(f).some((spec) => COACH_SCREENS.test(spec)));
    expect(dynamic.map(rel)).toEqual(['App.tsx']);
    for (const file of files) {
      for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
        expect(spec, rel(file)).not.toMatch(COACH_SCREENS);
      }
    }
  });

  it('administration du coach (AdminCoachPage) : seulement par import() depuis App.tsx, jamais dans le bundle initial', () => {
    const dynamic = files.filter((f) => imports(f).some((spec) => ADMIN_COACH_PAGE.test(spec)));
    expect(dynamic.map(rel)).toEqual(['App.tsx']);
    for (const file of files) {
      for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
        expect(spec, rel(file)).not.toMatch(ADMIN_COACH_PAGE);
      }
    }
  });

  it("cartes d'aide et signalement (features/coach/HelpCard, ReportSheet) : seulement importées par CoachPage et ThreadPage, jamais dans le bundle initial", () => {
    const importers = files.filter((f) => imports(f).some((spec) => COACH_PARTS.test(spec)));
    expect(importers.map(rel)).toEqual([COACH_PAGE, COACH_THREAD]);
    // Les deux sont eux-mêmes chargés par import() depuis App.tsx (test ci-dessus).
    expect(imports(resolve(SRC, COACH_PAGE)).some((spec) => COACH_PARTS.test(spec))).toBe(true);
    for (const spec of ['./HelpCard', './ReportSheet', '../coach/HelpCard'])
      expect(spec).toMatch(COACH_PARTS);
    for (const spec of ['./ChatBubble', '../program/ProposalCard']) expect(spec).not.toMatch(COACH_PARTS);
  });

  it('le motif des écrans du programme voit leurs chemins depuis App.tsx et depuis un autre écran', () => {
    for (const spec of [
      './features/program/ProgramPage',
      '../program/ChooseProgram',
      '../../features/program/x',
    ]) {
      expect(spec).toMatch(PROGRAM_SCREENS);
    }
    for (const spec of ['./features/profile/ProfileHub', '../programme/x', './program-view', '../repos']) {
      expect(spec).not.toMatch(PROGRAM_SCREENS);
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
