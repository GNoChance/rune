import { createHash } from 'node:crypto';
import {
  type CatalogBundle,
  type DraftSheet,
  SERVED_EXCLUDED_KEYS,
  type ServedSheet,
  ServedSheetSchema,
} from '@rune/contracts';
import { canonicalJson } from '@rune/domain';
import type { DbExecutor } from '../db/schema';
import { getServerMeta } from '../db/server-meta';
import type { AppDeps } from '../deps';
import { rowToEntry, rowToSheet } from './repo';

/*
 * Bloc servi par `GET /api/catalog` (04 §11) et version du catalogue (spec brique 2 §3.7). La base fait foi : le
 * bloc est reconstruit depuis elle au démarrage et à chaque écriture d'une fiche, dans la même transaction. Seuls
 * les modèles de programmes viennent des fichiers (`data/programs/*.json`) : le chargeur les confie au bloc.
 */

type CatalogContent = Omit<CatalogBundle, 'version'>;

/** Dernier bloc construit et modèles reçus du chargeur, par dépendances (une appli, ou un test). */
const state = new WeakMap<AppDeps, { bundle: CatalogBundle | null; templates: readonly unknown[] }>();

/** Dernier bloc construit pour ces dépendances, sinon null. Peut précéder un commit : servir `currentCatalog`. */
export function getServedCatalog(deps: AppDeps): CatalogBundle | null {
  return state.get(deps)?.bundle ?? null;
}

/**
 * Fiche servie : la fiche moins ses colonnes éditoriales et son lot, validée par `ServedSheetSchema` ; null si elle
 * ne le passe pas (fiche incomplète en base, par exemple un brouillon retiré).
 */
export function servedSheetOf(sheet: DraftSheet): ServedSheet | null {
  const record: Record<string, unknown> = { ...sheet };
  for (const key of SERVED_EXCLUDED_KEYS) delete record[key];
  const parsed = ServedSheetSchema.safeParse(record);
  return parsed.success ? parsed.data : null;
}

/** `catalog_version` : sha256 de la forme canonique (`canonicalJson`) du contenu servi. */
export function catalogVersion(content: CatalogContent): string {
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

/**
 * Reconstruit le bloc depuis la base (spec brique 2 §3.7) : fiches `published`, et `retired` déjà publiées
 * (`published_at` non nul, spec §3.6), triées par `id` ; manifeste de la table `illustration` ; modèles reçus du
 * chargeur (`templates`, gardés pour les reconstructions suivantes). Met `server_meta.catalog_version` et
 * `catalog_updated_at` à jour si la version change, puis remplace le bloc en mémoire.
 *
 * À appeler en dernier dans la transaction de l'écriture : si elle est annulée ensuite, `currentCatalog` le voit à
 * la version de `server_meta` et reconstruit le bloc.
 */
export async function rebuildCatalog(
  trx: DbExecutor,
  deps: AppDeps,
  templates?: readonly unknown[],
): Promise<CatalogBundle> {
  const kept = templates ?? state.get(deps)?.templates ?? [];
  const rows = await trx
    .selectFrom('exercise')
    .selectAll()
    .where((eb) =>
      eb.or([
        eb('status', '=', 'published'),
        eb.and([eb('status', '=', 'retired'), eb('publishedAt', 'is not', null)]),
      ]),
    )
    .orderBy('id')
    .execute();
  const exercises: ServedSheet[] = [];
  for (const row of rows) {
    const served = servedSheetOf(rowToSheet(row));
    if (served === null) deps.logger.error('catalog_sheet_unservable', { event: row.id });
    else exercises.push(served);
  }
  const illustrations = (await trx.selectFrom('illustration').selectAll().orderBy('id').execute()).map(
    rowToEntry,
  );
  const content: CatalogContent = {
    adviceSheets: [],
    exercises,
    illustrations,
    programTemplates: [...kept],
  };
  const version = catalogVersion(content);
  const meta = await getServerMeta(trx);
  if (meta.catalogVersion !== version) {
    await trx
      .updateTable('serverMeta')
      .set({ catalogVersion: version, catalogUpdatedAt: deps.clock.now().toISOString() })
      .where('id', '=', 1)
      .execute();
  }
  const bundle: CatalogBundle = { version, ...content };
  state.set(deps, { bundle, templates: kept });
  return bundle;
}

/**
 * Bloc à servir : celui en mémoire s'il porte la version de `server_meta`, sinon reconstruit depuis la base (rien
 * en mémoire, ou écriture annulée après sa reconstruction).
 */
export async function currentCatalog(deps: AppDeps): Promise<CatalogBundle> {
  const bundle = getServedCatalog(deps);
  const { catalogVersion: stored } = await getServerMeta(deps.db);
  if (bundle !== null && bundle.version === stored) return bundle;
  return deps.db.transaction().execute((trx) => rebuildCatalog(trx, deps));
}
