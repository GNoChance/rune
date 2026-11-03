import { entityRules } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { MIGRATIONS } from '../../src/db/migrations/index';
import { openDatabase } from '../../src/db/open';
import { deleteAccount } from '../../src/privacy/delete-account';
import { createTestContext, createUser, FakeClock, insertFixtureRow, type TestContext } from '../support';

// Spec brique 2 §3.1 à §3.5, §3.9 et §6 : tables du catalogue et de la relecture, drapeaux de relecteur.

const CATALOG_TABLES = [
  'exercise',
  'illustration',
  'exercise_comment',
  'exercise_validation',
  'exercise_revision',
];
const NOW = '2026-10-06T10:00:00.000Z';

let ctx: TestContext | undefined;
afterEach(() => {
  ctx?.close();
  ctx = undefined;
});

type Sqlite = ReturnType<typeof openDatabase>['sqlite'];
const rows = (sqlite: Sqlite, table: string) =>
  sqlite.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
const TABLES_SQL = "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'";
const tableNames = (sqlite: Sqlite) =>
  (sqlite.prepare(TABLES_SQL).all() as { name: string }[]).map((r) => r.name);

/** Cellules (hors security_event, journal gardé tel quel) qui contiennent l'identifiant, triées. */
function occurrences(sqlite: Sqlite, id: string): string[] {
  const found: string[] = [];
  for (const table of tableNames(sqlite)) {
    if (table === 'security_event') continue;
    const cols = sqlite.prepare('SELECT name FROM pragma_table_info(?)').all(table) as { name: string }[];
    for (const { name: col } of cols) {
      const hit = sqlite
        .prepare(`SELECT count(*) AS n FROM "${table}" WHERE cast("${col}" AS text) LIKE ?`)
        .get(`%${id}%`) as { n: number };
      if (hit.n > 0) found.push(`${table}.${col}`);
    }
  }
  return found.sort();
}

describe('migration 0003_catalog', () => {
  it("suit 0002_coach et n'est pas cassante", () => {
    expect(MIGRATIONS.slice(0, 3).map((m) => ({ id: m.id, breaking: m.breaking }))).toEqual([
      { id: '0001_socle', breaking: false },
      { id: '0002_coach', breaking: false },
      { id: '0003_catalog', breaking: false },
    ]);
  });

  it('une base 0001 + 0002 avec des lignes migre sans perte ; les comptes gagnent les drapeaux à 0', async () => {
    const h = openDatabase(':memory:');
    try {
      const clock = new FakeClock();
      const upToCoach = MIGRATIONS.filter((m) => m.id <= '0002_coach');
      await migrate(h.db, upToCoach, clock);
      // Une ligne par table du socle (parents compris), plus un admin.
      const socle = tableNames(h.sqlite).filter((t) => t !== 'schema_migrations');
      expect(socle).toHaveLength(17);
      for (const table of socle) await insertFixtureRow(h.db, table);
      await insertFixtureRow(h.db, 'user', { role: 'admin' });
      const before = Object.fromEntries(socle.map((t) => [t, rows(h.sqlite, t)]));
      expect(before.user?.length).toBeGreaterThan(2);

      expect(await migrate(h.db, MIGRATIONS, clock)).toEqual({
        applied: [
          '0003_catalog',
          '0004_program',
          '0005_sync_rejection_codes',
          '0006_performed_set_target_reps',
          '0007_coach',
        ],
        unknownNonBreaking: [],
      });
      for (const table of socle) {
        const expected =
          table === 'user'
            ? (before.user ?? []).map((r) => ({ ...r, catalog_reviewer: 0, health_professional: 0 }))
            : before[table];
        expect(rows(h.sqlite, table), table).toEqual(expected);
      }
      for (const table of CATALOG_TABLES) expect(rows(h.sqlite, table), table).toEqual([]);
      expect(h.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      h.sqlite.close();
    }
  });

  it('les cinq clés vers user des tables du catalogue sont en ON DELETE SET NULL, sans propriétaire', async () => {
    const c = await createTestContext();
    ctx = c;
    const fks = CATALOG_TABLES.flatMap((table) =>
      (
        c.deps.sqlite
          .prepare(`SELECT "from" AS col, on_delete FROM pragma_foreign_key_list(?) WHERE "table" = 'user'`)
          .all(table) as { col: string; on_delete: string }[]
      ).map((fk) => `${table}.${fk.col} ${fk.on_delete}`),
    );
    expect(fks.sort()).toEqual([
      'exercise.reviewed_by SET NULL',
      'exercise_comment.author_id SET NULL',
      'exercise_comment.resolved_by SET NULL',
      'exercise_revision.saved_by SET NULL',
      'exercise_validation.reviewer_id SET NULL',
    ]);
    for (const table of CATALOG_TABLES) expect(entityRules[table]?.ownerColumn, table).toBeNull();
  });

  it('supprimer une relectrice qui a commenté, résolu, validé et enregistré : son id disparaît, ses lignes restent', async () => {
    const c = await createTestContext();
    ctx = c;
    const { db, sqlite } = c.deps;
    await createUser(c, { username: 'porteur', role: 'admin' });
    const lea = await createUser(c, { username: 'lea' });
    await db
      .updateTable('user')
      .set({ catalogReviewer: 1, healthProfessional: 1 })
      .where('id', '=', lea.id)
      .execute();
    const sheet = await insertFixtureRow(db, 'exercise', {
      status: 'reviewed',
      reviewedBy: lea.id,
      reviewedAt: NOW,
    });
    const exerciseId = sheet.id as string;
    const written = await insertFixtureRow(db, 'exercise_comment', { exerciseId, authorId: lea.id });
    const resolved = await insertFixtureRow(db, 'exercise_comment', {
      exerciseId,
      resolvedAt: NOW,
      resolvedBy: lea.id,
    });
    const validation = await insertFixtureRow(db, 'exercise_validation', {
      exerciseId,
      reviewerId: lea.id,
      health: 1,
    });
    await insertFixtureRow(db, 'exercise_revision', { exerciseId, revision: 1 });
    await insertFixtureRow(db, 'exercise_revision', { exerciseId, revision: 2, savedBy: lea.id });
    expect(occurrences(sqlite, lea.id)).toEqual([
      'exercise.reviewed_by',
      'exercise_comment.author_id',
      'exercise_comment.resolved_by',
      'exercise_revision.saved_by',
      'exercise_validation.reviewer_id',
      'user.id',
    ]);

    await db
      .transaction()
      .execute((trx) => deleteAccount(trx, c.deps, lea.id, { actorId: lea.id, ip: null }));

    expect(occurrences(sqlite, lea.id)).toEqual([]);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(await db.selectFrom('exercise').select(['status', 'reviewedBy', 'reviewedAt']).execute()).toEqual([
      { status: 'reviewed', reviewedBy: null, reviewedAt: NOW },
    ]);
    const comment = (id: unknown) =>
      db
        .selectFrom('exerciseComment')
        .select(['authorId', 'resolvedAt', 'resolvedBy'])
        .where('id', '=', id as string)
        .executeTakeFirstOrThrow();
    expect(await comment(written.id)).toEqual({ authorId: null, resolvedAt: null, resolvedBy: null });
    expect(await comment(resolved.id)).toMatchObject({ resolvedAt: NOW, resolvedBy: null });
    expect(
      await db.selectFrom('exerciseValidation').select(['id', 'reviewerId', 'health']).execute(),
    ).toEqual([{ id: validation.id, reviewerId: null, health: 1 }]);
    expect(
      await db.selectFrom('exerciseRevision').select(['revision', 'savedBy']).orderBy('revision').execute(),
    ).toEqual([
      { revision: 1, savedBy: null },
      { revision: 2, savedBy: null },
    ]);
  });
});
