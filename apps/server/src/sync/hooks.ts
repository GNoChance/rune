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
  /**
   * Colonnes (snake_case) écrites à la création seulement : retirées d'un patch avant tout contrôle, parent compris,
   * sans rejet ; le reste du patch s'applique.
   */
  immutableColumns?: readonly string[];
  /** Dans le point de sauvegarde de l'op, avant l'écriture ; `fields` en snake_case, déjà filtrés. */
  beforeApply?(ctx: HookCtx, fields: Record<string, unknown>): Promise<void>;
  /**
   * `delete` d'une ligne vivante : vrai, la ligne reste vivante et prend seulement un rev neuf (l'op est acquittée
   * `applied`, l'appareil qui l'a supprimée la récupère au pull suivant) ; `afterApply` n'est pas appelé, `afterBatch`
   * reçoit la ligne comme écrite.
   */
  keepOnDelete?(ctx: HookCtx): Promise<boolean>;
  /**
   * `patch` ou `create` d'une ligne supprimée logiquement, après `beforeApply` et avec les mêmes `fields` (sans ce
   * hook, ou s'il rend faux, l'op est acquittée sans effet) : vrai, la ligne revit, écrite comme par un patch
   * (`deleted_at` à NULL, champs écrits sans les colonnes immuables, rev neuf) ; `afterApply` et `afterBatch` la
   * reçoivent comme écrite.
   */
  reviveOnWrite?(ctx: HookCtx, fields: Record<string, unknown>): Promise<boolean>;
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
