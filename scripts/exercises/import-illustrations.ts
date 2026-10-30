/**
 * `pnpm illustrations:import --source <copie figée> --ids <id>[,<id>…] [--dir <dossier data>]` : importe des
 * illustrations depuis une copie locale figée d'une source (04 §12, « Import et service »). Aucun téléchargement.
 *
 * La copie figée porte à sa racine un descripteur `rune-import.json`, écrit une fois en la figeant :
 *
 * ```json
 * {
 *   "source": "everkinetic",                          // ILLUSTRATION_SOURCES
 *   "repository": "https://github.com/everkinetic/data",
 *   "commit": "<40 caractères hexadécimaux>",          // commit de la copie (règle 1 : URL figée à un commit)
 *   "license": "CC-BY-SA-4.0", "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
 *   "creators": ["Greg Priday"],                      // créateurs par défaut
 *   "provenance_documented": true,                    // false : replace_before_public (règle 3)
 *   "files": {
 *     "<id d'illustration>": {
 *       "path": "svg/squat-1.svg",                    // chemin dans la copie
 *       "creators": ["…"],                            // facultatif, remplace le défaut (dessin repris : deux attributions)
 *       "provenance_documented": true,                // facultatif, remplace le défaut
 *       "modifications": "Redessiné par … d'après …"  // facultatif : ce que la source a déjà changé
 *     }
 *   }
 * }
 * ```
 *
 * Pour chaque id demandé (règle 5 : seuls les fichiers utilisés sont copiés) : type vérifié par les octets ; un
 * SVG est nettoyé par `sanitizeSvg` et reçoit son commentaire de crédit et de licence, un fichier matriciel est
 * copié tel quel ; 40 Ko au plus ; fichier écrit sous `illustrations/files/<id>.<hash8>.<ext>` ; entrée du
 * manifeste ajoutée ou remplacée (manifeste trié par id), ancien fichier de cet id retiré. L'URL source est
 * `<repository>/blob/<commit>/<path>`.
 *
 * Tout ou rien : à la moindre erreur, rien n'est écrit. Sortie 0, 1 (refus) ou 2 (usage).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ILLUSTRATION_LICENSES,
  ILLUSTRATION_MEDIA_TYPE_BY_EXTENSION,
  ILLUSTRATION_SOURCES,
  IllustrationEntry,
  type IllustrationLicense,
  IllustrationManifest,
  type IllustrationSource,
} from '@rune/contracts';
import { ILLUSTRATION_FILES_DIR, MANIFEST_FILE } from '@rune/domain';
import { DEFAULT_DATA_DIR } from '../data/validate';
import { ILLUSTRATION_MAX_BYTES, sniffMediaType } from '../svg/check';
import { SvgError, sanitizeSvg, svgCreditComment } from '../svg/sanitize';

/** Descripteur de la copie figée, à sa racine. */
export const SOURCE_DESCRIPTOR = 'rune-import.json';

/** Nos modifications d'un SVG importé (page Crédits : « nettoyage, optimisation, renommage », 04 §12). */
export const SVG_MODIFICATIONS =
  'Rune : nettoyage et optimisation du SVG (éléments et attributs sûrs seulement, blancs retirés), commentaire de crédit et de licence, renommage du fichier.';

const USAGE =
  'Usage : pnpm illustrations:import --source <copie figée> --ids <id>[,<id>…] [--dir <dossier data>]';

/** Fichier décrit par le descripteur. */
type SourceFile = {
  path: string;
  creators?: string[];
  provenance_documented?: boolean;
  modifications?: string;
};

type SourceDescriptor = {
  source: IllustrationSource;
  repository: string;
  commit: string;
  license: IllustrationLicense;
  license_url: string;
  creators: string[];
  provenance_documented: boolean;
  files: Record<string, SourceFile>;
};

/** Id d'illustration : la partie `<id>` de `ILLUSTRATION_FILE_RE`. */
const ILLUSTRATION_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const DESCRIPTOR_KEYS = [
  'source',
  'repository',
  'commit',
  'license',
  'license_url',
  'creators',
  'provenance_documented',
  'files',
];
const FILE_KEYS = ['path', 'creators', 'provenance_documented', 'modifications'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max;
const isHttps = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};
const isCreators = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length >= 1 && value.length <= 10 && value.every((c) => isText(c, 200));
const includes = <T extends string>(list: readonly T[], value: unknown): value is T =>
  list.includes(value as T);

/** Descripteur vérifié, ou la liste de ce qui ne va pas (une ligne par champ). */
function checkDescriptor(json: unknown): SourceDescriptor | string[] {
  if (!isRecord(json)) return [`${SOURCE_DESCRIPTOR} : un objet JSON est attendu.`];
  const problems: string[] = [];
  const bad = (key: string, expected: string) => problems.push(`${SOURCE_DESCRIPTOR}, ${key} : ${expected}.`);
  for (const key of Object.keys(json)) if (!DESCRIPTOR_KEYS.includes(key)) bad(key, 'clé inconnue');
  if (!includes(ILLUSTRATION_SOURCES, json.source))
    bad('source', `une de ${ILLUSTRATION_SOURCES.join(', ')}`);
  if (!isHttps(json.repository)) bad('repository', 'adresse https attendue');
  if (typeof json.commit !== 'string' || !/^[0-9a-f]{40}$/.test(json.commit))
    bad('commit', 'commit complet de 40 caractères hexadécimaux attendu (règle 1 : source figée)');
  if (!includes(ILLUSTRATION_LICENSES, json.license))
    bad('license', `une de ${ILLUSTRATION_LICENSES.join(', ')}`);
  if (!isHttps(json.license_url)) bad('license_url', 'adresse https attendue');
  if (!isCreators(json.creators)) bad('creators', '1 à 10 noms attendus');
  if (typeof json.provenance_documented !== 'boolean') bad('provenance_documented', 'booléen attendu');
  if (!isRecord(json.files)) bad('files', 'objet { id: fichier } attendu');
  else {
    for (const [id, file] of Object.entries(json.files)) {
      const at = `files.${id}`;
      if (!ILLUSTRATION_ID_RE.test(id)) bad(at, 'id en minuscules, chiffres et tirets attendu');
      if (!isRecord(file)) {
        bad(at, 'objet attendu');
        continue;
      }
      for (const key of Object.keys(file)) if (!FILE_KEYS.includes(key)) bad(`${at}.${key}`, 'clé inconnue');
      if (!isText(file.path, 500)) bad(`${at}.path`, 'chemin attendu');
      if (file.creators !== undefined && !isCreators(file.creators))
        bad(`${at}.creators`, '1 à 10 noms attendus');
      if (file.provenance_documented !== undefined && typeof file.provenance_documented !== 'boolean')
        bad(`${at}.provenance_documented`, 'booléen attendu');
      if (file.modifications !== undefined && !isText(file.modifications, 500))
        bad(`${at}.modifications`, 'texte de 500 caractères au plus attendu');
    }
  }
  return problems.length > 0 ? problems : (json as SourceDescriptor);
}

/** Extension servie de chaque extension de fichier source. */
const EXTENSIONS: Readonly<Record<string, keyof typeof ILLUSTRATION_MEDIA_TYPE_BY_EXTENSION>> = {
  '.svg': 'svg',
  '.png': 'png',
  '.webp': 'webp',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
};

export type ImportOptions = { sourceDir: string; ids: readonly string[]; dataDir: string };
export type ImportResult = { imported: IllustrationEntry[]; errors: string[] };

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

async function readDescriptor(sourceDir: string): Promise<SourceDescriptor | string[]> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(join(sourceDir, SOURCE_DESCRIPTOR), 'utf8'));
  } catch (error) {
    if (isMissing(error)) return [`${SOURCE_DESCRIPTOR} absent : la copie figée doit le porter à sa racine.`];
    if (error instanceof SyntaxError) return [`${SOURCE_DESCRIPTOR} illisible : ${error.message}`];
    throw error;
  }
  return checkDescriptor(json);
}

/** Fichier prêt à écrire : son entrée de manifeste et ses octets. */
type Prepared = { entry: IllustrationEntry; bytes: Uint8Array };

/** Lit, vérifie et prépare un id ; rend un message d'erreur sinon. */
async function prepare(
  id: string,
  descriptor: SourceDescriptor,
  sourceDir: string,
): Promise<Prepared | string> {
  const file = Object.hasOwn(descriptor.files, id) ? descriptor.files[id] : undefined;
  if (file === undefined) return `${id} : absent de ${SOURCE_DESCRIPTOR}.`;
  const root = resolve(sourceDir);
  const full = resolve(root, file.path);
  if (!full.startsWith(root + sep)) return `${id} : chemin hors de la source (${file.path}).`;
  const extension = EXTENSIONS[extname(full).toLowerCase()];
  if (extension === undefined) return `${id} : extension non admise (${file.path}).`;
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(await readFile(full));
  } catch (error) {
    if (isMissing(error)) return `${id} : fichier absent (${file.path}).`;
    throw error;
  }
  const expected = ILLUSTRATION_MEDIA_TYPE_BY_EXTENSION[extension];
  const sniffed = sniffMediaType(raw);
  if (sniffed !== expected) {
    const what = sniffed === null ? "octets d'un type inconnu" : `octets d'un fichier ${sniffed}`;
    return `${id} : ${what}, pour une extension .${extension}.`;
  }

  const ours = extension === 'svg' ? SVG_MODIFICATIONS : undefined;
  const modifications = [file.modifications, ours].filter((m) => m !== undefined).join(' ');
  const credit = {
    source_url: `${descriptor.repository.replace(/\/+$/, '')}/blob/${descriptor.commit}/${relative(root, full).replaceAll('\\', '/')}`,
    creators: file.creators ?? descriptor.creators,
    license: descriptor.license,
    license_url: descriptor.license_url,
    ...(modifications === '' ? {} : { modifications }),
  };

  let bytes = raw;
  if (extension === 'svg') {
    try {
      const text = new TextDecoder('utf-8').decode(raw).replace(/^\uFEFF/, '');
      bytes = new Uint8Array(Buffer.from(sanitizeSvg(text, svgCreditComment(credit)), 'utf8'));
    } catch (error) {
      if (error instanceof SvgError) return `${id} : SVG illisible (${error.message}).`;
      throw error;
    }
  }
  if (bytes.byteLength > ILLUSTRATION_MAX_BYTES) {
    const after = extension === 'svg' ? ' une fois nettoyé' : '';
    return `${id} : ${bytes.byteLength} octets${after}, 40 Ko au plus.`;
  }

  const hash = sha256(bytes);
  // Clés dans l'ordre des colonnes de la table `illustration` (forme d'`IllustrationEntry`).
  const entry: IllustrationEntry = {
    id,
    file: `${id}.${hash.slice(0, 8)}.${extension}`,
    sha256: hash,
    bytes: bytes.byteLength,
    media_type: expected,
    source: descriptor.source,
    source_url: credit.source_url,
    creators: credit.creators,
    license: credit.license,
    license_url: credit.license_url,
    ...(credit.modifications === undefined ? {} : { modifications: credit.modifications }),
    replace_before_public: !(file.provenance_documented ?? descriptor.provenance_documented),
  };
  // Dernier garde-fou : l'entrée écrite est celle que data:validate et le chargeur acceptent.
  const checked = IllustrationEntry.safeParse(entry);
  if (!checked.success)
    return `${id} : entrée de manifeste refusée (${checked.error.issues[0]?.message ?? ''}).`;
  return { entry, bytes };
}

/** Manifeste actuel de `dataDir` ; absent = vide. */
async function readManifest(dataDir: string): Promise<IllustrationEntry[] | string> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(join(dataDir, MANIFEST_FILE), 'utf8'));
  } catch (error) {
    if (isMissing(error)) return [];
    if (error instanceof SyntaxError) return `${MANIFEST_FILE} illisible : ${error.message}`;
    throw error;
  }
  const parsed = IllustrationManifest.safeParse(json);
  return parsed.success ? parsed.data : `${MANIFEST_FILE} invalide : lance pnpm data:validate.`;
}

/** Importe `ids` depuis `sourceDir` dans `dataDir` ; tout ou rien. */
export async function importIllustrations(options: ImportOptions): Promise<ImportResult> {
  const refused = (errors: string[]): ImportResult => ({ imported: [], errors });
  const descriptor = await readDescriptor(options.sourceDir);
  if (Array.isArray(descriptor)) return refused(descriptor);
  const manifest = await readManifest(options.dataDir);
  if (typeof manifest === 'string') return refused([manifest]);

  const prepared: Prepared[] = [];
  const errors: string[] = [];
  for (const id of [...new Set(options.ids)]) {
    const result = await prepare(id, descriptor, options.sourceDir);
    if (typeof result === 'string') errors.push(result);
    else prepared.push(result);
  }
  if (errors.length > 0) return refused(errors);

  const filesDir = join(options.dataDir, ILLUSTRATION_FILES_DIR);
  await mkdir(filesDir, { recursive: true });
  const byId = new Map(manifest.map((entry) => [entry.id, entry]));
  const replaced: string[] = [];
  for (const { entry, bytes } of prepared) {
    const previous = byId.get(entry.id);
    if (previous !== undefined && previous.file !== entry.file) replaced.push(previous.file);
    await writeFile(join(filesDir, entry.file), bytes);
    byId.set(entry.id, entry);
  }
  const next = [...byId.values()].sort((a, b) => binary(a.id, b.id));
  await writeFile(join(options.dataDir, MANIFEST_FILE), `${JSON.stringify(next, null, 2)}\n`);
  const kept = new Set(next.map((entry) => entry.file));
  for (const file of replaced) if (!kept.has(file)) await rm(join(filesDir, file), { force: true });
  return { imported: prepared.map((p) => p.entry), errors: [] };
}

type Args = { sourceDir: string; ids: string[]; dataDir: string };

function parseArgs(argv: readonly string[]): Args | null {
  let sourceDir: string | undefined;
  let dataDir = DEFAULT_DATA_DIR;
  const ids: string[] = [];
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) return null;
    if (flag === '--source') sourceDir = resolve(value);
    else if (flag === '--dir') dataDir = resolve(value);
    else if (flag === '--ids')
      ids.push(
        ...value
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id !== ''),
      );
    else return null;
  }
  return sourceDir === undefined || ids.length === 0 ? null : { sourceDir, ids, dataDir };
}

/** Point d'entrée : rend le code de sortie. */
export async function main(
  argv: readonly string[],
  out: Pick<Console, 'log' | 'error'> = console,
): Promise<number> {
  const args = parseArgs(argv);
  if (args === null) {
    out.error(USAGE);
    return 2;
  }
  const { imported, errors } = await importIllustrations(args);
  if (errors.length > 0) {
    for (const message of errors) out.error(message);
    out.error("Import refusé : rien n'a été écrit.");
    return 1;
  }
  for (const entry of imported) out.log(`${entry.file} importé (${entry.source}).`);
  out.log(`${imported.length} illustration(s) importée(s).`);
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
