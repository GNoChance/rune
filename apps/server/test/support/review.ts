import type { DraftSheet } from '@rune/contracts';
import { canonicalJson, contentOf } from '@rune/domain';
import { insertSheet, sheetToRow } from '../../src/catalog/repo';
import type { TestContext } from './context';

/*
 * Fiches en base pour les tests de la relecture. L'enregistrement par l'admin (`PUT`, transitions) arrive avec la
 * tâche 9 : `saveSheet` en écrit l'effet en base (fiche + ligne de révision) sans passer par l'API.
 */

/** Insère une fiche et sa première ligne de révision, comme le chargeur (`saved_by` NULL) ou `savedBy`. */
export async function seedSheet<S extends DraftSheet>(
  ctx: TestContext,
  sheet: S,
  savedBy: string | null = null,
): Promise<S> {
  await insertSheet(ctx.deps.db, sheet, {
    savedAt: ctx.clock.now().toISOString(),
    savedBy,
    exportedRevision: sheet.revision,
  });
  return sheet;
}

/**
 * Enregistre `sheet` comme nouvelle version (`revision` + 1) écrite par `savedBy` : ligne `exercise` mise à jour
 * (révision exportée inchangée) et ligne `exercise_revision` (`content` = `contentOf`). Rend la fiche écrite.
 */
export async function saveSheet<S extends DraftSheet>(
  ctx: TestContext,
  sheet: S,
  savedBy: string | null,
): Promise<S> {
  const next: S = { ...sheet, revision: sheet.revision + 1 };
  const { id, exportedRevision: _, ...changes } = sheetToRow(next, null);
  await ctx.deps.db.updateTable('exercise').set(changes).where('id', '=', id).execute();
  await ctx.deps.db
    .insertInto('exerciseRevision')
    .values({
      exerciseId: id,
      revision: next.revision,
      content: canonicalJson(contentOf(next)),
      status: next.status,
      savedBy,
      savedAt: ctx.clock.now().toISOString(),
    })
    .execute();
  return next;
}
