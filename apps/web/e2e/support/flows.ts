import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { type BrowserContext, expect, type Locator, type Page } from '@playwright/test';
import {
  type Effort,
  EXPERIENCE_LABELS,
  GOAL_LABELS,
  type LoadMode,
  PRESETS,
  PRIVACY_POLICY_VERSION,
  PROTOCOL_HEADER,
  type PushResult,
  SYNC_PROTOCOL,
  type SyncOp,
} from '@rune/contracts';
import { createMonotonicUuidV7 } from '@rune/domain';
import { ONBOARDING_COMPLETED_EVENT } from '../../src/app-events';
import { emulateStandalone, requireServiceWorker, waitForController } from './pwa';
import { bootstrapAdmin, type E2EServer } from './server';

// Parcours d'écran communs aux E2E, par les libellés exacts des composants (Interfaces §6, `exact: true`).

/** 31 points de code : au-dessus du minimum admin de 14 (R-MDP-1), pas de changement imposé. */
export const E2E_PASSWORD = 'cheval agrafe batterie correcte';

const READY_TIMEOUT_MS = 30_000;

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** Formulaire « Crée ton compte » déjà affiché ; attend l'onboarding (R-CPT-2). */
export async function createAccountViaUi(page: Page, username: string): Promise<void> {
  await page.getByLabel('Pseudo', { exact: true }).fill(username);
  await page.getByLabel('Mot de passe', { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel('Confirmation', { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel("J'ai lu la page Confidentialité et règles", { exact: true }).check();
  await button(page, 'Créer mon compte').click();
  await page.waitForURL((url) => url.pathname === '/onboarding');
}

/** Options de l'onboarding : `atReady` vérifie E8 (« Éveil terminé »), prêt hors ligne, juste avant « Commencer ». */
export interface OnboardingOptions {
  atReady?: (page: Page) => Promise<void>;
}

/**
 * Les 9 écrans de l'onboarding (spec refonte §10.1) depuis le coach : Le Skald, sa présentation, puis
 * chaque écran attendu par son `data-step`, et « Commencer » sur « Éveil terminé » une fois la quête
 * « Prêt hors ligne » cochée (R-SYN-33) ; attend l'accueil.
 */
export async function completeOnboardingViaUi(
  page: Page,
  o: { place: { kind: 'gym'; name: string; city: string } | { kind: 'home' } } & OnboardingOptions,
): Promise<void> {
  const current = page.getByTestId('onboarding-step');
  const at = (step: string) => expect(current).toHaveAttribute('data-step', step);
  const choose = (name: string) => current.getByRole('radio', { name, exact: true }).check();
  const next = () => button(page, 'Continuer').click();

  await at('coach');
  await choose('Le Skald');
  await button(page, 'Continuer').click();
  // Coach enregistré : sa présentation s'ouvre, toujours à l'étape coach.
  await button(page, "C'est parti").click();
  await at('goal');
  await choose(GOAL_LABELS.muscle);
  await next();
  await at('sport');
  await choose('Non');
  await next();
  await at('place_kind');
  await choose(o.place.kind === 'gym' ? 'À la salle' : 'À la maison');
  await next();
  await at('place');
  if (o.place.kind === 'gym') {
    // Carte « Créer une salle » sous la liste (maquette B04).
    await button(page, 'Créer une salle').click();
    await page.getByLabel('Nom de la salle', { exact: true }).fill(o.place.name);
    await page.getByLabel('Ville', { exact: true }).fill(o.place.city);
    await button(page, 'Continuer').click();
    await choose(PRESETS.gym_small.label);
    // La salle créée valide l'écran : pas de « Continuer » de l'écran.
    await button(page, 'Créer la salle').click();
  } else {
    // « Nom du lieu » prérempli.
    await next();
  }
  await at('experience');
  await choose(EXPERIENCE_LABELS.none);
  await next();
  await at('availability');
  await choose('3');
  await choose('45 min');
  await next();
  await at('health');
  await next();
  await at('ready');
  await expect(page.getByRole('checkbox', { name: 'Prêt hors ligne', exact: true })).toBeChecked({
    timeout: READY_TIMEOUT_MS,
  });
  await o.atReady?.(page);
  // La garde mène à l'accueil dès la réponse du serveur, mais « Commencer » y mène encore après le pull qui
  // suit : un geste fait entre les deux serait annulé. L'événement de fin, émis juste avant, marque la fin.
  await page.evaluate((name) => {
    const done = () => Object.assign(window, { e2eOnboardingCompleted: true });
    window.addEventListener(name, done, { once: true });
  }, ONBOARDING_COMPLETED_EVENT);
  await button(page, 'Commencer').click();
  await page.waitForFunction(() => 'e2eOnboardingCompleted' in window, null, { timeout: READY_TIMEOUT_MS });
  await page.waitForURL((url) => url.pathname === '/');
}

/** Administrateur amorcé (lien), compte créé et onboarding fini (maison) dans l'appli installée ; page contrôlée par le SW. */
export async function setupOnboardedAdmin(
  server: E2EServer,
  context: BrowserContext,
  username = 'camille',
  onboarding: OnboardingOptions = {},
): Promise<Page> {
  await emulateStandalone(context);
  const { link } = await bootstrapAdmin(server);
  const page = await context.newPage();
  await page.goto(link);
  await requireServiceWorker(page);
  await createAccountViaUi(page, username);
  await completeOnboardingViaUi(page, { place: { kind: 'home' }, ...onboarding });
  await waitForController(page);
  return page;
}

/** Formulaire de connexion déjà affiché (/login). */
export async function loginViaUi(page: Page, username: string): Promise<void> {
  await page.getByLabel('Pseudo', { exact: true }).fill(username);
  await page.getByLabel('Mot de passe', { exact: true }).fill(E2E_PASSWORD);
  await button(page, 'Se connecter').click();
}

// ---------------------------------------------------------------------------------------------------------------
// API : un membre et son historique préparés côté serveur, sans passer par les écrans
// ---------------------------------------------------------------------------------------------------------------

/**
 * Requête à l'API comme l'appli : cookie du contexte de `page` (partagé avec `page.request`), `Origin` de l'appli
 * (P-AUT-4) et en-tête de protocole de la synchro ; le statut attendu est vérifié. Rend le corps JSON.
 */
export async function callApi<T = unknown>(
  page: Page,
  server: E2EServer,
  o: { method: 'GET' | 'POST' | 'PATCH' | 'PUT'; path: string; data?: unknown; status: number },
): Promise<T> {
  const res = await page.request.fetch(`${server.url}${o.path}`, {
    method: o.method,
    headers: { Origin: server.url, [PROTOCOL_HEADER]: String(SYNC_PROTOCOL) },
    ...(o.data === undefined ? {} : { data: o.data }),
  });
  expect(res.status(), `${o.method} ${o.path} : ${await res.text()}`).toBe(o.status);
  return (await res.json()) as T;
}

/**
 * Administrateur créé par l'API (invitation, profil avec son coach, maison principale sans matériel, onboarding
 * fini) ; le contexte de `page` garde sa session. Rend son identifiant et celui de la maison. Avec `code` (invitation
 * d'un membre, voir `inviteViaApi`), c'est ce membre qui est créé à la place de l'administrateur.
 */
export async function createMemberViaApi(
  server: E2EServer,
  page: Page,
  username = 'camille',
  o: { code?: string } = {},
): Promise<{ userId: string; placeId: string }> {
  const code = o.code ?? (await bootstrapAdmin(server)).code;
  const me = await callApi<{ id: string }>(page, server, {
    method: 'POST',
    path: '/api/invitations/accept',
    data: { code, username, password: E2E_PASSWORD, termsVersion: PRIVACY_POLICY_VERSION },
    status: 201,
  });
  await callApi(page, server, {
    method: 'PATCH',
    path: '/api/me/training-profile',
    data: {
      coach: 'skald',
      goal: 'muscle',
      experience: 'none',
      daysPerWeek: 3,
      sessionMinutes: 45,
      onboardingStep: 'health',
    },
    status: 200,
  });
  const place = await callApi<{ id: string }>(page, server, {
    method: 'POST',
    path: '/api/places',
    data: { kind: 'home', equipment: [], isPrimary: true },
    status: 201,
  });
  await callApi(page, server, { method: 'POST', path: '/api/me/onboarding/complete', data: {}, status: 200 });
  return { userId: me.id, placeId: place.id };
}

/** Invitation d'un membre né le `birthDate`, créée par l'administrateur de `admin` ; rend son code. */
export async function inviteViaApi(server: E2EServer, admin: Page, birthDate: string): Promise<string> {
  const created = await callApi<{ code: string }>(admin, server, {
    method: 'POST',
    path: '/api/admin/invitations',
    data: { birthDate },
    status: 201,
  });
  return created.code;
}

/** Inscription au modèle `templateId` (`POST /api/program/enroll`) ; rend l'instance créée. */
export async function enrolViaApi(
  server: E2EServer,
  page: Page,
  templateId: string,
  daysPerWeek: number,
): Promise<{ id: string; templateVersion: number }> {
  const { instance } = await callApi<{ instance: { id: string; templateVersion: number } }>(page, server, {
    method: 'POST',
    path: '/api/program/enroll',
    data: { templateId, daysPerWeek },
    status: 201,
  });
  return instance;
}

/** Une série faite d'un historique préparé : répétitions ou durée, effort noté ou non. */
export interface HistorySet {
  reps?: number;
  durationS?: number;
  effort?: Effort | null;
}

/** Un exercice fait d'un historique préparé, dans son slot. */
export interface HistoryExercise {
  slotId: string;
  exerciseId: string;
  loadMode: LoadMode;
  sets: HistorySet[];
}

const newId = createMonotonicUuidV7(
  () => Date.now(),
  (n) => new Uint8Array(randomBytes(n)),
);

/**
 * Opérations `create` d'une séance de programme terminée, comme un autre appareil les pousserait : la séance, ses
 * exercices et leurs séries de travail faites, parents d'abord (R-SYN-17), 40 min après `startedAt`.
 */
export function completedSessionOps(o: {
  userId: string;
  instanceId: string;
  templateVersion: number;
  placeId: string;
  workoutId: string;
  startedAt: Date;
  exercises: HistoryExercise[];
}): SyncOp[] {
  const op = (entity: string, id: string, fields: Record<string, unknown>): SyncOp => ({
    opId: newId(),
    userId: o.userId,
    entity,
    id,
    kind: 'create',
    fields,
    clientTs: new Date().toISOString(),
    protocol: SYNC_PROTOCOL,
    attempts: 0,
  });
  const at = (minutes: number) => new Date(o.startedAt.getTime() + minutes * 60_000).toISOString();
  const sessionId = newId();
  const ops = [
    op('workout_session', sessionId, {
      instanceId: o.instanceId,
      workoutId: o.workoutId,
      placeId: o.placeId,
      deviceId: 'e2e-autre-appareil',
      startedAt: at(0),
      endedAt: at(40),
      status: 'completed',
      weekType: 'normal',
      templateVersion: o.templateVersion,
      rulesVersion: '1',
      appVersion: 'e2e',
      profile: 'adult',
      note: null,
    }),
  ];
  o.exercises.forEach((e, i) => {
    const exerciseId = newId();
    ops.push(
      op('performed_exercise', exerciseId, {
        sessionId,
        slotId: e.slotId,
        plannedExerciseId: e.exerciseId,
        exerciseId: e.exerciseId,
        swapReason: null,
        position: i + 1,
        nextAdjustment: null,
        note: null,
      }),
    );
    e.sets.forEach((s, j) => {
      ops.push(
        op('performed_set', newId(), {
          performedExerciseId: exerciseId,
          position: j + 1,
          kind: 'work',
          loadMode: e.loadMode,
          loadG: null,
          reps: s.reps ?? null,
          durationS: s.durationS ?? null,
          side: null,
          effort: s.effort ?? null,
          loggedAt: at(5 * i + j + 1),
        }),
      );
    });
  });
  return ops;
}

/** Pousse `ops` par la synchro (`POST /api/sync/push`) ; chaque opération doit être appliquée. */
export async function pushViaApi(server: E2EServer, page: Page, ops: SyncOp[]): Promise<PushResult[]> {
  const { results } = await callApi<{ results: PushResult[] }>(page, server, {
    method: 'POST',
    path: '/api/sync/push',
    data: { ops },
    status: 200,
  });
  expect(results.filter((r) => r.status !== 'applied')).toEqual([]);
  return results;
}

// ---------------------------------------------------------------------------------------------------------------
// Séance en cours (spec brique 3 §7.3)
// ---------------------------------------------------------------------------------------------------------------

/** Libellés de la feuille « Effort » (05 §7), mot pour mot, et le nom court de la pastille. */
export const EFFORTS = {
  easy: { label: "J'aurais pu en faire 4 de plus, ou plus", short: 'Facile' },
  ok: { label: 'Encore 2 ou 3', short: 'Correct' },
  hard: { label: 'Encore 1, pas plus', short: 'Difficile' },
  failed: { label: "La dernière n'est pas passée", short: 'Échec' },
} as const satisfies Record<Effort, { label: string; short: string }>;

/**
 * Carte d'un exercice de la séance en cours (`section` nommée par l'exercice), trouvée même cachée derrière une feuille
 * ouverte (`aria-hidden` hors du dialogue) ; ses actions, elles, ne se trouvent qu'à l'écran.
 */
export const exerciseCard = (page: Page, name: string): Locator =>
  page.getByRole('region', { name, exact: true, includeHidden: true });

/**
 * ✓ de la série de travail `position` d'une carte ; attend la série faite (« Corriger »). Après la dernière série
 * d'un exercice, sa carte se replie (l'exercice suivant s'ouvre) : la ligne est cherchée repliée comprise.
 */
export async function logSet(card: Locator, position: number): Promise<void> {
  await card.getByRole('button', { name: `Valider la série ${position}`, exact: true }).click();
  await expect(
    card.getByRole('button', { name: `Corriger la série ${position}`, exact: true, includeHidden: true }),
  ).toBeAttached();
}

/**
 * Effort choisi dans la feuille « Effort » déjà ouverte, puis attendu sur la pastille de la série `position` de
 * `card` (carte repliée comprise) : enregistré, et la feuille refermée. Attendre la pastille évite la course connue
 * de « Terminer » juste après l'effort.
 */
export async function chooseEffort(
  page: Page,
  card: Locator,
  position: number,
  effort: Effort,
): Promise<void> {
  const sheet = page.getByRole('dialog', { name: 'Effort', exact: true });
  await sheet.getByRole('button', { name: EFFORTS[effort].label, exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(
    card.getByRole('button', {
      name: `Effort de la série ${position} : ${EFFORTS[effort].short}`,
      exact: true,
      includeHidden: true,
    }),
  ).toBeAttached();
}

// ---------------------------------------------------------------------------------------------------------------
// Nutrition (spec brique 5 §16 point 6)
// ---------------------------------------------------------------------------------------------------------------

/** Un chiffre suivi d'une unité de la nutrition (kcal, g, kg, L) : ce que le mode sans chiffres ne montre jamais. */
export const FIGURE_AFTER_NUMBER = /\d[\s  ]*(?:kcal|kg|g|L)(?![\p{L}\d])/u;

/** Mode complet ouvert pour le cercle (`PUT /api/admin/nutrition`), par l'administrateur de `admin`. */
export async function openFullViaApi(server: E2EServer, admin: Page): Promise<void> {
  await callApi(admin, server, {
    method: 'PUT',
    path: '/api/admin/nutrition',
    data: { full_open: true },
    status: 200,
  });
}

/** Les fiches conseils de test (brouillons) relues puis publiées par l'administrateur de `admin`. */
export async function publishAdviceViaApi(server: E2EServer, admin: Page): Promise<void> {
  const sheets = await callApi<{ id: string }[]>(admin, server, {
    method: 'GET',
    path: '/api/review/advice',
    status: 200,
  });
  expect(sheets.length).toBeGreaterThan(0);
  for (const { id } of sheets) {
    for (const action of ['review', 'publish']) {
      await callApi(admin, server, {
        method: 'POST',
        path: `/api/review/advice/${id}/${action}`,
        data: {},
        status: 200,
      });
    }
  }
}

/** Ce que la pesée de départ et les réglages de l'activation complète recueillent. */
export interface FullSetup {
  sex: 'Homme' | 'Femme';
  heightCm: number;
  /** Écrit comme à l'écran, virgule décimale (« 80,0 »). */
  weight: string;
  activity: RegExp;
  goal: 'Perte de gras' | 'Maintien' | 'Prise de muscle';
}

/**
 * Activation complète par les écrans : « Activer », accord santé, trois réponses « Non », mode « Repères chiffrés »,
 * réglages de départ, « Valider ». Finit sur le module Nutrition en mode complet.
 */
export async function activateFullViaUi(server: E2EServer, page: Page, setup: FullSetup): Promise<void> {
  await page.goto(`${server.url}/nutrition`);
  await page.getByRole('link', { name: 'Activer', exact: true }).click();
  await button(page, 'Commencer').click();
  await page.getByRole('checkbox').check();
  await button(page, "J'accepte").click();
  for (let i = 0; i < 3; i++) await button(page, 'Non').click();
  await page.getByRole('radio', { name: 'Repères chiffrés', exact: true }).check();
  await button(page, 'Continuer').click();
  await page.getByRole('radio', { name: setup.sex, exact: true }).check();
  await page.getByLabel('Taille (cm)', { exact: true }).fill(String(setup.heightCm));
  await page.getByLabel('Première pesée (kg)').fill(setup.weight);
  await page.getByRole('radio', { name: setup.activity }).check();
  await page.getByRole('radio', { name: setup.goal, exact: true }).check();
  await button(page, 'Valider').click();
  await page.waitForURL((url) => url.pathname === '/nutrition');
  await expect(page.getByRole('heading', { name: 'Tes repères', exact: true })).toBeVisible();
}

/**
 * Opérations `create` de pesées (`weigh_in`), comme un autre appareil les pousserait : une par `[date, kilos]`.
 * Le serveur refuse une date future : avancer son horloge d'abord.
 */
export function weighInOps(userId: string, entries: readonly (readonly [string, number])[]): SyncOp[] {
  return entries.map(([date, kg]) => ({
    opId: newId(),
    userId,
    entity: 'weigh_in',
    id: newId(),
    kind: 'create',
    fields: { date, weightG: Math.round(kg * 1000) },
    clientTs: new Date().toISOString(),
    protocol: SYNC_PROTOCOL,
    attempts: 0,
  }));
}

/**
 * Horloge du serveur de test (point d'entrée `coach-server-entry.ts`, variable `E2E_CLOCK_FILE`) avancée à `to` :
 * le fichier porte le décalage avec l'heure réelle, relu par le serveur à chaque appel.
 */
export function setServerClock(clockFile: string, to: Date): void {
  writeFileSync(clockFile, String(to.getTime() - Date.now()));
}
