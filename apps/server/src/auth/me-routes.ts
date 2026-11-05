import { DeleteAccountRequest, UpdateMeRequest } from '@rune/contracts';
import { parisDate, usernameKey, validateUsername } from '@rune/domain';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { writeStamp } from '../db/rev';
import type { AppDeps } from '../deps';
import { validClientIp } from '../http/client-ip';
import { httpError } from '../http/errors';
import { parseJson } from '../http/validate';
import { deleteAccount } from '../privacy/delete-account';
import { buildExport } from '../privacy/export';
import { buildSetsCsv } from '../privacy/sets-csv';
import { buildMe, verifyUserPassword } from './me';
import { logSecurityEvent } from './security-log';
import { clearSessionCookie, requireUser } from './session';

const isUsernameConflict = (error: unknown): boolean =>
  error instanceof Error && /UNIQUE constraint failed: user\.username_key/.test(error.message);

export function meRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireUser);

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) throw httpError('unauthenticated');
    return c.json(await buildMe(deps.db, deps, user.id, { mustChangePassword: user.mustChangePassword }));
  });

  routes.patch('/', async (c) => {
    const user = c.get('user');
    if (!user) throw httpError('unauthenticated');
    const body = await parseJson(c, UpdateMeRequest);
    const username = body.username.normalize('NFC');
    const check = validateUsername(username);
    if (!check.ok) throw httpError('username_invalid', { reason: check.reason });
    const key = usernameKey(username);
    try {
      await deps.db.transaction().execute(async (trx) => {
        const taken = await trx
          .selectFrom('user')
          .select('id')
          .where('usernameKey', '=', key)
          .where('id', '!=', user.id)
          .executeTakeFirst();
        if (taken) throw httpError('username_taken');
        const stamp = await writeStamp(trx, deps, user.id);
        await trx
          .updateTable('user')
          .set({ username, usernameKey: key, ...stamp })
          .where('id', '=', user.id)
          .execute();
        await logSecurityEvent(trx, deps, {
          type: 'username_changed',
          actorId: user.id,
          targetId: user.id,
          ip: validClientIp(c),
          outcome: 'success',
        });
      });
    } catch (error) {
      throw isUsernameConflict(error) ? httpError('username_taken') : error;
    }
    return c.json(await buildMe(deps.db, deps, user.id, { mustChangePassword: user.mustChangePassword }));
  });

  routes.get('/export', async (c) => {
    const user = c.get('user');
    if (!user) throw httpError('unauthenticated');
    const exported = await deps.db.transaction().execute(async (trx) => {
      const data = await buildExport(trx, deps, user.id);
      await logSecurityEvent(trx, deps, {
        type: 'data_exported',
        actorId: user.id,
        targetId: user.id,
        ip: validClientIp(c),
        outcome: 'success',
      });
      return data;
    });
    c.header('Content-Disposition', `attachment; filename="rune-export-${parisDate(deps.clock.now())}.json"`);
    c.header('Cache-Control', 'no-store');
    return c.json(exported);
  });

  // CSV des séries (spec brique 3 §5.6). GET authentifié par cookie SameSite=Lax : même garde Fetch Metadata que
  // l'export du catalogue (seuls la page elle-même, l'adresse tapée ou un navigateur sans l'en-tête passent).
  routes.get('/export/sets.csv', async (c) => {
    const user = c.get('user');
    if (!user) throw httpError('unauthenticated');
    const site = c.req.header('Sec-Fetch-Site');
    if (site !== undefined && site !== 'same-origin' && site !== 'none') throw httpError('origin_mismatch');
    const csv = await deps.db.transaction().execute(async (trx) => {
      const data = await buildSetsCsv(trx, user.id);
      await logSecurityEvent(trx, deps, {
        type: 'data_exported',
        actorId: user.id,
        targetId: user.id,
        ip: validClientIp(c),
        outcome: 'success',
        details: { format: 'sets_csv' },
      });
      return data;
    });
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="rune-series-${parisDate(deps.clock.now())}.csv"`);
    c.header('Cache-Control', 'no-store');
    return c.body(csv);
  });

  routes.post('/delete', async (c) => {
    const user = c.get('user');
    if (!user) throw httpError('unauthenticated');
    const body = await parseJson(c, DeleteAccountRequest);
    const ip = validClientIp(c);
    await verifyUserPassword(deps.db, deps, user, body.password, ip);
    await deps.db.transaction().execute((trx) => deleteAccount(trx, deps, user.id, { actorId: user.id, ip }));
    // Après le commit : l'échange du coach en cours s'arrête (spec brique 4 §8.7), il n'a plus de compte à servir.
    deps.coach.exchanges.abortFor(user.id, 'consent_withdrawn');
    clearSessionCookie(c, deps);
    return c.body(null, 204);
  });

  return routes;
}
