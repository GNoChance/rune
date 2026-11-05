import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { HELP_RESOURCES, helpPhones } from '@rune/contracts';
import { PRECACHE_GLOBAL, type PrecacheManifest } from '../src/sw/precache-manifest';
import { E2E_TEMPLATE, writeWorkoutContent } from './support/content';
import { test as base, DEFAULT_PUBLIC_DIR, expect, REPO_ROOT } from './support/fixtures';
import { callApi, createMemberViaApi, E2E_PASSWORD, enrolViaApi, loginViaUi } from './support/flows';
import {
  goOffline,
  goOnline,
  requireServiceWorker,
  triggerForeground,
  waitForController,
} from './support/pwa';
import { E2E_DATA_DIR } from './support/server';

// Parcours du coach IA de bout en bout (spec brique 4 §19.5) : le vrai serveur, lancé par un point d'entrée de test
// qui injecte le faux client (`coach-server-entry.ts`), un scénario fixe, et la PWA de production. Un seul membre,
// administrateur : il parle au coach, accepte sa proposition, signale une réponse, la lit et la classe en admin.

const ENTRY = join(REPO_ROOT, 'apps', 'web', 'e2e', 'support', 'coach-server-entry.ts');

// Réponses du faux coach : ni chiffre ni terme interdit, elles passent le filtre de sortie comme celles du vrai.
const FIRST = 'Ta prochaine séance reprend les mêmes exercices que la dernière.';
const SECOND = 'Commence par un échauffement léger.';
const PROPOSAL_REPLY = "Voici ma proposition, tu peux l'accepter ou la refuser juste dessous.";
const HELP_REPLY =
  'Si tu te sens mal, appelle les secours tout de suite. La carte juste dessous te donne le numéro.';
const REASON_PROMPT = 'Le repos entre mes séries est trop court.';
const HELP_PROMPT = 'Je ne me sens pas bien après la séance.';
const SUGGESTION = 'Explique ma prochaine séance';
/** Les phrases d'une réponse arrivent une à une : la seconde est retenue ce temps-là côté serveur. */
const SENTENCE_DELAY_MS = 2_500;

const SCRIPT = [
  { kind: 'text', text: `${FIRST} ${SECOND}`, delayMs: SENTENCE_DELAY_MS },
  {
    kind: 'tool_use',
    id: 'toolu_e2e_proposal',
    name: 'propose_program_change',
    // L'inscription par l'API laisse le programme en révision 0 ; `A1` est le premier slot du modèle de test.
    input: {
      base_revision: 0,
      operations: [{ op: 'set_rest', slot: 'A1', seconds: 90 }],
      reason: 'Un repos plus long garde tes séries propres.',
    },
  },
  { kind: 'text', text: PROPOSAL_REPLY },
  { kind: 'tool_use', id: 'toolu_e2e_help', name: 'refer_to_help', input: { resource: 'emergency' } },
  { kind: 'text', text: HELP_REPLY },
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
      env: {
        RUNE_CONTENT_DIR: contentDir,
        E2E_COACH_SCRIPT: script,
        COACH_DEV_ALLOW_UNEVALUATED: '1',
      },
    });
  },
});

const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true });
const tab = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name, exact: true });

/** Réponse du coach (bulle de gauche) : l'indice `n` compte les bulles du fil. */
const coachBubbles = (page: Page) => page.locator('[data-role="assistant"][data-ai-generated="true"]');

const emergency = HELP_RESOURCES.find((r) => r.id === 'emergency');
if (!emergency) throw new Error('HELP_RESOURCES : ressource emergency absente');
const [callEmergency] = helpPhones(emergency);
if (!callEmergency) throw new Error('HELP_RESOURCES : numéro de la ressource emergency absent');

/** Dossier des captures du rendu de `/coach`, ignoré par git comme les données des serveurs de test. */
const SHOTS_DIR = join(E2E_DATA_DIR, 'coach-shots');

/**
 * La saisie du coach reste visible, entière au-dessus de la barre d'onglets et sans rien par-dessus : boîtes englobantes
 * du champ et de « Envoyer » dans la fenêtre, au-dessus de la barre, et le point central de chacun appartient bien à
 * l'élément (rien ne le recouvre). Page en haut puis en bas : la saisie collée ne doit pas dépendre du défilement.
 */
async function expectComposerClear(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const field = page.getByLabel('Ton message au coach', { exact: true });
  const send = button(page, 'Envoyer');
  const bar = page.getByTestId('tab-bar');
  await expect(field).toBeVisible();
  for (const scrollTo of ['top', 'bottom'] as const) {
    await page.evaluate(
      (to) => window.scrollTo(0, to === 'top' ? 0 : document.documentElement.scrollHeight),
      scrollTo,
    );
    const viewport = page.viewportSize();
    const barBox = await bar.boundingBox();
    if (!viewport || !barBox) throw new Error('fenêtre ou barre d’onglets sans boîte');
    for (const [name, element] of [
      ['champ', field],
      ['Envoyer', send],
    ] as const) {
      const box = await element.boundingBox();
      if (!box) throw new Error(`${name} sans boîte`);
      const where = `${label}, ${name}, page en ${scrollTo}`;
      expect(box.y, `${where} : sous le haut de la fenêtre`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `${where} : au-dessus de la barre d'onglets`).toBeLessThanOrEqual(
        barBox.y + 0.5,
      );
      expect(box.x + box.width, `${where} : dans la largeur`).toBeLessThanOrEqual(viewport.width + 0.5);
      const covered = await element.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return top !== node && !node.contains(top);
      });
      expect(covered, `${where} : recouvert`).toBe(false);
    }
  }
  // Capture du rendu, à regarder à l'œil (E2E_COACH_SHOTS=1). Sous WebKit, la capture de Playwright injecte une feuille
  // de style que la CSP refuse : la fixture `cspViolations` échoue alors en fin de test, sans rapport avec l'appli.
  if (process.env.E2E_COACH_SHOTS !== '1') return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  const file = join(SHOTS_DIR, `coach-${testInfo.project.name}-${label}.png`);
  await page.screenshot({ path: file, animations: 'allow', caret: 'initial' });
}

/** Le chunk paresseux de `/coach` (celui qui porte le libellé du fil) dans le build servi. */
function coachChunk(): string {
  const assets = join(DEFAULT_PUBLIC_DIR, 'assets');
  const found = readdirSync(assets)
    .filter((name) => name.endsWith('.js'))
    .filter((name) => readFileSync(join(assets, name), 'utf8').includes('Conversation avec le coach'));
  expect(found, 'un seul chunk porte la conversation du coach').toHaveLength(1);
  return `/assets/${found[0]}`;
}

/** Manifeste de précache du build : première ligne de `sw.js`. */
function precacheManifest(): PrecacheManifest {
  const first = readFileSync(join(DEFAULT_PUBLIC_DIR, 'sw.js'), 'utf8').split('\n', 1)[0] ?? '';
  const json = new RegExp(`^self\\.${PRECACHE_GLOBAL} = (\\{.*\\});$`).exec(first)?.[1];
  if (json === undefined) throw new Error('sw.js : manifeste de précache absent');
  return JSON.parse(json) as PrecacheManifest;
}

test('le chunk de /coach est dans le manifeste de précache et dans le cache du service worker', async ({
  server,
  page,
}) => {
  const chunk = coachChunk();
  expect(precacheManifest().files, 'manifeste de précache').toContain(chunk);
  await createMemberViaApi(server, page);
  await page.goto(`${server.url}/login`);
  await requireServiceWorker(page);
  await waitForController(page);
  await expect
    .poll(() => page.evaluate(async (path) => (await caches.match(path)) !== undefined, chunk), {
      message: `${chunk} en cache`,
      timeout: 30_000,
    })
    .toBe(true);
});

test('coach : accord, phrases, proposition acceptée, aide, signalement classé, hors ligne et désactivation', async ({
  server,
  context,
  page,
  browserName,
}, testInfo) => {
  test.setTimeout(300_000);
  await createMemberViaApi(server, page);
  await enrolViaApi(server, page, E2E_TEMPLATE.id, E2E_TEMPLATE.daysPerWeek);
  await page.goto(`${server.url}/login`);
  await loginViaUi(page, 'camille');
  await page.waitForURL((url) => url.pathname === '/');

  await test.step('le coach est disponible dès l’ouverture, en mode dev', async () => {
    const status = await callApi<{ available: boolean; devUnevaluated: boolean }>(page, server, {
      method: 'GET',
      path: '/api/coach/status',
      status: 200,
    });
    expect(status).toMatchObject({ available: true, devUnevaluated: true });
  });

  await test.step('accord : Mon coach, texte lu, case cochée, « Activer le coach »', async () => {
    await page.goto(`${server.url}/profile/coach`);
    await page.getByRole('link', { name: 'Activer le coach IA', exact: true }).click();
    await expect(button(page, 'Activer le coach')).toBeDisabled();
    await page.getByRole('checkbox', { name: "J'ai lu ce texte et j'accepte.", exact: true }).check();
    await button(page, 'Activer le coach').click();
    await page.waitForURL((url) => url.pathname === '/coach');
  });

  await test.step('conversation vide : bandeau IA, mode dev, saisie au-dessus de la barre', async () => {
    await expect(
      page.getByText('Tu échanges avec une intelligence artificielle', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('Mode dev : combinaison non évaluée', { exact: true })).toBeVisible();
    await expect(page.getByText("Message d'accueil", { exact: true })).toBeVisible();
    await expectComposerClear(page, testInfo, 'vide');
  });

  await test.step('premier message : les phrases arrivent une à une, badge « IA »', async () => {
    await button(page, SUGGESTION).click();
    await expect(page.getByLabel('Ton message au coach', { exact: true })).toHaveValue(SUGGESTION);
    await button(page, 'Envoyer').click();
    const bubble = coachBubbles(page).last();
    // La première phrase est affichée alors que la seconde, retenue côté serveur, n'est pas encore partie.
    await expect(bubble).toContainText(FIRST);
    await expect(bubble).not.toContainText(SECOND);
    await expect(bubble).toContainText(SECOND, { timeout: 15_000 });
    await expect(bubble.getByText('IA', { exact: true })).toBeVisible();
    await expect(button(bubble, 'Signaler')).toBeVisible();
    await expect(page.getByRole('log', { name: 'Conversation avec le coach', exact: true })).toContainText(
      SUGGESTION,
    );
    // Un message de l'utilisateur, une réponse du coach : la bulle du fil est la seule du coach (hors accueil).
    await expect(coachBubbles(page)).toHaveCount(1);
  });

  await test.step('proposition : carte dans la conversation, « Accepter », Mon programme mis à jour', async () => {
    await page.getByLabel('Ton message au coach', { exact: true }).fill(REASON_PROMPT);
    await button(page, 'Envoyer').click();
    await expect(page.getByText(PROPOSAL_REPLY)).toBeVisible({ timeout: 30_000 });
    const card = page.getByRole('article', { name: /^Proposition du coach IA/ });
    await expect(card).toHaveAttribute('data-ai-generated', 'true');
    await expect(card.getByText("Proposé par l'IA, vérifié par l'appli", { exact: true })).toBeVisible();
    // « Accepter » s'active quand la ligne de la proposition est arrivée par le pull.
    await expect(button(card, 'Accepter')).toBeEnabled({ timeout: 30_000 });
    await button(card, 'Accepter').click();
    await expect(card).toContainText('Acceptée');
    await page.goto(`${server.url}/program`);
    await expect(page.getByRole('heading', { level: 1, name: 'Mon programme', exact: true })).toBeVisible();
    const entry = page
      .getByRole('region', { name: 'Journal', exact: true })
      .getByRole('listitem')
      .filter({ hasText: 'Coach IA' });
    await expect(entry).toContainText('Accepté');
    await expect(page.getByRole('region', { name: 'Propositions en attente', exact: true })).toBeHidden();
  });

  await test.step('aide : carte avec un lien tel: de HELP_RESOURCES', async () => {
    await page.goto(`${server.url}/coach`);
    await page.getByLabel('Ton message au coach', { exact: true }).fill(HELP_PROMPT);
    await button(page, 'Envoyer').click();
    await expect(page.getByText(HELP_REPLY)).toBeVisible({ timeout: 30_000 });
    const card = page.getByRole('region', { name: emergency.label, exact: true });
    await expect(
      card.getByRole('link', { name: `Appeler le ${callEmergency.label}`, exact: true }),
    ).toHaveAttribute('href', `tel:${callEmergency.digits}`);
    await expect(card.getByRole('link', { name: "Ouvrir l'aide", exact: true })).toBeVisible();
    // Le texte du lien se lit : sa couleur n'est pas celle du fond de la carte (blanc sur blanc).
    const colors = await card
      .getByRole('link', { name: `Appeler le ${callEmergency.label}`, exact: true })
      .evaluate((a) => ({
        text: getComputedStyle(a).color,
        card: getComputedStyle(a.closest('section') as Element).backgroundColor,
      }));
    expect(colors.text).not.toBe(colors.card);
  });

  await test.step('signalement : une réponse signalée, puis lue et classée par l’admin', async () => {
    await button(coachBubbles(page).first(), 'Signaler').click();
    const sheet = page.getByRole('dialog', { name: 'Signaler cette réponse', exact: true });
    await expect(sheet.getByText("L'admin pourra lire cet échange", { exact: false })).toBeVisible();
    await sheet.getByRole('radio', { name: 'Inexact', exact: true }).check();
    await button(sheet, 'Envoyer').click();
    await expect(sheet.getByText("Merci, l'admin le lira.", { exact: true })).toBeVisible();

    await page.goto(`${server.url}/admin/coach`);
    const reports = page.getByRole('region', { name: 'Signalements', exact: true });
    await reports.getByRole('button', { name: /Inexact/ }).click();
    const detail = page.getByRole('region', { name: 'Signalement', exact: true });
    await expect(detail.getByText(FIRST, { exact: false })).toBeVisible();
    await button(detail, 'Classer').click();
    await button(
      page.getByRole('dialog', { name: 'Classer ce signalement', exact: true }),
      'Classer',
    ).click();
    await expect(page.getByText('Aucun signalement à lire.', { exact: true })).toBeVisible();
  });

  await test.step('hors ligne : conversation lisible, saisie inactive, entrée de l’accueil grisée', async () => {
    await page.goto(`${server.url}/coach`);
    const field = page.getByLabel('Ton message au coach', { exact: true });
    await expect(page.getByText(FIRST, { exact: false })).toBeVisible();
    await goOffline(server, context, browserName);
    await field.fill('Une dernière question.');
    await button(page, 'Envoyer').click();
    await expect(page.getByText('Hors ligne : le coach a besoin du réseau.', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(field).toBeDisabled();
    await expect(field).toHaveValue('Une dernière question.');
    await expect(page.getByText(FIRST, { exact: false })).toBeVisible();
    await expect(page.getByText(HELP_REPLY, { exact: true })).toBeVisible();

    await tab(page, 'Accueil').click();
    await expect
      .poll(async () => {
        await triggerForeground(page);
        return button(page, 'Parler au coach').isDisabled();
      })
      .toBe(true);
    await expect(page.getByText('Nécessite le réseau', { exact: true })).toBeVisible();

    await goOnline(server, context);
    await expect
      .poll(async () => {
        await triggerForeground(page);
        return page.getByRole('link', { name: 'Parler au coach', exact: true }).isVisible();
      })
      .toBe(true);
  });

  await test.step('la conversation revient, saisie au-dessus de la barre avec un long fil', async () => {
    await page.getByRole('link', { name: 'Parler au coach', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/coach');
    await expect(page.getByText(HELP_REPLY, { exact: true })).toBeVisible();
    await expectComposerClear(page, testInfo, 'fil');
  });

  await test.step('désactivation : mot de passe, conversations supprimées', async () => {
    await page.goto(`${server.url}/profile/coach`);
    await button(page, 'Désactiver le coach IA').click();
    const dialog = page.getByRole('dialog', { name: 'Désactiver le coach IA', exact: true });
    await dialog.getByLabel('Mot de passe', { exact: true }).fill(E2E_PASSWORD);
    await button(dialog, 'Désactiver le coach IA').click();
    await expect(page.getByText('Le coach IA est désactivé.', { exact: true })).toBeVisible();
    const status = await callApi<{ consent: { active: boolean } }>(page, server, {
      method: 'GET',
      path: '/api/coach/status',
      status: 200,
    });
    expect(status.consent.active).toBe(false);
    const threads = await callApi<unknown>(page, server, {
      method: 'GET',
      path: '/api/coach/threads',
      status: 200,
    });
    expect(JSON.stringify(threads)).not.toContain(SUGGESTION);
  });
});
