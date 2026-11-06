import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { E2E_TEMPLATE, writeWorkoutContent } from './support/content';
import { test as base, expect, REPO_ROOT } from './support/fixtures';
import { createMemberViaApi, enrolViaApi, loginViaUi } from './support/flows';

// Parcours guidés du coach et changement de coach de bout en bout (spec brique 4.1) : le vrai serveur avec le faux
// client scripté de `coach-server-entry.ts`, comme `coach.spec.ts`. Le membre de test suit le Skald au départ.

const ENTRY = join(REPO_ROOT, 'apps', 'web', 'e2e', 'support', 'coach-server-entry.ts');

const SESSION_TEXT =
  'Je voudrais une nouvelle séance : jambes, environ 40 minutes, avec le matériel de mon lieu principal.';
const SESSION_REPLY = 'Voici une séance de jambes simple, à faire avec ton matériel.';
const ADD_TEXT = 'Ajoute cette séance à mon programme.';
const PROPOSAL_REPLY = "Voici ma proposition, tu peux l'accepter ou la refuser juste dessous.";

// Un tour par appel du modèle : la réponse à la séance, puis l'outil de proposition et sa phrase.
const SCRIPT = [
  { kind: 'text', text: SESSION_REPLY },
  {
    kind: 'tool_use',
    id: 'toolu_e2e_guided_proposal',
    name: 'propose_program_change',
    // L'inscription par l'API laisse le programme en révision 0 ; `A1` est le premier slot du modèle de test.
    input: {
      base_revision: 0,
      operations: [{ op: 'set_rest', slot: 'A1', seconds: 90 }],
      reason: 'Un repos plus long garde tes séries propres.',
    },
  },
  { kind: 'text', text: PROPOSAL_REPLY },
];

const test = base.extend<{ contentDir: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright exige un premier argument déstructuré.
  contentDir: async ({}, use, testInfo) => {
    await use(writeWorkoutContent(testInfo.outputPath('content')));
  },
  serverOptions: async ({ contentDir }, use, testInfo) => {
    const script = testInfo.outputPath('coach-script.json');
    writeFileSync(script, JSON.stringify(SCRIPT));
    await use({
      entry: ENTRY,
      env: { RUNE_CONTENT_DIR: contentDir, E2E_COACH_SCRIPT: script, COACH_DEV_ALLOW_UNEVALUATED: '1' },
    });
  },
});

const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true });
const coachBubbles = (page: Page) => page.locator('[data-role="assistant"][data-ai-generated="true"]');

test('parcours guidés puis changement de coach : nouvelle séance ajoutée au programme, conversation qui repart vide', async ({
  server,
  page,
}) => {
  test.setTimeout(240_000);
  await createMemberViaApi(server, page);
  await enrolViaApi(server, page, E2E_TEMPLATE.id, E2E_TEMPLATE.daysPerWeek);
  await page.goto(`${server.url}/login`);
  await loginViaUi(page, 'camille');
  await page.waitForURL((url) => url.pathname === '/');

  await test.step('accord donné, conversation vide avec les parcours', async () => {
    await page.goto(`${server.url}/profile/coach`);
    await page.getByRole('link', { name: 'Activer le coach IA', exact: true }).click();
    await page.getByRole('checkbox', { name: "J'ai lu ce texte et j'accepte.", exact: true }).check();
    await button(page, 'Activer le coach').click();
    await page.waitForURL((url) => url.pathname === '/coach');
    await expect(page.getByText('Voix : le Skald', { exact: true })).toBeVisible();
    await expect(button(page, 'Nouvelle séance')).toBeEnabled();
  });

  await test.step('« Nouvelle séance » : Jambes, Moyenne, un seul message composé, réponse du coach', async () => {
    await button(page, 'Nouvelle séance').click();
    await button(page, 'Jambes').click();
    await button(page, 'Moyenne (40 min)').click();
    const log = page.getByRole('log', { name: 'Conversation avec le coach', exact: true });
    await expect(log).toContainText(SESSION_TEXT);
    await expect(log).toContainText('Choisi dans un parcours');
    await expect(coachBubbles(page).last()).toContainText(SESSION_REPLY);
  });

  await test.step('« L’ajouter à mon programme » : proposition du coach, puis Accepter', async () => {
    await button(page, "L'ajouter à mon programme").click();
    await expect(page.getByRole('log', { name: 'Conversation avec le coach', exact: true })).toContainText(
      ADD_TEXT,
    );
    await expect(page.getByText(PROPOSAL_REPLY)).toBeVisible({ timeout: 30_000 });
    const card = page.getByRole('article', { name: /^Proposition du coach IA/ });
    await expect(button(card, 'Accepter')).toBeEnabled({ timeout: 30_000 });
    await button(card, 'Accepter').click();
    await expect(card).toContainText('Acceptée');
  });

  await test.step('changement de coach par la feuille de Mon coach', async () => {
    await page.goto(`${server.url}/profile/coach`);
    await button(page, 'Changer de coach').click();
    const sheet = page.getByRole('dialog', { name: 'Changer de coach', exact: true });
    await sheet.getByRole('radio', { name: "L'Ombre", exact: true }).check();
    await button(sheet, "Choisir L'Ombre").click();
    await expect(page.getByText("L'Ombre est ton nouveau coach.", { exact: true })).toBeVisible();
  });

  await test.step('la conversation repart vide, avec la voix de l’Ombre', async () => {
    await page.getByRole('link', { name: 'Ouvrir la conversation', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/coach');
    await expect(page.getByText("Voix : l'Ombre", { exact: true })).toBeVisible();
    await expect(page.getByText("Message d'accueil", { exact: true })).toBeVisible();
    await expect(page.getByText(SESSION_REPLY, { exact: false })).toHaveCount(0);
    await expect(page.getByText(SESSION_TEXT, { exact: false })).toHaveCount(0);
    await expect(button(page, 'Nouvelle séance')).toBeEnabled();
  });

  await test.step('l’ancienne conversation est dans « Conversations précédentes », avec sa voix', async () => {
    await page.goto(`${server.url}/profile/coach`);
    await page.getByRole('link', { name: 'Conversations précédentes', exact: false }).click();
    await expect(page.getByRole('link', { name: /^Conversation avec le Skald/ })).toBeVisible();
  });
});
