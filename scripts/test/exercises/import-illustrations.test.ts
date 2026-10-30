import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IllustrationEntry } from '@rune/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DATA_DIR, GLOSSARY_FILE, validateDataDir } from '../../data/validate';
import {
  importIllustrations,
  main,
  SOURCE_DESCRIPTOR,
  SVG_MODIFICATIONS,
} from '../../exercises/import-illustrations';
import { checkIllustrations } from '../../svg/check';
import { svgComments, svgCreditComment } from '../../svg/sanitize';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const BY_SA = 'https://creativecommons.org/licenses/by-sa/4.0/';
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

/** SVG piégé de la source (04 §13, critère 11) : il doit arriver nettoyé dans le dépôt. */
const TRAPPED = `<?xml version="1.0"?>
<svg xmlns="${SVG_NS}" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(1)</script>
  <a href="https://evil.example/"><rect width="4" height="4"/></a>
</svg>
`;
const plainSvg = (n: number) => `<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><circle r="${n}"/></svg>`;

const everkinetic = (files: Record<string, unknown>) => ({
  source: 'everkinetic',
  repository: 'https://github.com/everkinetic/data',
  commit: COMMIT,
  license: 'CC-BY-SA-4.0',
  license_url: BY_SA,
  creators: ['Greg Priday'],
  provenance_documented: true,
  files,
});

const workoutGuide = (files: Record<string, unknown>) => ({
  source: 'workout_guide',
  repository: 'https://github.com/bryllim/workout-guide',
  commit: COMMIT,
  license: 'CC-BY-SA-4.0',
  license_url: BY_SA,
  creators: ['Bryl Lim'],
  // 04 §12 règle 3 : sans source ni méthode, la provenance des dessins n'est pas documentée.
  provenance_documented: false,
  files,
});

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

function capture() {
  const lines: { out: string[]; err: string[] } = { out: [], err: [] };
  return {
    lines,
    console: { log: (s: string) => lines.out.push(s), error: (s: string) => lines.err.push(s) },
  };
}

let root: string;
let source: string;
let data: string;

/** Copie figée d'une source : le descripteur, puis chaque fichier à son chemin. */
async function writeSource(descriptor: unknown, files: Record<string, string | Uint8Array>, dir = source) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, SOURCE_DESCRIPTOR), `${JSON.stringify(descriptor, null, 2)}\n`);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), content);
  }
}

const filesDir = () => join(data, 'illustrations', 'files');
const listed = async () => (await readdir(filesDir())).filter((n) => !n.startsWith('.')).sort();
const manifest = async (): Promise<IllustrationEntry[]> =>
  JSON.parse(await readFile(join(data, 'illustrations', 'manifest.json'), 'utf8'));
const run = (...args: string[]) => {
  const io = capture();
  return main([...args, '--dir', data], io.console).then((code) => ({ code, ...io.lines }));
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rune-import-'));
  source = join(root, 'everkinetic-data');
  data = join(root, 'data');
  await mkdir(filesDir(), { recursive: true });
  await mkdir(join(data, 'exercises'));
  await writeFile(join(filesDir(), '.gitkeep'), '');
  await writeFile(join(data, 'illustrations', 'manifest.json'), '[]\n');
  await copyFile(join(DEFAULT_DATA_DIR, GLOSSARY_FILE), join(data, GLOSSARY_FILE));
  // Aucun téléchargement : l'import lit seulement la copie figée.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('réseau interdit');
    }),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

describe('illustrations:import --source <copie figée> --ids …', () => {
  it('copie seulement les ids demandés, nettoyés, nommés <id>.<hash8>.svg, avec leur entrée de manifeste', async () => {
    await writeSource(
      everkinetic({
        'squat-start': { path: 'svg/squat-1.svg' },
        'squat-end': { path: 'svg/squat-2.svg' },
      }),
      { 'svg/squat-1.svg': TRAPPED, 'svg/squat-2.svg': plainSvg(2), 'svg/other.svg': plainSvg(3) },
    );
    const result = await run('--source', source, '--ids', 'squat-start');
    expect(result.code).toBe(0);

    const [file] = await listed();
    expect(await listed()).toHaveLength(1);
    const bytes = await readFile(join(filesDir(), file ?? ''));
    const hash = sha256(bytes);
    expect(file).toBe(`squat-start.${hash.slice(0, 8)}.svg`);
    const text = bytes.toString('utf8');
    expect(text).not.toMatch(/script|onload|evil\.example/);
    expect(text).toContain('<rect width="4" height="4"/>');

    const expected: IllustrationEntry = {
      id: 'squat-start',
      file: file ?? '',
      sha256: hash,
      bytes: bytes.byteLength,
      media_type: 'image/svg+xml',
      source: 'everkinetic',
      source_url: `https://github.com/everkinetic/data/blob/${COMMIT}/svg/squat-1.svg`,
      creators: ['Greg Priday'],
      license: 'CC-BY-SA-4.0',
      license_url: BY_SA,
      modifications: SVG_MODIFICATIONS,
      replace_before_public: false,
    };
    expect(await manifest()).toEqual([expected]);
    // Clés dans l'ordre des colonnes, JSON à 2 espaces et LF final.
    expect(await readFile(join(data, 'illustrations', 'manifest.json'), 'utf8')).toBe(
      `${JSON.stringify([expected], null, 2)}\n`,
    );
    expect(svgComments(text)).toEqual([svgCreditComment(expected)]);
    expect(result.out).toEqual([`${file} importé (everkinetic).`, '1 illustration(s) importée(s).']);

    // Le dépôt reste valide pour les deux contrôles de la CI.
    expect((await validateDataDir(data)).errors).toEqual([]);
    expect((await checkIllustrations(data)).errors).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('workout-guide : provenance non documentée → replace_before_public (04 §12 règle 3), sauf fichier documenté', async () => {
    await writeSource(
      workoutGuide({
        'pike-start': { path: 'images/pike-1.png' },
        'nordic-start': {
          path: 'images/nordic-1.svg',
          // Dessin repris d'Everkinetic : les deux attributions, et ce que la source y a changé.
          creators: ['Bryl Lim', 'Greg Priday'],
          provenance_documented: true,
          modifications: "Redessiné par Bryl Lim d'après Everkinetic (Greg Priday).",
        },
      }),
      { 'images/pike-1.png': PNG, 'images/nordic-1.svg': plainSvg(4) },
    );
    expect((await run('--source', source, '--ids', 'pike-start,nordic-start')).code).toBe(0);
    const [nordic, pike] = await manifest();
    expect(pike).toMatchObject({
      id: 'pike-start',
      file: `pike-start.${sha256(PNG).slice(0, 8)}.png`,
      media_type: 'image/png',
      source: 'workout_guide',
      source_url: `https://github.com/bryllim/workout-guide/blob/${COMMIT}/images/pike-1.png`,
      creators: ['Bryl Lim'],
      replace_before_public: true,
    });
    // Fichier matriciel copié octet pour octet, sans modification de notre part.
    expect(pike && 'modifications' in pike).toBe(false);
    expect(new Uint8Array(await readFile(join(filesDir(), pike?.file ?? '')))).toEqual(PNG);
    expect(nordic).toMatchObject({
      id: 'nordic-start',
      creators: ['Bryl Lim', 'Greg Priday'],
      modifications: `Redessiné par Bryl Lim d'après Everkinetic (Greg Priday). ${SVG_MODIFICATIONS}`,
      replace_before_public: false,
    });
    expect((await validateDataDir(data)).errors).toEqual([]);
    expect((await checkIllustrations(data)).errors).toEqual([]);
  });

  it('deux sources à la suite : manifeste trié par id ; réimport → nouvel octet, ancien fichier retiré', async () => {
    const other = join(root, 'workout-guide');
    await writeSource(everkinetic({ 'squat-start': { path: 's.svg' } }), { 's.svg': plainSvg(1) });
    await writeSource(workoutGuide({ 'ab-wheel-start': { path: 'a.png' } }), { 'a.png': PNG }, other);
    expect((await run('--source', source, '--ids', 'squat-start')).code).toBe(0);
    expect((await run('--source', other, '--ids', 'ab-wheel-start')).code).toBe(0);
    expect((await manifest()).map((e) => e.id)).toEqual(['ab-wheel-start', 'squat-start']);
    const before = await listed();

    // Même octets : rien ne bouge.
    expect((await run('--source', source, '--ids', 'squat-start')).code).toBe(0);
    expect(await listed()).toEqual(before);

    await writeFile(join(source, 's.svg'), plainSvg(5));
    expect((await run('--source', source, '--ids', 'squat-start')).code).toBe(0);
    const entries = await manifest();
    expect(entries.map((e) => e.id)).toEqual(['ab-wheel-start', 'squat-start']);
    const squat = entries[1];
    expect(await listed()).toEqual([entries[0]?.file, squat?.file].sort());
    expect(before).not.toContain(squat?.file);
    expect((await validateDataDir(data)).errors).toEqual([]);
  });
});

describe('illustrations:import : refus, sans rien écrire', () => {
  const unchanged = async () => {
    expect(await listed()).toEqual([]);
    expect(await readFile(join(data, 'illustrations', 'manifest.json'), 'utf8')).toBe('[]\n');
  };

  it.each([
    ['un id absent du descripteur', ['inconnu'], 'inconnu : absent de rune-import.json.'],
    [
      'un PNG renommé en .svg',
      ['fake-svg'],
      "fake-svg : octets d'un fichier image/png, pour une extension .svg.",
    ],
    [
      'un JPEG renommé en .png',
      ['fake-png'],
      "fake-png : octets d'un fichier image/jpeg, pour une extension .png.",
    ],
    ['un SVG de plus de 40 Ko une fois nettoyé', ['huge'], 'huge : 44'],
    [
      'un chemin qui sort de la copie figée',
      ['escape'],
      'escape : chemin hors de la source (../outside.svg).',
    ],
    ['un SVG illisible', ['broken'], 'broken : SVG illisible'],
    ['un fichier absent de la source', ['missing'], 'missing : fichier absent (svg/missing.svg).'],
    ['un id valide et un id refusé ensemble', ['squat-start', 'fake-svg'], 'fake-svg : '],
  ])('%s', async (_, ids, message) => {
    await writeFile(join(root, 'outside.svg'), plainSvg(1));
    await writeSource(
      everkinetic({
        'squat-start': { path: 'svg/squat-1.svg' },
        'fake-svg': { path: 'svg/fake.svg' },
        'fake-png': { path: 'img/fake.png' },
        huge: { path: 'svg/huge.svg' },
        escape: { path: '../outside.svg' },
        broken: { path: 'svg/broken.svg' },
        missing: { path: 'svg/missing.svg' },
      }),
      {
        'svg/squat-1.svg': plainSvg(1),
        'svg/fake.svg': PNG,
        'img/fake.png': JPEG,
        'svg/huge.svg': `<svg xmlns="${SVG_NS}">${'<rect x="1" y="1" width="2" height="2"/>'.repeat(1100)}</svg>`,
        'svg/broken.svg': `<svg xmlns="${SVG_NS}"><g></svg>`,
      },
    );
    const result = await run('--source', source, '--ids', ids.join(','));
    expect(result.code).toBe(1);
    expect(result.err[0]).toContain(message);
    expect(result.err.at(-1)).toBe("Import refusé : rien n'a été écrit.");
    await unchanged();
  });

  it.each([
    ['sans descripteur', null, 'rune-import.json absent'],
    ['commit non figé', { ...everkinetic({}), commit: 'main' }, 'commit'],
    ['licence non admise', { ...everkinetic({}), license: 'CC-BY-NC-4.0' }, 'license'],
    ['id invalide', everkinetic({ Squat_Start: { path: 'a.svg' } }), 'files'],
  ])('descripteur %s : sortie 1', async (_, descriptor, message) => {
    await mkdir(source, { recursive: true });
    if (descriptor !== null) await writeSource(descriptor, {});
    const result = await run('--source', source, '--ids', 'squat-start');
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain(message);
    await unchanged();
  });

  it.each([
    [[]],
    [['--source', 'x']],
    [['--ids', 'a']],
    [['--source', 'x', '--ids', 'a', '--force']],
    [['--source', 'x', '--ids', ',']],
  ])('usage %j : sortie 2', async (args) => {
    const io = capture();
    expect(await main(args, io.console)).toBe(2);
    expect(io.lines.err).toEqual([
      'Usage : pnpm illustrations:import --source <copie figée> --ids <id>[,<id>…] [--dir <dossier data>]',
    ]);
  });
});

describe('importIllustrations (fonction)', () => {
  it('rend les entrées écrites, sans toucher au dépôt quand une erreur survient', async () => {
    await writeSource(everkinetic({ a: { path: 'a.svg' } }), { 'a.svg': plainSvg(1) });
    const ok = await importIllustrations({ sourceDir: source, ids: ['a'], dataDir: data });
    expect(ok.errors).toEqual([]);
    expect(ok.imported.map((e) => e.id)).toEqual(['a']);
    const ko = await importIllustrations({ sourceDir: source, ids: ['b'], dataDir: data });
    expect(ko.imported).toEqual([]);
    expect(ko.errors).toEqual(['b : absent de rune-import.json.']);
  });
});
