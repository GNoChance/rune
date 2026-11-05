import { CoachMessageRequest } from '@rune/contracts';
import { type Context, Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { requireUser } from '../auth/session';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { parseJson } from '../http/validate';
import { prepareExchange, runExchange } from './orchestrator';
import { sseStream } from './sse';
import { deleteAllThreads, deleteThread } from './threads';
import { coachBrief, coachStatus, coachThread, coachThreads, coachToday } from './views';

/**
 * Monté sous /api/coach (spec brique 4 §7) : session exigée ; l'`Origin` des écritures est contrôlée par
 * `originGuard` (P-AUT-4). Un fil d'un autre membre répond 404, y compris à un admin. Les refus de
 * `prepareExchange` (`HttpError`) répondent en JSON avant l'ouverture du flux. Rien du contenu n'entre dans les
 * journaux (P-LOG-2). Les consentements et les signalements ont leurs propres routes.
 */
export function coachRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireUser);

  const userOf = (c: Context<AppEnv>) => {
    const user = c.get('user');
    if (!user) throw httpError('unauthenticated');
    return user;
  };

  routes.get('/status', async (c) =>
    c.json(await coachStatus(deps.db, deps, userOf(c).id, deps.clock.now())),
  );

  routes.get('/today', async (c) => c.json(await coachToday(deps.db, deps, userOf(c).id, deps.clock.now())));

  routes.post('/messages', async (c) => {
    const user = userOf(c);
    const body = await parseJson(c, CoachMessageRequest);
    const exchange = await prepareExchange(deps, user.id, body, deps.clock.now());
    return sseStream(c, (send) => runExchange(deps, exchange, send));
  });

  routes.get('/threads', async (c) =>
    c.json(await coachThreads(deps.db, deps, userOf(c).id, deps.clock.now())),
  );

  routes.get('/threads/:id', async (c) =>
    c.json(await coachThread(deps.db, userOf(c).id, c.req.param('id'))),
  );

  routes.delete('/threads/:id', async (c) => {
    const user = userOf(c);
    const id = c.req.param('id');
    await deps.db.transaction().execute((trx) => deleteThread(trx, deps, user.id, id));
    return c.body(null, 204);
  });

  routes.delete('/threads', async (c) => {
    const user = userOf(c);
    await deps.db.transaction().execute((trx) => deleteAllThreads(trx, deps, user.id));
    return c.body(null, 204);
  });

  routes.get('/brief', async (c) => c.json(await coachBrief(deps.db, deps, userOf(c).id, deps.clock.now())));

  return routes;
}
