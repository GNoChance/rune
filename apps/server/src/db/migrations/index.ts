import type { Kysely } from 'kysely';
import { socle } from './0001_socle';
import { coach } from './0002_coach';
import { catalog } from './0003_catalog';
import { program } from './0004_program';

export interface Migration {
  id: string;
  breaking: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: une migration écrit du DDL hors du schéma typé
  up(db: Kysely<any>): Promise<void>;
}

/** Migrations, dans l'ordre (appliquées ensemble dans une seule transaction, voir migrate). */
export const MIGRATIONS: readonly Migration[] = [socle, coach, catalog, program];
