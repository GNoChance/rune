# Task 4b report

Implemented: migration `0001_socle` (17 tables + schema_migrations = 18 STRICT tables, 28 indexes, DDL verbatim), `MIGRATIONS=[socle]`, full `schema.ts` (17 interfaces + Database), snapshot `test/__snapshots__/schema.sql`, frozen fixture `test/fixtures/schema-v1.sql` (copy of snapshot), tests `schema.test.ts` (snapshot, 18 STRICT, all constraint cases, cascades/SET NULL, foreign_key_check) and `upgrade.test.ts`. migrate/rev tests now run on MIGRATIONS; test-only `m1.ts` removed (server_meta defined once, in 0001_socle).

Note: the "18 tables" count includes `schema_migrations` (created by `migrate`); the brief's table lists 17.

RED: `pnpm test db/` with empty MIGRATIONS: 13 failures (no such table: server_meta, snapshot/upgrade ENOENT, applied: [] instead of ['0001_socle']).
GREEN: first run generated snapshot; 18-count assertion fixed (schema_migrations included in the 18); fixture copied; `pnpm test db/` -> Test Files 5 passed. Full: lint, typecheck clean; `pnpm test` 14 files passed, 85 tests passed, 2 skipped.
Self-review: DDL built via small helpers (sync/bool/table) to avoid repetition; no concerns.

## Fix round 1
- consent_event columns reordered to the brief (owner_id, type, action, text_version, rev, created_at, updated_at, updated_by); snapshot regenerated and schema-v1.sql re-frozen from it (byte-identical). Unused `deleted` param of `sync()` removed.
- migrate.test.ts: non-breaking-unknown test now runs on MIGRATIONS, asserting applied ['0001_socle'] and unknownNonBreaking ['0002_future'].
- schema.test.ts: `bad(q, kind='CHECK')` matches the specific constraint kind; UNIQUE for place p2/p5 and gym duplicate.
- Command: `pnpm lint; pnpm typecheck; pnpm test` -> clean; 14 files passed, 85 tests passed, 2 skipped (db/: 5 files passed; upgrade test failed once against the old fixture until it was re-frozen, as expected).
