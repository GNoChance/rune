import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { requireAdmin } from '../auth/session';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { parseJson } from '../http/validate';
import { editAdviceText, getAdvice, listAdvice, transitionAdvice } from './advice-review';

const TextSchema = z.strictObject({ title: z.string().min(1), body_md: z.string().min(1) });

/** Monté sous /api/review/advice : réservé à l'admin (spec brique 5 §10.2), pas aux relectrices d'exercices. */
export function adviceRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireAdmin);

  const adminOf = (c: Context<AppEnv>) => {
    const user = c.get('user');
    if (!user) throw httpError('unauthenticated');
    return user;
  };

  routes.get('/', async (c) => c.json(await listAdvice(deps.db)));
  routes.get('/:id', async (c) => c.json(await getAdvice(deps.db, c.req.param('id'))));

  routes.put('/:id', async (c) => {
    const text = await parseJson(c, TextSchema);
    const id = c.req.param('id');
    return c.json(await deps.db.transaction().execute((trx) => editAdviceText(trx, deps, id, text)));
  });

  for (const action of ['review', 'publish', 'retire'] as const) {
    routes.post(`/:id/${action}`, async (c) => {
      const admin = adminOf(c);
      const id = c.req.param('id');
      return c.json(
        await deps.db.transaction().execute((trx) => transitionAdvice(trx, deps, admin, id, action)),
      );
    });
  }

  return routes;
}
