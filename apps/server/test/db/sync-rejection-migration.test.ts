import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { MIGRATIONS } from '../../src/db/migrations/index';
import { openDatabase } from '../../src/db/open';
import { FakeClock, insertFixtureRow } from '../support';

// Migration 0005 : codes de rejet des séances (spec brique 3 §5.3) ajoutés au CHECK de `sync_rejection.code`.

describe('migration 0005_sync_rejection_codes', () => {
  let h: ReturnType<typeof openDatabase>;
  beforeEach(() => {
    h = openDatabase(':memory:');
  });
  afterEach(() => h.sqlite.close());

  const rows = () => h.sqlite.prepare('SELECT * FROM sync_rejection ORDER BY rowid').all();
  const insert = (id: string, owner: string, code: string) =>
    h.sqlite
      .prepare(
        "INSERT INTO sync_rejection (id, owner_id, rev, created_at, updated_at, op_id, entity, row_id, code) VALUES (?, ?, 1, 'x', 'x', 'op', 'workout_session', 'r', ?)",
      )
      .run(id, owner, code);

  it('garde les rejets existants, admet les 4 nouveaux codes et refuse un code inconnu', async () => {
    const clock = new FakeClock();
    await migrate(
      h.db,
      MIGRATIONS.filter((m) => m.id < '0005'),
      clock,
    );
    const owner = (await insertFixtureRow(h.db, 'user')).id as string;
    const before = [
      await insertFixtureRow(h.db, 'sync_rejection', {
        ownerId: owner,
        code: 'validation',
        detailJson: '{}',
      }),
      await insertFixtureRow(h.db, 'sync_rejection', { ownerId: owner, code: 'parent_rejected' }),
    ];
    expect(() => insert('r-early', owner, 'out_of_range')).toThrow('CHECK constraint failed');
    const snapshot = rows();

    expect(await migrate(h.db, MIGRATIONS, clock)).toEqual({
      applied: ['0005_sync_rejection_codes', '0006_performed_set_target_reps'],
      unknownNonBreaking: [],
    });
    expect(rows()).toEqual(snapshot);
    expect(snapshot).toHaveLength(before.length);
    for (const code of ['forbidden_reference', 'invalid_transition', 'unknown_exercise', 'out_of_range']) {
      expect(() => insert(`r-${code}`, owner, code)).not.toThrow();
    }
    expect(() => insert('r-bad', owner, 'consent_missing')).toThrow('CHECK constraint failed');
    expect(h.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const indexes = h.sqlite
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'sync_rejection' AND sql IS NOT NULL ORDER BY name",
      )
      .all();
    expect(indexes).toEqual([{ name: 'sync_rejection_owner_rev_idx' }, { name: 'sync_rejection_rev_idx' }]);
  });
});
