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

/** Instance parente créée à la volée : terminée, pour laisser la place à une instance active du même compte. */
const ENDED = { status: 'ended', endedAt: NOW };

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
  // Programmes et séances (brique 3) : les parents partagent le propriétaire de la ligne demandée.
  program_instance: owned('program_instance', () => ({
    templateId: 'full-body-3',
    templateVersion: 1,
    snapshot: '{}',
    daysPerWeek: 3,
    status: 'active',
    startedAt: NOW,
  })),
  instance_change: async (db, v) => {
    const ownerId = await parentId(db, v, 'ownerId', 'user');
    const instanceId = await parentId(db, v, 'instanceId', 'program_instance', { ownerId, ...ENDED });
    return insert(db, 'instance_change', {
      id: ids(db).uuidv7(),
      ownerId,
      ...SYNC,
      instanceId,
      baseRevision: 0,
      author: 'user',
      operations: '[{"type":"start_deload"}]',
      reasonCode: 'USER_CHANGE',
      status: 'proposed',
      ...v,
    });
  },
  slot_state: async (db, v) => {
    const ownerId = await parentId(db, v, 'ownerId', 'user');
    const instanceId = await parentId(db, v, 'instanceId', 'program_instance', { ownerId, ...ENDED });
    const slotId = (v.slotId as string | undefined) ?? 'push-1';
    const exerciseId = (v.exerciseId as string | undefined) ?? 'bench-press';
    return insert(db, 'slot_state', {
      id: `${instanceId}:${slotId}:${exerciseId}`,
      ownerId,
      ...SYNC,
      instanceId,
      slotId,
      exerciseId,
      mode: 'double',
      rulesVersion: '1',
      ...v,
    });
  },
  workout_session: owned('workout_session', () => ({
    deviceId: 'device-1',
    startedAt: NOW,
    status: 'in_progress',
    weekType: 'normal',
    rulesVersion: '1',
    appVersion: '0.3.0',
    profile: 'adult',
  })),
  performed_exercise: async (db, v) => {
    const ownerId = await parentId(db, v, 'ownerId', 'user');
    const sessionId = await parentId(db, v, 'sessionId', 'workout_session', { ownerId });
    return insert(db, 'performed_exercise', {
      id: ids(db).uuidv7(),
      ownerId,
      ...SYNC,
      sessionId,
      exerciseId: 'bench-press',
      position: 1,
      ...v,
    });
  },
  // 1-1 avec performed_exercise : `id` = son identifiant.
  engine_decision: async (db, v) => {
    const ownerId = await parentId(db, v, 'ownerId', 'user');
    const id = await parentId(db, v, 'id', 'performed_exercise', { ownerId });
    return insert(db, 'engine_decision', {
      id,
      ownerId,
      ...SYNC,
      exerciseId: 'bench-press',
      result: 'HOLD',
      reasonCode: 'HOLD_DEFAULT',
      profile: 'adult',
      rulesVersion: '1',
      ...v,
    });
  },
  performed_set: async (db, v) => {
    const ownerId = await parentId(db, v, 'ownerId', 'user');
    const performedExerciseId = await parentId(db, v, 'performedExerciseId', 'performed_exercise', {
      ownerId,
    });
    return insert(db, 'performed_set', {
      id: ids(db).uuidv7(),
      ownerId,
      ...SYNC,
      performedExerciseId,
      position: 1,
      kind: 'work',
      loadMode: 'barbell',
      loadG: 60_000,
      reps: 8,
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
  // Coach (brique 4, classe H) : fil du jour, `day` distinct par fil pour respecter UNIQUE (user_id, day).
  coach_thread: async (db, v) =>
    insert(db, 'coach_thread', {
      id: ids(db).uuidv7(),
      userId: await parentId(db, v, 'userId', 'user'),
      day: `2026-11-${String((next(db) % 28) + 1).padStart(2, '0')}`,
      audience: 'adult',
      persona: 'ombre',
      model: 'claude-test',
      effort: 'medium',
      promptVersion: '1',
      toolsVersion: '1',
      briefSchema: 'coach-brief/1',
      brief: '{}',
      isOpen: 1,
      createdAt: NOW,
      ...v,
    }),
  coach_message: async (db, v) => {
    const userId = await parentId(db, v, 'userId', 'user');
    const threadId = await parentId(db, v, 'threadId', 'coach_thread', { userId });
    return insert(db, 'coach_message', {
      id: ids(db).uuidv7(),
      threadId,
      userId,
      seq: next(db),
      role: 'user',
      blocks: '[]',
      displayText: 'Bonjour',
      createdAt: NOW,
      ...v,
    });
  },
  coach_call: async (db, v) =>
    insert(db, 'coach_call', {
      id: ids(db).uuidv7(),
      userId: await parentId(db, v, 'userId', 'user'),
      day: '2026-11-03',
      createdAt: NOW,
      requestedModel: 'claude-test',
      ...v,
    }),
  coach_report: async (db, v) =>
    insert(db, 'coach_report', {
      id: ids(db).uuidv7(),
      userId: await parentId(db, v, 'userId', 'user'),
      messageSeq: 1,
      category: 'inaccurate',
      exchangeText: 'Échange signalé',
      createdAt: NOW,
      ...v,
    }),
  // Clé composée ; `month` varie pour que deux appels successifs ne se heurtent pas.
  coach_safety_counter: async (db, v) =>
    insert(
      db,
      'coach_safety_counter',
      { month: `2026-${String((next(db) % 12) + 1).padStart(2, '0')}`, kind: 'refusal', count: 1, ...v },
      ['month', 'kind'],
    ),
  // Ligne unique insérée par la migration : relue, ou remplacée si des valeurs sont fournies.
  coach_state: async (db, v) => {
    if (Object.keys(v).length > 0) await sql`delete from coach_state`.execute(db);
    else {
      const existing = await sql<Values>`select * from coach_state where id = 1`.execute(db);
      if (existing.rows[0]) return rowToCamel(existing.rows[0]);
    }
    return insert(db, 'coach_state', { id: 1, enabled: 0, updatedAt: NOW, ...v });
  },
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
