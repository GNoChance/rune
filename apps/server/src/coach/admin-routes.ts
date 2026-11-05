import {
  type CoachAdminView,
  type CoachReportDetail,
  type CoachReportSummary,
  SetCoachEnabledRequest,
} from '@rune/contracts';
import { ageBandOn, parisDate, parisMonthOf } from '@rune/domain';
import { type Context, Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { logSecurityEvent } from '../auth/security-log';
import { requireAdmin } from '../auth/session';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { parseJson } from '../http/validate';
import { microsToUsd, monthCostMicros } from './costs';
import { catalogChangedSinceEvaluation, readCoachState, resumeCoach, setCoachEnabled } from './state';

/*
 * Administration du coach (spec brique 4 §17), sous /api/admin/coach. Les seules données C3 lisibles sont celles
 * des signalements (P-ADM-1) ; coûts et compteurs sont agrégés, sans aucun nombre de messages par personne. Les
 * journaux ne portent ni texte, ni commentaire, ni pseudo (P-LOG-2). Un signalement dont le fil a été supprimé
 * reste lisible : il garde sa copie de l'échange et n'a pas de lien vers le fil.
 */

/** Les 12 derniers mois de Paris, du plus ancien au courant (`month` compris). */
function lastTwelveMonths(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => {
    const index = y * 12 + (m - 1) - (11 - i);
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
}

async function adminView(deps: AppDeps): Promise<CoachAdminView> {
  const { db } = deps;
  const month = parisMonthOf(parisDate(deps.clock.now()));
  const state = await readCoachState(db);
  const { configured } = deps.coach;
  const costs = await monthCostMicros(db, month);
  const users = await db.selectFrom('user').select(['id', 'username']).orderBy('usernameKey').execute();
  const counters = await db
    .selectFrom('coachSafetyCounter')
    .select(['month', 'kind', 'count'])
    .where('month', '>=', lastTwelveMonths(month)[0] ?? month)
    .where('month', '<=', month)
    .orderBy('month')
    .orderBy('kind')
    .execute();
  const openReports = await db
    .selectFrom('coachReport')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .executeTakeFirstOrThrow();
  const total = [...costs.values()].reduce((a, b) => a + b, 0);
  return {
    state: {
      enabled: state.enabled,
      suspendedUntil: state.suspendedUntil,
      configured: configured.ok,
      notConfiguredCause: configured.ok ? null : configured.cause,
      catalogChanged: await catalogChangedSinceEvaluation(deps),
    },
    month,
    totalUsd: microsToUsd(total),
    workspaceLimitUsd: deps.coachConfig.workspaceMonthlyLimitUsd,
    members: users.map((u) => ({
      username: u.username,
      costUsd: microsToUsd(costs.get(u.id) ?? 0),
      budgetUsd: deps.coachConfig.limits.personMonthlyBudgetUsd,
    })),
    counters,
    openReports: Number(openReports.n),
  };
}

function reportRows(db: DbExecutor) {
  return db
    .selectFrom('coachReport')
    .innerJoin('user', 'user.id', 'coachReport.userId')
    .select([
      'coachReport.id',
      'coachReport.createdAt',
      'coachReport.category',
      'coachReport.comment',
      'coachReport.exchangeText',
      'user.username',
      'user.birthDate',
    ]);
}

export function adminCoachRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  // Déjà posée par adminRoutes ; répétée pour que ce module ne dépende pas de son montage.
  routes.use('*', requireAdmin);

  const adminOf = (c: Context<AppEnv>) => {
    const admin = c.get('user');
    if (!admin) throw httpError('unauthenticated');
    return admin;
  };
  const isMinor = (birthDate: string) => ageBandOn(birthDate, parisDate(deps.clock.now())) === 'minor';

  routes.get('/', async (c) => c.json(await adminView(deps)));

  routes.put('/state', async (c) => {
    const admin = adminOf(c);
    const body = await parseJson(c, SetCoachEnabledRequest);
    await deps.db.transaction().execute((trx) => setCoachEnabled(trx, deps, body.enabled, admin.id));
    return c.body(null, 204);
  });

  routes.post('/resume', async (c) => {
    const admin = adminOf(c);
    await deps.db.transaction().execute((trx) => resumeCoach(trx, deps, admin.id));
    return c.body(null, 204);
  });

  routes.get('/reports', async (c) => {
    const rows = await reportRows(deps.db).orderBy('coachReport.createdAt', 'desc').execute();
    const list: CoachReportSummary[] = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      category: r.category,
      username: r.username,
      minor: isMinor(r.birthDate),
    }));
    return c.json(list);
  });

  routes.get('/reports/:id', async (c) => {
    const r = await reportRows(deps.db).where('coachReport.id', '=', c.req.param('id')).executeTakeFirst();
    if (r === undefined) throw httpError('not_found');
    const detail: CoachReportDetail = {
      id: r.id,
      createdAt: r.createdAt,
      category: r.category,
      username: r.username,
      minor: isMinor(r.birthDate),
      exchangeText: r.exchangeText,
      comment: r.comment,
    };
    return c.json(detail);
  });

  routes.delete('/reports/:id', async (c) => {
    const admin = adminOf(c);
    const id = c.req.param('id');
    await deps.db.transaction().execute(async (trx) => {
      const gone = await trx.deleteFrom('coachReport').where('id', '=', id).executeTakeFirst();
      if (Number(gone.numDeletedRows) === 0) throw httpError('not_found');
      await logSecurityEvent(trx, deps, {
        type: 'coach_report_classified',
        actorId: admin.id,
        targetId: id,
        ip: null,
        outcome: 'success',
      });
    });
    return c.body(null, 204);
  });

  return routes;
}
