import { CoachReportRequest } from '@rune/contracts';
import { type Context, Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { logSecurityEvent } from '../auth/security-log';
import { requireUser } from '../auth/session';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { parseJson } from '../http/validate';

/*
 * Signalement d'une réponse du coach (spec brique 4 §16.6, §17.2). La copie de l'échange est le seul contenu que
 * l'admin lit (C3, P-ADM-1) ; elle reste, de même que le journal de sécurité qui n'en porte aucun mot (P-LOG-2).
 */

/**
 * Enregistre un signalement de `userId` et rend son identifiant. 404 si `(threadId, messageSeq)` n'est pas une
 * réponse du coach (à texte : un tour d'outil intermédiaire n'en est pas une) dans un fil de la personne, ou si la
 * question de la personne qui la précède (à texte aussi, pas un résultat d'outil) manque. Idempotent par message.
 * `exchange_text` = `Toi : <message qui précède>` + ligne vide + `Coach IA : <réponse>`.
 */
export async function createReport(
  trx: DbExecutor,
  deps: AppDeps,
  userId: string,
  req: CoachReportRequest,
): Promise<string> {
  const answer = await trx
    .selectFrom('coachMessage')
    .select(['seq', 'displayText'])
    .where('threadId', '=', req.threadId)
    .where('userId', '=', userId)
    .where('seq', '=', req.messageSeq)
    .where('role', '=', 'assistant')
    .where('displayText', 'is not', null)
    .executeTakeFirst();
  if (answer === undefined) throw httpError('not_found');
  const question = await trx
    .selectFrom('coachMessage')
    .select('displayText')
    .where('threadId', '=', req.threadId)
    .where('userId', '=', userId)
    .where('role', '=', 'user')
    .where('displayText', 'is not', null)
    .where('seq', '<', req.messageSeq)
    .orderBy('seq', 'desc')
    .executeTakeFirst();
  if (question === undefined) throw httpError('not_found');
  // Un second signalement du même message rend le premier (idempotent).
  const existing = await trx
    .selectFrom('coachReport')
    .select('id')
    .where('userId', '=', userId)
    .where('threadId', '=', req.threadId)
    .where('messageSeq', '=', req.messageSeq)
    .executeTakeFirst();
  if (existing !== undefined) return existing.id;
  const id = deps.ids.uuidv7();
  await trx
    .insertInto('coachReport')
    .values({
      id,
      userId,
      threadId: req.threadId,
      messageSeq: req.messageSeq,
      category: req.category,
      comment: req.comment ?? null,
      exchangeText: `Toi : ${question.displayText}\n\nCoach IA : ${answer.displayText}`,
      createdAt: deps.clock.now().toISOString(),
    })
    .execute();
  await logSecurityEvent(trx, deps, {
    type: 'coach_report_created',
    actorId: userId,
    targetId: id,
    ip: null,
    outcome: 'success',
  });
  return id;
}

/** Monté sous /api/coach/reports : session exigée, `POST /` → 201 `{id}`. */
export function coachReportRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireUser);

  const userOf = (c: Context<AppEnv>) => {
    const user = c.get('user');
    if (!user) throw httpError('unauthenticated');
    return user;
  };

  routes.post('/', async (c) => {
    const user = userOf(c);
    const body = await parseJson(c, CoachReportRequest);
    const id = await deps.db.transaction().execute((trx) => createReport(trx, deps, user.id, body));
    return c.json({ id }, 201);
  });

  return routes;
}
