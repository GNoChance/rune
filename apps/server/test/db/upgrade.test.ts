import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { MIGRATIONS } from '../../src/db/migrations/index';
import { openDatabase } from '../../src/db/open';
import { FakeClock } from '../support';
import { dumpSchema } from './schema-dump';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/**
 * Schémas figés des versions précédentes, au format de dumpSchema : v1 après 0001_socle, v2 après
 * 0002_coach (socle de départ de la brique 2), v3 après 0003_catalog (départ de la brique 3). Ils ne se régénèrent jamais.
 */
const PREVIOUS = [
  {
    fixture: 'schema-v1.sql',
    done: ['0001_socle'],
    applied: ['0002_coach', '0003_catalog', '0004_program', '0005_sync_rejection_codes'],
  },
  {
    fixture: 'schema-v2.sql',
    done: ['0001_socle', '0002_coach'],
    applied: ['0003_catalog', '0004_program', '0005_sync_rejection_codes'],
  },
  {
    fixture: 'schema-v3.sql',
    done: ['0001_socle', '0002_coach', '0003_catalog'],
    applied: ['0004_program', '0005_sync_rejection_codes'],
  },
];

describe('passage des versions précédentes (01 §9.1.4)', () => {
  let h: ReturnType<typeof openDatabase>;
  beforeEach(() => {
    h = openDatabase(':memory:');
  });
  afterEach(() => h.sqlite.close());

  it.each(PREVIOUS)(
    "le schéma figé $fixture reçoit $applied et devient identique à l'instantané",
    async ({ fixture, done, applied }) => {
      h.sqlite.exec(read(`../fixtures/${fixture}`));
      for (const id of done) h.sqlite.prepare("INSERT INTO schema_migrations VALUES (?, 0, 'x')").run(id);
      expect(await migrate(h.db, MIGRATIONS, new FakeClock())).toEqual({ applied, unknownNonBreaking: [] });
      expect(dumpSchema(h.sqlite)).toBe(read('../__snapshots__/schema.sql'));
    },
  );
});
