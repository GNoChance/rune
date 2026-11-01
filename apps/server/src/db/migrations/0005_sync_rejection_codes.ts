import { sql } from 'kysely';
import type { Migration } from './index';

/**
 * Codes de rejet des séances (spec brique 3 §5.3) : `forbidden_reference`, `invalid_transition`,
 * `unknown_exercise`, `out_of_range` s'ajoutent au CHECK de `sync_rejection.code`. SQLite ne modifie pas un CHECK :
 * la table est reconstruite, lignes et index compris, colonnes inchangées. L'ancienne est renommée d'abord, pour que
 * la nouvelle garde son nom tel quel dans `sqlite_schema` ; aucune clé étrangère ne pointe vers elle. Valeurs figées
 * ici comme dans 0001 : `RejectionCode` des contrats les recoupe (test enum-consistency).
 */

const CODES = [
  'validation',
  'forbidden',
  'parent_rejected',
  'stale_revision',
  'unknown_entity',
  'protocol',
  'forbidden_reference',
  'invalid_transition',
  'unknown_exercise',
  'out_of_range',
];

const COLUMNS = [
  'id TEXT PRIMARY KEY',
  'owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE',
  'rev INTEGER NOT NULL',
  'created_at TEXT NOT NULL',
  'updated_at TEXT NOT NULL',
  'updated_by TEXT REFERENCES user(id) ON DELETE SET NULL',
  'deleted_at TEXT',
  'op_id TEXT NOT NULL',
  'entity TEXT NOT NULL',
  'row_id TEXT NOT NULL',
  `code TEXT NOT NULL CHECK (code IN (${CODES.map((c) => `'${c}'`).join(',')}))`,
  'detail_json TEXT CHECK (json_valid(detail_json))',
  'dismissed_at TEXT',
];

const STATEMENTS = [
  'ALTER TABLE sync_rejection RENAME TO sync_rejection_0004',
  `CREATE TABLE sync_rejection (${COLUMNS.join(', ')}) STRICT`,
  'INSERT INTO sync_rejection SELECT * FROM sync_rejection_0004',
  'DROP TABLE sync_rejection_0004',
  'CREATE INDEX sync_rejection_rev_idx ON sync_rejection (rev)',
  'CREATE INDEX sync_rejection_owner_rev_idx ON sync_rejection (owner_id, rev)',
];

export const syncRejectionCodes: Migration = {
  id: '0005_sync_rejection_codes',
  breaking: false,
  up: async (db) => {
    for (const ddl of STATEMENTS) await sql.raw(ddl).execute(db);
  },
};
