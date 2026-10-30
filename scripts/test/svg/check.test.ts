import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IllustrationEntry } from '@rune/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DATA_DIR } from '../../data/validate';
import { checkIllustrations, ILLUSTRATION_MAX_BYTES, main, sniffMediaType } from '../../svg/check';
import { sanitizeSvg, svgCreditComment } from '../../svg/sanitize';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** Octets d'un PNG (signature, puis du remplissage) de `size` octets. */
const png = (size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set(PNG_MAGIC);
  return bytes;
};
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const webp = () => new Uint8Array([...Buffer.from('RIFF'), 1, 0, 0, 0, ...Buffer.from('WEBPVP8 ')]);
const gif = () => new Uint8Array(Buffer.from('GIF89a\u0001\u0000'));
const utf8 = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const EXT_TYPE = { svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' } as const;

/** Entrée de manifeste cohérente avec `bytes` : nom `<id>.<hash8>.<ext>`, sha256, taille. */
function entryFor(id: string, ext: keyof typeof EXT_TYPE, bytes: Uint8Array): IllustrationEntry {
  const hash = sha256(bytes);
  return {
    id,
    file: `${id}.${hash.slice(0, 8)}.${ext}`,
    sha256: hash,
    bytes: bytes.byteLength,
    media_type: EXT_TYPE[ext],
    source: 'everkinetic',
    source_url: `https://github.com/everkinetic/data/blob/${COMMIT}/svg/${id}.svg`,
    creators: ['Greg Priday'],
    license: 'CC-BY-SA-4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    ...(ext === 'svg' ? { modifications: 'Rune : nettoyage du SVG.' } : {}),
    replace_before_public: false,
  };
}

/** SVG nettoyé avec son commentaire de crédit, d'environ `size` octets (rectangles ajoutés). */
function creditedSvg(id: string, size = 0): { bytes: Uint8Array; entry: IllustrationEntry } {
  // Le crédit ne dépend pas de l'empreinte : on le calcule sur une entrée provisoire.
  const comment = svgCreditComment(entryFor(id, 'svg', new Uint8Array(1)));
  const rect = '<rect x="1" y="1" width="2" height="2"/>';
  const base = sanitizeSvg(`<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"></svg>`, comment);
  const count = Math.max(0, Math.ceil((size - base.length) / rect.length));
  const bytes = utf8(
    sanitizeSvg(`<svg xmlns="${SVG_NS}" viewBox="0 0 10 10">${rect.repeat(count)}</svg>`, comment),
  );
  return { bytes, entry: entryFor(id, 'svg', bytes) };
}

function capture() {
  const lines: { out: string[]; err: string[] } = { out: [], err: [] };
  return {
    lines,
    console: { log: (s: string) => lines.out.push(s), error: (s: string) => lines.err.push(s) },
  };
}

describe('sniffMediaType : le type par les octets (04 §12)', () => {
  it.each([
    ['PNG', png(), 'image/png'],
    ['JPEG', jpeg(), 'image/jpeg'],
    ['WebP', webp(), 'image/webp'],
    ['GIF (type non admis)', gif(), 'image/gif'],
    ['SVG', utf8(`<?xml version="1.0"?>\n<svg xmlns="${SVG_NS}"/>`), 'image/svg+xml'],
    ['SVG avec BOM', utf8(`\uFEFF<svg xmlns="${SVG_NS}"/>`), 'image/svg+xml'],
    ["texte qui n'est pas un SVG", utf8('<html></html>'), null],
    ['octets quelconques', new Uint8Array([0, 1, 2, 3, 0xff, 0xfe]), null],
  ])('%s', (_, bytes, expected) => {
    expect(sniffMediaType(bytes)).toBe(expected);
  });
});

describe('svg:check sur un dossier', () => {
  let dir: string;
  let manifest: IllustrationEntry[];

  const put = async (name: string, bytes: Uint8Array, entry?: IllustrationEntry) => {
    await writeFile(join(dir, 'illustrations', 'files', name), bytes);
    if (entry) manifest.push(entry);
    await writeFile(join(dir, 'illustrations', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  };
  /** Fichier rangé sous son nom de manifeste. */
  const add = async ({ bytes, entry }: { bytes: Uint8Array; entry: IllustrationEntry }) =>
    put(entry.file, bytes, entry);
  const codes = async () => (await checkIllustrations(dir)).errors.map((e) => [e.file, e.code]);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rune-svg-'));
    await mkdir(join(dir, 'illustrations', 'files'), { recursive: true });
    manifest = [];
    await put('.gitkeep', new Uint8Array());
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('SVG nettoyé et crédité, PNG, JPEG et WebP dans le manifeste : aucune erreur, sortie 0', async () => {
    await add(creditedSvg('squat-start'));
    for (const [id, ext, bytes] of [
      ['pike-start', 'png', png()],
      ['pike-end', 'jpg', jpeg()],
      ['pike-mid', 'webp', webp()],
    ] as const) {
      const entry = entryFor(id, ext, bytes);
      await put(entry.file, bytes, entry);
    }
    expect(await codes()).toEqual([]);
    const io = capture();
    expect(await main(['--dir', dir], io.console)).toBe(0);
    expect(io.lines.out).toEqual(['Illustrations valides : 4 fichier(s).']);
  });

  it('40 Ko acceptés, 41 Ko refusés (too_large), SVG comme PNG', async () => {
    expect(ILLUSTRATION_MAX_BYTES).toBe(40 * 1024);
    const atLimit = png(40 * 1024);
    const over = png(41 * 1024);
    const ok = entryFor('at-limit', 'png', atLimit);
    const big = entryFor('too-big', 'png', over);
    await put(ok.file, atLimit, ok);
    await put(big.file, over, big);
    const svg = creditedSvg('big-svg', 41 * 1024);
    expect(svg.bytes.byteLength).toBeGreaterThan(41 * 1024 - 64);
    await add(svg);
    expect(await codes()).toEqual([
      [`illustrations/files/${svg.entry.file}`, 'too_large'],
      [`illustrations/files/${big.file}`, 'too_large'],
    ]);
  });

  it('un PNG renommé en .svg est refusé (type_mismatch), comme un SVG renommé en .png', async () => {
    const bytes = png();
    const renamed = entryFor('png-as-svg', 'png', bytes);
    const file = renamed.file.replace(/\.png$/, '.svg');
    await put(file, bytes, { ...renamed, file, media_type: 'image/svg+xml' });
    const svg = creditedSvg('svg-as-png');
    const pngName = svg.entry.file.replace(/\.svg$/, '.png');
    await put(pngName, svg.bytes, { ...svg.entry, file: pngName, media_type: 'image/png' });
    const errors = (await checkIllustrations(dir)).errors;
    expect(errors.map((e) => [e.file, e.code])).toEqual([
      [`illustrations/files/${file}`, 'type_mismatch'],
      [`illustrations/files/${pngName}`, 'type_mismatch'],
    ]);
    expect(errors.map((e) => e.message)).toEqual([
      "Octets d'un fichier image/png, pour une extension .svg.",
      "Octets d'un fichier image/svg+xml, pour une extension .png.",
    ]);
  });

  it('JPEG sous .png et GIF sous .webp : refusés par leurs octets', async () => {
    for (const [id, ext, bytes] of [
      ['jpeg-as-png', 'png', jpeg()],
      ['gif-as-webp', 'webp', gif()],
    ] as const) {
      const entry = entryFor(id, ext, bytes);
      await put(entry.file, bytes, entry);
    }
    expect((await codes()).map(([, code]) => code)).toEqual(['type_mismatch', 'type_mismatch']);
  });

  it('SVG non nettoyé (svg_unclean), illisible (svg_invalid) ou sans son crédit (credit_missing)', async () => {
    const dirty = utf8(`<svg xmlns="${SVG_NS}"><script>alert(1)</script></svg>`);
    const broken = utf8(`<svg xmlns="${SVG_NS}"><g></svg>`);
    const bare = utf8(sanitizeSvg(`<svg xmlns="${SVG_NS}"/>`));
    for (const [id, bytes] of [
      ['dirty', dirty],
      ['broken', broken],
      ['bare', bare],
    ] as const) {
      const entry = entryFor(id, 'svg', bytes);
      await put(entry.file, bytes, entry);
    }
    const errors = (await checkIllustrations(dir)).errors;
    expect(errors.map((e) => e.code)).toEqual(['credit_missing', 'svg_invalid', 'svg_unclean']);
    expect(errors[2]?.message).toContain('élément <script> retiré');
  });

  it('crédit périmé : un commentaire qui ne reprend plus le manifeste est refusé', async () => {
    const { bytes, entry } = creditedSvg('squat-start');
    await put(entry.file, bytes, { ...entry, creators: ["Quelqu'un d'autre"] });
    expect((await codes()).map(([, code]) => code)).toEqual(['credit_missing']);
  });

  it('fichier hors manifeste (not_in_manifest) et nom sans empreinte (bad_name)', async () => {
    const { bytes, entry } = creditedSvg('orphan');
    await put(entry.file, bytes);
    await put('squat-start.svg', bytes);
    expect(await codes()).toEqual([
      [`illustrations/files/${entry.file}`, 'not_in_manifest'],
      ['illustrations/files/squat-start.svg', 'bad_name'],
    ]);
  });

  it('erreurs : sortie 1, une ligne par erreur puis le total', async () => {
    await put('squat-start.svg', png());
    const io = capture();
    expect(await main(['--dir', dir], io.console)).toBe(1);
    expect(io.lines.err.map((l) => l.replace(/^.*?(illustrations\/)/, '$1'))).toEqual([
      'illustrations/files/squat-start.svg [bad_name] Nom attendu : <id>.<empreinte 8 hex>.<svg|png|webp|jpg>.',
      'Illustrations invalides : 1 erreur(s).',
    ]);
  });

  it("option inconnue : sortie 2 et l'usage", async () => {
    const io = capture();
    expect(await main(['--strict'], io.console)).toBe(2);
    expect(io.lines.err).toEqual(['Usage : pnpm svg:check [--dir <dossier data>]']);
  });
});

describe('svg:check sur le dépôt', () => {
  it('le dossier data/ du dépôt passe', async () => {
    expect((await checkIllustrations(DEFAULT_DATA_DIR)).errors).toEqual([]);
  });
});
