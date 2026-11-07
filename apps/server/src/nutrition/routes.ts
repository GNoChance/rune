import { createHash } from 'node:crypto';
import {
  ModeRequestSchema,
  ScreenRequestSchema,
  SettingsChangesSchema,
  SettingsPreviewRequestSchema,
} from '@rune/contracts';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { requireUser } from '../auth/session';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { parseJson } from '../http/validate';
import { assertHealthConsent } from '../privacy/consent';
import { liveRowsOf } from '../sync/pull';
import { publishedSheets, servedFor } from './advice-review';
import { checkinRoutes } from './checkin-routes';
import { loadNutritionContext } from './context';
import { openNutrition } from './open';
import { changeMode, submitScreen } from './screen';
import { deleteNutritionData, previewSettings, saveSettings } from './settings';

/**
 * Instantané du retour en mode complet : les trois tables et le profil, dont les colonnes C2 ne reviennent pas seules
 * par le pull (rev inchangé pendant l'autre mode, curseur commun).
 */
const MIRRORED_TABLES = ['weigh_in', 'nutrition_target', 'nutrition_checkin', 'nutrition_profile'] as const;

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

  // Garde accord santé avant la validation du corps (ordre des erreurs, comme les autres routes C2).
  routes.post('/screen', async (c) => {
    const user = userOf(c);
    await assertHealthConsent(deps.db, user.id);
    return c.json(await submitScreen(deps, user, await parseJson(c, ScreenRequestSchema)));
  });

  routes.put('/mode', async (c) => {
    const user = userOf(c);
    // `full` n'est pas dans le schéma : la montée passe par l'écran de sécurité.
    const raw: unknown = await c.req.json().catch(() => null);
    if (typeof raw === 'object' && raw !== null && (raw as { mode?: unknown }).mode === 'full') {
      throw httpError('screen_required');
    }
    const { mode } = await parseJson(c, ModeRequestSchema);
    return c.json(await changeMode(deps, user, mode));
  });

  routes.post('/settings/preview', async (c) => {
    const { changes } = await parseJson(c, SettingsPreviewRequestSchema);
    return c.json(await previewSettings(deps, userOf(c), changes));
  });

  routes.put('/settings', async (c) =>
    c.json(await saveSettings(deps, userOf(c), await parseJson(c, SettingsChangesSchema))),
  );

  routes.route('/checkins', checkinRoutes(deps));

  // Fiches publiées pour l'âge et le mode effectif. ETag = "<version des fiches>-<audience>-<mode>", où la version
  // est l'empreinte des (id, version, publication) des fiches publiées : elle change à toute publication, retrait
  // ou modification de texte.
  routes.get('/sheets', async (c) => {
    const ctx = await loadNutritionContext(deps.db, deps, userOf(c).id);
    const mode = ctx.effective.mode;
    const audience = ctx.age < 18 ? 'minors' : 'adults';
    const published = await publishedSheets(deps.db);
    const version = createHash('sha256')
      .update(published.map(({ row }) => `${row.id}:${row.version}:${row.publishedAt}`).join('|'))
      .digest('hex')
      .slice(0, 16);
    const etag = `"${version}-${audience}-${mode}"`;
    c.header('ETag', etag);
    c.header('Cache-Control', 'no-cache');
    const matches = (c.req.header('If-None-Match') ?? '')
      .split(',')
      .map((v) => v.trim().replace(/^W\//, ''))
      .includes(etag);
    if (matches) return c.body(null, 304);
    return c.json(servedFor(published, ctx.age, mode));
  });

  routes.delete('/data', async (c) => c.json(await deleteNutritionData(deps, userOf(c))));

  // Lignes vivantes des trois tables et du profil au format du pull ; vides hors mode effectif `full`.
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
