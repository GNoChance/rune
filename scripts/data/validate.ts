/**
 * `pnpm data:validate [--strict] [--dir <dossier>] [--base <ref>]` : valide le catalogue du dépôt (04 §10 et §13,
 * critère 1) et les modèles de programmes (05 §5).
 *
 * Lit `data/` (ou `--dir`) : les fiches `exercises/*.json` (texte brut et JSON, pour la forme canonique), le
 * manifeste `illustrations/manifest.json` et l'empreinte de chaque fichier de `illustrations/files/`, les modèles
 * `programs/*.json` et le glossaire `glossary.json`, puis appelle `validateCatalog` de `@rune/domain`, et
 * `validateTemplate` sur chaque modèle contre toutes les fiches (tous statuts : la règle 5 vérifie l'existence et
 * le type, pas la publication). Sortie 0 si tout est valide ; sinon 1 et une ligne par erreur
 * (`<fichier> [<code>] <message>`) ; 2 pour une option inconnue.
 *
 * Règle 8 de 05 §5 (`--base <ref>`, `main` par défaut) : un modèle qui existe dans `<ref>` et dont le contenu a
 * changé a une `version` plus haute. Le contenu se compare sur le JSON, pas sur la mise en forme. Une référence
 * donnée par `--base` doit exister (`base_not_found` sinon) ; si `main`, la référence par défaut, est introuvable
 * (copie sans historique), la règle n'est pas vérifiée et un avertissement le dit.
 *
 * Règle R-EQ-5 (chaque code de matériel utilisé par au moins une fiche non retirée) : elle n'est exigée qu'avec
 * `--strict`. Tant que le lot A n'est pas publié, le catalogue n'utilise pas encore tout le matériel ; la CI
 * passera à `pnpm data:validate --strict` une fois le lot A publié (plan de la brique 2, tâche 4).
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { DraftSheetSchema, IllustrationEntry } from '@rune/contracts';
import {
  type CatalogFile,
  type CatalogInput,
  type CatalogSheet,
  EXERCISES_DIR,
  ILLUSTRATION_FILES_DIR,
  MANIFEST_FILE,
  validateCatalog,
  validateTemplate,
} from '@rune/domain';

/** Dossier `data/` du dépôt, quel que soit le dossier courant. */
export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));
export const GLOSSARY_FILE = 'glossary.json';
export const PROGRAMS_DIR = 'programs';

/** Référence de la règle 8 par défaut : la branche principale. */
export const DEFAULT_BASE = 'main';

const USAGE = 'Usage : pnpm data:validate [--strict] [--dir <dossier data>] [--base <référence git>]';

/**
 * Erreur rendue par le script : celles de `validateCatalog` et de `validateTemplate`, plus les fichiers illisibles,
 * le glossaire, les identifiants de modèles en double et la règle 8 (`version_not_bumped`).
 */
export type DataError = { file: string; code: string; message: string };

export type DataValidation = {
  errors: DataError[];
  /** Ce qui n'a pas pu être vérifié (règle 8 sans référence) : n'empêche pas la sortie 0. */
  warnings: string[];
  counts: { sheets: number; illustrations: number; templates: number };
};

/** Modèle lu : chemin relatif à `data/` et contenu. */
export type TemplateFile = { file: string; json: unknown };

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

/**
 * Lit `dataDir` et rend l'entrée de `validateCatalog`, les modèles avec leur fichier, et les erreurs de lecture et
 * du glossaire.
 */
export async function readCatalogInput(
  dataDir: string,
): Promise<{ input: CatalogInput; templates: TemplateFile[]; errors: DataError[] }> {
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

  const templates: TemplateFile[] = [];
  for (const name of await listFiles(dataDir, PROGRAMS_DIR, isJson)) {
    const file = `${PROGRAMS_DIR}/${name}`;
    const read = await readJson(dataDir, file, errors);
    if (read !== undefined) templates.push({ file, json: read.json });
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

  return {
    input: { sheets, manifest, templates: templates.map((t) => t.json), illustrationFiles },
    templates,
    errors,
  };
}

/** Fiches lisibles par le validateur des modèles, tous statuts ; une fiche invalide (déjà signalée) est sautée. */
function catalogSheets(sheets: readonly CatalogFile[]): CatalogSheet[] {
  return sheets.flatMap(({ json }) => {
    const parsed = DraftSheetSchema.safeParse(json);
    if (!parsed.success) return [];
    const sheet = parsed.data;
    // Un squelette n'a pas encore ses muscles (champs IA) : il ne compte alors pour aucun groupe de volume.
    return [
      {
        ...sheet,
        primary_muscles: sheet.primary_muscles ?? [],
        secondary_muscles: sheet.secondary_muscles ?? [],
      },
    ];
  });
}

/** Règles 1 à 7 de 05 §5 sur chaque modèle, et identifiant de modèle unique entre les fichiers (règle 2). */
function checkTemplates(templates: readonly TemplateFile[], catalog: readonly CatalogSheet[]): DataError[] {
  const errors: DataError[] = [];
  const ids = new Map<string, string>();
  for (const { file, json } of templates) {
    for (const issue of validateTemplate(json, catalog)) {
      const message = issue.path === '' ? issue.message : `${issue.path} : ${issue.message}`;
      errors.push({ file, code: issue.code, message });
    }
    const id = isRecord(json) && typeof json.id === 'string' ? json.id : undefined;
    if (id === undefined) continue;
    const first = ids.get(id);
    if (first === undefined) ids.set(id, file);
    else errors.push({ file, code: 'duplicate_id', message: `L'id « ${id} » est déjà celui de ${first}.` });
  }
  return errors;
}

const execFileAsync = promisify(execFile);

/** Sortie de `git -C <dataDir> <args>`, ou null si la commande échoue (pas de dépôt, référence ou fichier absents). */
async function git(dataDir: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', dataDir, ...args], { encoding: 'utf8' });
    return stdout;
  } catch {
    return null;
  }
}

/** JSON aux clés triées, à toute profondeur : deux contenus égaux ont la même forme, quelle que soit la mise en page. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedKeys(value[key])]),
  );
}

const versionOf = (json: unknown): number | null =>
  isRecord(json) && typeof json.version === 'number' ? json.version : null;

/**
 * Règle 8 de 05 §5 : un modèle présent dans `base` dont le contenu diffère a une `version` plus haute.
 * - `required` (référence donnée explicitement) : la référence doit exister, même sans modèle, sinon
 *   `base_not_found` ;
 * - sinon (référence par défaut) : rien à vérifier sans modèle, et une référence introuvable donne un avertissement.
 */
export async function checkVersionBumps(
  dataDir: string,
  base: string,
  templates: readonly TemplateFile[],
  required = false,
): Promise<{ errors: DataError[]; warnings: string[] }> {
  if (!required && templates.length === 0) return { errors: [], warnings: [] };
  if ((await git(dataDir, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`])) === null) {
    if (required) {
      const message = `Référence git « ${base} » introuvable : la règle 8 (05 §5) ne peut pas être vérifiée.`;
      return { errors: [{ file: PROGRAMS_DIR, code: 'base_not_found', message }], warnings: [] };
    }
    return {
      errors: [],
      warnings: [`règle 8 non vérifiée (05 §5) : référence git « ${base} » introuvable.`],
    };
  }
  const errors: DataError[] = [];
  for (const { file, json } of templates) {
    const text = await git(dataDir, ['show', `${base}:./${file}`]);
    if (text === null) continue; // Modèle nouveau : rien à comparer.
    let before: unknown;
    try {
      before = JSON.parse(text);
    } catch {
      continue;
    }
    if (JSON.stringify(sortedKeys(before)) === JSON.stringify(sortedKeys(json))) continue;
    const was = versionOf(before);
    const now = versionOf(json);
    if (was === null || now === null || now > was) continue;
    errors.push({
      file,
      code: 'version_not_bumped',
      message: `Contenu changé depuis ${base} sans hausse de version (${was} dans ${base}, ${now} ici) : 05 §5, règle 8.`,
    });
  }
  return { errors, warnings: [] };
}

/**
 * Valide le dossier `dataDir` ; erreurs triées par fichier, chemins relatifs à `dataDir`. La règle 8 n'est vérifiée
 * qu'avec `base` ; `requireBase` : la référence a été donnée explicitement et doit exister.
 */
export async function validateDataDir(
  dataDir: string,
  options: { strict?: boolean; base?: string; requireBase?: boolean } = {},
): Promise<DataValidation> {
  const { input, templates, errors } = await readCatalogInput(dataDir);
  const result = validateCatalog(input, options);
  const versions =
    options.base === undefined
      ? { errors: [], warnings: [] }
      : await checkVersionBumps(dataDir, options.base, templates, options.requireBase ?? false);
  const all: DataError[] = [
    ...errors,
    ...result.errors,
    ...checkTemplates(templates, catalogSheets(input.sheets)),
    ...versions.errors,
  ].sort((a, b) => binary(a.file, b.file));
  return {
    errors: all,
    warnings: versions.warnings,
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
  let base = DEFAULT_BASE;
  let requireBase = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--strict') {
      strict = true;
    } else if (arg === '--dir' && value !== undefined) {
      dataDir = resolve(value);
      i += 1;
    } else if (arg === '--base' && value !== undefined) {
      base = value;
      requireBase = true;
      i += 1;
    } else {
      out.error(USAGE);
      return 2;
    }
  }
  const { errors, warnings, counts } = await validateDataDir(dataDir, { strict, base, requireBase });
  for (const warning of warnings) out.error(`Avertissement : ${warning}`);
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
