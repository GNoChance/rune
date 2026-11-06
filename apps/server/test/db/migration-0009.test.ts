import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { MIGRATIONS } from '../../src/db/migrations/index';
import { openDatabase } from '../../src/db/open';
import { createTestContext, FakeClock, insertFixtureRow, type TestContext } from '../support';

// Spec brique 5 §6.1 : les 6 tables de la nutrition et la reconstruction de coach_thread (0009_nutrition).

let ctx: TestContext | undefined;
afterEach(() => {
  ctx?.close();
  ctx = undefined;
});

const NUTRITION_TABLES = [
  'nutrition_profile',
  'weigh_in',
  'nutrition_target',
  'nutrition_checkin',
  'advice_sheet',
  'nutrition_state',
] as const;

describe('migration 0009_nutrition', () => {
  it("suit 0008 et n'est pas cassante", () => {
    expect(MIGRATIONS.at(-1)).toMatchObject({ id: '0009_nutrition', breaking: false });
  });

  it('crée les 6 tables STRICT et la ligne unique de nutrition_state, mode complet fermé', async () => {
    ctx = await createTestContext();
    const { sqlite } = ctx.deps;
    for (const t of NUTRITION_TABLES) {
      const row = sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(t) as
        | { sql: string }
        | undefined;
      expect(row?.sql, t).toMatch(/\) STRICT$/);
    }
    expect(sqlite.prepare('SELECT id, full_open, updated_by FROM nutrition_state').all()).toEqual([
      { id: 1, full_open: 0, updated_by: null },
    ]);
    expect(() =>
      sqlite.exec("INSERT INTO nutrition_state (id, full_open, updated_at) VALUES (2, 0, 'x')"),
    ).toThrow(/constraint/i);
  });

  it('refuse les valeurs hors domaine du profil', async () => {
    ctx = await createTestContext();
    const { db } = ctx.deps;
    const user = await insertFixtureRow(db, 'user');
    const base = { ownerId: user.id };
    expect(await insertFixtureRow(db, 'nutrition_profile', base)).toMatchObject({
      mode: 'disabled',
      cumulativeAdjustmentKcal: 0,
      safetyPause: 0,
    });
    const bad = async (over: Record<string, unknown>) => {
      const other = await insertFixtureRow(db, 'user');
      await expect(insertFixtureRow(db, 'nutrition_profile', { ownerId: other.id, ...over })).rejects.toThrow(
        /constraint/i,
      );
    };
    await bad({ mode: 'partial' });
    await bad({ modeReason: 'other' });
    await bad({ cumulativeAdjustmentKcal: 50 });
    await bad({ activityLevel: 5 });
    await bad({ activityLevel: 0 });
    await bad({ heightCm: 119 });
    await bad({ heightCm: 221 });
    await bad({ goal: 'bulk' });
    await bad({ sexForCalc: 'x' });
    await bad({ safetyPause: 2 });
    const ok = await insertFixtureRow(db, 'nutrition_profile', {
      ownerId: (await insertFixtureRow(db, 'user')).id,
      mode: 'full',
      modeReason: 'safety',
      cumulativeAdjustmentKcal: -300,
      activityLevel: 4,
      heightCm: 220,
    });
    expect(ok).toMatchObject({ mode: 'full', activityLevel: 4, cumulativeAdjustmentKcal: -300 });
    await expect(
      insertFixtureRow(db, 'nutrition_profile', { ownerId: user.id, id: 'autre-id' }),
    ).rejects.toThrow(/constraint/i);
  });

  it('pesée : poids entre 30 000 et 250 000 g par pas de 100, une seule vivante par jour', async () => {
    ctx = await createTestContext();
    const { db, sqlite } = ctx.deps;
    const user = await insertFixtureRow(db, 'user');
    const w = (over: Record<string, unknown>) =>
      insertFixtureRow(db, 'weigh_in', { ownerId: user.id, date: '2026-11-02', ...over });
    for (const weightG of [29_900, 72_550, 250_100, 30_050])
      await expect(w({ weightG, date: `2026-11-1${weightG % 7}` }), String(weightG)).rejects.toThrow(
        /constraint/i,
      );
    await w({ weightG: 30_000, date: '2026-10-30' });
    await w({ weightG: 250_000, date: '2026-10-31' });
    const first = await w({ weightG: 72_500 });
    await expect(w({ weightG: 72_600 })).rejects.toThrow(/UNIQUE/i);
    // Une pesée supprimée et une vivante au même jour coexistent.
    sqlite.exec(`UPDATE weigh_in SET deleted_at = '2026-11-02T10:00:00.000Z' WHERE id = '${first.id}'`);
    await w({ weightG: 72_600 });
    // Un autre propriétaire peut peser le même jour.
    await insertFixtureRow(db, 'weigh_in', { date: '2026-11-02', weightG: 60_000 });
    // Une tombstone sans contenu est permise, une ligne vivante sans contenu non.
    sqlite.exec(
      `INSERT INTO weigh_in (id, owner_id, rev, created_at, updated_at, deleted_at) VALUES ('t1', '${String(user.id)}', 1, 'x', 'x', 'x')`,
    );
    expect(() =>
      sqlite.exec(
        `INSERT INTO weigh_in (id, owner_id, rev, created_at, updated_at) VALUES ('t2', '${String(user.id)}', 1, 'x', 'x')`,
      ),
    ).toThrow(/constraint/i);
  });

  it('cible et bilan : énumérations, JSON valide, un seul bilan par semaine', async () => {
    ctx = await createTestContext();
    const { db } = ctx.deps;
    const user = await insertFixtureRow(db, 'user');
    const ownerId = user.id;
    await expect(insertFixtureRow(db, 'nutrition_target', { ownerId, reason: 'x' })).rejects.toThrow(
      /constraint/i,
    );
    await expect(insertFixtureRow(db, 'nutrition_target', { ownerId, inputs: '{' })).rejects.toThrow(
      /constraint/i,
    );
    const target = await insertFixtureRow(db, 'nutrition_target', { ownerId });
    await insertFixtureRow(db, 'nutrition_checkin', { ownerId, weekStart: '2026-11-02' });
    await expect(
      insertFixtureRow(db, 'nutrition_checkin', { ownerId, weekStart: '2026-11-02' }),
    ).rejects.toThrow(/UNIQUE/i);
    await insertFixtureRow(db, 'nutrition_checkin', {
      ownerId,
      weekStart: '2026-11-09',
      decision: 'proposal',
      position: 'above',
      proposedDeltaKcal: -100,
      response: 'accepted',
      createdTargetId: target.id,
    });
    await expect(
      insertFixtureRow(db, 'nutrition_checkin', { ownerId, weekStart: '2026-11-16', proposedDeltaKcal: 50 }),
    ).rejects.toThrow(/constraint/i);
    await expect(
      insertFixtureRow(db, 'nutrition_checkin', { ownerId, weekStart: '2026-11-23', decision: 'maybe' }),
    ).rejects.toThrow(/constraint/i);
    await expect(
      insertFixtureRow(db, 'nutrition_checkin', {
        ownerId,
        weekStart: '2026-11-30',
        createdTargetId: 'nope',
      }),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  it('fiche conseil : énumérations, JSON valide, empreinte obligatoire', async () => {
    ctx = await createTestContext();
    const { db } = ctx.deps;
    await insertFixtureRow(db, 'advice_sheet', { id: 'sleep-basics' });
    await expect(insertFixtureRow(db, 'advice_sheet', { audience: 'kids' })).rejects.toThrow(/constraint/i);
    await expect(insertFixtureRow(db, 'advice_sheet', { status: 'live' })).rejects.toThrow(/constraint/i);
    await expect(insertFixtureRow(db, 'advice_sheet', { visibleModes: 'x' })).rejects.toThrow(/constraint/i);
    await expect(insertFixtureRow(db, 'advice_sheet', { contentHash: null })).rejects.toThrow(/NOT NULL/i);
  });

  it('migre sans perte une base 0008 aux fils ouverts, et accepte nutrition_mode_change', async () => {
    const h = openDatabase(':memory:');
    try {
      const clock = new FakeClock();
      await migrate(
        h.db,
        MIGRATIONS.filter((m) => m.id < '0009'),
        clock,
      );
      h.sqlite.exec(
        "INSERT INTO user (id, username, username_key, password_hash, role, status, birth_date, terms_version, terms_accepted_at, rev, created_at, updated_at) VALUES ('u1', 'u1', 'u1', 'h', 'member', 'active', '1990-01-01', '1', 'x', 1, 'x', 'x')",
      );
      const thread = (id: string, day: string, open: number, reason: string | null) =>
        `INSERT INTO coach_thread (id, user_id, day, audience, persona, model, effort, prompt_version, tools_version, brief_schema, brief, slot_aliases, is_open, closed_reason, user_message_count, created_at, last_message_at) VALUES ('${id}', 'u1', '${day}', 'adult', 'skald', 'm', 'low', 'coach-1/adult', 'tools-1', 'coach-brief/1', '{"a":1}', '{"s":"A9"}', ${open}, ${reason === null ? 'NULL' : `'${reason}'`}, 1, '${day}T10:00:00.000Z', '${day}T10:05:00.000Z')`;
      h.sqlite.exec(thread('t1', '2026-11-03', 0, 'day_over'));
      h.sqlite.exec(thread('t2', '2026-11-04', 1, null));
      h.sqlite.exec(thread('t3', '2026-11-05', 1, null));
      h.sqlite.exec(
        "INSERT INTO coach_message (id, thread_id, user_id, seq, role, display_text, client_message_id, created_at) VALUES ('m1', 't1', 'u1', 1, 'user', 'Salut', 'c1', 'x'), ('m2', 't2', 'u1', 1, 'assistant', 'Hello', NULL, 'x')",
      );
      const dump = (table: string) => h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
      const threads = dump('coach_thread');
      const messages = dump('coach_message');
      expect(() =>
        h.sqlite.exec("UPDATE coach_thread SET closed_reason = 'nutrition_mode_change' WHERE id = 't2'"),
      ).toThrow(/constraint/i);

      const result = await migrate(h.db, MIGRATIONS, clock);
      expect(result.applied).toEqual(['0009_nutrition']);
      expect(dump('coach_thread')).toEqual(threads);
      expect(dump('coach_message')).toEqual(messages);
      expect(h.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(
        h.sqlite
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'coach_thread' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all(),
      ).toEqual([
        { name: 'coach_thread_created_idx' },
        { name: 'coach_thread_last_message_idx' },
        { name: 'coach_thread_open_day_idx' },
      ]);

      h.sqlite.exec(
        "UPDATE coach_thread SET is_open = 0, closed_reason = 'nutrition_mode_change' WHERE id = 't2'",
      );
      expect(() => h.sqlite.exec("UPDATE coach_thread SET closed_reason = 'autre' WHERE id = 't3'")).toThrow(
        /constraint/i,
      );
      // Un seul fil ouvert par jour, la cascade des messages tient toujours.
      h.sqlite.exec(thread('t4', '2026-11-04', 1, null));
      expect(() => h.sqlite.exec(thread('t5', '2026-11-04', 1, null))).toThrow(/UNIQUE/i);
      h.sqlite.exec("DELETE FROM coach_thread WHERE id = 't1'");
      expect(h.sqlite.prepare('SELECT id FROM coach_message').all()).toEqual([{ id: 'm2' }]);
    } finally {
      h.sqlite.close();
    }
  });
});
