import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { HELP_RESOURCES, helpPhones } from '@rune/contracts';
import { addDays, mondayOf, parisDate } from '@rune/domain';
import { E2E_TEMPLATE, writeWorkoutContent } from './support/content';
import { test as base, expect, REPO_ROOT } from './support/fixtures';
import {
  activateFullViaUi,
  createMemberViaApi,
  enrolViaApi,
  FIGURE_AFTER_NUMBER,
  type FullSetup,
  inviteViaApi,
  loginViaUi,
  openFullViaApi,
  publishAdviceViaApi,
  pushViaApi,
  setServerClock,
  setupOnboardedAdmin,
  weighInOps,
} from './support/flows';
import { goOffline, goOnline, idbGetAll, triggerForeground, waitForOutboxEmpty } from './support/pwa';

// Parcours de la nutrition de bout en bout (spec brique 5 §16 point 6) : le vrai serveur, lancé par le point d'entrée de
// test `coach-server-entry.ts` (faux client du coach scripté, horloge décalée par un fichier), la PWA de production.
// Les fiches conseils de test sont publiées par l'API de relecture, le mode complet ouvert par l'API d'administration.

const ENTRY = join(REPO_ROOT, 'apps', 'web', 'e2e', 'support', 'coach-server-entry.ts');

type Script = readonly object[];

const test = base.extend<{ contentDir: string; coachScript: { turns: Script }; clockFile: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright exige un premier argument déstructuré.
  contentDir: async ({}, use, testInfo) => {
    await use(writeWorkoutContent(testInfo.outputPath('content')));
  },
  coachScript: [{ turns: [] }, { option: true }],
  // biome-ignore lint/correctness/noEmptyPattern: Playwright exige un premier argument déstructuré.
  clockFile: async ({}, use, testInfo) => {
    const file = testInfo.outputPath('clock-offset');
    writeFileSync(file, '0');
    await use(file);
  },
  serverOptions: async ({ contentDir, coachScript, clockFile }, use, testInfo) => {
    const script = testInfo.outputPath('coach-script.json');
    writeFileSync(script, JSON.stringify(coachScript.turns));
    await use({
      entry: ENTRY,
      env: {
        RUNE_CONTENT_DIR: contentDir,
        E2E_COACH_SCRIPT: script,
        E2E_CLOCK_FILE: clockFile,
        COACH_DEV_ALLOW_UNEVALUATED: '1',
      },
    });
  },
});

const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true });
const ADULT_SHEET = '[Test] Repères pour adultes';
const YOUTH_SHEET = '[Test] Repères pour jeunes';

/** Un homme de 180 cm, 80,0 kg, un peu actif ; l'objectif change d'un parcours à l'autre. */
const setupWith = (goal: FullSetup['goal']): FullSetup => ({
  sex: 'Homme',
  heightCm: 180,
  weight: '80,0',
  activity: /^Un peu actif/,
  goal,
});

/** Les pesées du lundi `monday`, 3 par semaine (lundi, mercredi, vendredi) à `kg`. */
const weekOf = (monday: string, kg: number): [string, number][] =>
  [0, 2, 4].map((d) => [addDays(monday, d), kg]);

/** Midi UTC du jour `date` : le même jour civil à Paris, été comme hiver. */
const noon = (date: string): Date => new Date(`${date}T12:00:00Z`);

/** Texte entier de la page, sans le chargement : ce que la personne lit. */
const pageText = (page: Page): Promise<string> => page.evaluate(() => document.body.innerText);

/** Administrateur adulte connecté (compte par l'API, connexion par l'écran), mode complet ouvert, fiches publiées. */
async function adminReady(
  server: Parameters<typeof createMemberViaApi>[0],
  page: Page,
): Promise<{ userId: string }> {
  const { userId } = await createMemberViaApi(server, page);
  await enrolViaApi(server, page, E2E_TEMPLATE.id, E2E_TEMPLATE.daysPerWeek);
  await openFullViaApi(server, page);
  await publishAdviceViaApi(server, page);
  await page.goto(`${server.url}/login`);
  await loginViaUi(page, 'camille');
  await page.waitForURL((url) => url.pathname === '/');
  return { userId };
}

/** Synchro relancée au premier plan jusqu'à ce que `target` apparaisse : l'écran lit la copie locale, mise à jour au tirage. */
async function syncUntilVisible(page: Page, target: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        await triggerForeground(page);
        return target.count();
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
}

/** Le centre de la fourchette d'énergie affichée par le module (« repère : 2 700 kcal »). */
const energyCentre = async (page: Page): Promise<string> =>
  (await page.getByText(/^repère : /).textContent()) ?? '';

test('adulte : activation complète, trois pesées, semaine écoulée, proposition acceptée, nouveaux repères', async ({
  server,
  page,
  clockFile,
}) => {
  test.setTimeout(240_000);
  const { userId } = await adminReady(server, page);
  const today = parisDate(new Date());
  // Le bilan de S compte quand le lundi de S-1 est au plus tôt le jour de la cible : S-1 est la première semaine
  // entière après l'activation, S la suivante, et le serveur est au lundi qui suit S.
  const weekBefore = addDays(mondayOf(today), 7);
  const week = addDays(weekBefore, 7);
  const monday = addDays(week, 7);

  await test.step('activation complète : repères du jour, fiches du mode complet', async () => {
    await activateFullViaUi(server, page, setupWith('Maintien'));
    await expect(page.getByText(/^\d[\d ]* à \d[\d ]* kcal$/)).toBeVisible();
    await expect(page.getByText('Aucun bilan pour le moment.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: ADULT_SHEET })).toBeVisible();
    await expect(page.getByRole('link', { name: '[Test] Pourquoi le poids varie' })).toBeVisible();
    await expect(page.getByText(YOUTH_SHEET)).toHaveCount(0);
  });

  await test.step('deux pesées de plus par la feuille, avec la date du jour d’avant', async () => {
    for (const [back, kg] of [
      [1, '80,2'],
      [2, '79,8'],
    ] as const) {
      await button(page, 'Noter mon poids').click();
      const sheet = page.getByRole('dialog', { name: 'Noter mon poids', exact: true });
      await sheet.getByLabel('Poids (kg)').fill(kg);
      await sheet.getByLabel('Date', { exact: true }).fill(addDays(today, -back));
      await button(sheet, 'Enregistrer').click();
      await expect(sheet).toBeHidden();
    }
    await waitForOutboxEmpty(page);
    await page.goto(`${server.url}/nutrition/weight`);
    await expect(page.getByText(/· 79,8 kg$/)).toBeVisible();
    await expect(page.getByText(/· 80,2 kg$/)).toBeVisible();
  });

  const before =
    await test.step('horloge du serveur au lundi, deux semaines de pesées, ouverture du module', async () => {
      await page.goto(`${server.url}/nutrition`);
      const centre = await energyCentre(page);
      setServerClock(clockFile, noon(monday));
      await pushViaApi(server, page, weighInOps(userId, [...weekOf(weekBefore, 80), ...weekOf(week, 78.5)]));
      await page.goto(`${server.url}/nutrition`);
      await syncUntilVisible(page, page.getByText(/^Semaine du \d/));
      return centre;
    });

  await test.step('le bilan de la semaine écoulée propose +100 kcal', async () => {
    await expect(page.getByText('Moyenne : 78,5 kg', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Ton poids baisse plus vite que prévu\. Proposition : /)).toBeVisible();
    // Un seul bilan par semaine : rouvrir le module n'en crée pas un second.
    await page.reload();
    await expect(page.getByText(/^Semaine du \d/)).toHaveCount(1);
  });

  await test.step('acceptée : les nouveaux repères remplacent les anciens', async () => {
    await button(page, 'Accepter').click();
    await expect(page.getByText('Proposition acceptée.', { exact: true })).toBeVisible();
    await expect(button(page, 'Accepter')).toBeHidden();
    await expect.poll(() => energyCentre(page), { timeout: 20_000 }).not.toBe(before);
  });
});

test('mineur : conseils seulement, aucun chiffre dans la page', async ({ server, page, newContext }) => {
  test.setTimeout(180_000);
  await adminReady(server, page);
  const year = new Date().getUTCFullYear() - 16;
  const code = await inviteViaApi(server, page, `${year}-01-01`);

  const youth = await (await newContext()).newPage();
  await createMemberViaApi(server, youth, 'lea', { code });
  await youth.goto(`${server.url}/login`);
  await loginViaUi(youth, 'lea');
  await youth.waitForURL((url) => url.pathname === '/');

  await test.step('« Activer les conseils » : la fiche des jeunes, jamais celle du mode complet', async () => {
    await youth.goto(`${server.url}/nutrition`);
    await button(youth, 'Activer les conseils').click();
    await expect(youth.getByRole('heading', { name: 'Conseils sans chiffres', exact: true })).toBeVisible();
    await expect(youth.getByRole('link', { name: YOUTH_SHEET })).toBeVisible();
    await expect(youth.getByText(ADULT_SHEET)).toHaveCount(0);
    await expect(youth.getByText('Tes repères', { exact: true })).toHaveCount(0);
  });

  await test.step('aucun nombre suivi de kcal, g, kg ou L sur les pages que le jeune parcourt', async () => {
    for (const path of ['/', '/nutrition', '/nutrition/settings', '/profile']) {
      await youth.goto(`${server.url}${path}`);
      await expect(youth.getByRole('heading').first()).toBeVisible();
      expect(await pageText(youth), path).not.toMatch(FIGURE_AFTER_NUMBER);
    }
    await youth.goto(`${server.url}/nutrition`);
    await youth.getByRole('link', { name: YOUTH_SHEET }).click();
    await expect(youth.getByText('Fais des repas réguliers.', { exact: false })).toBeVisible();
    expect(await pageText(youth), 'fiche').not.toMatch(FIGURE_AFTER_NUMBER);
  });

  await test.step('le serveur ne sert aucune ligne chiffrée', async () => {
    const res = await youth.request.get(`${server.url}/api/nutrition/rows`);
    expect(await res.json()).toEqual({
      weigh_in: [],
      nutrition_target: [],
      nutrition_checkin: [],
      nutrition_profile: [],
    });
  });
});

test('descente de mode hors ligne : tout chiffre disparaît, y compris après rechargement', async ({
  server,
  context,
  browserName,
}) => {
  test.setTimeout(240_000);
  const page = await setupOnboardedAdmin(server, context);
  await openFullViaApi(server, page);
  await publishAdviceViaApi(server, page);
  await activateFullViaUi(server, page, setupWith('Maintien'));
  await expect(page.getByText(/kcal/).first()).toBeVisible();
  await waitForOutboxEmpty(page);

  await test.step('hors ligne : « Passer en conseils sans chiffres »', async () => {
    await page.goto(`${server.url}/nutrition/settings`);
    await goOffline(server, context, browserName);
    await button(page, 'Passer en conseils sans chiffres').click();
    await expect(page.getByText('Mode actuel : Conseils sans chiffres', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Le changement part dès que le réseau revient.', { exact: true }),
    ).toBeVisible();
  });

  await test.step('plus aucun chiffre, ni dans la page ni dans la base locale', async () => {
    await page.goto(`${server.url}/nutrition`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Conseils sans chiffres', exact: true })).toBeVisible();
    expect(await pageText(page)).not.toMatch(FIGURE_AFTER_NUMBER);
    expect(await pageText(page)).not.toContain('kcal');
    for (const store of ['weigh_in', 'nutrition_target', 'nutrition_checkin']) {
      expect(await idbGetAll(page, store), store).toEqual([]);
    }
  });

  await test.step('rechargement à froid hors ligne : toujours rien', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Conseils sans chiffres', exact: true })).toBeVisible();
    expect(await pageText(page)).not.toMatch(FIGURE_AFTER_NUMBER);
    await page.goto(`${server.url}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Conseils nutrition', { exact: true })).toBeVisible();
    expect(await pageText(page)).not.toMatch(FIGURE_AFTER_NUMBER);
  });

  await test.step('le réseau revient : le serveur passe aussi en conseils sans chiffres', async () => {
    await goOnline(server, context);
    await triggerForeground(page);
    await expect
      .poll(
        async () => {
          await triggerForeground(page);
          const res = await page.request.post(`${server.url}/api/nutrition/open`, {
            headers: { Origin: server.url },
            data: {},
          });
          return ((await res.json()) as { effective_mode?: string }).effective_mode;
        },
        { timeout: 30_000 },
      )
      .toBe('qualitative');
  });
});

const TCA = HELP_RESOURCES.find((r) => r.id === 'eating_disorder');
if (!TCA) throw new Error('HELP_RESOURCES : ressource eating_disorder absente');
const TCA_PHONES = helpPhones(TCA);
const TCA_REPLY = "Si manger te pèse, tu peux en parler. La carte juste dessous te donne une ligne d'écoute.";

test.describe('coach : signal TCA', () => {
  test.use({
    coachScript: {
      turns: [
        {
          kind: 'tool_use',
          id: 'toolu_e2e_tca',
          name: 'refer_to_help',
          input: { resource: 'eating_disorder' },
        },
        { kind: 'text', text: TCA_REPLY },
      ],
    },
  });

  test('carte d’aide, bouton vers le mode sans chiffres, pause visible dans le bilan suivant', async ({
    server,
    page,
    clockFile,
  }) => {
    test.setTimeout(300_000);
    const { userId } = await adminReady(server, page);
    const today = parisDate(new Date());
    // Trois semaines de pesées stables : deux bilans de suite au-dessus de la bande de la perte, donc une baisse que la
    // pause de sécurité empêche de proposer.
    const first = addDays(mondayOf(today), 7);
    const monday = addDays(first, 21);

    await activateFullViaUi(server, page, setupWith('Perte de gras'));

    await test.step('accord du coach, puis message : carte avec la ligne d’écoute', async () => {
      await page.goto(`${server.url}/profile/coach`);
      await page.getByRole('link', { name: 'Activer le coach IA', exact: true }).click();
      await page.getByRole('checkbox', { name: "J'ai lu ce texte et j'accepte.", exact: true }).check();
      await button(page, 'Activer le coach').click();
      await page.waitForURL((url) => url.pathname === '/coach');
      await page.getByLabel('Ton message au coach', { exact: true }).fill('Je mange de moins en moins.');
      await button(page, 'Envoyer').click();
      await expect(page.getByText(TCA_REPLY)).toBeVisible({ timeout: 30_000 });
      const card = page.getByRole('region', { name: TCA.label, exact: true });
      for (const phone of TCA_PHONES) {
        await expect(
          card.getByRole('link', { name: `Appeler le ${phone.label}`, exact: true }),
        ).toHaveAttribute('href', `tel:${phone.digits}`);
      }
      await expect(card.getByRole('link', { name: "Ouvrir l'aide", exact: true })).toBeVisible();
    });

    await test.step('« Passer en mode sans chiffres » mène aux réglages, avec la suggestion du coach', async () => {
      const card = page.getByRole('region', { name: TCA.label, exact: true });
      await card.getByRole('link', { name: 'Passer en mode sans chiffres', exact: true }).click();
      await page.waitForURL((url) => url.pathname === '/nutrition/settings');
      await expect(
        page.getByText('Suggestion du coach : Passer en conseils sans chiffres', { exact: true }),
      ).toBeVisible();
      await expect(button(page, 'Passer en conseils sans chiffres')).toBeVisible();
    });

    await test.step('la pause est posée : les réglages le disent', async () => {
      await triggerForeground(page);
      await expect(
        page.getByText('Tes repères chiffrés sont en pause. Tu peux repasser les questions quand tu veux.', {
          exact: true,
        }),
      ).toBeVisible({ timeout: 20_000 });
    });

    await test.step('trois semaines plus tard : le bilan ne propose aucune baisse', async () => {
      setServerClock(clockFile, noon(monday));
      await pushViaApi(
        server,
        page,
        weighInOps(userId, [
          ...weekOf(first, 80),
          ...weekOf(addDays(first, 7), 80),
          ...weekOf(addDays(first, 14), 80),
        ]),
      );
      await page.goto(`${server.url}/nutrition`);
      await syncUntilVisible(page, page.getByText(/^Semaine du \d/));
      await expect(
        page.getByText(
          "Pas de baisse proposée pour l'instant. Tu peux repasser les questions quand tu veux.",
          {
            exact: true,
          },
        ),
      ).toBeVisible();
      await expect(button(page, 'Accepter')).toHaveCount(0);
    });
  });
});
