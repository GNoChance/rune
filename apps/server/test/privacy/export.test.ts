import { type EntityRulesMap, entityRules, snakeToCamel } from '@rune/contracts';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import type { Migration } from '../../src/db/migrations/index';
import { fullMember, seedTarget, seedWeighIns } from '../nutrition/fixtures';
import { createTestContext, createUser, insertFixtureRow, login, type TestContext } from '../support';

let ctx: TestContext;
afterEach(() => ctx?.close());

const fixtureMigration: Migration = {
  id: '0002_fixture_export',
  breaking: false,
  up: async (db) => {
    await sql
      .raw(
        'CREATE TABLE fixture_export (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, label TEXT NOT NULL, secret_hash TEXT NOT NULL) STRICT',
      )
      .execute(db);
  },
};

const rulesWithFixture: EntityRulesMap = {
  ...entityRules,
  fixture_export: {
    category: 'C1',
    syncClass: 'H',
    ownerColumn: 'owner_id',
    columns: ['id', 'owner_id', 'label', 'secret_hash'],
    clientWritable: [],
    c2Columns: [],
    secretColumns: ['secret_hash'],
    exported: true,
    onUserDelete: 'cascade',
  },
};

describe('GET /api/me/export (R-EXP-1, R-EXP-2, P-DRT-1)', () => {
  it('exporte uniquement les données du compte, sans secret ni session', async () => {
    ctx = await createTestContext({ entityRules: rulesWithFixture, extraMigrations: [fixtureMigration] });
    const u = await createUser(ctx, { username: 'lea' });
    const other = await createUser(ctx, { username: 'tom' });
    const cookie = await login(ctx, 'lea', u.password);
    await login(ctx, 'tom', other.password);
    const { db } = ctx.deps;

    const mine = await insertFixtureRow(db, 'gym', { createdBy: u.id });
    const frequented = await insertFixtureRow(db, 'gym');
    const foreign = await insertFixtureRow(db, 'gym', { createdBy: other.id });
    const historyOnly = await insertFixtureRow(db, 'gym');
    const place = await insertFixtureRow(db, 'place', {
      ownerId: u.id,
      kind: 'gym',
      gymId: frequented.id,
      name: null,
      loadSettings: null,
    });
    await insertFixtureRow(db, 'place', { ownerId: other.id });
    const written = await insertFixtureRow(db, 'gym_history', { gymId: historyOnly.id, authorId: u.id });
    await insertFixtureRow(db, 'gym_history', { gymId: foreign.id, authorId: other.id });
    await insertFixtureRow(db, 'limitation', { ownerId: u.id });
    await insertFixtureRow(db, 'limitation', { ownerId: other.id });
    await sql`insert into fixture_export (id, owner_id, label, secret_hash) values ('f1', ${u.id}, 'témoin', 'x'), ('f2', ${other.id}, 'autre', 'y')`.execute(
      db,
    );

    const res = await ctx.request('/api/me/export', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="rune-export-2026-10-06.json"');
    const text = await res.text();
    expect(text).not.toContain('$argon2id');
    const exp = JSON.parse(text);

    expect(exp.format).toBe('rune-export/1');
    expect(exp.exportedAt).toBe('2026-10-06T10:00:00.000Z');
    expect(exp.account).toMatchObject({ id: u.id, username: 'lea' });
    expect(exp.account).not.toHaveProperty('passwordHash');
    expect(Object.keys(exp.tables).sort()).toEqual(
      Object.entries(rulesWithFixture)
        .filter(([t, r]) => r.exported && t !== 'user')
        .map(([t]) => t)
        .sort(),
    );
    expect(exp.tables).not.toHaveProperty('session');
    expect(exp.tables.place.map((r: { id: string }) => r.id)).toEqual([place.id]);
    expect(exp.tables.limitation).toHaveLength(1);
    expect(exp.tables.limitation[0].ownerId).toBe(u.id);
    expect(exp.tables.fixture_export).toEqual([{ id: 'f1', ownerId: u.id, label: 'témoin' }]);
    expect(exp.gyms.map((g: { id: string }) => g.id).sort()).toEqual(
      [mine.id, frequented.id, historyOnly.id].sort(),
    );
    expect(exp.gymHistory.map((h: { id: string }) => h.id)).toEqual([written.id]);
  });

  it('exporte le coach de la personne (fil, messages, journal, signalement), pas celui des autres ni le compteur et le réglage', async () => {
    ctx = await createTestContext();
    const u = await createUser(ctx, { username: 'lea' });
    const other = await createUser(ctx, { username: 'tom' });
    const cookie = await login(ctx, 'lea', u.password);
    const { db } = ctx.deps;
    const thread = await insertFixtureRow(db, 'coach_thread', {
      userId: u.id,
      brief: '{"repere":"BRIEF_LEA"}',
      slotAliases: '{"slot-a":"REPERE_ALIAS"}',
    });
    const m1 = await insertFixtureRow(db, 'coach_message', {
      threadId: thread.id,
      userId: u.id,
      seq: 1,
      blocks: '[{"type":"text","text":"BLOCS_LEA"}]',
    });
    const m2 = await insertFixtureRow(db, 'coach_message', {
      threadId: thread.id,
      userId: u.id,
      seq: 2,
      role: 'assistant',
    });
    const call = await insertFixtureRow(db, 'coach_call', { userId: u.id, threadId: thread.id });
    const report = await insertFixtureRow(db, 'coach_report', { userId: u.id, threadId: thread.id });
    const foreignThread = await insertFixtureRow(db, 'coach_thread', { userId: other.id });
    await insertFixtureRow(db, 'coach_message', {
      threadId: foreignThread.id,
      userId: other.id,
      displayText: 'REPERE_TOM',
    });
    await insertFixtureRow(db, 'coach_call', { userId: other.id });
    await insertFixtureRow(db, 'coach_report', { userId: other.id });
    await insertFixtureRow(db, 'coach_safety_counter');

    const text = await (await ctx.request('/api/me/export', { cookie })).text();
    const exp = JSON.parse(text) as { tables: Record<string, Record<string, unknown>[]> };
    expect(exp.tables.coach_thread?.map((r) => r.id)).toEqual([thread.id]);
    expect(exp.tables.coach_message?.map((r) => r.id)).toEqual([m1.id, m2.id]);
    expect(exp.tables.coach_message?.[0]?.blocks).toBe('[{"type":"text","text":"BLOCS_LEA"}]');
    expect(exp.tables.coach_call?.map((r) => r.id)).toEqual([call.id]);
    expect(exp.tables.coach_report?.map((r) => r.id)).toEqual([report.id]);
    // Toutes les colonnes du registre, sauf la table des alias (identifiants internes).
    for (const t of ['coach_thread', 'coach_message', 'coach_call', 'coach_report']) {
      const rule = entityRules[t];
      const expected = (rule?.columns ?? [])
        .filter((c) => !rule?.secretColumns.includes(c))
        .map(snakeToCamel);
      expect(Object.keys(exp.tables[t]?.[0] ?? {}).sort(), t).toEqual(expected.sort());
    }
    expect(exp.tables.coach_thread?.[0]?.brief).toBe('{"repere":"BRIEF_LEA"}');
    expect(exp.tables).not.toHaveProperty('coach_safety_counter');
    expect(exp.tables).not.toHaveProperty('coach_state');
    for (const leak of ['REPERE_TOM', 'REPERE_ALIAS', other.id]) expect(text).not.toContain(leak);
  });

  it('inclut les lieux supprimés et leurs salles, valeurs telles que stockées', async () => {
    ctx = await createTestContext();
    const u = await createUser(ctx, { username: 'lea' });
    const cookie = await login(ctx, 'lea', u.password);
    const gym = await insertFixtureRow(ctx.deps.db, 'gym');
    await insertFixtureRow(ctx.deps.db, 'place', {
      ownerId: u.id,
      kind: 'gym',
      gymId: gym.id,
      name: null,
      loadSettings: null,
      deletedAt: '2026-10-05T10:00:00.000Z',
    });
    const exp = (await (await ctx.request('/api/me/export', { cookie })).json()) as {
      gyms: { id: string; loadSettings: string }[];
      tables: Record<string, Record<string, unknown>[]>;
    };
    expect(exp.gyms.map((g: { id: string }) => g.id)).toEqual([gym.id]);
    expect(exp.tables.place?.[0]).toMatchObject({ isPrimary: 0, deletedAt: '2026-10-05T10:00:00.000Z' });
    expect(exp.gyms[0]?.loadSettings).toBe('{}');
  });

  it('contient les commentaires et validations de relecture de la personne, pas ceux des autres ni les révisions (spec brique 2 §3.9)', async () => {
    ctx = await createTestContext();
    const zoe = await createUser(ctx, { username: 'zoe', catalogReviewer: true });
    const ines = await createUser(ctx, { username: 'ines', catalogReviewer: true });
    const cookie = await login(ctx, 'zoe', zoe.password);
    const { db } = ctx.deps;
    const exercise = await insertFixtureRow(db, 'exercise');
    await insertFixtureRow(db, 'exercise_revision', {
      exerciseId: exercise.id,
      content: '{"name":"REPERE_REVISION"}',
      savedBy: zoe.id,
    });
    const mine = await insertFixtureRow(db, 'exercise_comment', {
      exerciseId: exercise.id,
      authorId: zoe.id,
      body: 'REPERE_ZOE',
      resolvedAt: '2026-10-06T11:00:00.000Z',
      resolvedBy: ines.id,
    });
    await insertFixtureRow(db, 'exercise_comment', {
      exerciseId: exercise.id,
      authorId: ines.id,
      body: 'REPERE_INES',
    });
    const validated = await insertFixtureRow(db, 'exercise_validation', {
      exerciseId: exercise.id,
      reviewerId: zoe.id,
      revision: 1,
    });
    await insertFixtureRow(db, 'exercise_validation', {
      exerciseId: exercise.id,
      reviewerId: ines.id,
      revision: 1,
    });

    const text = await (await ctx.request('/api/me/export', { cookie })).text();
    const exp = JSON.parse(text);
    expect(exp.reviewComments).toEqual([
      {
        id: mine.id,
        exerciseId: exercise.id,
        part: 'general',
        body: 'REPERE_ZOE',
        revision: 1,
        createdAt: '2026-10-06T10:00:00.000Z',
        resolvedAt: '2026-10-06T11:00:00.000Z',
      },
    ]);
    expect(exp.reviewValidations).toEqual([
      {
        id: validated.id,
        exerciseId: exercise.id,
        revision: 1,
        health: 0,
        createdAt: '2026-10-06T10:00:00.000Z',
      },
    ]);
    for (const leak of ['REPERE_INES', 'REPERE_REVISION', ines.id]) expect(text).not.toContain(leak);
    for (const table of ['exercise', 'exercise_comment', 'exercise_validation', 'exercise_revision']) {
      expect(exp.tables).not.toHaveProperty(table);
    }
  });

  it('exporte les quatre tables nutrition du membre en mode complet, pas celles des autres', async () => {
    ctx = await createTestContext({ now: '2026-11-09T09:00:00.000Z' });
    const u = await createUser(ctx, { username: 'lea' });
    const other = await createUser(ctx, { username: 'tom' });
    const cookie = await login(ctx, 'lea', u.password);
    await fullMember(ctx, u.id);
    await fullMember(ctx, other.id);
    const target = (await seedTarget(ctx, u.id, { validFrom: '2026-11-02' })) as { id: string };
    await seedTarget(ctx, other.id, { validFrom: '2026-11-02' });
    await seedWeighIns(ctx, u.id, [['2026-11-07', 80_000]]);
    await seedWeighIns(ctx, other.id, [['2026-11-07', 91_000]]);
    await insertFixtureRow(ctx.deps.db, 'nutrition_checkin', {
      ownerId: u.id,
      weekStart: '2026-11-02',
      createdTargetId: target.id,
    });

    const text = await (await ctx.request('/api/me/export', { cookie })).text();
    const exp = JSON.parse(text) as { tables: Record<string, Record<string, unknown>[]> };
    expect(exp.tables.nutrition_profile).toHaveLength(1);
    expect(exp.tables.nutrition_profile?.[0]).toMatchObject({
      ownerId: u.id,
      heightCm: 180,
      goal: 'maintain',
    });
    expect(exp.tables.weigh_in).toMatchObject([{ ownerId: u.id, date: '2026-11-07', weightG: 80_000 }]);
    expect(exp.tables.nutrition_target).toHaveLength(1);
    expect(exp.tables.nutrition_checkin).toHaveLength(1);
    expect(text).not.toContain('91000');
  });

  it('journalise data_exported sans détail', async () => {
    ctx = await createTestContext();
    const u = await createUser(ctx, { username: 'lea' });
    const cookie = await login(ctx, 'lea', u.password);
    await ctx.request('/api/me/export', { cookie });
    const events = await ctx.deps.db
      .selectFrom('securityEvent')
      .selectAll()
      .where('type', '=', 'data_exported')
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: u.id, targetId: u.id, details: null, outcome: 'success' });
  });

  it('exige une session', async () => {
    ctx = await createTestContext();
    const res = await ctx.request('/api/me/export');
    expect(res.status).toBe(401);
  });
});
