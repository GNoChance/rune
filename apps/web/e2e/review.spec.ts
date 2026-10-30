import { readFile } from 'node:fs/promises';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { PRIVACY_POLICY_VERSION } from '@rune/contracts';
import { expect, test } from './support/fixtures';
import { E2E_PASSWORD, loginViaUi } from './support/flows';
import { idbGetAll } from './support/pwa';
import { bootstrapAdmin, type E2EServer } from './support/server';

// Parcours de bout en bout de la relecture (spec brique 2 §7 critère 12, plan Task 17) sur les brouillons du lot A
// de `data/` : une relectrice commente, l'admin corrige et marque traité, la relectrice santé valide, l'admin
// publie, puis un membre ouvre la fiche hors ligne. Les drapeaux de relecteur sont posés par l'écran de l'admin.

/** Fiche étalon du lot A, complète et sensible (bas du dos) : sa publication attend le feu vert santé. */
const SHEET_ID = 'dumbbell-romanian-deadlift';
const SHEET_NAME = 'Soulevé de terre roumain aux haltères';
const COMMENT = 'Précise quand souffler : en haut ou pendant la remontée ?';
const BREATHING =
  'Inspire et gaine le tronc en haut, retiens ton souffle en descendant, souffle en fin de remontée.';

/** Un parcours à quatre comptes : plus long que le délai par défaut. */
const FLOW_TIMEOUT_MS = 300_000;

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true });

async function call(
  request: APIRequestContext,
  server: E2EServer,
  method: 'POST' | 'PATCH',
  path: string,
  data: unknown,
  status: number,
): Promise<unknown> {
  const res = await request.fetch(`${server.url}${path}`, { method, headers: { Origin: server.url }, data });
  expect(res.status(), `${method} ${path}`).toBe(status);
  return res.status() === 204 ? null : res.json();
}

/**
 * Compte créé par l'API avec `code` (profil d'entraînement, lieu maison, onboarding fini), puis connecté par
 * l'écran de connexion dans `context` : l'appli démarre sur l'accueil, catalogue synchronisé.
 */
async function onboardedAccount(
  server: E2EServer,
  context: BrowserContext,
  code: string,
  username: string,
): Promise<Page> {
  const { request } = context;
  await call(
    request,
    server,
    'POST',
    '/api/invitations/accept',
    { code, username, password: E2E_PASSWORD, termsVersion: PRIVACY_POLICY_VERSION },
    201,
  );
  await call(
    request,
    server,
    'PATCH',
    '/api/me/training-profile',
    {
      coach: 'skald',
      goal: 'muscle',
      experience: 'none',
      daysPerWeek: 3,
      sessionMinutes: 45,
      onboardingStep: 'health',
    },
    200,
  );
  await call(request, server, 'POST', '/api/places', { kind: 'home', equipment: [], isPrimary: true }, 201);
  await call(request, server, 'POST', '/api/me/onboarding/complete', {}, 200);
  const page = await context.newPage();
  await page.goto(`${server.url}/login`);
  await loginViaUi(page, username);
  await page.waitForURL((url) => url.pathname === '/');
  return page;
}

/** Code d'invitation d'un membre adulte, créé par l'admin. */
async function invite(server: E2EServer, admin: Page): Promise<string> {
  const created = (await call(
    admin.request,
    server,
    'POST',
    '/api/admin/invitations',
    { birthDate: '1992-05-04' },
    201,
  )) as { code: string };
  return created.code;
}

/** Ouvre `path` de la relecture ; « Comment relire » s'ouvre au premier passage du compte : on le ferme. */
async function openReview(page: Page, server: E2EServer, path: string, firstVisit: boolean): Promise<void> {
  await page.goto(`${server.url}${path}`);
  if (firstVisit) {
    const intro = dialog(page, 'Comment relire');
    await expect(intro).toBeVisible();
    await intro.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(intro).toBeHidden();
  }
}

/** Admin › Membres : drapeaux de relecteur de `username` posés par la feuille du membre (mot de passe ressaisi). */
async function setReviewerFlags(page: Page, username: string, health: boolean): Promise<void> {
  await button(page, `Actions pour ${username}`).click();
  await dialog(page, username).getByRole('button', { name: 'Relecture des exercices' }).click();
  const flags = dialog(page, `Relecture de ${username}`);
  await flags.getByRole('switch', { name: 'Relecture des exercices', exact: true }).click();
  if (health) await flags.getByRole('switch', { name: 'Feu vert santé', exact: true }).click();
  await flags.getByLabel('Ton mot de passe', { exact: true }).fill(E2E_PASSWORD);
  await flags.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(flags).toBeHidden();
}

test('relecture de bout en bout : commentaire, correction, feu vert santé, publication, fiche hors ligne', async ({
  server,
  page: admin,
  newContext,
}) => {
  test.setTimeout(FLOW_TIMEOUT_MS);
  const sheetPath = `/review/exercises/${SHEET_ID}`;
  let zoe: Page;
  let ines: Page;

  await test.step('admin : compte, invitations, drapeaux posés depuis Admin › Membres', async () => {
    const { code } = await bootstrapAdmin(server);
    await call(
      admin.request,
      server,
      'POST',
      '/api/invitations/accept',
      { code, username: 'camille', password: E2E_PASSWORD, termsVersion: PRIVACY_POLICY_VERSION },
      201,
    );
    await call(
      admin.request,
      server,
      'PATCH',
      '/api/me/training-profile',
      {
        coach: 'skald',
        goal: 'muscle',
        experience: 'none',
        daysPerWeek: 3,
        sessionMinutes: 45,
        onboardingStep: 'health',
      },
      200,
    );
    await call(
      admin.request,
      server,
      'POST',
      '/api/places',
      { kind: 'home', equipment: [], isPrimary: true },
      201,
    );
    await call(admin.request, server, 'POST', '/api/me/onboarding/complete', {}, 200);
    await admin.goto(`${server.url}/login`);
    await loginViaUi(admin, 'camille');
    await admin.waitForURL((url) => url.pathname === '/');

    zoe = await onboardedAccount(server, await newContext(), await invite(server, admin), 'zoe');
    ines = await onboardedAccount(server, await newContext(), await invite(server, admin), 'ines');

    await admin.goto(`${server.url}/admin/members`);
    await setReviewerFlags(admin, 'zoe', false);
    await setReviewerFlags(admin, 'ines', true);
  });

  await test.step('relectrice : commentaire sur la respiration du brouillon', async () => {
    await openReview(zoe, server, '/review/exercises?queue=drafts', true);
    await zoe.getByRole('link', { name: SHEET_NAME, exact: true }).click();
    await expect(zoe.getByRole('heading', { level: 1, name: SHEET_NAME })).toBeVisible();
    await button(zoe, 'Commenter : Respiration').click();
    const sheet = dialog(zoe, 'Commenter : Respiration');
    await sheet.getByLabel('Ton commentaire', { exact: true }).fill(COMMENT);
    await sheet.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(zoe.getByRole('list', { name: 'Commentaires : Respiration' })).toContainText(COMMENT);
  });

  await test.step('admin : corrige la fiche, marque le commentaire traité, la passe en relue', async () => {
    await openReview(admin, server, `${sheetPath}?queue=drafts`, true);
    await expect(admin.getByRole('list', { name: 'Commentaires : Respiration' })).toContainText(COMMENT);
    await button(admin, 'Modifier').click();
    await expect(admin.getByRole('heading', { level: 1, name: `Modifier « ${SHEET_NAME} »` })).toBeVisible();
    await admin.getByRole('textbox', { name: 'Respiration', exact: true }).fill(BREATHING);
    await button(admin, 'Enregistrer').click();
    await expect(admin.getByText('Version 2 enregistrée.', { exact: true })).toBeVisible();
    const comments = admin.getByRole('list', { name: 'Commentaires : Respiration' });
    await comments.getByRole('button', { name: 'Traité', exact: true }).click();
    await expect(comments.getByRole('button', { name: 'Traité', exact: true })).toHaveCount(0);
    await expect(comments).toContainText('Traité');

    await button(admin, 'Marquer relue').click();
    const review = dialog(admin, 'Marquer la version 2 relue');
    await review.getByRole('checkbox', { name: 'Consignes et sécurité vérifiées', exact: true }).check();
    await review
      .getByRole('checkbox', { name: 'Réglage « Déconseillé aux mineurs » confirmé : non', exact: true })
      .check();
    await review.getByRole('button', { name: 'Marquer relue', exact: true }).click();
    await expect(review).toBeHidden();
    await expect(admin.getByText('Statut enregistré : Relue.', { exact: true })).toBeVisible();
    // Fiche sensible sans feu vert santé : « Publier » attend, et le dit.
    await expect(button(admin, 'Publier')).toBeDisabled();
    await expect(admin.getByRole('list', { name: 'Blocages de la publication' })).toHaveText(
      'Il manque le feu vert santé sur cette version.',
    );
  });

  await test.step('relectrice santé : « Sécurité vérifiée » sur la version 3', async () => {
    await openReview(ines, server, '/review/exercises?queue=health_pending', true);
    await ines.getByRole('link', { name: SHEET_NAME, exact: true }).click();
    await expect(ines.getByText(BREATHING, { exact: true }).first()).toBeVisible();
    await button(ines, 'Sécurité vérifiée').click();
    const confirm = dialog(ines, 'Valider la version 3');
    await confirm.getByRole('button', { name: 'Valider la version 3', exact: true }).click();
    await expect(dialog(ines, 'Version 3 validée')).toBeVisible();
  });

  await test.step('admin : « Publier », puis le catalogue exporté', async () => {
    await openReview(admin, server, `${sheetPath}?queue=all`, false);
    await expect(button(admin, 'Publier')).toBeEnabled();
    await button(admin, 'Publier').click();
    const publish = dialog(admin, 'Publier la version 3');
    await publish.getByRole('button', { name: 'Publier', exact: true }).click();
    await expect(publish).toBeHidden();
    await expect(admin.getByText('Statut enregistré : Publiée.', { exact: true })).toBeVisible();

    // Export : le fichier téléchargé est le tableau des fiches, relisible par `pnpm data:pull`.
    await openReview(admin, server, '/review/exercises?queue=all', false);
    const tools = admin.getByRole('region', { name: 'Administration' });
    await expect(tools.getByText(/^\d+ fiches? à exporter$/)).toBeVisible();
    const [download] = await Promise.all([
      admin.waitForEvent('download'),
      tools.getByRole('button', { name: 'Exporter le catalogue', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('exercises-export.json');
    const path = await download.path();
    const exported = JSON.parse(await readFile(path, 'utf8')) as {
      id: string;
      status: string;
      breathing?: string;
    }[];
    expect(exported.find((sheet) => sheet.id === SHEET_ID)).toMatchObject({
      status: 'published',
      breathing: BREATHING,
    });
    await expect(tools.getByText('0 fiche à exporter', { exact: true })).toBeVisible();
  });

  await test.step('membre : la fiche publiée s’ouvre hors ligne, avec la correction', async () => {
    const context = await newContext();
    const lea = await onboardedAccount(server, context, await invite(server, admin), 'lea');
    // Catalogue servi (fiches publiées) arrivé dans la base de l'appareil.
    await expect
      .poll(async () => (await idbGetAll<{ id: string }>(lea, 'exercises')).map((s) => s.id), {
        timeout: 15_000,
      })
      .toContain(SHEET_ID);
    await context.setOffline(true);
    // Navigation dans l'appli, sans requête : WebKit refuse une navigation de document sous `setOffline`.
    await lea.evaluate((path) => history.pushState(null, '', path), `/exercises/${SHEET_ID}`);
    await expect(lea.getByRole('heading', { level: 1, name: SHEET_NAME })).toBeVisible();
    await expect(lea.getByText(BREATHING, { exact: true })).toBeVisible();
    await expect(lea.getByText('Sécurité', { exact: true }).first()).toBeVisible();
    await context.setOffline(false);
  });
});
