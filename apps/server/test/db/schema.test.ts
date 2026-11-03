import { BatchSchema } from '@rune/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { MIGRATIONS } from '../../src/db/migrations/index';
import { openDatabase } from '../../src/db/open';
import { FakeClock } from '../support';
import { dumpSchema } from './schema-dump';

const S = "1, '2026-10-06T10:00:00.000Z', '2026-10-06T10:00:00.000Z'";
const x = (n: number) => 'x'.repeat(n);

describe('schéma du socle et du catalogue', () => {
  let h: ReturnType<typeof openDatabase>;
  const run = (q: string) => h.sqlite.exec(q);
  const ok = (q: string) => expect(() => run(q)).not.toThrow();
  const bad = (q: string, kind: 'CHECK' | 'UNIQUE' | 'FOREIGN KEY' | 'NOT NULL' = 'CHECK') =>
    expect(() => run(q)).toThrow(`${kind} constraint failed`);
  const count = (q: string) => (h.sqlite.prepare(q).get() as { n: number }).n;

  const place = (id: string, owner: string, cols: string, vals: string) =>
    `INSERT INTO place (id, owner_id, rev, created_at, updated_at, ${cols}) VALUES ('${id}', '${owner}', ${S}, ${vals})`;
  const gym = (id: string, name: string, key = id) =>
    `INSERT INTO gym (id, name, name_key, city, city_key, load_settings, rev, created_at, updated_at) VALUES ('${id}', '${name}', '${key}', 'Paris', '${key}', '{}', ${S})`;
  const profile = (cols: string, vals: string, id = 'u1') =>
    `INSERT INTO training_profile (id, owner_id, rev, created_at, updated_at, ${cols}) VALUES ('${id}', 'u1', ${S}, ${vals})`;
  const consent = (action: string) =>
    `INSERT INTO consent_event (id, owner_id, type, action, text_version, rev, created_at, updated_at) VALUES ('c-${action}', 'u1', 'health', '${action}', 'v1', ${S})`;
  const session = (id: string, cols: string, vals: string) =>
    `INSERT INTO session (id, token_hash, created_at, last_seen_at, expires_at, ${cols}) VALUES ('${id}', 't-${id}', 'x', 'x', 'x', ${vals})`;
  const limitation = (area: string | null, note: string | null) =>
    `INSERT INTO limitation (id, owner_id, rev, created_at, updated_at, body_area, side, severity, active, note) VALUES ('l1', 'u1', ${S}, ${area ? `'${area}'` : 'NULL'}, 'left', 'mild', 1, ${note ? `'${note}'` : 'NULL'})`;
  /** INSERT d'une ligne : valeurs SQL par colonne, les valeurs de `over` remplaçant celles de `base`. */
  const insert = (table: string, base: Record<string, string>, over: Record<string, string>) => {
    const row = { ...base, ...over };
    return `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).join(', ')})`;
  };
  const exercise = (over: Record<string, string>) =>
    insert(
      'exercise',
      {
        schema_version: '1',
        revision: '1',
        status: "'draft'",
        batch: "'A'",
        name: "'Squat goblet'",
        movement_pattern: "'squat'",
        mechanics: "'compound'",
        unilateral: '0',
        measure: "'reps'",
        load_mode: "'dumbbell'",
        level: '1',
        not_for_minors: '0',
        equipment_options: `'[["dumbbells"]]'`,
        content: "'{}'",
      },
      over,
    );
  const illustration = (id: string, over: Record<string, string> = {}) =>
    insert(
      'illustration',
      {
        id: `'${id}'`,
        file: `'${id}.0a1b2c3d.svg'`,
        sha256: `'${'0'.repeat(64)}'`,
        bytes: '2048',
        media_type: "'image/svg+xml'",
        source: "'everkinetic'",
        source_url: "'https://github.com/everkinetic/data/blob/0123abc/svg/squat-1.svg'",
        creators: `'["Greg Priday"]'`,
        license: "'CC-BY-SA-4.0'",
        license_url: "'https://creativecommons.org/licenses/by-sa/4.0/'",
      },
      over,
    );
  const comment = (id: string, part: string, body: string, exerciseId = 'e1') =>
    `INSERT INTO exercise_comment (id, exercise_id, author_id, part, body, revision, created_at) VALUES ('${id}', '${exerciseId}', 'u1', '${part}', '${body}', 1, 'x')`;
  const validation = (id: string, reviewer: string, revision: number, health = '1') =>
    `INSERT INTO exercise_validation (id, exercise_id, reviewer_id, revision, health, created_at) VALUES ('${id}', 'e1', '${reviewer}', ${revision}, ${health}, 'x')`;
  const revision = (n: number, status = "'draft'", content = "'{}'") =>
    `INSERT INTO exercise_revision (exercise_id, revision, content, status, saved_by, saved_at) VALUES ('e1', ${n}, ${content}, ${status}, 'u1', 'x')`;

  beforeEach(async () => {
    h = openDatabase(':memory:');
    await migrate(h.db, MIGRATIONS, new FakeClock());
    run(`INSERT INTO user (id, username, username_key, password_hash, role, birth_date, rev, created_at, updated_at) VALUES
      ('u1', 'U1', 'u1', 'h', 'member', '1990-01-01', ${S}), ('u2', 'U2', 'u2', 'h', 'member', '1990-01-01', ${S})`);
  });
  afterEach(() => h.sqlite.close());

  it('instantané de sqlite_schema', async () => {
    await expect(dumpSchema(h.sqlite)).toMatchFileSnapshot('../__snapshots__/schema.sql');
  });

  it('36 tables (18 du socle, 5 du catalogue, 7 des programmes, 6 du coach), toutes STRICT', () => {
    const rows = h.sqlite
      .prepare(
        "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string; strict: number }[];
    expect(rows).toHaveLength(36);
    expect(rows.every((r) => r.strict === 1)).toBe(true);
  });

  it('server_meta, user et training_profile', () => {
    const meta = (id: number) =>
      `INSERT INTO server_meta (id, server_epoch, epoch_started_at) VALUES (${id}, 'e', 'x')`;
    ok(meta(1));
    bad(meta(2));
    bad("UPDATE user SET role = 'root' WHERE id = 'u1'");
    bad("UPDATE user SET onboarding_step = 'nope' WHERE id = 'u1'");
    ok("UPDATE user SET onboarding_step = NULL WHERE id = 'u1'");
    ok(profile('goal, experience, days_per_week, session_minutes', 'NULL, NULL, NULL, NULL'));
    run('DELETE FROM training_profile');
    bad(profile('goal', 'NULL', 'autre'));
    bad(profile('days_per_week', '5'));
    bad(profile('session_minutes', '50'));
    bad(profile('sport_other_label', `'${x(41)}'`));
    ok(profile('sport_other_label', `'${x(40)}'`));
    run('DELETE FROM training_profile');
    bad(profile('coach', "'berserker'"));
    ok(profile('coach', "'skald'"));
  });

  it('drapeaux de relecteur du compte : 0 par défaut, puis 0 ou 1 seulement', () => {
    expect(
      h.sqlite.prepare("SELECT catalog_reviewer, health_professional FROM user WHERE id = 'u1'").get(),
    ).toEqual({ catalog_reviewer: 0, health_professional: 0 });
    for (const col of ['catalog_reviewer', 'health_professional']) {
      bad(`UPDATE user SET ${col} = 2 WHERE id = 'u1'`);
      bad(`UPDATE user SET ${col} = NULL WHERE id = 'u1'`, 'NOT NULL');
      ok(`UPDATE user SET ${col} = 1 WHERE id = 'u1'`);
    }
  });

  it('exercise : statut, mécanique, mesure, mode de charge, niveau, booléens, nom et JSON', () => {
    ok(exercise({ id: "'e0'" }));
    ok(exercise({ id: "'e1'", name: `'${x(60)}'`, level: '3', not_for_minors: '1', aliases: "'[]'" }));
    const refused: Record<string, string>[] = [
      { status: "'archived'" },
      { mechanics: "'mixed'" },
      { measure: "'distance'" },
      { load_mode: "'kettlebell'" },
      { level: '0' },
      { level: '4' },
      { unilateral: '2' },
      { not_for_minors: '2' },
      { revision: '0' },
      { name: `'${x(61)}'` },
      { equipment_options: "'pas du JSON'" },
      { content: "'{'" },
      { aliases: "'['" },
      { illustrations: "'['" },
      { drafting: "'{'" },
    ];
    for (const [i, over] of refused.entries()) bad(exercise({ id: `'r${i}'`, ...over }));
    bad(exercise({ id: "'r-batch'", batch: 'NULL' }), 'NOT NULL');
    // Pas de CHECK sur movement_pattern (09 §2) : taxonomie extensible par PR, gardée par Zod.
    ok(exercise({ id: "'e2'", movement_pattern: "'nouveau_pattern'" }));
  });

  it('exercise.batch accepte exactement les valeurs de BatchSchema', () => {
    const valid = ['A', 'B', 'E1', 'E9', 'E10', 'E42', 'E99'];
    const cases = [...valid, 'E0', 'E01', 'E100', 'C', 'e1', 'AB', 'E', '', 'A '];
    const accepted = cases.filter((batch, i) => {
      try {
        run(exercise({ id: `'b${i}'`, batch: `'${batch}'` }));
        return true;
      } catch (error) {
        expect(String(error)).toContain('CHECK constraint failed');
        return false;
      }
    });
    expect(accepted).toEqual(valid);
    expect(accepted).toEqual(cases.filter((batch) => BatchSchema.safeParse(batch).success));
  });

  it('exercise : pointeurs de chaîne vérifiés en fin de transaction', () => {
    // Deux fiches qui se pointent : l'ordre d'insertion est libre dans une transaction (chargeur).
    run('BEGIN');
    run(exercise({ id: "'a'", harder_id: "'b'" }));
    run(exercise({ id: "'b'", easier_id: "'a'" }));
    ok('COMMIT');
    run('BEGIN');
    run(exercise({ id: "'c'", easier_id: "'absente'" }));
    expect(() => run('COMMIT')).toThrow('FOREIGN KEY constraint failed');
    run('ROLLBACK');
    bad(exercise({ id: "'d'", harder_id: "'absente'" }), 'FOREIGN KEY');
    expect(count("SELECT count(*) AS n FROM exercise WHERE id IN ('c', 'd')")).toBe(0);
  });

  it('illustration : fichier unique, source, licence, type et marquage', () => {
    ok(illustration('i1'));
    bad(illustration('i2', { file: "'i1.0a1b2c3d.svg'" }), 'UNIQUE');
    bad(illustration('i3', { source: "'wikimedia'" }));
    bad(illustration('i4', { license: "'CC-BY-NC-4.0'" }));
    bad(illustration('i5', { media_type: "'image/gif'" }));
    bad(illustration('i6', { replace_before_public: '2' }));
    bad(illustration('i7', { creators: "'Greg'" }));
    ok(illustration('i8', { source: "'workout_guide'", license: "'CC0-1.0'", replace_before_public: '1' }));
    expect(count("SELECT replace_before_public AS n FROM illustration WHERE id = 'i1'")).toBe(0);
  });

  it('relecture : commentaires, validations et révisions', () => {
    run(exercise({ id: "'e1'" }));
    ok(comment('c1', 'general', x(1)));
    ok(comment('c2', 'illustrations', x(1000)));
    bad(comment('c3', 'ailleurs', 'x'));
    bad(comment('c4', 'general', ''));
    bad(comment('c5', 'general', x(1001)));
    bad(comment('c6', 'general', 'x', 'e-absente'), 'FOREIGN KEY');
    // « Traité » pose resolved_at ; resolved_by sans resolved_at est incohérent
    bad("UPDATE exercise_comment SET resolved_by = 'u2' WHERE id = 'c1'");
    ok("UPDATE exercise_comment SET resolved_at = 'x', resolved_by = 'u2' WHERE id = 'c1'");

    ok(validation('v1', 'u1', 1));
    bad(validation('v2', 'u1', 1), 'UNIQUE');
    ok(validation('v3', 'u1', 2));
    ok(validation('v4', 'u2', 1));
    bad(validation('v5', 'u2', 3, '2'));

    ok(revision(1));
    bad(revision(1), 'UNIQUE');
    bad(revision(0));
    bad(revision(2, "'archived'"));
    bad(revision(3, "'draft'", "'{'"));
    ok(revision(2));
    // Une fiche ne se supprime jamais (04, Relations) : ses lignes de relecture la retiennent.
    bad("DELETE FROM exercise WHERE id = 'e1'", 'FOREIGN KEY');
  });

  it('health_screening et limitation', () => {
    const hs = (del: string) =>
      `INSERT INTO health_screening (id, owner_id, rev, created_at, updated_at, deleted_at) VALUES ('u1', 'u1', ${S}, ${del})`;
    bad(hs('NULL'));
    ok(hs("'2026-10-06'"));
    bad(limitation(null, null));
    bad(limitation('tete', null));
    bad(limitation('knee', x(201)));
    ok(limitation('knee', x(200)));
  });

  it('place', () => {
    run(gym('g1', 'Salle un'));
    run(gym('g2', 'Salle deux'));
    ok(place('p1', 'u1', 'kind, is_primary', "'home', 1"));
    bad(place('p2', 'u1', 'kind, is_primary', "'home', 1"), 'UNIQUE');
    ok(place('p3', 'u1', 'kind, is_primary, deleted_at', "'home', 1, 'x'"));
    ok(place('p4', 'u1', 'kind, gym_id', "'gym', 'g1'"));
    bad(place('p5', 'u1', 'kind, gym_id', "'gym', 'g1'"), 'UNIQUE');
    ok(place('p6', 'u2', 'kind, gym_id', "'gym', 'g1'"));
    bad(place('p7', 'u1', 'kind', "'gym'"));
    bad(place('p8', 'u2', 'kind, gym_id, load_settings', "'gym', 'g2', '{}'"));
    bad(place('p9', 'u2', 'kind, gym_id, name', "'gym', 'g2', 'x'"));
    bad(place('pa', 'u2', 'kind, name', `'home', '${x(31)}'`));
    ok(place('pb', 'u2', 'kind, name', `'home', '${x(30)}'`));
  });

  it('gym, équipements, invitation, session et journaux', () => {
    ok(gym('g1', 'Salle un'));
    bad(gym('g2', 'Salle deux', 'g1'), 'UNIQUE');
    bad(gym('g3', 'X'));
    const ge = (id: string) =>
      `INSERT INTO gym_equipment (id, gym_id, equipment_code, rev, created_at, updated_at) VALUES ('${id}', 'g1', 'barbell', ${S})`;
    bad(ge('g1:dumbbell'));
    ok(ge('g1:barbell'));
    ok(place('p1', 'u1', 'kind', "'home'"));
    const he = (id: string) =>
      `INSERT INTO home_equipment (id, place_id, equipment_code, owner_id, rev, created_at, updated_at) VALUES ('${id}', 'p1', 'bench', 'u1', ${S})`;
    bad(he('p1:other'));
    ok(he('p1:bench'));
    const inv = (n: number) =>
      `INSERT INTO invitation (id, code_hash, note, created_at, expires_at) VALUES ('i${n}', 'c${n}', '${x(n)}', 'x', 'x')`;
    bad(inv(61));
    ok(inv(60));
    bad(session('s1', 'must_change_password', '2'));
    bad(session('s2', 'revoked_reason', "'expired'"));
    ok(session('s3', 'revoked_reason', "'logout'"));
    bad(consent('revoke'));
    ok(consent('grant'));
    bad(
      `INSERT INTO sync_rejection (id, owner_id, rev, created_at, updated_at, op_id, entity, row_id, code) VALUES ('r', 'u1', ${S}, 'o', 'e', 'r', 'nope')`,
    );
    bad(
      "INSERT INTO applied_op (op_id, user_id, entity, row_id, status, applied_at) VALUES ('o', 'u1', 'e', 'r', 'nope', 'x')",
    );
    bad("INSERT INTO gym_history (id, gym_id, at, action, detail) VALUES ('h', 'g1', 'x', 'nope', '{}')");
  });

  it("suppression d'un user : cascades et SET NULL", () => {
    run(profile('goal', "'muscle'"));
    run(place('p1', 'u1', 'kind', "'home'"));
    run(consent('grant'));
    run(
      "INSERT INTO password_reset (id, user_id, code_hash, created_at, expires_at) VALUES ('pr', 'u1', 'h', 'x', 'x')",
    );
    run(session('s', 'user_id', "'u1'"));
    run(gym('g1', 'Salle un'));
    run(
      "INSERT INTO gym_history (id, gym_id, author_id, at, action, detail) VALUES ('h', 'g1', 'u1', 'x', 'create', '{}')",
    );
    run("DELETE FROM user WHERE id = 'u1'");
    for (const t of ['training_profile', 'place', 'consent_event', 'password_reset']) {
      expect(count(`SELECT count(*) AS n FROM ${t}`)).toBe(0);
    }
    expect(count("SELECT count(*) AS n FROM session WHERE id = 's' AND user_id IS NULL")).toBe(1);
    expect(count("SELECT count(*) AS n FROM gym_history WHERE id = 'h' AND author_id IS NULL")).toBe(1);
    expect(h.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
