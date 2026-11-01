import { type EntityRule, type EntityRulesMap, entityRules, PAIN_CODE_REWRITES } from '@rune/contracts';
import { isC2Value, stripC2Fields } from './c2';
import { clearAllCommentDrafts } from './comment-drafts';
import { type AppDb, mirrorStoreNames } from './db';
import { USER_META_KEYS } from './meta';

/**
 * Efface les données de l'utilisateur ; l'appareil (deviceId) et le catalogue restent. Les brouillons de
 * commentaire de relecture (`localStorage`, hors de la base) partent en premier : déconnexion, suppression du
 * compte, compte supprimé constaté par l'API et changement de compte passent tous par ici.
 */
export async function wipeUserData(db: AppDb, opts: { keepOutbox: boolean }): Promise<void> {
  clearAllCommentDrafts();
  await db.transaction('rw', db.tables, async () => {
    for (const store of mirrorStoreNames(db)) await db.mirror(store).clear();
    await db.meta.bulkDelete([...USER_META_KEYS]);
    if (!opts.keepOutbox) {
      await db.outbox.clear();
      await db.deadletter.clear();
    }
  });
}

/** Vide les miroirs seuls (pull complet après `watermark_expired`). */
export async function clearMirrors(db: AppDb): Promise<void> {
  const stores = mirrorStoreNames(db);
  await db.transaction(
    'rw',
    stores.map((s) => db.mirror(s)),
    async () => {
      for (const store of stores) await db.mirror(store).clear();
    },
  );
}

/** Tables dont `reason_code` peut porter un code `PAIN_*` (spec brique 3 §5.5) : réécrit comme sur le serveur. */
const PAIN_CODE_ENTITIES: readonly string[] = ['instance_change', 'engine_decision'];

/** Champs avec le code `PAIN_*` de `reasonCode` remplacé ; `rewritten` dit si une valeur a changé. */
function rewritePainCode<T extends Record<string, unknown>>(
  entity: string,
  fields: T,
): { fields: T; rewritten: boolean } {
  const code = fields.reasonCode;
  if (
    !PAIN_CODE_ENTITIES.includes(entity) ||
    typeof code !== 'string' ||
    !Object.hasOwn(PAIN_CODE_REWRITES, code)
  )
    return { fields, rewritten: false };
  return {
    fields: { ...fields, reasonCode: PAIN_CODE_REWRITES[code as keyof typeof PAIN_CODE_REWRITES] },
    rewritten: true,
  };
}

/**
 * Retrait de l'accord santé (P-CST-3 étape 4), en une transaction : miroirs C2 vidés, valeurs C2
 * mises à null ailleurs ; ops sur une table C2 supprimées, clés C2 retirées des autres (un patch
 * vidé est supprimé) ; deadletter des tables C2 supprimée. Les codes `PAIN_*` des changements de programme et
 * des décisions du moteur (copies provisoires comprises) sont réécrits comme sur le serveur.
 */
export async function purgeHealthData(
  db: AppDb,
  rules: EntityRulesMap = entityRules,
): Promise<{ rowsCleared: number; opsRemoved: number; opsStripped: number }> {
  const ruleOf = (entity: string): EntityRule | undefined =>
    Object.hasOwn(rules, entity) ? rules[entity] : undefined;
  let rowsCleared = 0;
  let opsRemoved = 0;
  let opsStripped = 0;
  await db.transaction('rw', db.tables, async () => {
    for (const store of mirrorStoreNames(db)) {
      const rule = ruleOf(store);
      if (!rule) continue;
      const table = db.mirror(store);
      if (rule.category === 'C2') {
        rowsCleared += await table.count();
        await table.clear();
        continue;
      }
      const hasCodes = PAIN_CODE_ENTITIES.includes(store);
      if (rule.c2Columns.length === 0 && !rule.c2Values && !hasCodes) continue;
      for (const row of await table.toArray()) {
        const changes = Object.fromEntries(
          Object.entries(row)
            .filter(([k, v]) => isC2Value(rule, k, v))
            .map(([k]) => [k, null]),
        );
        const { fields: next, rewritten } = rewritePainCode(store, { ...row, ...changes });
        if (Object.keys(changes).length === 0 && !rewritten) continue;
        await table.put(next);
        rowsCleared += 1;
      }
    }

    for (const op of await db.outbox.toArray()) {
      const rule = ruleOf(op.entity);
      if (!rule) continue;
      if (rule.category === 'C2') {
        await db.outbox.delete(op.opId);
        opsRemoved += 1;
        continue;
      }
      const strippedOp = stripC2Fields(rule, op.fields);
      const { fields, rewritten } = rewritePainCode(op.entity, strippedOp.fields);
      if (!strippedOp.stripped && !rewritten) continue;
      if (op.kind === 'patch' && Object.keys(fields).length === 0) {
        await db.outbox.delete(op.opId);
        opsRemoved += 1;
      } else {
        await db.outbox.put({ ...op, fields });
        opsStripped += 1;
      }
    }

    const c2Entities = Object.keys(rules).filter((e) => ruleOf(e)?.category === 'C2');
    await db.deadletter.filter((d) => c2Entities.includes(d.entity)).delete();
  });
  return { rowsCleared, opsRemoved, opsStripped };
}
