/**
 * `pnpm data:pull <fichier> [--dir <dossier data>]` : découpe l'export du catalogue (`exercises-export.json`,
 * téléchargé par « Exporter le catalogue », `GET /api/admin/exercises/export`) en un fichier par fiche dans
 * `data/exercises/<id>.json`, en forme canonique (`canonicalJson`, 04 §10). Le porteur ouvre ensuite une PR, et la
 * CI lance `pnpm data:validate`.
 *
 * - L'export est lu en entier avant toute écriture : JSON illisible, autre chose qu'un tableau, fiche refusée par
 *   `DraftSheetSchema` ou `id` en double, et rien n'est écrit (sortie 1).
 * - Seuls les fichiers dont le texte change sont réécrits. Une fiche du dépôt absente de l'export (un squelette pas
 *   encore chargé en base, par exemple) est gardée et signalée : la base ne supprime jamais une fiche.
 * - Ensuite, le dossier est validé comme par `pnpm data:validate` : sortie 1 et une ligne par erreur s'il ne passe
 *   pas (les fichiers restent écrits ; une règle de chaîne, par exemple, se corrige dans l'appli avant un nouvel
 *   export). Sortie 0 sinon ; 2 pour un usage incorrect.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type DraftSheet, DraftSheetSchema } from '@rune/contracts';
import { canonicalJson, EXERCISES_DIR } from '@rune/domain';
import { type DataError, DEFAULT_DATA_DIR, validateDataDir } from './validate';

const USAGE = 'Usage : pnpm data:pull <exercises-export.json> [--dir <dossier data>]';

/** Bilan d'un `data:pull` : `id` des fiches écrites, inchangées, et gardées (absentes de l'export). */
export type PullReport = {
  errors: DataError[];
  created: string[];
  updated: string[];
  unchanged: string[];
  kept: string[];
};

const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
const sheetFile = (id: string) => `${EXERCISES_DIR}/${id}.json`;

/**
 * Fiches de l'export, validées une à une par `DraftSheetSchema` (le slug de l'`id` garde le nom de fichier dans
 * `exercises/`) et sans `id` en double ; sinon les erreurs, chemin = fichier visé ou position dans l'export.
 */
export function parseExport(text: string): { sheets: DraftSheet[]; errors: DataError[] } {
  const errors: DataError[] = [];
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    return {
      sheets: [],
      errors: [
        { file: '(export)', code: 'invalid_json', message: `JSON illisible : ${(error as Error).message}` },
      ],
    };
  }
  if (!Array.isArray(json)) {
    return {
      sheets: [],
      errors: [
        { file: '(export)', code: 'invalid_export', message: "L'export est un tableau JSON de fiches." },
      ],
    };
  }
  const sheets: DraftSheet[] = [];
  const seen = new Set<string>();
  json.forEach((item: unknown, index) => {
    const parsed = DraftSheetSchema.safeParse(item);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const where = issue.path.map(String).join('.') || '(fiche)';
        errors.push({
          file: `(export)[${index}]`,
          code: 'invalid_sheet',
          message: `${where} : ${issue.message}`,
        });
      }
      return;
    }
    const { id } = parsed.data;
    if (seen.has(id)) {
      errors.push({ file: sheetFile(id), code: 'duplicate_id', message: `L'id « ${id} » figure deux fois.` });
      return;
    }
    seen.add(id);
    sheets.push(parsed.data);
  });
  return { sheets, errors };
}

/** Noms des fiches `*.json` de `dir`, sans extension ; dossier absent = aucune. */
async function listSheetIds(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => e.name.slice(0, -'.json'.length));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** Écrit les fiches de l'export `text` dans `dataDir/exercises/` ; rien n'est écrit si l'export est refusé. */
export async function pullExport(text: string, dataDir: string): Promise<PullReport> {
  const report: PullReport = { errors: [], created: [], updated: [], unchanged: [], kept: [] };
  const { sheets, errors } = parseExport(text);
  if (errors.length > 0) {
    report.errors = errors;
    return report;
  }
  const dir = join(dataDir, EXERCISES_DIR);
  await mkdir(dir, { recursive: true });
  const exported = new Set<string>();
  for (const sheet of [...sheets].sort((a, b) => binary(a.id, b.id))) {
    exported.add(sheet.id);
    const path = join(dataDir, sheetFile(sheet.id));
    const next = canonicalJson(sheet);
    let previous: string | undefined;
    try {
      previous = await readFile(path, 'utf8');
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (previous === next) {
      report.unchanged.push(sheet.id);
      continue;
    }
    await writeFile(path, next, 'utf8');
    (previous === undefined ? report.created : report.updated).push(sheet.id);
  }
  report.kept = (await listSheetIds(dir)).filter((id) => !exported.has(id)).sort(binary);
  return report;
}

/** Point d'entrée : rend le code de sortie. */
export async function main(
  argv: readonly string[],
  out: Pick<Console, 'log' | 'error'> = console,
): Promise<number> {
  let file: string | undefined;
  let dataDir = DEFAULT_DATA_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const value = argv[i + 1];
    if (arg === '--dir' && value !== undefined) {
      dataDir = resolve(value);
      i += 1;
    } else if (!arg.startsWith('--') && file === undefined) {
      file = arg;
    } else {
      out.error(USAGE);
      return 2;
    }
  }
  if (file === undefined) {
    out.error(USAGE);
    return 2;
  }

  let text: string;
  try {
    text = await readFile(resolve(file), 'utf8');
  } catch (error) {
    out.error(`Export illisible (${file}) : ${(error as Error).message}`);
    return 1;
  }
  const report = await pullExport(text, dataDir);
  if (report.errors.length > 0) {
    for (const e of report.errors) out.error(`${e.file} [${e.code}] ${e.message}`);
    out.error(`Export refusé : ${report.errors.length} erreur(s), aucun fichier écrit.`);
    return 1;
  }
  out.log(
    `${report.created.length} fiche(s) créée(s), ${report.updated.length} modifiée(s), ` +
      `${report.unchanged.length} inchangée(s).`,
  );
  if (report.kept.length > 0) {
    out.log(`Absente(s) de l'export, gardée(s) : ${report.kept.join(', ')}.`);
  }

  const { errors } = await validateDataDir(dataDir);
  if (errors.length > 0) {
    for (const e of errors) out.error(`${e.file} [${e.code}] ${e.message}`);
    out.error(
      `Catalogue invalide après data:pull : ${errors.length} erreur(s). Corrige dans l'appli puis réexporte.`,
    );
    return 1;
  }
  out.log('Catalogue valide : lance la PR.');
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
