/**
 * `pnpm data:validate [--strict] [--dir <dossier>]` : valide le catalogue du dépôt (04 §10 et §13, critère 1).
 *
 * Lit `data/` (ou `--dir`) : les fiches `exercises/*.json` (texte brut et JSON, pour la forme canonique), le
 * manifeste `illustrations/manifest.json` et l'empreinte de chaque fichier de `illustrations/files/`, les modèles
 * `programs/*.json` et le glossaire `glossary.json`, puis appelle `validateCatalog` de `@rune/domain`.
 * Sortie 0 si tout est valide ; sinon 1 et une ligne par erreur (`<fichier> [<code>] <message>`) ; 2 pour une
 * option inconnue.
 *
 * Règle R-EQ-5 (chaque code de matériel utilisé par au moins une fiche non retirée) : elle n'est exigée qu'avec
 * `--strict`. Tant que le lot A n'est pas publié, le catalogue n'utilise pas encore tout le matériel ; la CI
 * passera à `pnpm data:validate --strict` une fois le lot A publié (plan de la brique 2, tâche 4).
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IllustrationEntry } from '@rune/contracts';
import {
  type CatalogFile,
  type CatalogInput,
  EXERCISES_DIR,
  ILLUSTRATION_FILES_DIR,
  MANIFEST_FILE,
  validateCatalog,
} from '@rune/domain';

/** Dossier `data/` du dépôt, quel que soit le dossier courant. */
export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));
export const GLOSSARY_FILE = 'glossary.json';
export const PROGRAMS_DIR = 'programs';

const USAGE = 'Usage : pnpm data:validate [--strict] [--dir <dossier data>]';

/** Erreur rendue par le script : celles de `validateCatalog`, plus les fichiers illisibles et le glossaire. */
export type DataError = { file: string; code: string; message: string };

export type DataValidation = {
  errors: DataError[];
  counts: { sheets: number; illustrations: number; templates: number };
};

const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

/** Noms des fichiers d'un dossier relatif à `dataDir`, en ordre binaire ; dossier absent = aucun fichier. */
async function listFiles(dataDir: string, dir: string, keep: (name: string) => boolean): Promise<string[]> {
  try {
    const entries = await readdir(join(dataDir, dir), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && keep(e.name))
      .map((e) => e.name)
      .sort(binary);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

const isJson = (name: string) => name.endsWith('.json');

/** Texte et JSON d'un fichier relatif à `dataDir` ; `undefined` s'il est absent, une erreur s'il est illisible. */
async function readJson(
  dataDir: string,
  file: string,
  errors: DataError[],
): Promise<{ text: string; json: unknown } | undefined> {
  let text: string;
  try {
    text = await readFile(join(dataDir, file), 'utf8');
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  try {
    return { text, json: JSON.parse(text) };
  } catch (error) {
    errors.push({ file, code: 'invalid_json', message: `JSON illisible : ${(error as Error).message}` });
    return undefined;
  }
}

/** Entrées valides du manifeste ; chaque entrée refusée par `IllustrationEntry` donne une erreur `invalid_manifest`. */
function readManifest(json: unknown, errors: DataError[]): IllustrationEntry[] {
  if (!Array.isArray(json)) {
    errors.push({
      file: MANIFEST_FILE,
      code: 'invalid_manifest',
      message: 'Le manifeste est un tableau JSON.',
    });
    return [];
  }
  const entries: IllustrationEntry[] = [];
  json.forEach((item: unknown, index) => {
    const parsed = IllustrationEntry.safeParse(item);
    if (parsed.success) {
      entries.push(parsed.data);
      return;
    }
    const id = isRecord(item) && typeof item.id === 'string' ? ` (${item.id})` : '';
    for (const issue of parsed.error.issues) {
      const where = issue.path.map(String).join('.') || '(entrée)';
      errors.push({
        file: MANIFEST_FILE,
        code: 'invalid_manifest',
        message: `Entrée ${index}${id}, ${where} : ${issue.message}`,
      });
    }
  });
  return entries;
}

const GLOSSARY_KEYS = new Set(['preferred', 'abbreviation', 'refused', 'english', 'note']);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * Glossaire (04 §8, étape 0) : tableau d'entrées `{preferred, abbreviation?, refused, english, note?}`. Termes
 * préférés uniques ; aucune variante refusée n'est un terme préféré (à la casse près).
 */
export function checkGlossary(json: unknown): DataError[] {
  const errors: DataError[] = [];
  const fail = (message: string) => errors.push({ file: GLOSSARY_FILE, code: 'invalid_glossary', message });
  if (!Array.isArray(json)) {
    fail('Le glossaire est un tableau JSON.');
    return errors;
  }
  const lower = (text: string) => text.toLocaleLowerCase('fr');
  const preferred = new Set<string>();
  for (const [index, entry] of json.entries()) {
    if (!isRecord(entry)) {
      fail(`Entrée ${index} : un objet est attendu.`);
      continue;
    }
    const unknown = Object.keys(entry).filter((key) => !GLOSSARY_KEYS.has(key));
    if (unknown.length > 0) fail(`Entrée ${index} : clé(s) inconnue(s) ${unknown.join(', ')}.`);
    const { preferred: term, abbreviation, refused, english, note } = entry;
    if (!nonEmpty(term)) {
      fail(`Entrée ${index} : preferred est un texte non vide.`);
      continue;
    }
    if (preferred.has(lower(term))) fail(`« ${term} » figure deux fois.`);
    preferred.add(lower(term));
    if (!nonEmpty(english)) fail(`« ${term} » : english est un texte non vide.`);
    if (!Array.isArray(refused) || !refused.every(nonEmpty))
      fail(`« ${term} » : refused est une liste de textes.`);
    if (abbreviation !== undefined && !nonEmpty(abbreviation))
      fail(`« ${term} » : abbreviation est un texte.`);
    if (note !== undefined && !nonEmpty(note)) fail(`« ${term} » : note est un texte.`);
  }
  for (const entry of json) {
    if (!isRecord(entry) || !Array.isArray(entry.refused)) continue;
    for (const variant of entry.refused) {
      if (nonEmpty(variant) && preferred.has(lower(variant))) {
        fail(`La variante refusée « ${variant} » est aussi un terme préféré.`);
      }
    }
  }
  return errors;
}

/** Lit `dataDir` et rend l'entrée de `validateCatalog`, avec les erreurs de lecture et du glossaire. */
export async function readCatalogInput(
  dataDir: string,
): Promise<{ input: CatalogInput; errors: DataError[] }> {
  const errors: DataError[] = [];

  const sheets: CatalogFile[] = [];
  for (const name of await listFiles(dataDir, EXERCISES_DIR, isJson)) {
    const file = `${EXERCISES_DIR}/${name}`;
    const read = await readJson(dataDir, file, errors);
    if (read !== undefined) sheets.push({ file, json: read.json, text: read.text });
  }

  const manifestJson = await readJson(dataDir, MANIFEST_FILE, errors);
  const manifest = manifestJson === undefined ? [] : readManifest(manifestJson.json, errors);

  const illustrationFiles = new Map<string, string>();
  for (const name of await listFiles(dataDir, ILLUSTRATION_FILES_DIR, (n) => !n.startsWith('.'))) {
    const bytes = await readFile(join(dataDir, ILLUSTRATION_FILES_DIR, name));
    illustrationFiles.set(name, createHash('sha256').update(bytes).digest('hex'));
  }

  const templates: unknown[] = [];
  for (const name of await listFiles(dataDir, PROGRAMS_DIR, isJson)) {
    const read = await readJson(dataDir, `${PROGRAMS_DIR}/${name}`, errors);
    if (read !== undefined) templates.push(read.json);
  }

  const glossary = await readJson(dataDir, GLOSSARY_FILE, errors);
  if (glossary === undefined && !errors.some((e) => e.file === GLOSSARY_FILE)) {
    errors.push({
      file: GLOSSARY_FILE,
      code: 'invalid_glossary',
      message: 'Glossaire absent (04 §8, étape 0).',
    });
  } else if (glossary !== undefined) {
    errors.push(...checkGlossary(glossary.json));
  }

  return { input: { sheets, manifest, templates, illustrationFiles }, errors };
}

/** Valide le dossier `dataDir` ; erreurs triées par fichier, chemins relatifs à `dataDir`. */
export async function validateDataDir(
  dataDir: string,
  options: { strict?: boolean } = {},
): Promise<DataValidation> {
  const { input, errors } = await readCatalogInput(dataDir);
  const result = validateCatalog(input, options);
  const all: DataError[] = [...errors, ...result.errors].sort((a, b) => binary(a.file, b.file));
  return {
    errors: all,
    counts: {
      sheets: input.sheets.length,
      illustrations: input.manifest.length,
      templates: input.templates.length,
    },
  };
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
  let strict = false;
  let dataDir = DEFAULT_DATA_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--strict') {
      strict = true;
    } else if (arg === '--dir' && value !== undefined) {
      dataDir = resolve(value);
      i += 1;
    } else {
      out.error(USAGE);
      return 2;
    }
  }
  const { errors, counts } = await validateDataDir(dataDir, { strict });
  for (const e of errors) out.error(`${display(dataDir, e.file)} [${e.code}] ${e.message}`);
  if (errors.length > 0) {
    out.error(`Catalogue invalide : ${errors.length} erreur(s).`);
    return 1;
  }
  out.log(
    `Catalogue valide${strict ? ' (strict)' : ''} : ${counts.sheets} fiche(s), ${counts.illustrations} ` +
      `illustration(s), ${counts.templates} modèle(s).`,
  );
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
