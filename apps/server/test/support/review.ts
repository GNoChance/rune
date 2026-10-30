import type { DraftSheet, TransitionRequest } from '@rune/contracts';
import { canonicalJson, contentOf } from '@rune/domain';
import { rebuildCatalog } from '../../src/catalog/bundle';
import { insertSheet, sheetToRow } from '../../src/catalog/repo';
import type { TestContext } from './context';

/*
 * Fiches en base pour les tests de la relecture et de l'édition. `seedSheet` et `saveSheet` écrivent en base sans
 * passer par l'API ; `putSheet` et `postTransition` passent par les routes de l'admin (`/api/admin/exercises`).
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

/** `PUT /api/admin/exercises/:id` (enregistrement par l'admin). */
export function putSheet(
  ctx: TestContext,
  cookie: string,
  id: string,
  sheet: Readonly<Record<string, unknown>>,
  baseRevision: number,
): Promise<Response> {
  return ctx.request(`/api/admin/exercises/${id}`, { method: 'PUT', cookie, json: { sheet, baseRevision } });
}

/** `POST /api/admin/exercises/:id/transition`. */
export function postTransition(
  ctx: TestContext,
  cookie: string,
  id: string,
  body: TransitionRequest,
): Promise<Response> {
  return ctx.request(`/api/admin/exercises/${id}/transition`, { method: 'POST', cookie, json: body });
}

/**
 * Reconstruit le bloc servi depuis la base, comme le chargeur au démarrage ; `templates` remplace les modèles de
 * programmes gardés (sinon ceux de la reconstruction précédente). Rend la version du catalogue.
 */
export async function rebuild(ctx: TestContext, templates?: readonly unknown[]): Promise<string> {
  const bundle = await ctx.deps.db.transaction().execute((trx) => rebuildCatalog(trx, ctx.deps, templates));
  return bundle.version;
}
