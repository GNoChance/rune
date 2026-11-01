import {
  IllustrationManifest,
  type ServedProgramTemplate,
  ServedProgramTemplateSchema,
} from '@rune/contracts';
import { z } from 'zod';
import type { AppDb } from '../local-db/db';
import { getMeta, setMeta } from '../local-db/meta';
import { postToSw } from '../sw/sw-client';
import { fetchJsonWithTimeout, type SyncTransport } from './transport';

/** Budget du catalogue, corps compris : plus long que celui des appels de synchro. */
export const CATALOG_TIMEOUT_MS = 30_000;

const Item = z.looseObject({ id: z.string() });
/**
 * Bloc reçu : les illustrations sont les entrées complètes du manifeste (`IllustrationEntry`), crédits compris,
 * stockées telles quelles : la page Crédits les lit hors ligne (04 §12). Les modèles de programmes sont validés
 * un par un (`localTemplates`).
 */
const LocalCatalog = z.object({
  version: z.string(),
  exercises: z.array(Item),
  illustrations: IllustrationManifest,
  programTemplates: z.array(z.unknown()),
  adviceSheets: z.array(Item),
});

/** Modèle stocké dans `programTemplates` : clé `id` du modèle, modèle servi et sa disponibilité. */
export type LocalProgramTemplate = { id: string } & ServedProgramTemplate;

/** Entrées qui passent `ServedProgramTemplateSchema` (spec brique 3 §5.4) ; une entrée invalide est ignorée. */
function localTemplates(entries: readonly unknown[]): LocalProgramTemplate[] {
  return entries.flatMap((entry) => {
    const parsed = ServedProgramTemplateSchema.safeParse(entry);
    return parsed.success ? [{ id: parsed.data.template.id, ...parsed.data }] : [];
  });
}

/**
 * Catalogue (classe C) par ETag : 304 → inchangé ; 200 → les quatre magasins remplacés en une
 * transaction, versions locales alignées, puis le SW est prié de mettre les illustrations en cache.
 */
export async function refreshCatalog(db: AppDb, t: SyncTransport): Promise<'unchanged' | 'updated'> {
  const current = await getMeta(db, 'catalogVersion');
  const headers: Record<string, string> = current === undefined ? {} : { 'If-None-Match': `"${current}"` };
  const { res, body } = await fetchJsonWithTimeout(
    t,
    '/api/catalog',
    { method: 'GET', headers },
    CATALOG_TIMEOUT_MS,
  );
  if (res.status === 304) return 'unchanged';
  if (res.status !== 200) throw new Error(`catalog_http_${res.status}`);
  const parsed = LocalCatalog.parse(body);
  const bundle = { ...parsed, programTemplates: localTemplates(parsed.programTemplates) };

  await db.transaction(
    'rw',
    ['exercises', 'illustrations', 'programTemplates', 'adviceSheets', 'meta'],
    async () => {
      for (const store of ['exercises', 'illustrations', 'programTemplates', 'adviceSheets'] as const) {
        await db.table(store).clear();
        await db.table(store).bulkPut(bundle[store]);
      }
      await setMeta(db, 'catalogVersion', bundle.version);
      await setMeta(db, 'serverCatalogVersion', bundle.version);
    },
  );
  postToSw({ type: 'SYNC_ILLUSTRATIONS', files: bundle.illustrations.map((i) => i.file) });
  return 'updated';
}
