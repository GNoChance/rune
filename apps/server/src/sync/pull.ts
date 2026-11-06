import {
  COLUMN_CODECS,
  type ColumnCodec,
  decodeWatermark,
  type EntityRule,
  encodeWatermark,
  type PulledRow,
  type PullResponse,
  snakeToCamel,
} from '@rune/contracts';
import { type RawBuilder, sql, type Transaction } from 'kysely';
import type { SessionUser } from '../app-env';
import type { Database, DbExecutor } from '../db/schema';
import { getServerMeta } from '../db/server-meta';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { loadNutritionContext } from '../nutrition/context';
import { expireProposals } from '../program/expire';

type Raw = Record<string, unknown>;

interface Source {
  entity: string;
  rule: EntityRule;
  columns: readonly string[];
  scope: RawBuilder<unknown>;
  /** Utilisateur de la session : seule valeur gardée dans les colonnes `pullRedact`. */
  userId: string;
  /** Valeurs C2 de colonnes C1 servies à null (hors mode complet). */
  hiddenValues: Readonly<Record<string, readonly string[]>>;
}

const MIRRORED = new Set(['J', 'D', 'E']);
/** Tables servies seulement en mode nutrition effectif `full` (spec brique 5 §6.4). */
const NUTRITION_FULL_ONLY = new Set(['weigh_in', 'nutrition_target', 'nutrition_checkin']);

/** Tables du périmètre de l'utilisateur (R-SYN-21) : ses lignes J/D/E, et les tables C0 partagées. */
function sourcesFor(deps: AppDeps, userId: string, nutritionFull = true): Source[] {
  const sources: Source[] = [];
  for (const [entity, rule] of Object.entries(deps.entityRules)) {
    if (!MIRRORED.has(rule.syncClass)) continue;
    if (!nutritionFull && NUTRITION_FULL_ONLY.has(entity)) continue;
    let scope: RawBuilder<unknown>;
    if (rule.ownerColumn !== null) scope = sql`${sql.ref(rule.ownerColumn)} = ${userId}`;
    else if (rule.category === 'C0') scope = sql`1 = 1`;
    else continue;
    // Hors mode complet, le profil nutrition ne sert que ses colonnes C1 (choix C19).
    const hidden = !nutritionFull && entity === 'nutrition_profile';
    const columns = rule.columns.filter(
      (c) => !rule.secretColumns.includes(c) && !(hidden && rule.c2Columns.includes(c)),
    );
    sources.push({ entity, rule, columns, scope, userId, hiddenValues: hidden ? (rule.c2Values ?? {}) : {} });
  }
  return sources;
}

function decode(codec: ColumnCodec | undefined, value: unknown): unknown {
  if (value === null || value === undefined || codec === undefined) return value ?? null;
  return codec === 'boolean' ? value === 1 : JSON.parse(String(value));
}

/**
 * Ligne SQL → ligne de pull : camelCase, sans secret, codecs appliqués, `deletedAt` toujours présent ;
 * les colonnes `pullRedact` (auteurs d'une ligne partagée) ne gardent que l'id de l'utilisateur de la session.
 */
function toPulled(source: Source, raw: Raw): PulledRow {
  const codecs = COLUMN_CODECS[source.entity] ?? {};
  const redact = source.rule.pullRedact ?? [];
  const row: Raw = { deletedAt: null };
  for (const column of source.columns) {
    const key = snakeToCamel(column);
    const hiddenValues = Object.hasOwn(source.hiddenValues, column) ? source.hiddenValues[column] : undefined;
    const hidden = typeof raw[key] === 'string' && hiddenValues?.includes(raw[key]);
    const value = hidden || (redact.includes(column) && raw[key] !== source.userId) ? null : raw[key];
    row[key] = decode(codecs[column], value);
  }
  return { entity: source.entity, rev: Number(row.rev), row };
}

async function selectRows(
  trx: DbExecutor,
  source: Source,
  revFilter: RawBuilder<unknown>,
  limit?: number,
): Promise<PulledRow[]> {
  const columns = sql.join(source.columns.map((c) => sql.ref(c)));
  const tail = limit === undefined ? sql`` : sql`limit ${limit}`;
  const result = await sql<Raw>`select ${columns} from ${sql.table(source.entity)}
    where ${source.scope} and ${revFilter} order by rev ${tail}`.execute(trx);
  return result.rows.map((r) => toPulled(source, r));
}

/** Lignes vivantes d'une table miroir de l'utilisateur, au format du pull (lecture complète, hors flux). */
export async function liveRowsOf(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  entity: string,
): Promise<PulledRow[]> {
  const source = sourcesFor(deps, userId).find((s) => s.entity === entity);
  if (!source) throw new Error(`table miroir inconnue : ${entity}`);
  return selectRows(db, source, sql`deleted_at is null`);
}

async function hasRowsAfter(trx: Transaction<Database>, sources: Source[], rev: number): Promise<boolean> {
  for (const s of sources) {
    const more =
      await sql`select 1 from ${sql.table(s.entity)} where ${s.scope} and rev > ${rev} limit 1`.execute(trx);
    if (more.rows.length > 0) return true;
  }
  return false;
}

const compare = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
const byRev = (a: PulledRow, b: PulledRow) =>
  a.rev - b.rev || compare(a.entity, b.entity) || compare(String(a.row.id), String(b.row.id));

/**
 * Page de pull (R-SYN-20, R-SYN-21, R-SYN-23) lue dans une seule transaction : lignes de rev > since,
 * triées, `limit` au plus, sans jamais couper un groupe de même rev. Watermark d'une autre époque,
 * antérieur à la dernière purge ou au-delà du compteur courant → 410 `watermark_expired` (pull complet).
 */
export async function buildPull(
  deps: AppDeps,
  user: SessionUser,
  since: string | null,
  limit: number,
): Promise<PullResponse> {
  let sinceWatermark: { epoch: string; rev: number } | null = null;
  if (since !== null) {
    sinceWatermark = decodeWatermark(since);
    if (!sinceWatermark) throw httpError('validation');
  }
  return deps.db.transaction().execute(async (trx) => {
    // Propositions périmées de l'utilisateur passées à `expired` avant la lecture (spec brique 3 §4.4.6).
    await expireProposals(trx, user.id, deps.clock.now());
    const meta = await getServerMeta(trx);
    if (
      sinceWatermark &&
      (sinceWatermark.epoch !== meta.serverEpoch ||
        sinceWatermark.rev < meta.tombstonePurgeRev ||
        sinceWatermark.rev > meta.syncCounter)
    ) {
      throw httpError('watermark_expired');
    }
    const sinceRev = sinceWatermark?.rev ?? 0;
    // Mode effectif lu une fois par requête : il décide des tables servies et des colonnes C2 du profil.
    const { effective } = await loadNutritionContext(trx, deps, user.id);
    const sources = sourcesFor(deps, user.id, effective.mode === 'full');

    const candidates: PulledRow[] = [];
    for (const s of sources)
      candidates.push(...(await selectRows(trx, s, sql`rev > ${sinceRev}`, limit + 1)));
    candidates.sort(byRev);
    let rows = candidates.slice(0, limit);
    const last = rows.at(-1);
    let hasMore = false;
    if (last && candidates.length > limit) {
      // Le groupe du dernier rev gardé est relu en entier dans chaque table.
      const group: PulledRow[] = [];
      for (const s of sources) group.push(...(await selectRows(trx, s, sql`rev = ${last.rev}`)));
      rows = [...rows.filter((r) => r.rev !== last.rev), ...group.sort(byRev)];
      hasMore = await hasRowsAfter(trx, sources, last.rev);
    }
    // sinceRev ≤ syncCounter (vérifié plus haut) : la fin du flux est le compteur courant.
    const nextRev = hasMore && last ? last.rev : meta.syncCounter;
    return {
      rows,
      nextWatermark: encodeWatermark(meta.serverEpoch, nextRev),
      hasMore,
      catalogVersion: meta.catalogVersion,
      nutrition: { effective_mode: effective.mode, cause: effective.cause },
    };
  });
}
