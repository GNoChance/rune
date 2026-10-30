import { CreateCommentRequest, ReviewListQuery, ValidateRequest } from '@rune/contracts';
import { type Context, Hono } from 'hono';
import type { AppEnv } from '../app-env';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { parseJson, parseQuery } from '../http/validate';
import { requireReviewer } from './guard';
import { addComment, listReview, resolveComment, reviewSheet, validateSheet } from './review';

/**
 * Monté sous /api/review (spec brique 2 §3.9) : relecture des fiches, pour les relecteurs effectifs seulement
 * (`requireReviewer`, relu à chaque requête). Classe H : rien n'est mis en cache ni synchronisé. Les lectures
 * passent par une transaction pour voir la fiche, ses commentaires et ses validations dans un même état.
 */
export function reviewRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireReviewer);

  const callerOf = (c: Context<AppEnv>) => {
    const user = c.get('user');
    if (!user) throw httpError('unauthenticated');
    return user;
  };

  routes.get('/exercises', async (c) => {
    const caller = callerOf(c);
    const query = parseQuery(c, ReviewListQuery);
    return c.json(await deps.db.transaction().execute((trx) => listReview(trx, caller, query)));
  });

  routes.get('/exercises/:id', async (c) => {
    const caller = callerOf(c);
    const id = c.req.param('id');
    return c.json(await deps.db.transaction().execute((trx) => reviewSheet(trx, caller, id)));
  });

  routes.post('/exercises/:id/comments', async (c) => {
    const caller = callerOf(c);
    const body = await parseJson(c, CreateCommentRequest);
    const id = c.req.param('id');
    const comment = await deps.db.transaction().execute((trx) => addComment(trx, deps, caller, id, body));
    return c.json(comment, 201);
  });

  routes.post('/comments/:cid/resolve', async (c) => {
    const caller = callerOf(c);
    const cid = c.req.param('cid');
    return c.json(await deps.db.transaction().execute((trx) => resolveComment(trx, deps, caller, cid)));
  });

  routes.post('/exercises/:id/validations', async (c) => {
    const caller = callerOf(c);
    const body = await parseJson(c, ValidateRequest);
    const id = c.req.param('id');
    const { validation, created } = await deps.db
      .transaction()
      .execute((trx) => validateSheet(trx, deps, caller, id, body));
    return c.json(validation, created ? 201 : 200);
  });

  return routes;
}
