import { CreateChangeRequest, DecideChangeRequest, EnrollRequest, MachineStepRequest } from '@rune/contracts';
import { type Context, Hono } from 'hono';
import type { Transaction } from 'kysely';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { requireUser } from '../auth/session';
import { currentCatalog } from '../catalog/bundle';
import type { Database } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { parseJson } from '../http/validate';
import { acceptChange, createUserChange, ownChange, rejectChange } from './changes';
import { enroll } from './enroll';
import { machineStepTarget, setMachineStep } from './machine-step';

/**
 * Monté sous /api/program (spec brique 3 §6) : en ligne seulement, session exigée ; l'`Origin` des écritures est
 * contrôlée par `originGuard` (P-AUT-4). Une ligne d'un autre membre répond 404, y compris à un admin (05 §17.8) :
 * ce contrôle passe avant celui du corps. Chaque écriture tient dans une transaction, rejeu compris.
 */
export function programRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireUser);

  const userOf = (c: Context<AppEnv>) => {
    const user = c.get('user');
    if (!user) throw httpError('unauthenticated');
    return user;
  };
  const inTransaction = <T>(f: (trx: Transaction<Database>) => Promise<T>) =>
    deps.db.transaction().execute(f);

  // Des jours hors de 2 à 4 sont un refus métier (422 `days_out_of_range`), pas un corps invalide.
  const EnrollBody = EnrollRequest.extend({ daysPerWeek: z.number().int() });
  const RejectBody = z.strictObject({});

  routes.post('/enroll', async (c) => {
    const user = userOf(c);
    const body = await parseJson(c, EnrollBody);
    const { programTemplates } = await currentCatalog(deps);
    const instance = await inTransaction((trx) => enroll(trx, deps, user.id, body, programTemplates));
    return c.json({ instance }, 201);
  });

  routes.post('/changes', async (c) => {
    const user = userOf(c);
    const body = await parseJson(c, CreateChangeRequest);
    const catalog = await currentCatalog(deps);
    const result = await inTransaction((trx) => createUserChange(trx, deps, user.id, body, catalog));
    return c.json(result, 201);
  });

  routes.post('/changes/:id/accept', async (c) => {
    const user = userOf(c);
    const id = c.req.param('id');
    await ownChange(deps.db, user.id, id);
    const body = await parseJson(c, DecideChangeRequest);
    const catalog = await currentCatalog(deps);
    const result = await inTransaction((trx) => acceptChange(trx, deps, user.id, id, body, catalog));
    // Refus rendu après la transaction : la proposition expirée le reste.
    if ('refused' in result) throw httpError(result.refused);
    return c.json(result);
  });

  routes.post('/changes/:id/reject', async (c) => {
    const user = userOf(c);
    const id = c.req.param('id');
    await ownChange(deps.db, user.id, id);
    await parseJson(c, RejectBody);
    const result = await inTransaction((trx) => rejectChange(trx, deps, user.id, id));
    if ('refused' in result) throw httpError(result.refused);
    return c.json(result);
  });

  routes.put('/slot-states/:id/machine-step', async (c) => {
    const user = userOf(c);
    const id = c.req.param('id');
    const catalog = await currentCatalog(deps);
    await machineStepTarget(deps.db, user.id, id, catalog);
    const { stepG } = await parseJson(c, MachineStepRequest);
    const slotState = await inTransaction((trx) => setMachineStep(trx, deps, user.id, id, stepG, catalog));
    return c.json({ slotState });
  });

  return routes;
}
