import { sql } from 'kysely';
import type { Migration } from './index';

/**
 * Un seul fil ouvert par jour (spec brique 4.1 §4.4). `coach_thread` perd `UNIQUE (user_id, day)` au profit d'un
 * index unique partiel `(user_id, day) WHERE is_open = 1` : un changement de coach ferme le fil du jour
 * (`persona_change`) et le message suivant en ouvre un autre le même jour. `closed_reason` accepte `persona_change`.
 *
 * SQLite ne modifie pas un CHECK : la table est reconstruite. Sa suppression déclencherait la cascade vers
 * `coach_message` (clés actives pendant la migration) : les messages sont donc mis de côté, puis `coach_message` est
 * recréée à l'identique, ses clés (fil et personne, en cascade) et ses contraintes comprises, et remplie de nouveau.
 * Aucune autre table ne cite `coach_thread` par une clé (`coach_call`, `coach_report` et `instance_change` non).
 */

const THREAD_COLUMNS = `id, user_id, day, audience, persona, model, effort, prompt_version, tools_version, brief_schema, brief, slot_aliases, is_open, closed_reason, user_message_count, created_at, last_message_at`;
const MESSAGE_COLUMNS = `id, thread_id, user_id, seq, role, blocks, display_text, display_extras, client_message_id, ai_generated, effective_model, stop_reason, truncated, created_at`;

/** DDL sur une ligne, comme celui de 0007 (le schéma figé en garde le texte). */
const oneLine = (ddl: string): string =>
  ddl
    .replace(/\(\n\s*/, '(')
    .replace(/,\n\s*/g, ', ')
    .replace(/\n\)/, ')');

const CREATE_THREAD = oneLine(`CREATE TABLE coach_thread (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('adult','minor')),
  persona TEXT NOT NULL CHECK (persona IN ('ombre','skald','scribe')),
  model TEXT NOT NULL,
  effort TEXT NOT NULL CHECK (effort IN ('low','medium','high')),
  prompt_version TEXT NOT NULL,
  tools_version TEXT NOT NULL,
  brief_schema TEXT NOT NULL,
  brief TEXT CHECK (json_valid(brief)),
  slot_aliases TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(slot_aliases)),
  is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0,1)),
  closed_reason TEXT CHECK (closed_reason IN ('version_change','health_withdrawn','day_over','persona_change')),
  user_message_count INTEGER NOT NULL DEFAULT 0 CHECK (user_message_count >= 0),
  created_at TEXT NOT NULL,
  last_message_at TEXT
) STRICT`);

const CREATE_MESSAGE = oneLine(`CREATE TABLE coach_message (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES coach_thread(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  blocks TEXT CHECK (json_valid(blocks)),
  display_text TEXT,
  display_extras TEXT CHECK (json_valid(display_extras)),
  client_message_id TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0 CHECK (ai_generated IN (0,1)),
  effective_model TEXT,
  stop_reason TEXT,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE (thread_id, seq),
  UNIQUE (thread_id, client_message_id)
) STRICT`);

const STATEMENTS = [
  `CREATE TABLE coach_message_save AS SELECT ${MESSAGE_COLUMNS} FROM coach_message`,
  'DROP TABLE coach_message',
  `CREATE TABLE coach_thread_new AS SELECT ${THREAD_COLUMNS} FROM coach_thread`,
  'DROP TABLE coach_thread',
  CREATE_THREAD,
  `INSERT INTO coach_thread (${THREAD_COLUMNS}) SELECT ${THREAD_COLUMNS} FROM coach_thread_new`,
  'DROP TABLE coach_thread_new',
  CREATE_MESSAGE,
  `INSERT INTO coach_message (${MESSAGE_COLUMNS}) SELECT ${MESSAGE_COLUMNS} FROM coach_message_save`,
  'DROP TABLE coach_message_save',
  'CREATE INDEX coach_thread_last_message_idx ON coach_thread (last_message_at)',
  'CREATE INDEX coach_thread_created_idx ON coach_thread (created_at)',
  'CREATE UNIQUE INDEX coach_thread_open_day_idx ON coach_thread (user_id, day) WHERE is_open = 1',
];

export const coachThreadsPerDay: Migration = {
  id: '0008_coach_threads_per_day',
  breaking: false,
  up: async (db) => {
    for (const ddl of STATEMENTS) await sql.raw(ddl).execute(db);
  },
};
