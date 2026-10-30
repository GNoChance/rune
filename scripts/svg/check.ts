/**
 * `pnpm svg:check [--dir <dossier>]` : contrôle les fichiers de `data/illustrations/files/` (04 §12, « Import et
 * service »), en complément de `data:validate` qui vérifie les empreintes et les fichiers cités manquants.
 *
 * Pour chaque fichier (les fichiers cachés, comme `.gitkeep`, sont ignorés) :
 * - `bad_name` : nom autre que `<id>.<empreinte 8 hex>.<ext>` (rien d'autre n'est vérifié) ;
 * - `too_large` : plus de 40 Ko (`ILLUSTRATION_MAX_BYTES`) ;
 * - `type_mismatch` : octets d'un autre type que l'extension (un PNG renommé en `.svg`, un JPEG en `.png`) ;
 * - SVG : `svg_invalid` (illisible), sinon `svg_unclean` (ce que `sanitizeSvg` retirerait encore), sinon
 *   `credit_missing` (commentaire de crédit et de licence absent, ou qui ne reprend plus le manifeste) ;
 * - `not_in_manifest` : fichier qu'aucune entrée du manifeste ne cite.
 *
 * Sortie 0 si tout va bien ; 1 et une ligne par erreur (`<fichier> [<code>] <message>`) sinon ; 2 pour une option
 * inconnue.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ILLUSTRATION_FILE_RE,
  ILLUSTRATION_MEDIA_TYPE_BY_EXTENSION,
  type IllustrationEntry,
  IllustrationManifest,
} from '@rune/contracts';
import { ILLUSTRATION_FILES_DIR, MANIFEST_FILE } from '@rune/domain';
import { DEFAULT_DATA_DIR } from '../data/validate';
import { SvgError, svgComments, svgCreditComment, svgIssues } from './sanitize';

/** 40 Ko au plus par fichier (04 §12). */
export const ILLUSTRATION_MAX_BYTES = 40 * 1024;

const USAGE = 'Usage : pnpm svg:check [--dir <dossier data>]';

export type SvgCheckError = { file: string; code: string; message: string };

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) =>
  prefix.every((byte, i) => bytes[at + i] === byte);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/**
 * Type d'un fichier d'après ses octets : signature PNG, JPEG, WebP ou GIF ; un texte UTF-8 qui contient une
 * balise `<svg` est un SVG ; null sinon.
 */
export function sniffMediaType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const start = text.replace(/^\uFEFF/, '').trimStart();
  return start.startsWith('<') && /<svg[\s/>]/.test(start) ? 'image/svg+xml' : null;
}

/** Texte UTF-8 d'un SVG, sans BOM (le type a déjà été vérifié). */
const svgText = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');

/** Contrôle d'un fichier par son nom et ses octets ; `entry` : son entrée de manifeste, s'il en a une. */
export function checkIllustrationFile(
  name: string,
  bytes: Uint8Array,
  entry: IllustrationEntry | undefined,
): Omit<SvgCheckError, 'file'>[] {
  const match = ILLUSTRATION_FILE_RE.exec(name);
  if (match === null) {
    return [{ code: 'bad_name', message: 'Nom attendu : <id>.<empreinte 8 hex>.<svg|png|webp|jpg>.' }];
  }
  const errors: Omit<SvgCheckError, 'file'>[] = [];
  if (bytes.byteLength > ILLUSTRATION_MAX_BYTES) {
    errors.push({
      code: 'too_large',
      message: `${bytes.byteLength} octets : 40 Ko (${ILLUSTRATION_MAX_BYTES} octets) au plus.`,
    });
  }
  const extension = match[3] as keyof typeof ILLUSTRATION_MEDIA_TYPE_BY_EXTENSION;
  const sniffed = sniffMediaType(bytes);
  if (sniffed !== ILLUSTRATION_MEDIA_TYPE_BY_EXTENSION[extension]) {
    const what = sniffed === null ? "Octets d'un type inconnu" : `Octets d'un fichier ${sniffed}`;
    errors.push({ code: 'type_mismatch', message: `${what}, pour une extension .${extension}.` });
    return errors;
  }
  if (extension !== 'svg') return errors;

  const text = svgText(bytes);
  let issues: string[];
  try {
    issues = svgIssues(text);
  } catch (error) {
    if (!(error instanceof SvgError)) throw error;
    errors.push({ code: 'svg_invalid', message: `SVG illisible : ${error.message}.` });
    return errors;
  }
  if (issues.length > 0) {
    errors.push({ code: 'svg_unclean', message: `SVG non nettoyé : ${issues.join(' ; ')}.` });
  } else if (entry !== undefined && !svgComments(text).includes(svgCreditComment(entry))) {
    errors.push({
      code: 'credit_missing',
      message: 'Commentaire de crédit et de licence absent ou périmé : relance pnpm illustrations:import.',
    });
  }
  return errors;
}

const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Contrôle de tous les fichiers de `dataDir` ; erreurs triées par fichier (chemins relatifs à `dataDir`). */
export async function checkIllustrations(
  dataDir: string,
): Promise<{ errors: SvgCheckError[]; count: number }> {
  const errors: SvgCheckError[] = [];
  // Manifeste absent = aucune entrée ; illisible ou invalide : une erreur (le détail vient de data:validate).
  let manifest: unknown = [];
  try {
    manifest = JSON.parse(await readFile(join(dataDir, MANIFEST_FILE), 'utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (error instanceof SyntaxError) manifest = null;
  }
  const parsed = IllustrationManifest.safeParse(manifest);
  if (!parsed.success) {
    errors.push({
      file: MANIFEST_FILE,
      code: 'invalid_manifest',
      message: 'Manifeste invalide (pnpm data:validate).',
    });
  }
  const byFile = new Map((parsed.data ?? []).map((entry) => [entry.file, entry]));

  let names: string[] = [];
  try {
    names = (await readdir(join(dataDir, ILLUSTRATION_FILES_DIR), { withFileTypes: true }))
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort(binary);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  for (const name of names) {
    const file = `${ILLUSTRATION_FILES_DIR}/${name}`;
    const bytes = new Uint8Array(await readFile(join(dataDir, ILLUSTRATION_FILES_DIR, name)));
    const entry = byFile.get(name);
    for (const e of checkIllustrationFile(name, bytes, entry)) errors.push({ file, ...e });
    if (entry === undefined && ILLUSTRATION_FILE_RE.test(name)) {
      errors.push({
        file,
        code: 'not_in_manifest',
        message: `Aucune entrée de ${MANIFEST_FILE} ne cite ce fichier.`,
      });
    }
  }
  return { errors: errors.sort((a, b) => binary(a.file, b.file)), count: names.length };
}

/** Chemin affiché d'un fichier de `dataDir` : relatif au dossier courant, avec `/`. */
function display(dataDir: string, file: string): string {
  const base = relative(process.cwd(), dataDir).replaceAll('\\', '/');
  return base === '' ? file : `${base}/${file}`;
}

/** Point d'entrée : rend le code de sortie. */
export async function main(
  argv: readonly string[],
  out: Pick<Console, 'log' | 'error'> = console,
): Promise<number> {
  let dataDir = DEFAULT_DATA_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === '--dir' && value !== undefined) {
      dataDir = resolve(value);
      i += 1;
    } else {
      out.error(USAGE);
      return 2;
    }
  }
  const { errors, count } = await checkIllustrations(dataDir);
  for (const e of errors) out.error(`${display(dataDir, e.file)} [${e.code}] ${e.message}`);
  if (errors.length > 0) {
    out.error(`Illustrations invalides : ${errors.length} erreur(s).`);
    return 1;
  }
  out.log(`Illustrations valides : ${count} fichier(s).`);
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
