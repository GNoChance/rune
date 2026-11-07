import { AdminNutritionSchema } from '@rune/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { logSecurityEvent } from '../auth/security-log';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { parseJson } from '../http/validate';

/**
 * Interrupteur du mode complet (spec brique 5 §7, D4), monté sous /api/admin/nutrition derrière `requireAdmin`.
 * Fermer `full_open` sert d'arrêt d'urgence. Le journal ne porte que le nouvel état, aucune donnée personnelle.
 */
export function adminNutritionRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // Lecture de l'état pour la page « Serveur » : un booléen, aucune donnée personnelle.
  routes.get('/', async (c) => {
    const state = await deps.db
      .selectFrom('nutritionState')
      .select('fullOpen')
      .where('id', '=', 1)
      .executeTakeFirst();
    return c.json({ full_open: state?.fullOpen === 1 });
  });

  routes.put('/', async (c) => {
    const admin = c.get('user');
    if (!admin) throw httpError('unauthenticated');
    const body = await parseJson(c, AdminNutritionSchema);
    await deps.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('nutritionState')
        .set({
          fullOpen: body.full_open ? 1 : 0,
          updatedAt: deps.clock.now().toISOString(),
          updatedBy: admin.id,
        })
        .where('id', '=', 1)
        .execute();
      await logSecurityEvent(trx, deps, {
        type: 'nutrition_state_changed',
        actorId: admin.id,
        targetId: null,
        ip: null,
        outcome: 'success',
        details: { fullOpen: body.full_open },
      });
    });
    return c.json({ full_open: body.full_open });
  });

  return routes;
}
