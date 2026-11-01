import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type DraftSheet,
  DraftSheetSchema,
  type ExerciseStatus,
  IllustrationEntry,
  type ProgramTemplate,
  ProgramTemplateSchema,
} from '@rune/contracts';
import {
  type CatalogFile,
  EXERCISES_DIR,
  ILLUSTRATION_FILES_DIR,
  MANIFEST_FILE,
  validateCatalog,
} from '@rune/domain';
import type { Transaction } from 'kysely';
import type { Database } from '../db/schema';
import type { AppDeps } from '../deps';
import type { Logger } from '../logger';
import type { StartupTask } from '../startup';
import { rebuildCatalog } from './bundle';
import { insertSheet, upsertIllustration } from './repo';

/*
 * Chargeur du catalogue (04 §10 et spec brique 2 §3.6), au démarrage après les migrations. Il lit `data/`, le valide
 * comme la CI (`validateCatalog`, forme canonique comprise), puis, dans une seule transaction, verse les fiches et
 * le manifeste en base et reconstruit le bloc servi. Tout ou rien, et idempotent : la base fait foi pour les fiches,
 * le dépôt pour les illustrations et les modèles de programmes.
 */

/** Modèles de programmes, relatifs à `data/` (05). */
export const PROGRAMS_DIR = 'programs';

/** Erreur d'un fichier de `data/`, chemin relatif à `data/` : celles du validateur, de lecture et du manifeste. */
export type CatalogLoadIssue = { file: string; code: string; message: string };

/**
 * Contenu valide de `data/` : fiches (forme de fichier), manifeste et modèles qui passent `ProgramTemplateSchema`,
 * triés par nom de fichier.
 */
export type CatalogFiles = {
  sheets: DraftSheet[];
  manifest: IllustrationEntry[];
  templates: ProgramTemplate[];
};

/**
 * Lecture de `data/`. En échec, `templates` rend les modèles valides : ils restent servis avec le catalogue déjà
 * en base, qui ne contient pas de modèles. `invalidTemplates` : fichiers de modèles qui ne passent pas
 * `ProgramTemplateSchema` (chemins relatifs à `data/`) ; ils ne sont pas servis, sans refuser le reste.
 */
export type CatalogFilesResult =
  | { ok: true; files: CatalogFiles; invalidTemplates: string[] }
  | { ok: false; errors: CatalogLoadIssue[]; templates: ProgramTemplate[]; invalidTemplates: string[] };

/** Refus du chargement en cours d'écriture : la transaction est annulée, rien n'est écrit. */
export class CatalogLoadError extends Error {
  readonly errors: readonly CatalogLoadIssue[];

  constructor(errors: readonly CatalogLoadIssue[]) {
    super(`catalogue refusé : ${errors.length} erreur(s)`);
    this.name = 'CatalogLoadError';
    this.errors = errors;
  }
}

const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isJson = (name: string) => name.endsWith('.json');
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

/** Noms des fichiers d'un dossier, en ordre binaire ; dossier absent = aucun fichier. */
async function listFiles(dir: string, keep: (name: string) => boolean): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && keep(e.name))
      .map((e) => e.name)
      .sort(binary);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** Entrées valides du manifeste ; chaque entrée refusée par `IllustrationEntry` donne une erreur. */
function parseManifest(json: unknown, errors: CatalogLoadIssue[]): IllustrationEntry[] {
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
    for (const issue of parsed.error.issues) {
      const where = issue.path.map(String).join('.') || '(entrée)';
      errors.push({
        file: MANIFEST_FILE,
        code: 'invalid_manifest',
        message: `Entrée ${index}, ${where} : ${issue.message}`,
      });
    }
  });
  return entries;
}

/**
 * Lit et valide `data/` (`deps.config.contentDir`) : fiches `exercises/*.json` (texte brut compris, pour la forme
 * canonique), manifeste, empreinte des fichiers d'illustrations, modèles `programs/*.json`. Un fichier absent vaut
 * un dossier vide. Ne lève que pour une erreur du système de fichiers.
 */
export async function loadCatalogFiles(deps: Pick<AppDeps, 'config'>): Promise<CatalogFilesResult> {
  const dir = deps.config.contentDir;
  const errors: CatalogLoadIssue[] = [];
  const read = async (file: string): Promise<{ text: string; json: unknown } | undefined> => {
    let text: string;
    try {
      text = await readFile(join(dir, file), 'utf8');
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
  };

  const sheets: CatalogFile[] = [];
  for (const name of await listFiles(join(dir, EXERCISES_DIR), isJson)) {
    const file = `${EXERCISES_DIR}/${name}`;
    const content = await read(file);
    if (content !== undefined) sheets.push({ file, json: content.json, text: content.text });
  }

  const manifestFile = await read(MANIFEST_FILE);
  const manifest = manifestFile === undefined ? [] : parseManifest(manifestFile.json, errors);

  const illustrationFiles = new Map<string, string>();
  for (const name of await listFiles(join(dir, ILLUSTRATION_FILES_DIR), (n) => !n.startsWith('.'))) {
    const bytes = await readFile(join(dir, ILLUSTRATION_FILES_DIR, name));
    illustrationFiles.set(name, createHash('sha256').update(bytes).digest('hex'));
  }

  // Modèles : tous lus pour la règle `retired_in_template` ; seuls ceux qui passent le schéma sont servis.
  const rawTemplates: unknown[] = [];
  const templates: ProgramTemplate[] = [];
  const invalidTemplates: string[] = [];
  for (const name of await listFiles(join(dir, PROGRAMS_DIR), isJson)) {
    const file = `${PROGRAMS_DIR}/${name}`;
    const content = await read(file);
    if (content === undefined) continue;
    rawTemplates.push(content.json);
    const template = ProgramTemplateSchema.safeParse(content.json);
    if (template.success) templates.push(template.data);
    else invalidTemplates.push(file);
  }

  errors.push(...validateCatalog({ sheets, manifest, templates: rawTemplates, illustrationFiles }).errors);
  const parsed: DraftSheet[] = [];
  for (const { file, json } of sheets) {
    const result = DraftSheetSchema.safeParse(json);
    if (result.success) parsed.push(result.data);
    else if (!errors.some((e) => e.file === file)) {
      errors.push({ file, code: 'invalid_sheet', message: 'La fiche ne passe pas DraftSheetSchema.' });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors: errors.sort((a, b) => binary(a.file, b.file)), templates, invalidTemplates };
  }
  return { ok: true, files: { sheets: parsed, manifest, templates }, invalidTemplates };
}

/** Bilan d'un versement en base, journalisé après le commit. */
export type CatalogMergeReport = {
  /** Base sans aucune fiche : amorçage, chaque fiche entre avec son statut. */
  seeded: boolean;
  inserted: string[];
  /** Fiches déjà en base : la base fait foi. */
  ignored: string[];
  /** Nouvelles fiches non `draft` sur une base non vide (spec brique 2 §3.6). */
  refused: { id: string; status: ExerciseStatus }[];
  /** Fiches insérées avec `reviewed_by` NULL : le compte cité n'existe pas dans cette base. */
  unknownReviewers: number;
  /** Entrées du manifeste insérées ou mises à jour. */
  illustrations: number;
};

const POINTERS = ['easier_id', 'harder_id'] as const;

/**
 * Verse les fichiers valides en base (04 §10, spec brique 2 §3.6), dans la transaction `trx` :
 * - fiche déjà en base : ignorée, la base fait foi ;
 * - fiche absente : insérée si elle est `draft` ; sur une base vide (amorçage), toute fiche entre avec son statut ;
 *   une fiche non `draft` sur une base non vide est refusée (journalisée par l'appelant) ;
 * - une fiche insérée a sa ligne `exercise_revision` (`saved_by` NULL, `saved_at` = `now`) et
 *   `exported_revision` = `revision` (elle est déjà dans le dépôt) ; `reviewed_by` devient NULL si le compte n'est
 *   pas dans cette base (clé vers `user`) ;
 * - entrée du manifeste : insérée ou mise à jour, le dépôt fait foi.
 *
 * Lève `CatalogLoadError` (rien n'est écrit) si une fiche insérée pointe (`easier_id`, `harder_id`) vers une fiche
 * qui n'est ni en base ni insérée, une fiche refusée par exemple.
 */
export async function seedOrMergeCatalog(
  trx: Transaction<Database>,
  files: CatalogFiles,
  now: string,
): Promise<CatalogMergeReport> {
  const existing = new Set((await trx.selectFrom('exercise').select('id').execute()).map((r) => r.id));
  const seeded = existing.size === 0;
  const report: CatalogMergeReport = {
    seeded,
    inserted: [],
    ignored: [],
    refused: [],
    unknownReviewers: 0,
    illustrations: 0,
  };
  const toInsert: DraftSheet[] = [];
  for (const sheet of [...files.sheets].sort((a, b) => binary(a.id, b.id))) {
    if (existing.has(sheet.id)) report.ignored.push(sheet.id);
    else if (!seeded && sheet.status !== 'draft') report.refused.push({ id: sheet.id, status: sheet.status });
    else toInsert.push(sheet);
  }

  const present = new Set([...existing, ...toInsert.map((s) => s.id)]);
  const refused = new Map(report.refused.map((r) => [r.id, r.status]));
  const broken: CatalogLoadIssue[] = [];
  for (const sheet of toInsert) {
    for (const key of POINTERS) {
      const target = sheet[key];
      if (target === undefined || present.has(target)) continue;
      const why = refused.has(target)
        ? `refusée (nouvelle fiche ${refused.get(target)} sur une base non vide)`
        : 'absente de la base et des fichiers';
      broken.push({
        file: `${EXERCISES_DIR}/${sheet.id}.json`,
        code: 'chain_pointer',
        message: `${key} pointe vers « ${target} », ${why}.`,
      });
    }
  }
  if (broken.length > 0) throw new CatalogLoadError(broken);

  const reviewers = [
    ...new Set(toInsert.flatMap((s) => (s.reviewed_by === undefined ? [] : [s.reviewed_by]))),
  ];
  const known = new Set(
    reviewers.length === 0
      ? []
      : (await trx.selectFrom('user').select('id').where('id', 'in', reviewers).execute()).map((r) => r.id),
  );
  for (const sheet of toInsert) {
    let row = sheet;
    if (sheet.reviewed_by !== undefined && !known.has(sheet.reviewed_by)) {
      const { reviewed_by: _, ...rest } = sheet;
      row = rest;
      report.unknownReviewers += 1;
    }
    await insertSheet(trx, row, { savedAt: now, savedBy: null, exportedRevision: sheet.revision });
    report.inserted.push(sheet.id);
  }

  for (const entry of files.manifest) await upsertIllustration(trx, entry);
  report.illustrations = files.manifest.length;
  return report;
}

/** Une ligne par erreur (fichier et code, jamais le message : P-LOG-2), puis leur nombre. */
function logIssues(logger: Logger, issues: readonly CatalogLoadIssue[]): void {
  for (const issue of issues) logger.error('catalog_invalid', { code: issue.code, event: issue.file });
  logger.error('catalog_invalid', { count: issues.length });
}

function logReport(logger: Logger, report: CatalogMergeReport): void {
  if (report.inserted.length > 0) {
    logger.info(report.seeded ? 'catalog_seeded' : 'catalog_sheets_inserted', {
      count: report.inserted.length,
    });
  }
  if (report.ignored.length > 0) logger.info('catalog_sheets_ignored', { count: report.ignored.length });
  for (const { id, status } of report.refused)
    logger.warn('catalog_sheet_refused', { event: id, code: status });
  if (report.unknownReviewers > 0)
    logger.warn('catalog_reviewer_unknown', { count: report.unknownReviewers });
  if (report.illustrations > 0) logger.info('catalog_illustrations', { count: report.illustrations });
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : 'unknown');

/**
 * Au démarrage : `loadCatalogFiles` → `seedOrMergeCatalog` → `rebuildCatalog`, dans une transaction. Des fichiers
 * invalides n'écrivent rien : le bloc est reconstruit depuis le catalogue déjà en base, et l'appli démarre. Un
 * modèle qui ne passe pas `ProgramTemplateSchema` n'est pas servi : `program_template_invalid`, avec le nom de son
 * fichier seulement (la CI l'aurait refusé).
 */
export const CATALOG_STARTUP_TASK: StartupTask = {
  name: 'catalog',
  async run(deps) {
    let result: CatalogFilesResult;
    try {
      result = await loadCatalogFiles(deps);
    } catch (error) {
      deps.logger.error('catalog_unreadable', { event: errorName(error) });
      result = { ok: false, errors: [], templates: [], invalidTemplates: [] };
    }
    for (const file of result.invalidTemplates)
      deps.logger.error('program_template_invalid', { event: file });
    if (result.ok) {
      const { files } = result;
      try {
        const report = await deps.db.transaction().execute(async (trx) => {
          const merged = await seedOrMergeCatalog(trx, files, deps.clock.now().toISOString());
          await rebuildCatalog(trx, deps, files.templates);
          return merged;
        });
        logReport(deps.logger, report);
        return;
      } catch (error) {
        if (error instanceof CatalogLoadError) logIssues(deps.logger, error.errors);
        else deps.logger.error('catalog_load_failed', { event: errorName(error) });
      }
    } else if (result.errors.length > 0) {
      logIssues(deps.logger, result.errors);
    }
    const templates = result.ok ? result.files.templates : result.templates;
    try {
      await deps.db.transaction().execute((trx) => rebuildCatalog(trx, deps, templates));
    } catch (error) {
      deps.logger.error('catalog_rebuild_failed', { event: errorName(error) });
    }
  },
};
