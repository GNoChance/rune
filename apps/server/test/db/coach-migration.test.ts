import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { MIGRATIONS } from '../../src/db/migrations/index';
import { openDatabase } from '../../src/db/open';
import { createTestContext, FakeClock, insertFixtureRow, type TestContext } from '../support';

// Spec brique 4 §6.1 : les 6 tables du coach, classe H, créées par 0007_coach.

const COACH_TABLES = [
  'coach_thread',
  'coach_message',
  'coach_call',
  'coach_report',
  'coach_safety_counter',
  'coach_state',
] as const;
const PERSONAL = ['coach_thread', 'coach_message', 'coach_call', 'coach_report'] as const;

let ctx: TestContext | undefined;
afterEach(() => {
  ctx?.close();
  ctx = undefined;
});

type Sqlite = TestContext['deps']['sqlite'];
const count = (sqlite: Sqlite, table: string) =>
  (sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;
const bad = (sqlite: Sqlite, sql: string) => expect(() => sqlite.exec(sql), sql).toThrow(/constraint/i);

describe('migration 0007_coach', () => {
  it("suit 0006 et n'est pas cassante", () => {
    expect(MIGRATIONS.at(-1)).toMatchObject({ id: '0007_coach', breaking: false });
  });

  it('crée les 6 tables STRICT et la ligne unique de coach_state, coach désactivé', async () => {
    ctx = await createTestContext();
    const { sqlite } = ctx.deps;
    for (const t of COACH_TABLES) {
      const row = sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(t) as
        | { sql: string }
        | undefined;
      expect(row?.sql, t).toMatch(/\) STRICT$/);
    }
    expect(sqlite.prepare('SELECT id, enabled, suspended_until FROM coach_state').all()).toEqual([
      { id: 1, enabled: 0, suspended_until: null },
    ]);
    const stamp = (sqlite.prepare('SELECT updated_at AS t FROM coach_state').get() as { t: string }).t;
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    bad(sqlite, "INSERT INTO coach_state (id, enabled, updated_at) VALUES (2, 0, 'x')");
  });

  it('migre sans perte une base au schéma de la brique 3', async () => {
    const h = openDatabase(':memory:');
    try {
      const clock = new FakeClock();
      await migrate(
        h.db,
        MIGRATIONS.filter((m) => m.id < '0007'),
        clock,
      );
      h.sqlite.exec(
        "INSERT INTO user (id, username, username_key, password_hash, role, status, birth_date, terms_version, terms_accepted_at, rev, created_at, updated_at) VALUES ('u1', 'u1', 'u1', 'h', 'member', 'active', '1990-01-01', '1', 'x', 1, 'x', 'x')",
      );
      const before = count(h.sqlite, 'user');
      const result = await migrate(h.db, MIGRATIONS, clock);
      expect(result.applied).toEqual(['0007_coach']);
      expect(count(h.sqlite, 'user')).toBe(before);
      expect(count(h.sqlite, 'coach_state')).toBe(1);
    } finally {
      h.sqlite.close();
    }
  });

  it('un seul fil par (user_id, day), un seul message par (thread_id, seq) et par client_message_id', async () => {
    ctx = await createTestContext();
    const { db, sqlite } = ctx.deps;
    const user = await insertFixtureRow(db, 'user');
    const thread = await insertFixtureRow(db, 'coach_thread', { userId: user.id, day: '2026-11-03' });
    await expect(
      insertFixtureRow(db, 'coach_thread', { userId: user.id, day: '2026-11-03' }),
    ).rejects.toThrow(/UNIQUE/i);
    await insertFixtureRow(db, 'coach_thread', { userId: user.id, day: '2026-11-04' });

    await insertFixtureRow(db, 'coach_message', {
      threadId: thread.id,
      userId: user.id,
      seq: 1,
      clientMessageId: 'c1',
    });
    await expect(
      insertFixtureRow(db, 'coach_message', { threadId: thread.id, userId: user.id, seq: 1 }),
    ).rejects.toThrow(/UNIQUE/i);
    await expect(
      insertFixtureRow(db, 'coach_message', {
        threadId: thread.id,
        userId: user.id,
        seq: 2,
        clientMessageId: 'c1',
      }),
    ).rejects.toThrow(/UNIQUE/i);
    // Sans client_message_id (NULL), plusieurs messages cohabitent.
    await insertFixtureRow(db, 'coach_message', { threadId: thread.id, userId: user.id, seq: 2 });
    await insertFixtureRow(db, 'coach_message', { threadId: thread.id, userId: user.id, seq: 3 });
    expect(count(sqlite, 'coach_message')).toBe(3);
  });

  it('refuse les valeurs hors énumération, le JSON invalide et un commentaire trop long', async () => {
    ctx = await createTestContext();
    const { db, sqlite } = ctx.deps;
    const user = await insertFixtureRow(db, 'user');
    const thread = await insertFixtureRow(db, 'coach_thread', { userId: user.id });
    const t = `'${thread.id}'`;
    const u = `'${user.id}'`;
    bad(sqlite, `UPDATE coach_thread SET closed_reason = 'other' WHERE id = ${t}`);
    bad(sqlite, `UPDATE coach_thread SET audience = 'senior' WHERE id = ${t}`);
    bad(sqlite, `UPDATE coach_thread SET persona = 'x' WHERE id = ${t}`);
    bad(sqlite, `UPDATE coach_thread SET effort = 'max' WHERE id = ${t}`);
    bad(sqlite, `UPDATE coach_thread SET brief = '{' WHERE id = ${t}`);
    bad(sqlite, `UPDATE coach_thread SET slot_aliases = '{' WHERE id = ${t}`);
    sqlite.exec(`UPDATE coach_thread SET closed_reason = 'day_over', brief = NULL WHERE id = ${t}`);
    const msg = (cols: string, vals: string) =>
      `INSERT INTO coach_message (id, thread_id, user_id, seq, ${cols}, created_at) VALUES ('m', ${t}, ${u}, 9, ${vals}, 'x')`;
    bad(sqlite, msg('role', "'tool'"));
    bad(sqlite, msg('role, blocks', "'user', '['"));
    bad(sqlite, msg('role, display_extras', "'user', '{'"));
    sqlite.exec(msg('role, blocks', "'system', '[]'"));
    const report = (category: string, comment: string) =>
      `INSERT INTO coach_report (id, user_id, message_seq, category, comment, exchange_text, created_at) VALUES ('r', ${u}, 1, '${category}', '${comment}', 'x', 'x')`;
    bad(sqlite, report('spam', 'ok'));
    bad(sqlite, report('other', 'a'.repeat(501)));
    sqlite.exec(report('other', 'a'.repeat(500)));
    bad(sqlite, "INSERT INTO coach_safety_counter (month, kind, count) VALUES ('2026-11', 'other', 1)");
    sqlite.exec("INSERT INTO coach_safety_counter (month, kind, count) VALUES ('2026-11', 'refusal', 1)");
    bad(sqlite, "INSERT INTO coach_safety_counter (month, kind, count) VALUES ('2026-11', 'refusal', 2)");
  });

  it('supprimer un user efface ses 4 tables personnelles, pas coach_safety_counter ni coach_state', async () => {
    ctx = await createTestContext();
    const { db, sqlite } = ctx.deps;
    const user = await insertFixtureRow(db, 'user');
    const other = await insertFixtureRow(db, 'user');
    for (const owner of [user, other]) {
      const thread = await insertFixtureRow(db, 'coach_thread', { userId: owner.id });
      await insertFixtureRow(db, 'coach_message', { threadId: thread.id, userId: owner.id });
      await insertFixtureRow(db, 'coach_call', { userId: owner.id, threadId: thread.id });
      await insertFixtureRow(db, 'coach_report', { userId: owner.id, threadId: thread.id });
    }
    await insertFixtureRow(db, 'coach_safety_counter');
    sqlite.prepare('DELETE FROM user WHERE id = ?').run(String(user.id));
    for (const t of PERSONAL) {
      expect(count(sqlite, t), t).toBe(1);
      expect(
        sqlite.prepare(`SELECT count(*) AS n FROM ${t} WHERE user_id = ?`).get(String(user.id)),
        t,
      ).toEqual({
        n: 0,
      });
    }
    expect(count(sqlite, 'coach_safety_counter')).toBe(1);
    expect(count(sqlite, 'coach_state')).toBe(1);
  });

  it("supprimer un fil emporte ses messages ; coach_call et coach_report n'ont pas de clé vers le fil", async () => {
    ctx = await createTestContext();
    const { db, sqlite } = ctx.deps;
    const user = await insertFixtureRow(db, 'user');
    const thread = await insertFixtureRow(db, 'coach_thread', { userId: user.id });
    await insertFixtureRow(db, 'coach_message', { threadId: thread.id, userId: user.id });
    await insertFixtureRow(db, 'coach_call', { userId: user.id, threadId: thread.id });
    sqlite.prepare('DELETE FROM coach_thread WHERE id = ?').run(String(thread.id));
    expect(count(sqlite, 'coach_message')).toBe(0);
    expect(count(sqlite, 'coach_call')).toBe(1);
    for (const t of ['coach_call', 'coach_report']) {
      expect(
        sqlite.prepare('SELECT * FROM pragma_foreign_key_list(?) WHERE "from" = ?').all(t, 'thread_id'),
        t,
      ).toEqual([]);
    }
  });
});
