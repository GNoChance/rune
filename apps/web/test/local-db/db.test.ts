import { entityRules, mirroredTables, snakeToCamel } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AppDb,
  createAppDb,
  LOCAL_DB_NAME,
  LOCAL_DB_VERSION,
  mirrorStoreNames,
  NON_MIRROR_STORES,
  STORE_SCHEMAS,
} from '../../src/local-db/db';
import { deleteMeta, getMeta, setMeta } from '../../src/local-db/meta';
import { createTestLocalDb, FIXTURE_MIRRORS } from '../support/local-db';

/**
 * Tables miroir de la brique 3 déclarées au registre (Task 11) dont les magasins Dexie n'existent pas encore :
 * Task 15 les crée (`version(2)`) et retire cette liste, qui n'exempte que ces sept tables.
 */
const PENDING_TASK_15: readonly string[] = [
  'engine_decision',
  'instance_change',
  'performed_exercise',
  'performed_set',
  'program_instance',
  'slot_state',
  'workout_session',
];
const mirroredWithStore = (): string[] =>
  mirroredTables(entityRules).filter((t) => !PENDING_TASK_15.includes(t));

/** 'id, [type+createdAt]' → ['id', 'type', 'createdAt']. */
const indexedFields = (schema: string): string[] =>
  schema
    .split(',')
    .map((s) => s.trim().replace(/^[&*]|^\[|\]$/g, ''))
    .flatMap((s) => s.split('+'));

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

describe('STORE_SCHEMAS', () => {
  it('a un magasin par table miroir du registre, plus les magasins internes', () => {
    expect(
      Object.keys(STORE_SCHEMAS)
        .filter((s) => !NON_MIRROR_STORES.includes(s))
        .sort(),
    ).toEqual(mirroredWithStore());
    for (const s of NON_MIRROR_STORES) expect(STORE_SCHEMAS).toHaveProperty(s);
  });

  it("n'indexe que des colonnes du registre (camelCase) dans les miroirs", () => {
    for (const store of mirroredWithStore()) {
      const rule = entityRules[store];
      const columns = (rule?.columns ?? []).map(snakeToCamel);
      for (const field of indexedFields(STORE_SCHEMAS[store] ?? '')) expect(columns, store).toContain(field);
    }
  });
});

describe('createAppDb', () => {
  it("ouvre la base 'rune' à LOCAL_DB_VERSION", async () => {
    const db = createAppDb();
    opened.push(db);
    await db.open();
    expect(db.name).toBe(LOCAL_DB_NAME);
    expect(LOCAL_DB_NAME).toBe('rune');
    expect(db.verno).toBe(LOCAL_DB_VERSION);
  });

  it('ajoute les miroirs supplémentaires et les liste', async () => {
    const db = createAppDb(`extra-${crypto.randomUUID()}`, { extraMirrors: FIXTURE_MIRRORS });
    opened.push(db);
    expect(mirrorStoreNames(db)).toEqual([...mirroredWithStore(), ...Object.keys(FIXTURE_MIRRORS)].sort());
    await db.mirror('fixture_note').put({ id: 'n1', serverRevSeen: null, deletedAt: null });
    expect(await db.mirror('fixture_note').count()).toBe(1);
  });

  it('refuse un miroir inconnu', () => {
    const db = createTestLocalDb();
    opened.push(db);
    expect(() => db.mirror('nope')).toThrow(/nope/);
    expect(() => db.mirror('outbox')).toThrow(/outbox/);
  });

  it('expose les tables internes', async () => {
    const db = createTestLocalDb();
    opened.push(db);
    await db.open();
    expect(db.meta.name).toBe('meta');
    expect(db.outbox.schema.primKey.name).toBe('opId');
    expect(db.deadletter.schema.primKey.name).toBe('opId');
  });
});

describe('meta', () => {
  it('écrit, relit et supprime une valeur ; clé absente → undefined', async () => {
    const db = createTestLocalDb();
    opened.push(db);
    expect(await getMeta(db, 'watermark')).toBeUndefined();
    await setMeta(db, 'watermark', 'e1:42');
    await setMeta(db, 'protocol', 1);
    await setMeta(db, 'activeSessionId', null);
    expect(await getMeta(db, 'watermark')).toBe('e1:42');
    expect(await getMeta(db, 'protocol')).toBe(1);
    expect(await getMeta(db, 'activeSessionId')).toBeNull();
    await deleteMeta(db, 'watermark');
    expect(await getMeta(db, 'watermark')).toBeUndefined();
  });
});
