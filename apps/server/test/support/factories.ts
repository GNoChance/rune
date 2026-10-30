import { camelToSnake, entityRules, rowToCamel, snakeToCamel } from '@rune/contracts';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../../src/db/schema';
import { seqIds } from './ids';

const NOW = '2026-10-06T10:00:00.000Z';
type Values = Record<string, unknown>;
type Factory = (db: Kysely<Database>, v: Values) => Promise<Values>;

/** Un générateur par base : les ids restent uniques et déterministes au fil des insertions. */
const generators = new WeakMap<object, ReturnType<typeof seqIds>>();
const ids = (db: Kysely<Database>) => {
  const existing = generators.get(db);
  if (existing) return existing;
  const created = seqIds(999);
  generators.set(db, created);
  return created;
};
const counters = new WeakMap<object, number>();
const next = (db: Kysely<Database>) => {
  const n = (counters.get(db) ?? 0) + 1;
  counters.set(db, n);
  return n;
};

const SYNC = { rev: 1, createdAt: NOW, updatedAt: NOW };

/** Insère la ligne puis la relit (camelCase) par sa clé, simple ou composée. */
async function insert(
  db: Kysely<Database>,
  table: string,
  row: Values,
  keyColumns: string | readonly string[] = 'id',
): Promise<Values> {
  const cols = Object.keys(row).map(camelToSnake);
  const query = sql`insert into ${sql.table(table)} (${sql.join(cols.map((c) => sql.ref(c)))}) values (${sql.join(
    Object.values(row),
  )})`;
  await query.execute(db);
  const keys = typeof keyColumns === 'string' ? [keyColumns] : keyColumns;
  const where = sql.join(
    keys.map((k) => sql`${sql.ref(k)} = ${row[snakeToCamel(k)]}`),
    sql` and `,
  );
  const read = await sql<Values>`select * from ${sql.table(table)} where ${where}`.execute(db);
  const found = read.rows[0];
  if (!found) throw new Error(`Ligne introuvable dans ${table}`);
  return rowToCamel(found);
}

/** Valeur fournie, sinon parent créé par récursion. */
async function parentId(
  db: Kysely<Database>,
  v: Values,
  key: string,
  table: string,
  extra?: Values,
): Promise<string> {
  return (v[key] as string | undefined) ?? ((await insertFixtureRow(db, table, extra)).id as string);
}

const plain =
  (table: string, defaults: (db: Kysely<Database>) => Values): Factory =>
  (db, v) =>
    insert(db, table, { ...defaults(db), ...v });

const owned =
  (
    table: string,
    defaults: (db: Kysely<Database>, ownerId: string) => Values,
    keyedByOwner = false,
  ): Factory =>
  async (db, v) => {
    const ownerId = await parentId(db, v, 'ownerId', 'user');
    const id = keyedByOwner ? ownerId : ids(db).uuidv7();
    return insert(db, table, { id, ownerId, ...SYNC, ...defaults(db, ownerId), ...v });
  };

const FACTORIES: Record<string, Factory> = {
  server_meta: plain('server_meta', (db) => ({
    id: 1,
    serverEpoch: ids(db).uuidv7(),
    epochStartedAt: NOW,
  })),
  schema_migrations: plain('schema_migrations', (db) => ({
    id: `fixture_${ids(db).uuidv7()}`,
    breaking: 0,
    appliedAt: NOW,
  })),
  applied_op: async (db, v) =>
    insert(
      db,
      'applied_op',
      {
        opId: ids(db).uuidv7(),
        userId: await parentId(db, v, 'userId', 'user'),
        entity: 'place',
        rowId: ids(db).uuidv7(),
        status: 'applied',
        assignedRev: 1,
        appliedAt: NOW,
        ...v,
      },
      'op_id',
    ),
  sync_rejection: owned('sync_rejection', (db) => ({
    opId: ids(db).uuidv7(),
    entity: 'place',
    rowId: ids(db).uuidv7(),
    code: 'validation',
  })),
  user: plain('user', (db) => {
    const n = next(db);
    return {
      id: ids(db).uuidv7(),
      username: `user${n}`,
      usernameKey: `user${n}`,
      passwordHash: '$argon2id$fixture',
      role: 'member',
      birthDate: '1990-01-01',
      ...SYNC,
    };
  }),
  invitation: plain('invitation', (db) => ({
    id: ids(db).uuidv7(),
    codeHash: `hash-${ids(db).uuidv7()}`,
    createdAt: NOW,
    expiresAt: '2026-10-13T10:00:00.000Z',
  })),
  password_reset: async (db, v) =>
    insert(db, 'password_reset', {
      id: ids(db).uuidv7(),
      userId: await parentId(db, v, 'userId', 'user'),
      codeHash: `hash-${ids(db).uuidv7()}`,
      createdAt: NOW,
      expiresAt: '2026-10-07T10:00:00.000Z',
      ...v,
    }),
  session: async (db, v) =>
    insert(db, 'session', {
      id: ids(db).uuidv7(),
      tokenHash: `hash-${ids(db).uuidv7()}`,
      userId: await parentId(db, v, 'userId', 'user'),
      createdAt: NOW,
      lastSeenAt: NOW,
      expiresAt: '2026-11-05T10:00:00.000Z',
      ...v,
    }),
  consent_event: owned('consent_event', () => ({ type: 'health', action: 'grant', textVersion: '1.0' })),
  security_event: plain('security_event', (db) => ({
    id: ids(db).uuidv7(),
    at: NOW,
    type: 'fixture',
    outcome: 'success',
  })),
  training_profile: owned('training_profile', () => ({}), true),
  health_screening: owned(
    'health_screening',
    () => ({ caution: 0, questionnaireVersion: '1.0', answeredAt: NOW }),
    true,
  ),
  limitation: owned('limitation', () => ({ bodyArea: 'knee', side: 'left', severity: 'mild', active: 1 })),
  gym: plain('gym', (db) => {
    const n = next(db);
    return {
      id: ids(db).uuidv7(),
      name: `Salle ${n}`,
      nameKey: `salle ${n}`,
      city: 'Lyon',
      cityKey: 'lyon',
      loadSettings: '{}',
      ...SYNC,
    };
  }),
  gym_equipment: async (db, v) => {
    const gymId = await parentId(db, v, 'gymId', 'gym');
    return insert(db, 'gym_equipment', {
      id: `${gymId}:dumbbells`,
      gymId,
      equipmentCode: 'dumbbells',
      ...SYNC,
      ...v,
    });
  },
  gym_history: async (db, v) =>
    insert(db, 'gym_history', {
      id: ids(db).uuidv7(),
      gymId: await parentId(db, v, 'gymId', 'gym'),
      at: NOW,
      action: 'create',
      detail: '{}',
      ...v,
    }),
  place: async (db, v) => {
    const ownerId = await parentId(db, v, 'ownerId', 'user');
    return insert(db, 'place', {
      id: ids(db).uuidv7(),
      ownerId,
      ...SYNC,
      kind: 'home',
      name: 'Maison',
      loadSettings: '{}',
      ...v,
    });
  },
  home_equipment: async (db, v) => {
    const placeId =
      (v.placeId as string | undefined) ?? ((await insertFixtureRow(db, 'place', ownerOf(v))).id as string);
    const ownerId = (v.ownerId as string | undefined) ?? (await ownerOfPlace(db, placeId));
    return insert(db, 'home_equipment', {
      id: `${placeId}:chair`,
      placeId,
      equipmentCode: 'chair',
      ownerId,
      ...SYNC,
      ...v,
    });
  },
  // Brouillon de squelette (04 §8 étape 1) : champs IA, illustrations et colonnes éditoriales absents.
  exercise: plain('exercise', (db) => {
    const n = next(db);
    return {
      id: `exercise-${n}`,
      schemaVersion: 1,
      revision: 1,
      status: 'draft',
      batch: 'A',
      name: `Exercice ${n}`,
      movementPattern: 'squat',
      mechanics: 'compound',
      unilateral: 0,
      measure: 'reps',
      loadMode: 'dumbbell',
      level: 1,
      notForMinors: 0,
      equipmentOptions: '[["dumbbells"]]',
      content: '{}',
    };
  }),
  illustration: plain('illustration', (db) => {
    const n = next(db);
    return {
      id: `illustration-${n}`,
      file: `illustration-${n}.0a1b2c3d.svg`,
      sha256: '0'.repeat(64),
      bytes: 2048,
      mediaType: 'image/svg+xml',
      source: 'everkinetic',
      sourceUrl: 'https://github.com/everkinetic/data/blob/0123abc/svg/fixture.svg',
      creators: '["Greg Priday"]',
      license: 'CC-BY-SA-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    };
  }),
  exercise_comment: async (db, v) =>
    insert(db, 'exercise_comment', {
      id: ids(db).uuidv7(),
      exerciseId: await parentId(db, v, 'exerciseId', 'exercise'),
      authorId: await parentId(db, v, 'authorId', 'user'),
      part: 'general',
      body: 'Commentaire de relecture',
      revision: 1,
      createdAt: NOW,
      ...v,
    }),
  exercise_validation: async (db, v) =>
    insert(db, 'exercise_validation', {
      id: ids(db).uuidv7(),
      exerciseId: await parentId(db, v, 'exerciseId', 'exercise'),
      reviewerId: await parentId(db, v, 'reviewerId', 'user'),
      revision: 1,
      health: 0,
      createdAt: NOW,
      ...v,
    }),
  // Ligne écrite par le chargeur (`saved_by` NULL) sauf valeur fournie.
  exercise_revision: async (db, v) =>
    insert(
      db,
      'exercise_revision',
      {
        exerciseId: await parentId(db, v, 'exerciseId', 'exercise'),
        revision: 1,
        content: '{}',
        status: 'draft',
        savedBy: null,
        savedAt: NOW,
        ...v,
      },
      ['exercise_id', 'revision'],
    ),
};

const ownerOf = (v: Values): Values => (v.ownerId ? { ownerId: v.ownerId } : {});

async function ownerOfPlace(db: Kysely<Database>, placeId: string): Promise<string> {
  const r = await sql<{ ownerId: string }>`select owner_id from place where id = ${placeId}`.execute(db);
  const place = r.rows[0];
  if (!place) throw new Error(`Lieu introuvable : ${placeId}`);
  return place.ownerId;
}

/**
 * Insère une ligne valide dans `table` (parents créés au besoin) et la renvoie relue, en camelCase.
 * `values` (camelCase) prend le pas sur les défauts.
 */
export async function insertFixtureRow(
  db: Kysely<Database>,
  table: string,
  values: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const factory = FACTORIES[table];
  if (!factory || !entityRules[table]) throw new Error(`Pas de fabrique pour la table « ${table} »`);
  return factory(db, values);
}
