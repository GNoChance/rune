import type { z } from 'zod';
import { ApiError } from '../api/client';
import type { AppServices } from '../app-services';
import type { AppDb, MirrorRow } from '../local-db/db';
import { getMeta } from '../local-db/meta';

/**
 * Colonne JSON d'un miroir : le pull l'a déjà décodée (`COLUMN_CODECS`), on ne fait que valider
 * l'objet ; texte, valeur absente ou objet invalide → null.
 */
export function parseJsonColumn<T>(v: unknown, schema: z.ZodType<T>): T | null {
  if (typeof v !== 'object' || v === null) return null;
  const parsed = schema.safeParse(v);
  return parsed.success ? parsed.data : null;
}

/** Ligne non supprimée (tombstone exclu). */
export function isLive(row: MirrorRow): boolean {
  return row.deletedAt == null;
}

/** `v` s'il fait partie de `values`, sinon null (valeur de miroir inattendue). */
export function oneOf<T>(values: readonly T[], v: unknown): T | null {
  return values.includes(v as T) ? (v as T) : null;
}

export const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function currentUserId(db: AppDb): Promise<string | null> {
  return (await getMeta(db, 'userId')) ?? null;
}

/** Lignes vivantes d'un miroir appartenant à `ownerId`. */
export async function ownedRows(db: AppDb, entity: string, ownerId: string | null): Promise<MirrorRow[]> {
  if (ownerId === null) return [];
  return db
    .mirror(entity)
    .filter((r) => isLive(r) && r.ownerId === ownerId)
    .toArray();
}

/** Refus qui disent que le miroir est en retard sur le serveur : un pull le met à jour avant de réessayer. */
const STALE_MIRROR_CODES: readonly string[] = ['stale_revision', 'expired', 'coach_load_increase'];

/**
 * Écriture de classe E : l'API d'abord (hors ligne → NetworkRequiredError, rien d'écrit en local),
 * puis `apply` sur la réponse (meta.me par exemple), puis un pull qui ramène les lignes serveur.
 * Un 409 `stale_revision` ou `expired`, ou un 422 `coach_load_increase` (la proposition du coach vient de passer à
 * `expired`, spec brique 4 §12.2), tire aussi avant de relancer l'erreur (ruling R52) : sans cela, réessayer
 * renverrait la même révision périmée ; un pull en échec ne remplace pas l'erreur du serveur.
 */
export async function sendThenPull<T = void>(
  s: AppServices,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  opts: { body?: unknown; schema?: z.ZodType<T>; apply?: (result: T) => Promise<void> } = {},
): Promise<T> {
  let result: T;
  try {
    result = await s.api.send(method, path, opts.body, opts.schema);
  } catch (error) {
    if (error instanceof ApiError && STALE_MIRROR_CODES.includes(error.code)) {
      await s.sync.pullNow().catch(() => {});
    }
    throw error;
  }
  await opts.apply?.(result);
  await s.sync.pullNow();
  return result;
}
