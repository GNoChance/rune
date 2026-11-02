// Usage : node apps/web/scripts/screenshots.mjs [dossier]
// Captures de relecture de la refonte : build de production (prénom du porteur « Alex », comme les E2E),
// serveur jetable sur une base neuve (`init`, administrateur amorcé), puis chaque écran à 390 × 844 dans le
// Chromium de Playwright, une fois en clair et une fois en sombre (apparence Auto, schéma du téléphone émulé).
// Écrit `<dossier>/<écran>-<clair|sombre>.png` ; par défaut `.e2e-data/screenshots/`, hors dépôt (ignoré par
// git). Mouvement réduit : chaque écran est capturé dans son état final, sans attendre ses animations.
// Contenu servi : celui des E2E des séances (fiches publiées et modèle de programme de test), le `data/` du dépôt
// n'ayant que des brouillons, plus une copie « salle » du modèle, recommandée à l'onboarding (salle, débutant) ;
// les écrans de la brique 3 (programme, séance, fin de séance, historique, réglages de charge) en ont besoin.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, devices } from '@playwright/test';
import { build } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIR = join(here, '..');
const REPO_ROOT = join(WEB_DIR, '..', '..');
const SERVER_DIR = join(REPO_ROOT, 'apps', 'server');
const outDir = resolve(process.argv[2] ?? join(REPO_ROOT, '.e2e-data', 'screenshots'));
const workDir = join(REPO_ROOT, '.e2e-data', `screenshots-${Date.now()}`);
const publicDir = join(workDir, 'dist');
const dataDir = join(workDir, 'data');
const contentDir = join(workDir, 'content');

/** 31 points de code, comme les E2E : au-dessus du minimum admin, pas de changement imposé. */
const PASSWORD = 'cheval agrafe batterie correcte';
const USERNAME = 'camille';
const GYM = { name: 'Salle du Port', city: 'Lyon' };
const THEMES = [
  { name: 'clair', colorScheme: 'light' },
  { name: 'sombre', colorScheme: 'dark' },
];
const VIEWPORT = { width: 390, height: 844 };
const HEALTH_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 30_000;

async function freePort() {
  const probe = createServer();
  await new Promise((done, fail) => {
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', done);
  });
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}

/** Serveur (ou CLI) du dépôt, `node --import tsx src/main.ts <args>` lancé depuis apps/server. */
function spawnServer(args, env) {
  return spawn(process.execPath, ['--import', 'tsx', 'src/main.ts', ...args], {
    cwd: SERVER_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runCli(args, env) {
  return new Promise((done, fail) => {
    const child = spawnServer(args, env);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', fail);
    child.once('close', (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

function healthy(port) {
  return new Promise((done) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', agent: false }, (res) => {
      res.resume();
      done(res.statusCode === 200);
    });
    req.setTimeout(1000, () => req.destroy());
    req.once('error', () => done(false));
  });
}

/** Attend `check()` vrai, `timeout` ms au plus ; l'échec nomme ce qui était attendu. */
async function until(what, check, timeout = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`${what} : rien en ${timeout / 1000} s`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Contenu de `contentDir` : `writeWorkoutContent` des E2E (module TypeScript, lancé par `tsx`), puis la copie
 * « salle » du modèle de test, pour que l'onboarding de ce script (À la salle, Jamais) recommande un programme.
 */
async function writeContent() {
  const module = pathToFileURL(join(WEB_DIR, 'e2e', 'support', 'content.ts')).href;
  const code = `const { writeWorkoutContent } = await import(${JSON.stringify(module)});
writeWorkoutContent(${JSON.stringify(contentDir)});`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    cwd: WEB_DIR,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const [exitCode] = await once(child, 'exit');
  if (exitCode !== 0) throw new Error(`contenu de test : échec (code ${exitCode})`);
  const home = JSON.parse(readFileSync(join(contentDir, 'programs', 'e2e-home-full-body.json'), 'utf8'));
  const gym = { ...home, id: 'e2e-gym-full-body', name: 'Salle · Corps entier (test)', context: 'gym' };
  writeFileSync(join(contentDir, 'programs', `${gym.id}.json`), `${JSON.stringify(gym, null, 2)}\n`);
}

/** Serveur neuf : base initialisée, prêt quand /api/health répond ; renvoie le processus et le lien admin. */
async function startServer(origin, port) {
  await writeContent();
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, '.rune-volume'), '');
  const env = {
    ...process.env,
    APP_ORIGIN: origin,
    PORT: String(port),
    HOST: '127.0.0.1',
    RUNE_DATA_DIR: dataDir,
    RUNE_PUBLIC_DIR: publicDir,
    RUNE_CONTENT_DIR: contentDir,
    APP_VERSION: 'screenshots',
  };
  const init = await runCli(['init'], env);
  if (init.code !== 0) throw new Error(`init a échoué (code ${init.code}) : ${init.stderr}`);
  const server = spawnServer([], env);
  server.stdout.resume();
  server.stderr.resume();
  await until('/api/health', () => healthy(port), HEALTH_TIMEOUT_MS);
  // Lien et code d'invitation jamais affichés : ils ne servent qu'à ouvrir la page d'invitation.
  const bootstrap = await runCli(['admin:bootstrap', '--birth-date', '1990-01-01'], env);
  const link = /^Lien : (.+)$/m.exec(bootstrap.stdout)?.[1]?.trim();
  if (bootstrap.code !== 0 || !link) throw new Error(`admin:bootstrap a échoué (code ${bootstrap.code})`);
  return { server, link };
}

const settle = (page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

/**
 * Capture de l'écran affiché, en clair puis en sombre : voile de démarrage retiré, un titre visible, polices
 * chargées et deux images rendues après chaque changement de schéma. Écran entier : la fenêtre prend la
 * hauteur de la page le temps de la capture (`fullPage` laisserait la barre d'onglets et les barres collées
 * au bas de la première fenêtre, par-dessus le contenu), comme une fois défilé jusqu'en bas.
 */
async function shoot(page, name) {
  await page.getByTestId('boot-splash').waitFor({ state: 'detached' });
  await page.locator('h1, h2').first().waitFor({ state: 'visible' });
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme.colorScheme });
    await settle(page);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ ...VIEWPORT, height: Math.max(VIEWPORT.height, height) });
    await settle(page);
    await page.screenshot({ path: join(outDir, `${name}-${theme.name}.png`) });
    await page.setViewportSize(VIEWPORT);
  }
  console.log(name);
}

async function visit(page, origin, path, name) {
  await page.goto(`${origin}${path}`);
  // Lectures locales de l'écran (Dexie) : la cascade attend la base avant d'entrer.
  await page.waitForLoadState('networkidle');
  await shoot(page, name);
}

/** L'appli installée : `display-mode: standalone` vrai, comme sur l'écran d'accueil du téléphone. */
function emulateStandalone() {
  const original = window.matchMedia.bind(window);
  window.matchMedia = (query) => {
    if (!/display-mode:\s*standalone/.test(query)) return original(query);
    return {
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  };
}

/** Les 9 étapes de l'onboarding (Le Skald, une salle créée), chacune capturée, jusqu'à l'accueil. */
async function onboard(page) {
  const current = page.getByTestId('onboarding-step');
  const at = (step) => page.locator(`[data-testid="onboarding-step"][data-step="${step}"]`).waitFor();
  const choose = (name) => current.getByRole('radio', { name, exact: true }).check();
  const button = (name) => page.getByRole('button', { name, exact: true });

  await at('coach');
  await shoot(page, 'onboarding-1-coach');
  await choose('Le Skald');
  await button('Continuer').click();
  await button("C'est parti").waitFor();
  await shoot(page, 'onboarding-1-presentation');
  await button("C'est parti").click();
  await at('goal');
  await choose('Prendre du muscle');
  await shoot(page, 'onboarding-2-objectif');
  await button('Continuer').click();
  await at('sport');
  await choose('Non');
  await shoot(page, 'onboarding-3-sport');
  await button('Continuer').click();
  await at('place_kind');
  await choose('À la salle');
  await shoot(page, 'onboarding-4-lieu');
  await button('Continuer').click();
  await at('place');
  await shoot(page, 'onboarding-5-salle');
  await button('Créer une salle').click();
  await page.getByLabel('Nom de la salle', { exact: true }).fill(GYM.name);
  await page.getByLabel('Ville', { exact: true }).fill(GYM.city);
  await shoot(page, 'onboarding-5-salle-creer');
  await button('Continuer').click();
  await choose('Petite salle de quartier');
  await shoot(page, 'onboarding-5-salle-equipement');
  await button('Créer la salle').click();
  await at('experience');
  await choose('Jamais');
  await shoot(page, 'onboarding-6-experience');
  await button('Continuer').click();
  await at('availability');
  await choose('3');
  await choose('45 min');
  await shoot(page, 'onboarding-7-disponibilite');
  await button('Continuer').click();
  await at('health');
  await shoot(page, 'onboarding-8-sante');
  await button('Continuer').click();
  await at('ready');
  const offline = page.getByRole('checkbox', { name: 'Prêt hors ligne', exact: true });
  await until('quête « Prêt hors ligne »', () => offline.isChecked());
  await shoot(page, 'onboarding-9-eveil-termine');
  await button('Commencer').click();
  await page.waitForURL((url) => url.pathname === '/', { timeout: READY_TIMEOUT_MS });
}

/** Capture d'une feuille du bas ouverte par `opener`, puis fermée (Échap). */
async function shootSheet(page, opener, name) {
  await page.getByRole('button', { name: opener, exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await shoot(page, name);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}

const LIVE_PATH = /^\/workout\/[0-9a-f-]{36}$/;

/**
 * Écrans de la brique 3, le programme recommandé pris à l'onboarding : Mon programme et le choix d'un autre, la
 * séance du jour, la séance en cours (repos, effort, menu d'un exercice), sa fin, l'historique, la séance libre et
 * les réglages de charge de la salle (`gymPath` : sa fiche).
 */
async function workoutScreens(page, origin, gymPath) {
  const button = (name) => page.getByRole('button', { name, exact: true });
  await visit(page, origin, '/program', 'programme');
  await visit(page, origin, '/program/choose', 'programme-choisir');
  await shootSheet(page, 'Choisir Maison · Corps entier (test)', 'programme-changer');

  await visit(page, origin, '/workout', 'seance-du-jour');
  await button('Commencer').click();
  await page.waitForURL((url) => LIVE_PATH.test(url.pathname));
  await shoot(page, 'seance-en-cours');
  await button('Valider la série 1').click();
  await page.getByRole('timer').waitFor();
  await shoot(page, 'seance-repos');
  await button('Valider la série 2').click();
  await page.getByRole('dialog', { name: 'Effort', exact: true }).waitFor();
  await shoot(page, 'seance-effort');
  await button('Encore 2 ou 3').click();
  // Effort enregistré (sa pastille le dit) avant « Terminer », qui sinon peut demander l'effort une fois de plus.
  await page
    .getByRole('button', { name: 'Effort de la série 2 : Correct', exact: true, includeHidden: true })
    .waitFor({ state: 'attached' });
  await shootSheet(page, 'Options pour Pompe', 'seance-menu-exercice');
  await button('Terminer').click();
  await page.waitForURL((url) => url.pathname.endsWith('/summary'));
  await page.getByText('Séance gravée.', { exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  await shoot(page, 'seance-fin');

  await visit(page, origin, '/history', 'historique');
  await page
    .getByRole('link', { name: /Séance A/ })
    .first()
    .click();
  await page.waitForURL((url) => url.pathname.startsWith('/history/'));
  await shoot(page, 'historique-detail');

  // Séance libre : ouverte, la recherche d'un exercice montrée, puis close sans série (abandonnée, sans résumé).
  await visit(page, origin, '/workout', 'seance-du-jour-suivante');
  await button('Séance libre').click();
  await page.waitForURL((url) => LIVE_PATH.test(url.pathname));
  await shoot(page, 'seance-libre');
  await shootSheet(page, 'Ajouter un exercice', 'seance-libre-ajout');
  await button('Terminer').click();
  await page.waitForURL((url) => url.pathname === '/workout');

  await visit(page, origin, `${gymPath}/load`, 'salle-charges');
  await visit(page, origin, '/', 'accueil-apres-seance');
  await visit(page, origin, '/progression', 'progression-apres-seance');
}

mkdirSync(outDir, { recursive: true });
let server;
let browser;
try {
  process.env.VITE_OWNER_FIRST_NAME = 'Alex';
  await build({
    root: WEB_DIR,
    configLoader: 'runner',
    logLevel: 'error',
    build: { outDir: publicDir, emptyOutDir: true },
  });
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const started = await startServer(origin, port);
  server = started.server;

  browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    viewport: VIEWPORT,
    screen: VIEWPORT,
    deviceScaleFactor: 2,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    reducedMotion: 'reduce',
    serviceWorkers: 'allow',
  });
  await context.addInitScript(emulateStandalone);
  const page = await context.newPage();

  // Pages publiques, sans session.
  await visit(page, origin, '/login', 'connexion');
  await visit(page, origin, '/reset', 'reinitialisation');
  await visit(page, origin, '/privacy', 'confidentialite-regles');
  await visit(page, origin, '/help', 'aide');
  await visit(page, origin, '/credits', 'credits');
  await visit(page, origin, '/zone-inconnue', 'introuvable');

  // Invitation administrateur, compte créé, onboarding.
  await page.goto(started.link);
  await page.getByLabel('Pseudo', { exact: true }).fill(USERNAME);
  await shoot(page, 'invitation');
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirmation', { exact: true }).fill(PASSWORD);
  await page.getByLabel("J'ai lu la page Confidentialité et règles", { exact: true }).check();
  await page.getByRole('button', { name: 'Créer mon compte', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/onboarding');
  await onboard(page);

  // Écrans connectés.
  await visit(page, origin, '/', 'accueil');
  await visit(page, origin, '/progression', 'progression');
  await visit(page, origin, '/places', 'salles');
  await page.getByRole('link', { name: GYM.name, exact: true }).first().click();
  await page.waitForURL((url) => url.pathname.startsWith('/gyms/'));
  await page.waitForLoadState('networkidle');
  await shoot(page, 'salle-fiche');
  const gymPath = new URL(page.url()).pathname;
  await visit(page, origin, '/profile', 'profil');
  await shootSheet(page, 'Se déconnecter', 'profil-deconnexion');
  await visit(page, origin, '/profile/edit', 'mon-profil');
  await visit(page, origin, '/profile/coach', 'mon-coach');
  await shootSheet(page, 'Changer de coach', 'mon-coach-changer');
  await visit(page, origin, '/profile/health', 'sante');
  await visit(page, origin, '/profile/privacy', 'confidentialite-donnees');
  await visit(page, origin, '/settings', 'reglages');
  await visit(page, origin, '/rejections', 'refus');
  await visit(page, origin, '/admin/members', 'admin-membres');
  await visit(page, origin, '/admin/invitations', 'admin-invitations');
  await visit(page, origin, '/admin/gyms', 'admin-salles');
  await visit(page, origin, '/admin/health', 'admin-serveur');
  await visit(page, origin, '/zone-inconnue', 'introuvable-connecte');
  await workoutScreens(page, origin, gymPath);
  console.log(`Captures : ${outDir}`);
} finally {
  await browser?.close();
  // Base fermée avant l'effacement (Windows refuse d'effacer un fichier SQLite encore ouvert).
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
  rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
