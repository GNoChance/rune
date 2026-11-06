import { entityRules } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { MIGRATIONS } from '../../src/db/migrations/index';
import { openDatabase } from '../../src/db/open';
import { createTestContext, FakeClock, insertFixtureRow, type TestContext } from '../support';

// Spec brique 3 §5.1 et §5.2 : les 7 tables des programmes et des séances.

const PROGRAM_TABLES = [
  'program_instance',
  'instance_change',
  'slot_state',
  'engine_decision',
  'workout_session',
  'performed_exercise',
  'performed_set',
] as const;
const NOW = '2026-11-01T10:00:00.000Z';
const U1 = '01900000-0000-7000-8000-000000000001';
const U2 = '01900000-0000-7000-8000-000000000002';

let ctx: TestContext | undefined;
afterEach(() => {
  ctx?.close();
  ctx = undefined;
});

type Sqlite = TestContext['deps']['sqlite'];
const tableNames = (sqlite: Sqlite) =>
  (
    sqlite
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map((r) => r.name);
const count = (sqlite: Sqlite, table: string) =>
  (sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;

async function setup(): Promise<TestContext> {
  ctx = await createTestContext();
  const { sqlite } = ctx.deps;
  for (const [id, name] of [
    [U1, 'u1'],
    [U2, 'u2'],
  ] as const)
    sqlite
      .prepare(
        "INSERT INTO user (id, username, username_key, password_hash, role, status, birth_date, terms_version, terms_accepted_at, rev, created_at, updated_at) VALUES (?, ?, ?, 'h', 'member', 'active', '1990-01-01', '1', ?, 1, ?, ?)",
      )
      .run(id, name, name, NOW, NOW, NOW);
  return ctx;
}

const instanceSql = (
  id: string,
  owner: string,
  status: string,
  o: { deletedAt?: string; days?: number; snapshot?: string } = {},
) =>
  `INSERT INTO program_instance (id, owner_id, rev, created_at, updated_at, deleted_at, template_id, template_version, snapshot, days_per_week, status, started_at)
   VALUES ('${id}', '${owner}', 1, '${NOW}', '${NOW}', ${o.deletedAt ? `'${o.deletedAt}'` : 'NULL'}, 'tpl', 1, '${o.snapshot ?? '{}'}', ${o.days ?? 3}, '${status}', '${NOW}')`;

describe('migration 0004_program', () => {
  it("suit 0003_catalog et n'est pas cassante", () => {
    expect(MIGRATIONS.map((m) => ({ id: m.id, breaking: m.breaking }))).toEqual([
      { id: '0001_socle', breaking: false },
      { id: '0002_coach', breaking: false },
      { id: '0003_catalog', breaking: false },
      { id: '0004_program', breaking: false },
      { id: '0005_sync_rejection_codes', breaking: false },
      { id: '0006_performed_set_target_reps', breaking: false },
      { id: '0007_coach', breaking: false },
      { id: '0008_coach_threads_per_day', breaking: false },
      { id: '0009_nutrition', breaking: false },
    ]);
  });

  it('crée les 7 tables STRICT, avec index (rev) et (owner_id, rev)', async () => {
    const { deps } = await setup();
    const names = tableNames(deps.sqlite);
    for (const t of PROGRAM_TABLES) {
      expect(names, t).toContain(t);
      const sql = (
        deps.sqlite.prepare('SELECT sql FROM sqlite_schema WHERE name = ?').get(t) as { sql: string }
      ).sql;
      expect(sql, t).toMatch(/\) STRICT$/);
      const idx = (
        deps.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = ?").all(t) as {
          sql: string | null;
        }[]
      ).map((r) => r.sql ?? '');
      expect(
        idx.some((s) => s.includes(`ON ${t} (rev)`)),
        `${t} (rev)`,
      ).toBe(true);
      expect(
        idx.some((s) => s.includes(`ON ${t} (owner_id, rev)`)),
        `${t} (owner_id, rev)`,
      ).toBe(true);
    }
  });

  it('migre une base 0001 + 0002 + 0003 avec des lignes sans perte, les tables du socle restent identiques', async () => {
    const h = openDatabase(':memory:');
    try {
      const clock = new FakeClock();
      await migrate(
        h.db,
        MIGRATIONS.filter((m) => m.id <= '0003_catalog'),
        clock,
      );
      const before = tableNames(h.sqlite).filter((t) => t !== 'schema_migrations');
      for (const table of before.filter((t) => t === 'user' || t === 'place'))
        await insertFixtureRow(h.db, table);
      const snapshot = Object.fromEntries(
        before.map((t) => [t, h.sqlite.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()]),
      );
      expect(await migrate(h.db, MIGRATIONS, clock)).toEqual({
        applied: [
          '0004_program',
          '0005_sync_rejection_codes',
          '0006_performed_set_target_reps',
          '0007_coach',
          '0008_coach_threads_per_day',
          '0009_nutrition',
        ],
        unknownNonBreaking: [],
      });
      for (const t of before)
        expect(h.sqlite.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all(), t).toEqual(snapshot[t]);
      for (const t of PROGRAM_TABLES) expect(count(h.sqlite, t), t).toBe(0);
      expect(h.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      h.sqlite.close();
    }
  });

  describe('program_instance', () => {
    it('refuse deux instances actives du même propriétaire, admet une terminée, une supprimée ou un autre propriétaire', async () => {
      const { deps } = await setup();
      const run = (sql: string) => deps.sqlite.exec(sql);
      run(instanceSql('i1', U1, 'active'));
      expect(() => run(instanceSql('i2', U1, 'active'))).toThrow(/UNIQUE/);
      run(instanceSql('i3', U1, 'ended'));
      run(instanceSql('i4', U1, 'active', { deletedAt: NOW }));
      run(instanceSql('i5', U2, 'active'));
      // Terminer la première libère la place.
      deps.sqlite.prepare("UPDATE program_instance SET status = 'ended' WHERE id = 'i1'").run();
      run(instanceSql('i6', U1, 'active'));
      expect(count(deps.sqlite, 'program_instance')).toBe(5);
    });

    it('days_per_week 2 à 4, statut et snapshot JSON gardés, revision à 0 par défaut', async () => {
      const { deps } = await setup();
      const bad = (sql: string) => expect(() => deps.sqlite.exec(sql)).toThrow(/CHECK/);
      bad(instanceSql('i1', U1, 'active', { days: 5 }));
      bad(instanceSql('i1', U1, 'active', { days: 1 }));
      bad(instanceSql('i1', U1, 'paused'));
      bad(instanceSql('i1', U1, 'active', { snapshot: 'pas du json' }));
      deps.sqlite.exec(instanceSql('i1', U1, 'active'));
      expect(deps.sqlite.prepare("SELECT revision FROM program_instance WHERE id = 'i1'").get()).toEqual({
        revision: 0,
      });
    });
  });

  describe('instance_change', () => {
    const change = (o: { ops?: string; author?: string; status?: string } = {}) =>
      `INSERT INTO instance_change (id, owner_id, rev, created_at, updated_at, instance_id, base_revision, author, operations, reason_code, status)
       VALUES ('c1', '${U1}', 1, '${NOW}', '${NOW}', 'i1', 0, '${o.author ?? 'user'}', '${o.ops ?? '[{"type":"start_deload"}]'}', 'USER_CHANGE', '${o.status ?? 'proposed'}')`;

    it('1 à 5 opérations, auteur et statut gardés, ai_generated à 0 par défaut', async () => {
      const { deps } = await setup();
      deps.sqlite.exec(instanceSql('i1', U1, 'active'));
      const bad = (sql: string) => expect(() => deps.sqlite.exec(sql)).toThrow(/CHECK/);
      bad(change({ ops: '[]' }));
      bad(change({ ops: '[1,2,3,4,5,6]' }));
      bad(change({ ops: 'pas du json' }));
      bad(change({ author: 'robot' }));
      bad(change({ status: 'maybe' }));
      deps.sqlite.exec(change({ ops: '[1,2,3,4,5]', author: 'coach' }));
      expect(deps.sqlite.prepare("SELECT ai_generated FROM instance_change WHERE id = 'c1'").get()).toEqual({
        ai_generated: 0,
      });
    });
  });

  describe('performed_set', () => {
    it("refuse reps et duration_s ensemble ; admet l'un, l'autre ou aucun ; logged_at facultatif", async () => {
      const { deps } = await setup();
      const pe = await insertFixtureRow(deps.db, 'performed_exercise', { ownerId: U1 });
      const set = (id: string, reps: string, dur: string) =>
        `INSERT INTO performed_set (id, owner_id, rev, created_at, updated_at, performed_exercise_id, position, kind, load_mode, reps, duration_s)
         VALUES ('${id}', '${U1}', 1, '${NOW}', '${NOW}', '${pe.id}', 1, 'work', 'barbell', ${reps}, ${dur})`;
      expect(() => deps.sqlite.exec(set('s1', '8', '30'))).toThrow(/CHECK/);
      deps.sqlite.exec(set('s2', '8', 'NULL'));
      deps.sqlite.exec(set('s3', 'NULL', '30'));
      deps.sqlite.exec(set('s4', 'NULL', 'NULL'));
      expect(deps.sqlite.prepare("SELECT logged_at FROM performed_set WHERE id = 's2'").get()).toEqual({
        logged_at: null,
      });
    });

    it("garde les bornes d'une série (charge, répétitions, durée, position)", async () => {
      const { deps } = await setup();
      const pe = await insertFixtureRow(deps.db, 'performed_exercise', { ownerId: U1 });
      const set = (col: string, v: number, position = 1) =>
        `INSERT INTO performed_set (id, owner_id, rev, created_at, updated_at, performed_exercise_id, position, kind, load_mode, ${col})
         VALUES ('s${col}${v}${position}', '${U1}', 1, '${NOW}', '${NOW}', '${pe.id}', ${position}, 'work', 'barbell', ${v})`;
      for (const [col, ok, ko] of [
        ['load_g', 500_000, 500_001],
        ['reps', 200, 201],
        ['duration_s', 7200, 7201],
      ] as const) {
        deps.sqlite.exec(set(col, ok));
        expect(() => deps.sqlite.exec(set(col, ko)), col).toThrow(/CHECK/);
        expect(() => deps.sqlite.exec(set(col, -1)), col).toThrow(/CHECK/);
      }
      expect(() => deps.sqlite.exec(set('load_g', 1, 0))).toThrow(/CHECK/);
      expect(() => deps.sqlite.exec(set('load_g', 1, 100))).toThrow(/CHECK/);
    });
  });

  describe('workout_session', () => {
    const session = (profile: string | null, extra = '') =>
      `INSERT INTO workout_session (id, owner_id, rev, created_at, updated_at, device_id, started_at, status, week_type, rules_version, app_version, profile ${extra ? ', instance_id, place_id' : ''})
       VALUES ('w-${profile}', '${U1}', 1, '${NOW}', '${NOW}', 'd1', '${NOW}', 'in_progress', 'normal', '1', '0.3.0', ${profile === null ? 'NULL' : `'${profile}'`} ${extra})`;

    it('profile NOT NULL, adult ou cautious', async () => {
      const { deps } = await setup();
      expect(() => deps.sqlite.exec(session(null))).toThrow(/NOT NULL/);
      expect(() => deps.sqlite.exec(session('teen'))).toThrow(/CHECK/);
      deps.sqlite.exec(session('adult'));
      deps.sqlite.exec(session('cautious'));
    });

    it('admet un instance_id et un place_id inconnus (pas de clé étrangère, restauration R-SYN-26)', async () => {
      const { deps } = await setup();
      deps.sqlite.exec(session('adult', ", 'instance-disparue', 'lieu-disparu'"));
      expect(deps.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    });
  });

  it("n'a de clé étrangère ni sur workout_session.instance_id et place_id, ni sur slot_state.exercise_id", async () => {
    const { deps } = await setup();
    const fks = (t: string) =>
      (
        deps.sqlite
          .prepare('SELECT "from" AS col, "table" AS target FROM pragma_foreign_key_list(?)')
          .all(t) as {
          col: string;
          target: string;
        }[]
      ).map((f) => `${f.col}>${f.target}`);
    expect(fks('workout_session').sort()).toEqual(['owner_id>user', 'updated_by>user']);
    expect(fks('slot_state')).toEqual(expect.arrayContaining(['instance_id>program_instance']));
    expect(fks('slot_state').some((f) => f.startsWith('exercise_id'))).toBe(false);
  });

  it("slot_state : l'identifiant est instance:slot:exercice, sans plafond de longueur sur slot_id", async () => {
    const { deps } = await setup();
    const inst = await insertFixtureRow(deps.db, 'program_instance', { ownerId: U1 });
    const slotId = `push-day-0192f0a1-7b3c-7d4e-8a5f-0123456789ab-0192f0a1-7b3c-7d4e-8a5f-0123456789ab`;
    expect(slotId.length).toBeGreaterThan(80);
    const row = await insertFixtureRow(deps.db, 'slot_state', {
      ownerId: U1,
      instanceId: inst.id,
      slotId,
      exerciseId: 'chain-squat',
      id: `${inst.id}:${slotId}:chain-squat`,
    });
    expect(row.slotId).toBe(slotId);
    expect(() =>
      deps.sqlite.prepare("UPDATE slot_state SET id = 'autre' WHERE id = ?").run(row.id as string),
    ).toThrow(/CHECK/);
  });

  it("la suppression d'un compte efface toute ligne des 7 tables", async () => {
    const c = await setup();
    const { db, sqlite } = c.deps;
    for (const owner of [U1, U2]) {
      for (const t of PROGRAM_TABLES) await insertFixtureRow(db, t, { ownerId: owner });
    }
    const owned = (t: string, owner: string) =>
      (sqlite.prepare(`SELECT count(*) AS n FROM "${t}" WHERE owner_id = ?`).get(owner) as { n: number }).n;
    const others = Object.fromEntries(PROGRAM_TABLES.map((t) => [t, owned(t, U2)]));
    for (const t of PROGRAM_TABLES) {
      expect(owned(t, U1), t).toBeGreaterThan(0);
      expect(others[t], t).toBeGreaterThan(0);
    }
    sqlite.prepare('DELETE FROM user WHERE id = ?').run(U1);
    for (const t of PROGRAM_TABLES) {
      expect(owned(t, U1), t).toBe(0);
      expect(owned(t, U2), t).toBe(others[t]);
    }
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('le registre déclare les 7 tables : cascade, exportées, classes E, D et J', () => {
    for (const t of PROGRAM_TABLES) {
      expect(entityRules[t]?.onUserDelete, t).toBe('cascade');
      expect(entityRules[t]?.exported, t).toBe(true);
    }
  });
});
