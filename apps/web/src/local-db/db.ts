import type { SyncOp } from '@rune/contracts';
import Dexie, { type Table } from 'dexie';
import { convertOutboxOp } from '../sync/protocol-converters';

export const LOCAL_DB_NAME = 'rune';
export const LOCAL_DB_VERSION = 2;

export type OutboxOp = SyncOp;

export interface DeadletterEntry {
  opId: string;
  userId: string;
  entity: string;
  id: string;
  code: string;
  detail: unknown;
  receivedAt: string;
}

/** Ligne miroir : colonnes du registre en camelCase, valeurs décodées (booléens, objets), `null` gardé. */
export type MirrorRow = Record<string, unknown> & {
  id: string;
  serverRevSeen: number | null;
  deletedAt: string | null;
};

/** Version 1 (socle), figée : celle du jeu `test/fixtures/local-db/v1` (R-VER-5). */
const STORES_V1: Readonly<Record<string, string>> = {
  meta: 'key',
  outbox: 'opId, userId, [entity+id]',
  deadletter: 'opId, userId',
  user: 'id',
  training_profile: 'id',
  health_screening: 'id',
  limitation: 'id',
  consent_event: 'id, [type+createdAt]',
  gym: 'id, nameKey',
  gym_equipment: 'id, gymId',
  place: 'id, gymId',
  home_equipment: 'id, placeId',
  sync_rejection: 'id, dismissedAt',
  exercises: 'id',
  illustrations: 'id',
  programTemplates: 'id',
  adviceSheets: 'id',
};

/**
 * Version 2 (brique 3, spec §5.4) : les 7 tables des programmes et des séances. `provisional` marque les copies
 * provisoires de classe D calculées par le téléphone (valeur 1 : IndexedDB n'indexe pas les booléens), que le pull
 * remplace.
 */
const STORES_V2: Readonly<Record<string, string>> = {
  ...STORES_V1,
  program_instance: 'id, status',
  instance_change: 'id, instanceId',
  slot_state: 'id, instanceId, provisional',
  engine_decision: 'id, instanceId, provisional',
  workout_session: 'id, status',
  performed_exercise: 'id, sessionId',
  performed_set: 'id, performedExerciseId',
};

/**
 * Schéma de chaque version, jamais modifié une fois livré (R-VER-5). Une version suivante ajoute son schéma ici ;
 * sa mise à niveau convertit l'outbox par `convertOutboxOp` (R-VER-4).
 */
export const STORE_SCHEMAS_BY_VERSION: Readonly<Record<number, Readonly<Record<string, string>>>> = {
  1: STORES_V1,
  2: STORES_V2,
};

/** Schéma de LOCAL_DB_VERSION. */
export const STORE_SCHEMAS: Readonly<Record<string, string>> = STORES_V2;

export const NON_MIRROR_STORES: readonly string[] = [
  'meta',
  'outbox',
  'deadletter',
  'exercises',
  'illustrations',
  'programTemplates',
  'adviceSheets',
];

export class AppDb extends Dexie {
  declare meta: Table<{ key: string; value: unknown }, string>;
  declare outbox: Table<OutboxOp, string>;
  declare deadletter: Table<DeadletterEntry, string>;
  readonly mirrorNames: readonly string[];

  constructor(name: string, extraMirrors: Record<string, string> = {}) {
    super(name);
    this.version(1).stores(STORES_V1);
    const stores = { ...STORE_SCHEMAS, ...extraMirrors };
    this.version(LOCAL_DB_VERSION)
      .stores(stores)
      .upgrade(async (tx) => {
        // R-VER-4 : les ops restées dans l'outbox passent au protocole courant (aucun maillon tant qu'il vaut 1).
        await tx
          .table<OutboxOp, string>('outbox')
          .toCollection()
          .modify((op, ref) => {
            ref.value = convertOutboxOp(op);
          });
      });
    this.mirrorNames = Object.keys(stores)
      .filter((s) => !NON_MIRROR_STORES.includes(s))
      .sort();
  }

  /** Table miroir d'une entité ; lève pour une entité sans miroir. */
  mirror(entity: string): Table<MirrorRow, string> {
    if (!this.mirrorNames.includes(entity)) throw new Error(`unknown_mirror:${entity}`);
    return this.table(entity);
  }
}

export function createAppDb(
  name: string = LOCAL_DB_NAME,
  opts: { extraMirrors?: Record<string, string> } = {},
): AppDb {
  return new AppDb(name, opts.extraMirrors);
}

/** Magasins miroirs, triés. */
export function mirrorStoreNames(db: AppDb): string[] {
  return [...db.mirrorNames];
}
