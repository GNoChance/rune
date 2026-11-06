import { PulledRow } from '@rune/contracts';
import { z } from 'zod';
import type { AppDb, MirrorRow } from '../local-db/db';
import { getMeta, setMeta } from '../local-db/meta';
import { NUTRITION_DATA_TABLES } from '../local-db/nutrition';

/**
 * Écrit les lignes tirées dans les miroirs, en une transaction (R-SYN-22) : la ligne serveur
 * remplace la copie, puis les ops en attente sur la même ligne sont rejouées dans l'ordre des
 * opId (patch → champs, delete → deletedAt ; un create en attente est ignoré). Entité sans miroir
 * ignorée.
 */
export async function applyPulledRows(db: AppDb, rows: PulledRow[]): Promise<void> {
  const known = rows.filter((r) => db.mirrorNames.includes(r.entity));
  if (known.length === 0) return;
  const stores = [...new Set(known.map((r) => r.entity))].map((e) => db.mirror(e));
  await db.transaction('rw', [db.outbox, ...stores], async () => {
    for (const { entity, rev, row } of known) {
      const merged = { ...row, serverRevSeen: rev } as MirrorRow;
      const pending = await db.outbox.where('[entity+id]').equals([entity, merged.id]).sortBy('opId');
      for (const op of pending) {
        if (op.kind === 'patch') Object.assign(merged, op.fields);
        else if (op.kind === 'delete') merged.deletedAt = op.clientTs;
      }
      await db.mirror(entity).put(merged);
    }
  });
}

/** Réponse de `GET /api/nutrition/rows` : les lignes vivantes des trois tables, au format du pull. */
export const NutritionSnapshot = z.object({
  weigh_in: z.array(PulledRow),
  nutrition_target: z.array(PulledRow),
  nutrition_checkin: z.array(PulledRow),
});
export type NutritionSnapshot = z.infer<typeof NutritionSnapshot>;

/**
 * Instantané du retour en mode complet (spec §6.4) : les copies des trois tables sont remplacées (les ops en
 * attente sont rejouées dessus) et `full` devient le mode lu, en une transaction. Une descente demandée entre-temps
 * l'emporte : rien n'est écrit, les copies restent purgées.
 */
export async function applyNutritionSnapshot(db: AppDb, snapshot: NutritionSnapshot): Promise<void> {
  const stores = NUTRITION_DATA_TABLES.map((t) => db.mirror(t));
  await db.transaction('rw', [db.outbox, db.meta, ...stores], async () => {
    if (await getMeta(db, 'nutritionPendingMode')) return;
    for (const store of stores) await store.clear();
    await applyPulledRows(db, [
      ...snapshot.weigh_in,
      ...snapshot.nutrition_target,
      ...snapshot.nutrition_checkin,
    ]);
    await setMeta(db, 'nutritionEffectiveMode', 'full');
  });
}
