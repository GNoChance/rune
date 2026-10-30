import { isReviewer } from '@rune/domain';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app-env';
import { requireUser } from '../auth/session';
import { httpError } from '../http/errors';

/**
 * Garde des routes `/api/review/*` (spec brique 2 §3.1) : relecteur effectif, c'est-à-dire drapeau
 * `catalog_reviewer` ou rôle admin (`isReviewer`). Sans session, les réponses de `requireUser` (401, 410, 503,
 * 403 `password_change_required`) ; connecté sans être relecteur : 403 `forbidden`. Rôle et drapeaux viennent
 * de la session, relue en base à chaque requête et jamais mise en cache : retirer le drapeau ou rétrograder un
 * admin coupe l'accès dès la requête suivante.
 */
export const requireReviewer: MiddlewareHandler<AppEnv> = async (c, next) => {
  await requireUser(c, async () => {
    const user = c.get('user');
    if (!user || !isReviewer(user)) throw httpError('forbidden');
    await next();
  });
};
