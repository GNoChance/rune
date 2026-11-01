import type { SyncOp } from '@rune/contracts';
import type { Transaction } from 'kysely';
import type { Database } from '../db/schema';
import type { AppDeps } from '../deps';
import { PROGRAM_SYNC_HOOKS } from '../program/sync-hooks';

export interface HookCtx {
  trx: Transaction<Database>;
  deps: AppDeps;
  userId: string;
  op: SyncOp;
}

export interface BatchCtx {
  trx: Transaction<Database>;
  deps: AppDeps;
  userId: string;
  applied: readonly { entity: string; id: string }[];
}

/** Points d'extension d'une table J ; la relation parent est lue dans `EntityRule.parent`. */
export interface EntitySyncHooks {
  allowedKinds?: readonly SyncOp['kind'][];
  /** Dans le point de sauvegarde de l'op, avant l'écriture ; `fields` en snake_case, déjà filtrés. */
  beforeApply?(ctx: HookCtx, fields: Record<string, unknown>): Promise<void>;
  /** Après une écriture effective de l'op. */
  afterApply?(ctx: HookCtx): Promise<void>;
  /**
   * Une fois par lot et par fonction, s'il y a des ops écrites : des entités qui partagent la même fonction
   * reçoivent un seul appel, avec les lignes de toutes.
   */
  afterBatch?(b: BatchCtx): Promise<void>;
}

export type SyncHooksMap = Readonly<Record<string, EntitySyncHooks>>;

/** Au socle, le client n'écrit que `dismissed_at` de ses rejets ; séances : contrôles et rejeu (brique 3 §5.3). */
export const SYNC_HOOKS: SyncHooksMap = {
  sync_rejection: { allowedKinds: ['patch'] },
  ...PROGRAM_SYNC_HOOKS,
};
