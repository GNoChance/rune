import { EXERCISES_EXPORT_FILE, SaveSheetRequest, TransitionRequest } from '@rune/contracts';
import { type Context, Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { requireAdmin } from '../auth/session';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { parseJson } from '../http/validate';
import { exportCatalog, saveSheet, transitionSheet } from './edit';

/**
 * Monté sous /api/admin/exercises (spec brique 2 §3.9) : édition des fiches, transitions et export du catalogue,
 * pour l'admin seulement (une relectrice reçoit 403). Classe H : rien n'est mis en cache ni synchronisé. Chaque
 * écriture est une transaction `BEGIN IMMEDIATE` (contrôle de la révision de départ, spec §3.5).
 */
export function adminExerciseRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  // Déjà posée par adminRoutes sur /api/admin/* ; répétée ici pour que ce module ne dépende pas de son montage.
  routes.use('*', requireAdmin);

  const callerOf = (c: Context<AppEnv>) => {
    const user = c.get('user');
    if (!user) throw httpError('unauthenticated');
    return user;
  };

  routes.get('/export', async (c) => {
    const text = await deps.db.transaction().execute((trx) => exportCatalog(trx));
    c.header('Content-Type', 'application/json; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${EXERCISES_EXPORT_FILE}"`);
    c.header('Cache-Control', 'no-store');
    return c.body(text);
  });

  routes.put('/:id', async (c) => {
    const caller = callerOf(c);
    const body = await parseJson(c, SaveSheetRequest);
    const id = c.req.param('id');
    return c.json(await deps.db.transaction().execute((trx) => saveSheet(trx, deps, caller, id, body)));
  });

  routes.post('/:id/transition', async (c) => {
    const caller = callerOf(c);
    const body = await parseJson(c, TransitionRequest);
    const id = c.req.param('id');
    return c.json(await deps.db.transaction().execute((trx) => transitionSheet(trx, deps, caller, id, body)));
  });

  return routes;
}
