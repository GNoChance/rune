import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { requireUser } from '../auth/session';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { liveRowsOf } from '../sync/pull';
import { loadNutritionContext } from './context';
import { openNutrition } from './open';

const MIRRORED_TABLES = ['weigh_in', 'nutrition_target', 'nutrition_checkin'] as const;

/**
 * Monté sous /api/nutrition (spec brique 5 §7) : session exigée, `Origin` des écritures contrôlée par `originGuard`.
 * Chaque requête est bornée à l'utilisateur de la session : aucun identifiant d'autrui n'est accepté, admin compris.
 */
export function nutritionRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireUser);

  const userOf = (c: { get(key: 'user'): AppEnv['Variables']['user'] }) => {
    const user = c.get('user');
    if (!user) throw httpError('unauthenticated');
    return user;
  };

  routes.post('/open', async (c) => c.json(await openNutrition(deps, userOf(c))));

  // Lignes vivantes des trois tables au format du pull ; vides hors mode effectif `full`.
  routes.get('/rows', async (c) => {
    const user = userOf(c);
    const ctx = await loadNutritionContext(deps.db, deps, user.id);
    const full = ctx.effective.mode === 'full';
    const entries = await Promise.all(
      MIRRORED_TABLES.map(async (t) => [t, full ? await liveRowsOf(deps.db, deps, user.id, t) : []] as const),
    );
    return c.json(Object.fromEntries(entries));
  });

  return routes;
}
