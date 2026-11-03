import { sql } from 'kysely';
import type { Migration } from './index';

/**
 * Visée par série copiée au démarrage de la séance (ruling R57) : `performed_set.target_reps`, les répétitions que
 * le moteur vise à chaque série, dans la fourchette `target_reps_min`–`target_reps_max`. Colonne ajoutée, nulle pour
 * les séries existantes ; aucune autre colonne ne change.
 */
export const performedSetTargetReps: Migration = {
  id: '0006_performed_set_target_reps',
  breaking: false,
  up: async (db) => {
    await sql.raw('ALTER TABLE performed_set ADD COLUMN target_reps INTEGER').execute(db);
  },
};
