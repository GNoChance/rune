import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { MIGRATIONS } from '../../src/db/migrations/index';
import { openDatabase } from '../../src/db/open';
import { FakeClock, insertFixtureRow } from '../support';

// Migration 0006 : répétitions visées par série, copiées au démarrage de la séance (ruling R57).

describe('migration 0006_performed_set_target_reps', () => {
  let h: ReturnType<typeof openDatabase>;
  beforeEach(() => {
    h = openDatabase(':memory:');
  });
  afterEach(() => h.sqlite.close());

  const rows = () => h.sqlite.prepare('SELECT * FROM performed_set ORDER BY rowid').all();

  it('ajoute target_reps, nulle pour les séries existantes, sans toucher aux autres colonnes', async () => {
    const clock = new FakeClock();
    await migrate(
      h.db,
      MIGRATIONS.filter((m) => m.id < '0006'),
      clock,
    );
    const set = await insertFixtureRow(h.db, 'performed_set', { targetRepsMin: 8, targetRepsMax: 12 });
    const before = rows();
    expect(before).toHaveLength(1);

    expect(await migrate(h.db, MIGRATIONS, clock)).toEqual({
      applied: ['0006_performed_set_target_reps', '0007_coach', '0008_coach_threads_per_day'],
      unknownNonBreaking: [],
    });
    expect(rows()).toEqual(before.map((r) => ({ ...r, target_reps: null })));
    h.sqlite.prepare('UPDATE performed_set SET target_reps = 10 WHERE id = ?').run(String(set.id));
    expect(h.sqlite.prepare('SELECT target_reps FROM performed_set').all()).toEqual([{ target_reps: 10 }]);
    expect(h.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
