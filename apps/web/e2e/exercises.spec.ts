import type { Page } from '@playwright/test';
import {
  E2E_LIST_QUERY,
  E2E_LIST_SIZE,
  E2E_PUSH_UP,
  e2eListName,
  writeExercisesContent,
} from './support/content';
import { test as base, expect } from './support/fixtures';
import { setupOnboardedAdmin } from './support/flows';

// Onglet Exercices de bout en bout (spec brique 2 §4.1 et §4.2, 04 §13 critère 13) : un catalogue publié et ses
// illustrations arrivent par la synchro ; la recherche et le défilement reviennent avec Retour ; puis, serveur
// injoignable et réseau coupé, une fiche jamais ouverte s'affiche avec ses illustrations, servies par le SW.

/** Une navigation servie par le SW sous des requêtes sans réponse : bornée, pour nommer l'étape en échec. */
const SHELL_TIMEOUT_MS = 10_000;

const test = base.extend<{ contentDir: string }>({
  // Dossier de contenu du serveur : fiches publiées et SVG réels (le `data/` du dépôt n'a que des brouillons).
  // biome-ignore lint/correctness/noEmptyPattern: Playwright exige un premier argument déstructuré.
  contentDir: async ({}, use, testInfo) => {
    await use(writeExercisesContent(testInfo.outputPath('content')));
  },
  serverOptions: async ({ contentDir }, use) => {
    await use({ env: { RUNE_CONTENT_DIR: contentDir } });
  },
});

const nav = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const results = (page: Page) => page.getByRole('list', { name: 'Résultats', exact: true });

/** Nom de la ligne de résultat la plus proche du milieu de l'écran (cliquée sans défiler, loin de la barre d'onglets). */
function middleResult(page: Page): Promise<string> {
  return page.evaluate(() => {
    const middle = window.innerHeight / 2;
    const center = (el: Element) => {
      const box = el.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    const rows = [...document.querySelectorAll('ul[aria-label="Résultats"] a')];
    rows.sort((a, b) => Math.abs(center(a) - middle) - Math.abs(center(b) - middle));
    return rows[0]?.querySelector('[data-name]')?.textContent ?? '';
  });
}

test('Exercices : tuiles, recherche et Retour qui la restaure, puis une fiche publiée hors ligne avec ses illustrations', async ({
  server,
  context,
  browserName,
}) => {
  const page = await setupOnboardedAdmin(server, context);
  const exercisesTab = nav(page).getByRole('link', { name: 'Exercices', exact: true });
  const search = page.getByRole('searchbox', { name: 'Rechercher un exercice', exact: true });
  const chest = page.getByRole('link', {
    name: `Pectoraux, rang E, ${E2E_LIST_SIZE + 1} exercices`,
    exact: true,
  });

  await test.step('onglet Exercices : le catalogue synchronisé, en tuiles', async () => {
    await exercisesTab.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Exercices' })).toBeVisible();
    await expect(exercisesTab).toHaveAttribute('aria-current', 'page');
    await expect(chest).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mollets, rang E, 0 exercice', exact: true })).toBeVisible();
  });

  await test.step('recherche, fiche, puis Retour : la recherche et le défilement reviennent', async () => {
    await search.fill(E2E_LIST_QUERY);
    await expect(results(page).getByRole('link')).toHaveCount(E2E_LIST_SIZE);
    await expect(page).toHaveURL(/\/exercises\?q=pompe(\+|%20)e2e$/);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled, 'la liste des résultats défile').toBeGreaterThan(100);

    const name = await middleResult(page);
    expect(name).toMatch(/^Pompe e2e \d\d$/);
    await results(page).getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    // Un onglet de la fiche remplace son entrée d'historique : Retour revient quand même à la liste.
    await page.getByRole('tab', { name: 'Erreurs', exact: true }).click();
    await expect(page).toHaveURL(/\?tab=mistakes$/);
    await page.getByRole('button', { name: 'Retour', exact: true }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Exercices' })).toBeVisible();
    await expect(search).toHaveValue(E2E_LIST_QUERY);
    await expect(results(page).getByRole('link', { name: e2eListName(1), exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate((y) => Math.abs(window.scrollY - y) <= 2, scrolled), { timeout: 5_000 })
      .toBe(true);
  });

  await test.step('hors ligne : la fiche publiée, jamais ouverte, s’affiche avec ses illustrations', async () => {
    // Serveur injoignable (requêtes sans réponse), puis lancement à froid servi par le SW. Sous Chromium, le
    // réseau est en plus coupé (`setOffline`) une fois l'appli lancée. Pas sous WebKit : son émulation fait
    // échouer aussi ce que le SW sert depuis son cache (navigations comme images), ce que ne fait pas un iPhone
    // hors ligne ; le serveur injoignable y tient lieu de réseau absent, comme dans offline.spec.ts.
    server.setFault({ kind: 'blackhole' });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: SHELL_TIMEOUT_MS });
    await expect(search).toHaveValue(E2E_LIST_QUERY, { timeout: SHELL_TIMEOUT_MS });
    if (browserName === 'chromium') await context.setOffline(true);

    await search.fill('');
    await chest.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pectoraux' })).toBeVisible();
    await page
      .getByRole('list', { name: 'Exercices', exact: true })
      .getByRole('link', { name: E2E_PUSH_UP.name, exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: E2E_PUSH_UP.name })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/exercises/${E2E_PUSH_UP.id}`);
    await expect(exercisesTab).toHaveAttribute('aria-current', 'page');

    for (const pose of ['position de départ', 'position de fin']) {
      const img = page.getByRole('img', { name: `${E2E_PUSH_UP.name} : ${pose}`, exact: true });
      await expect(img).toBeVisible();
      await expect
        .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { message: pose })
        .toBeGreaterThan(0);
    }
    await expect(page.getByText('Illustration disponible après synchronisation')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Crédits des illustrations', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sécurité', exact: true })).toBeVisible();
  });
});
