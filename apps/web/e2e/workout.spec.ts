import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { REASON_TEXTS } from '@rune/contracts';
import type { OutboxOp } from '../src/local-db/db';
import { E2E_TARGETS, E2E_TEMPLATE, writeWorkoutContent } from './support/content';
import { test as base, expect } from './support/fixtures';
import {
  callApi,
  chooseEffort,
  completedSessionOps,
  createMemberViaApi,
  enrolViaApi,
  exerciseCard,
  loginViaUi,
  logSet,
  pushViaApi,
  setupOnboardedAdmin,
} from './support/flows';
import {
  goOffline,
  goOnline,
  idbGetAll,
  metaValue,
  triggerForeground,
  waitForOutboxEmpty,
} from './support/pwa';
import type { E2EServer } from './support/server';

// Séances de bout en bout (spec brique 3 §10, critère 11 ; plan, Review Focus 1, 3, 4 et 5) : inscription à E8,
// séance complète hors ligne (séries, saisie maladroite, minuteur, rechargement, douleur sans accord santé, effort),
// retour du réseau et cibles du serveur, CSV des séries ; « Continuer ici » sur un second appareil ; proposition du
// moteur née d'un historique préparé côté serveur, acceptée sur le téléphone ; fiche retirée en cours de programme.

/** Une navigation servie par le SW sous des requêtes sans réponse : bornée, pour nommer l'étape en échec. */
const SHELL_TIMEOUT_MS = 10_000;
const DAY_MS = 86_400_000;

const test = base.extend<{ contentDir: string }>({
  // Contenu du serveur : le modèle de test et ses fiches publiées (le `data/` du dépôt n'a que des brouillons).
  // biome-ignore lint/correctness/noEmptyPattern: Playwright exige un premier argument déstructuré.
  contentDir: async ({}, use, testInfo) => {
    await use(writeWorkoutContent(testInfo.outputPath('content')));
  },
  serverOptions: async ({ contentDir }, use) => {
    await use({ env: { RUNE_CONTENT_DIR: contentDir } });
  },
});

const [SQUAT, PUSH_UP, ROW, BRIDGE, PLANK] = E2E_TEMPLATE.slots;
if (!SQUAT || !PUSH_UP || !ROW || !BRIDGE || !PLANK) throw new Error('modèle de test : 5 slots attendus');

const tab = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name, exact: true });
const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true });
const pending = (page: Page) => page.getByText(/^\d+ en attente$/);

/** Secondes du minuteur de repos affiché (« Repos 1:05 » → 65). */
async function restLeft(page: Page): Promise<number> {
  const text = (await page.getByRole('timer').textContent()) ?? '';
  const match = /^Repos (\d+):(\d\d)$/.exec(text.trim());
  if (!match) throw new Error(`minuteur illisible : « ${text} »`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Export JSON du compte (`GET /api/me/export`) : les lignes du serveur, suppressions logiques comprises. */
async function serverTables(
  page: Page,
  server: E2EServer,
): Promise<Record<string, Record<string, unknown>[]>> {
  const res = await page.request.get(`${server.url}/api/me/export`);
  expect(res.status(), 'export JSON').toBe(200);
  return ((await res.json()) as { tables: Record<string, Record<string, unknown>[]> }).tables;
}

const live = (rows: Record<string, unknown>[] | undefined) => (rows ?? []).filter((r) => r.deletedAt == null);

test('E8 et séance hors ligne : séries, minuteur, rechargement, douleur sans accord, puis synchro et CSV', async ({
  server,
  context,
  browserName,
}) => {
  test.setTimeout(240_000);
  const page = await setupOnboardedAdmin(server, context, 'camille', {
    atReady: async (p) => {
      // E8 (D15) : le modèle recommandé et la case « Commencer avec ce programme », cochée par défaut.
      const program = p.getByRole('region', { name: 'Ton programme', exact: true });
      await expect(program.getByRole('heading', { name: E2E_TEMPLATE.name, exact: true })).toBeVisible();
      await expect(
        program.getByRole('checkbox', { name: 'Commencer avec ce programme', exact: true }),
      ).toBeChecked();
    },
  });
  const squat = exerciseCard(page, SQUAT.exercise.name);
  const pushUp = exerciseCard(page, PUSH_UP.exercise.name);
  const row = exerciseCard(page, ROW.exercise.name);
  const swapped = exerciseCard(page, E2E_TEMPLATE.swap.name);
  const bridge = exerciseCard(page, BRIDGE.exercise.name);
  const plank = exerciseCard(page, PLANK.exercise.name);
  const title = page.getByRole('heading', { level: 1, name: E2E_TEMPLATE.workout.name, exact: true });

  await test.step('inscrit à E8 : la séance du jour vient du programme', async () => {
    await tab(page, 'Séance').click();
    await expect(page.getByRole('heading', { level: 1, name: E2E_TEMPLATE.name, exact: true })).toBeVisible();
    await expect(page.getByText(`Semaine 1 · ${E2E_TEMPLATE.workout.name}`, { exact: true })).toBeVisible();
    const plan = page.getByRole('list', { name: 'Exercices de la séance', exact: true });
    await expect(plan.getByRole('listitem')).toHaveCount(E2E_TEMPLATE.slots.length);
    await expect(plan.getByRole('listitem').first()).toContainText(SQUAT.exercise.name);
  });

  await test.step("hors ligne : la séance commence et une saisie maladroite n'écrit rien", async () => {
    await goOffline(server, context, browserName);
    await button(page, 'Commencer').click();
    await page.waitForURL(/\/workout\/[0-9a-f-]{36}$/);
    await expect(title).toBeVisible();

    // Review Focus 4 : aucune valeur hors bornes ni illisible n'est écrite ; le message est attaché au champ.
    const reps = squat.getByRole('textbox', { name: 'Répétitions, série 1', exact: true });
    await expect(reps).toHaveValue(String(E2E_TARGETS.reps.min));
    for (const [value, message] of [
      ['abc', 'Nombre invalide'],
      ['600', 'Nombre trop élevé'],
      ['', 'Indique un nombre'],
    ] as const) {
      await reps.fill(value);
      await button(squat, 'Valider la série 1').click();
      await expect(reps).toHaveAttribute('aria-invalid', 'true');
      await expect(reps).toHaveAccessibleDescription(message);
      await expect(reps).toBeFocused();
    }
    expect(
      (await idbGetAll(page, 'performed_set')).filter((s) => s.loggedAt != null),
      'aucune série écrite',
    ).toEqual([]);
    await reps.fill('10');
    await logSet(squat, 1);
    await expect(squat.getByText('Séries faites : 1 / 2')).toBeAttached();
  });

  let queued = 0;
  await test.step('minuteur de repos : lancé par la série, +15 s', async () => {
    const left = await restLeft(page);
    expect(left).toBeGreaterThan(SQUAT.restS - 10);
    expect(left).toBeLessThanOrEqual(SQUAT.restS);
    await button(page, '+15 s').click();
    expect(await restLeft(page)).toBeGreaterThan(left + 10);
    // « N en attente » (R-SYN-34) : les opérations de l'outbox, la séance, ses exercices et ses séries comprises.
    queued = (await idbGetAll(page, 'outbox')).length;
    expect(queued).toBeGreaterThan(E2E_TEMPLATE.slots.length);
    await expect(pending(page)).toHaveText(`${queued} en attente`);
  });

  await test.step('appli rechargée en pleine séance : séries faites et minuteur reviennent', async () => {
    // Review Focus 1 : servie par le SW, sans serveur ; le repos reprend sur son heure de fin (ruling R44).
    await page.reload({ waitUntil: 'domcontentloaded', timeout: SHELL_TIMEOUT_MS });
    await expect(title).toBeVisible({ timeout: SHELL_TIMEOUT_MS });
    await expect(button(squat, 'Corriger la série 1')).toBeVisible();
    await expect(button(squat, 'Valider la série 2')).toBeVisible();
    await expect(page.getByRole('timer')).toBeVisible();
    const left = await restLeft(page);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(SQUAT.restS + 15);
    await expect(pending(page)).toHaveText(`${queued} en attente`);
  });

  await test.step("dernière série : l'effort est demandé ; fin du repos annoncée", async () => {
    await logSet(squat, 2);
    await chooseEffort(page, squat, 2, 'ok');
    // La dernière série relance le repos : −15 s jusqu'à la fin, annoncée à l'écran et à la région d'annonce.
    for (let i = 0; i < 8 && (await page.getByRole('timer').count()) > 0; i++) {
      await button(page, '−15 s').click();
    }
    await expect(page.getByText('Repos terminé', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /^Repos terminé$/ })).toHaveCount(1);
    await button(page, 'Fermer').click();
    await expect(page.getByText('Repos terminé', { exact: true })).toHaveCount(0);

    await logSet(pushUp, 1);
    await logSet(pushUp, 2);
    await chooseEffort(page, pushUp, 2, 'hard');
  });

  await test.step('douleur sans accord santé : un autre exercice, aucune trace de la douleur', async () => {
    await button(row, `Options pour ${ROW.exercise.name}`).click();
    await button(page.getByRole('dialog', { name: ROW.exercise.name }), 'Douleur ou gêne').click();
    await button(page.getByRole('dialog', { name: 'Douleur ou gêne' }), 'Douleur').click();
    // Conseil de sécurité, puis un exercice du même type de mouvement (05 §13.6).
    const painSheet = page.getByRole('dialog', { name: 'Douleur', exact: true });
    await expect(painSheet).toContainText('consulte un médecin ou un kiné');
    await button(painSheet, E2E_TEMPLATE.swap.name).click();
    await expect(painSheet).toBeHidden();
    await expect(row).toHaveCount(0);
    await expect(swapped.getByText('La prochaine fois : alléger', { exact: true })).toBeVisible();

    // Spec §5.5 et contraintes globales : ni `pain_level` ni raison « douleur » (ruling R46), dans Dexie ou l'outbox.
    const exercises = await idbGetAll(page, 'performed_exercise');
    expect(exercises.filter((e) => e.painLevel != null || e.swapReason === 'pain')).toEqual([]);
    expect(exercises.find((e) => e.exerciseId === E2E_TEMPLATE.swap.id)).toMatchObject({
      slotId: ROW.slot,
      swapReason: null,
      nextAdjustment: 'lighten',
    });
    const outbox = await idbGetAll<OutboxOp>(page, 'outbox');
    expect(outbox.filter((op) => 'painLevel' in op.fields || op.fields.swapReason === 'pain')).toEqual([]);

    await logSet(swapped, 1);
    await logSet(swapped, 2);
    await chooseEffort(page, swapped, 2, 'ok');
  });

  await test.step('fin de séance hors ligne : résumé et cibles provisoires', async () => {
    await logSet(bridge, 1);
    await logSet(bridge, 2);
    await chooseEffort(page, bridge, 2, 'ok');
    // Exercice en durée : la cible (20 s) est déjà dans le champ.
    await expect(plank.getByRole('textbox', { name: 'Secondes, série 1', exact: true })).toHaveValue(
      String(E2E_TARGETS.durationS.min),
    );
    await logSet(plank, 1);
    await logSet(plank, 2);
    await chooseEffort(page, plank, 2, 'easy');

    // Chaque exercice a son effort (pastilles attendues par `chooseEffort`) : « Terminer » clôt sans feuille.
    await button(page, 'Terminer').click();
    await page.waitForURL(/\/workout\/[0-9a-f-]{36}\/summary$/);
    await expect(page.getByText('Séance gravée.', { exact: true })).toBeVisible();
    const next = page.getByRole('region', { name: 'La prochaine fois', exact: true });
    await expect(next.getByRole('listitem')).toHaveCount(E2E_TEMPLATE.slots.length);
    // Décisions du rejeu du téléphone, en attendant celles du serveur (spec §4.4.8).
    await expect(next.getByText('· provisoire')).toHaveCount(E2E_TEMPLATE.slots.length);
  });

  await test.step('retour du réseau : tout part, les cibles du serveur remplacent les provisoires', async () => {
    await goOnline(server, context);
    await waitForOutboxEmpty(page);
    const next = page.getByRole('region', { name: 'La prochaine fois', exact: true });
    await expect
      .poll(
        async () => {
          await triggerForeground(page);
          return next.getByText('· provisoire').count();
        },
        { timeout: 15_000, message: 'cibles du serveur' },
      )
      .toBe(0);
    await expect(next.getByRole('listitem')).toHaveCount(E2E_TEMPLATE.slots.length);

    // Côté serveur : une séance terminée, 10 séries faites, sans doublon, et aucune trace de douleur.
    const tables = await serverTables(page, server);
    const sessions = live(tables.workout_session);
    expect(sessions.map((s) => s.status)).toEqual(['completed']);
    const sets = live(tables.performed_set);
    expect(sets).toHaveLength(E2E_TEMPLATE.slots.reduce((n, s) => n + s.sets, 0));
    expect(sets.filter((s) => s.loggedAt == null)).toEqual([]);
    expect(new Set(sets.map((s) => `${s.performedExerciseId}|${s.position}`)).size).toBe(sets.length);
    const exercises = live(tables.performed_exercise);
    expect(exercises.map((e) => e.exerciseId).sort()).toEqual(
      [SQUAT, PUSH_UP, BRIDGE, PLANK]
        .map((s) => s.exercise.id)
        .concat(E2E_TEMPLATE.swap.id)
        .sort(),
    );
    expect((tables.performed_exercise ?? []).filter((e) => e.painLevel != null)).toEqual([]);
    expect((tables.performed_exercise ?? []).filter((e) => e.swapReason != null)).toEqual([]);
  });

  await test.step('CSV des séries : téléchargé, une ligne par série faite, sans colonne douleur', async () => {
    await page.getByRole('button', { name: 'Terminé', exact: true }).click();
    await tab(page, 'Profil').click();
    await page.getByRole('link', { name: /^Confidentialité et données/ }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      button(page, 'Télécharger mes séries (CSV)').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^rune-series-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile(await download.path(), 'utf8');
    // UTF-8 avec BOM (ouverture directe dans un tableur français, spec §5.6).
    expect(csv.charCodeAt(0), 'BOM UTF-8').toBe(0xfeff);
    const [header, ...rows] = csv.slice(1).trimEnd().split('\r\n');
    expect(header?.split(';')).not.toContain('douleur');
    expect(header?.split(';').slice(0, 6)).toEqual([
      'date',
      'heure',
      'seance',
      'lieu',
      'exercice',
      'exercice_id',
    ]);
    expect(rows).toHaveLength(E2E_TEMPLATE.slots.reduce((n, s) => n + s.sets, 0));
    expect(rows.every((r) => r.split(';')[2] === E2E_TEMPLATE.workout.name)).toBe(true);
    expect(rows.filter((r) => r.split(';')[4] === E2E_TEMPLATE.swap.name)).toHaveLength(ROW.sets);
  });
});

test('« Continuer ici » : la séance passe au second appareil, le premier passe en lecture seule', async ({
  server,
  page,
  context,
  newContext,
}) => {
  test.setTimeout(180_000);
  await createMemberViaApi(server, page);
  await enrolViaApi(server, page, E2E_TEMPLATE.id, E2E_TEMPLATE.daysPerWeek);
  await page.goto(`${server.url}/login`);
  await loginViaUi(page, 'camille');
  await page.waitForURL((url) => url.pathname === '/');

  const otherContext = await newContext();
  const other = await otherContext.newPage();
  const squatHere = exerciseCard(page, SQUAT.exercise.name);
  const squatThere = exerciseCard(other, SQUAT.exercise.name);
  let sessionId = '';

  await test.step('premier appareil : séance commencée, une série envoyée', async () => {
    await tab(page, 'Séance').click();
    await button(page, 'Commencer').click();
    await page.waitForURL(/\/workout\/[0-9a-f-]{36}$/);
    sessionId = new URL(page.url()).pathname.split('/')[2] ?? '';
    await logSet(squatHere, 1);
    await waitForOutboxEmpty(page);
    // Review Focus 3 : le premier perd le réseau ; il ne verra la reprise qu'à son retour (aucun pull d'ici là).
    await context.setOffline(true);
  });

  await test.step('second appareil : « Continuer ici » reprend la séance telle quelle', async () => {
    await other.goto(`${server.url}/login`);
    await loginViaUi(other, 'camille');
    await other.waitForURL((url) => url.pathname === '/');
    await tab(other, 'Séance').click();
    await expect(
      other.getByRole('heading', { name: 'Séance en cours sur un autre appareil', exact: true }),
    ).toBeVisible();
    await button(other, 'Continuer ici').click();
    await other.waitForURL(`${server.url}/workout/${sessionId}`);
    await expect(button(squatThere, 'Corriger la série 1')).toBeVisible();
    await waitForOutboxEmpty(other);
  });

  await test.step('le premier continue hors ligne, le second en ligne', async () => {
    // Le premier n'a pas vu la reprise : il note la série suivante, sans réseau.
    await logSet(squatHere, 2);
    await chooseEffort(page, squatHere, 2, 'ok');
    // Le second note une série de la pompe, dont il ouvre la carte (le squat y est encore l'exercice en cours).
    const pushUpThere = exerciseCard(other, PUSH_UP.exercise.name);
    await button(pushUpThere, 'Séries faites : 0 / 2').click();
    await logSet(pushUpThere, 1);
    await waitForOutboxEmpty(other);
  });

  await test.step('retour du réseau : le premier passe en lecture seule, rien en double', async () => {
    await context.setOffline(false);
    await waitForOutboxEmpty(page);
    const readOnly = page.getByText('Cette séance continue sur un autre appareil.', { exact: true });
    await expect
      .poll(
        async () => {
          await triggerForeground(page);
          return readOnly.isVisible();
        },
        { timeout: 15_000, message: 'lecture seule au pull suivant' },
      )
      .toBe(true);
    // Lecture seule : ni ✓, ni « Terminer » ; les séries du squat (dont celle notée hors ligne) restent faites, et
    // celle de la pompe notée par le second est arrivée (la pompe est désormais l'exercice ouvert).
    await expect(button(page, 'Terminer')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Valider|Corriger) / })).toHaveCount(0);
    await expect(button(squatHere, 'Séries faites : 2 / 2')).toBeVisible();
    await expect(
      exerciseCard(page, PUSH_UP.exercise.name).getByRole('img', { name: 'Faite', exact: true }),
    ).toHaveCount(1);

    // La série notée hors ligne par le premier arrive au second (dernière écriture, champ par champ).
    await expect
      .poll(
        async () => {
          await triggerForeground(other);
          return button(squatThere, 'Séries faites : 2 / 2').isVisible();
        },
        { timeout: 15_000, message: 'série du premier appareil reçue' },
      )
      .toBe(true);

    // Serveur : la séance tenue par le second appareil, ses 10 séries prévues sans doublon, 3 faites.
    const tables = await serverTables(other, server);
    expect(live(tables.workout_session)).toEqual([
      expect.objectContaining({
        id: sessionId,
        status: 'in_progress',
        deviceId: await metaValue(other, 'deviceId'),
      }),
    ]);
    const sets = live(tables.performed_set);
    expect(sets).toHaveLength(E2E_TEMPLATE.slots.reduce((n, s) => n + s.sets, 0));
    expect(new Set(sets.map((s) => `${s.performedExerciseId}|${s.position}`)).size).toBe(sets.length);
    expect(sets.filter((s) => s.loggedAt != null)).toHaveLength(3);
  });
});

test('proposition du moteur : historique préparé côté serveur, allègement accepté sur le téléphone', async ({
  server,
  page,
}) => {
  const { userId, placeId } = await createMemberViaApi(server, page);
  const instance = await enrolViaApi(server, page, E2E_TEMPLATE.id, E2E_TEMPLATE.daysPerWeek);

  await test.step('4 séances ratées poussées par un autre appareil : le serveur propose un allègement', async () => {
    // Sous le bas de la fourchette, effort « échec » : chaque slot stagne à la 4e séance, d'où l'allègement réactif
    // (05 §10.1 : au moins 2 slots en stagnation sur 2 semaines de programme).
    const failed = E2E_TEMPLATE.slots.map((s) => ({
      slotId: s.slot,
      exerciseId: s.exercise.id,
      loadMode: 'bodyweight' as const,
      sets: Array.from({ length: s.sets }, () =>
        s.measure === 'reps'
          ? { reps: E2E_TARGETS.reps.min - 2, effort: 'failed' as const }
          : { durationS: E2E_TARGETS.durationS.min - 8, effort: 'failed' as const },
      ),
    }));
    const ops = [9, 7, 5, 3].flatMap((daysAgo) =>
      completedSessionOps({
        userId,
        instanceId: instance.id,
        templateVersion: instance.templateVersion,
        placeId,
        workoutId: E2E_TEMPLATE.workout.id,
        startedAt: new Date(Date.now() - daysAgo * DAY_MS),
        exercises: failed,
      }),
    );
    await pushViaApi(server, page, ops);
    // Le rejeu du serveur, au push, écrit la proposition du moteur (spec §4.4.4).
    expect((await serverTables(page, server)).instance_change).toEqual([
      expect.objectContaining({ author: 'engine', status: 'proposed', reasonCode: 'ENGINE_REACTIVE_DELOAD' }),
    ]);
  });

  await page.goto(`${server.url}/login`);
  await loginViaUi(page, 'camille');
  await page.waitForURL((url) => url.pathname === '/');

  await test.step('la séance du jour signale la proposition ; Mon programme la montre', async () => {
    await tab(page, 'Séance').click();
    await expect(page.getByText("Une proposition t'attend.")).toBeVisible();
    await page.getByRole('link', { name: 'Voir la proposition', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mon programme', exact: true })).toBeVisible();
  });

  await test.step('« Accepter » : la semaine suivante est allégée', async () => {
    const proposals = page.getByRole('region', { name: 'Propositions en attente', exact: true });
    const card = proposals.getByRole('article', { name: 'Proposition de Rune', exact: true });
    await expect(card).toContainText(REASON_TEXTS.ENGINE_REACTIVE_DELOAD);
    await expect(card.getByRole('definition')).toHaveText(['Semaine normale', 'Semaine allégée']);
    await button(card, 'Accepter').click();
    await expect(proposals).toBeHidden();
    const entry = page
      .getByRole('region', { name: 'Journal', exact: true })
      .getByRole('listitem')
      .filter({ hasText: 'Semaine allégée' });
    await expect(entry).toContainText('Rune');
    await expect(entry).toContainText('Accepté');

    await tab(page, 'Séance').click();
    await expect(page.getByText('Semaine allégée', { exact: true })).toBeVisible();
    await expect(page.getByText("Une proposition t'attend.")).toHaveCount(0);
  });
});

test("fiche retirée en cours de programme : la séance prend la suivante, l'historique garde son nom", async ({
  server,
  page,
}, testInfo) => {
  const { userId, placeId } = await createMemberViaApi(server, page);
  const instance = await enrolViaApi(server, page, E2E_TEMPLATE.id, E2E_TEMPLATE.daysPerWeek);
  // Une séance déjà faite avec le premier exercice du tirage.
  await pushViaApi(
    server,
    page,
    completedSessionOps({
      userId,
      instanceId: instance.id,
      templateVersion: instance.templateVersion,
      placeId,
      workoutId: E2E_TEMPLATE.workout.id,
      startedAt: new Date(Date.now() - 2 * DAY_MS),
      exercises: [
        {
          slotId: ROW.slot,
          exerciseId: ROW.exercise.id,
          loadMode: 'bodyweight',
          sets: [
            { reps: 10, effort: 'ok' },
            { reps: 10, effort: 'ok' },
          ],
        },
      ],
    }),
  );

  await test.step("le modèle passe en version 2 sans cette fiche, que l'admin retire", async () => {
    // Un modèle chargé qui cite une fiche en bloque le retrait (`referenced_by_template`) : le serveur repart avec la
    // version 2 du modèle. L'inscription garde sa copie de la version 1 (D5), qui cite toujours la fiche retirée.
    await server.restart({
      RUNE_CONTENT_DIR: writeWorkoutContent(testInfo.outputPath('content-v2'), { templateVersion: 2 }),
    });
    await callApi(page, server, {
      method: 'POST',
      path: `/api/admin/exercises/${ROW.exercise.id}/transition`,
      data: { to: 'retired', baseRevision: 1 },
      status: 200,
    });
  });

  await page.goto(`${server.url}/login`);
  await loginViaUi(page, 'camille');
  await page.waitForURL((url) => url.pathname === '/');

  await test.step("séance du jour : le slot prend l'exercice suivant de sa liste", async () => {
    // Review Focus 5 : fiche retirée en tête de slot → la suivante.
    await tab(page, 'Séance').click();
    const plan = page.getByRole('list', { name: 'Exercices de la séance', exact: true });
    await expect(plan.getByRole('listitem')).toHaveCount(E2E_TEMPLATE.slots.length);
    // Le slot du tirage (3e) prend la suivante de sa liste et dit ce qu'elle remplace, et pourquoi (M6).
    const rowSlot = plan.getByRole('listitem').nth(2);
    await expect(rowSlot).toContainText(E2E_TEMPLATE.swap.name);
    await expect(rowSlot).toContainText(`Remplace ${ROW.exercise.name} (retiré du catalogue)`);
    await expect(rowSlot.getByRole('button')).toHaveAccessibleName(new RegExp(`^${E2E_TEMPLATE.swap.name}`));
  });

  await test.step('historique : la séance passée garde le nom de la fiche retirée', async () => {
    await tab(page, 'Progression').click();
    await page.getByRole('link', { name: 'Historique des séances', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Historique', exact: true })).toBeVisible();
    await page.getByRole('link', { name: new RegExp(E2E_TEMPLATE.workout.name) }).click();
    await expect(page.getByRole('heading', { level: 2, name: ROW.exercise.name, exact: true })).toBeVisible();
  });
});
