import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type AdviceSheetFile, AdviceSheetFileSchema } from '@rune/contracts';
import { canonicalJson } from '@rune/domain';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';

/*
 * Fiches conseils de `data/advice/<id>.json` (spec brique 5 §10.1). Le dépôt apporte le contenu, la base fait foi pour
 * le statut : fiche absente → `draft` ; contenu changé (`content_hash`) → retour à `draft`, `version` + 1, relecture
 * et publication effacées ; contenu identique → rien. Le texte modifié dans l'écran de relecture ne touche pas
 * `content_hash` (empreinte du dernier fichier lu) : le chargeur ne l'écrase donc qu'à un vrai changement du fichier.
 */

/** Dossier des fiches, relatif à `data/`. */
export const ADVICE_DIR = 'advice';

/** Empreinte du contenu d'un fichier (forme canonique, indépendante de la mise en page du JSON). */
export const adviceHash = (file: AdviceSheetFile): string =>
  createHash('sha256').update(canonicalJson(file)).digest('hex');

export type AdviceFilesResult = { files: AdviceSheetFile[]; invalid: string[] };

/** Lit `<contentDir>/advice/*.json` ; dossier absent = aucune fiche. Un fichier illisible ou invalide est listé dans `invalid`. */
export async function loadAdviceFiles(deps: Pick<AppDeps, 'config'>): Promise<AdviceFilesResult> {
  const dir = join(deps.config.contentDir, ADVICE_DIR);
  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => e.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { files: [], invalid: [] };
    throw error;
  }
  const files: AdviceSheetFile[] = [];
  const invalid: string[] = [];
  for (const name of names) {
    try {
      const parsed = AdviceSheetFileSchema.safeParse(JSON.parse(await readFile(join(dir, name), 'utf8')));
      if (parsed.success && `${parsed.data.id}.json` === name) files.push(parsed.data);
      else invalid.push(`${ADVICE_DIR}/${name}`);
    } catch {
      invalid.push(`${ADVICE_DIR}/${name}`);
    }
  }
  return { files, invalid };
}

const contentColumns = (file: AdviceSheetFile) => ({
  title: file.title,
  bodyMd: file.body_md,
  audience: file.audience,
  visibleModes: JSON.stringify(file.visible_modes),
  tags: JSON.stringify(file.tags),
  sources: JSON.stringify(file.sources),
  draftOrigin: file.draft_origin,
});

/** Verse les fichiers en base ; à appeler dans la transaction du chargeur de catalogue. */
export async function seedOrMergeAdviceSheets(
  trx: DbExecutor,
  files: AdviceSheetFile[],
  nowIso: string,
): Promise<{ added: number; changed: number }> {
  let added = 0;
  let changed = 0;
  for (const file of files) {
    const hash = adviceHash(file);
    const current = await trx
      .selectFrom('adviceSheet')
      .select(['version', 'contentHash'])
      .where('id', '=', file.id)
      .executeTakeFirst();
    if (!current) {
      await trx
        .insertInto('adviceSheet')
        .values({
          id: file.id,
          ...contentColumns(file),
          status: 'draft',
          version: 1,
          updatedAt: nowIso,
          contentHash: hash,
        })
        .execute();
      added += 1;
    } else if (current.contentHash !== hash) {
      await trx
        .updateTable('adviceSheet')
        .set({
          ...contentColumns(file),
          status: 'draft',
          version: current.version + 1,
          reviewedBy: null,
          reviewedAt: null,
          publishedAt: null,
          retiredAt: null,
          updatedAt: nowIso,
          contentHash: hash,
        })
        .where('id', '=', file.id)
        .execute();
      changed += 1;
    }
  }
  return { added, changed };
}
