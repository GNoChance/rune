import { type MeResponse, REASON_TEXTS } from '@rune/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { createFakeApi, createFakeSyncEngine, type FakeApi, type FakeSyncEngine } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import {
  CHANGE_VIEW,
  changeRow,
  GYM_BEGINNER,
  INSTANCE_VIEW,
  type ProgramSetup,
  seedCompletedSessions,
  seedProgram,
  TEMPLATES,
} from '../support/program';
import { makeMe, renderApp } from '../support/render';
import { seedMirror } from '../support/seed';
import { until } from '../support/wait';

const CHANGES = '/api/program/changes';
const STALE = 'Le programme a changé : vérifie et recommence.';
/** Premier affichage d'un écran chargé à la demande (`import()`), large quand toute la suite tourne en parallèle. */
const LAZY = { timeout: 10_000 };
const OFFLINE = 'Nécessite le réseau';

interface OpenOptions {
  setup?: ProgramSetup;
  me?: MeResponse;
  sync?: FakeSyncEngine;
  seed?(db: AppDb): Promise<void>;
}

/** Mon programme (`/program`) de l'instance i-1, une fois l'en-tête affiché. */
async function openProgram(o: OpenOptions = {}) {
  const db = createTestLocalDb();
  await seedProgram(db, o.setup);
  await o.seed?.(db);
  const api = createFakeApi();
  const rendered = await renderApp({ path: '/program', db, api, me: o.me ?? makeMe(), sync: o.sync });
  await screen.findByRole('heading', { level: 2, name: GYM_BEGINNER.name }, LAZY);
  return { ...rendered, api };
}

const button = (name: string, root: HTMLElement = document.body) =>
  within(root).getByRole('button', { name }) as HTMLButtonElement;
const dialog = (name: string) => screen.getByRole('dialog', { name });
const region = (name: string) => screen.getByRole('region', { name });

/** Changement accepté par le serveur : réponse 201 et corps envoyés notés. */
function acceptChanges(api: FakeApi): void {
  api.on('POST', CHANGES, { status: 201, body: { change: CHANGE_VIEW, instance: INSTANCE_VIEW } });
}

const sentChanges = (api: FakeApi) => api.calls.filter((c) => c.path === CHANGES).map((c) => c.body);

/** Ouvre la feuille du premier slot nommé `name`. */
async function openSlot(name: string): Promise<HTMLElement> {
  const [row] = screen.getAllByRole('button', { name });
  if (!row) throw new Error(`slot ${name} introuvable`);
  fireEvent.click(row);
  return dialog(name);
}

const PROPOSAL = changeRow('c-prop', {
  author: 'engine',
  operations: [{ op: 'replace_exercise', slot: 'A1', exercise: 'goblet-squat' }],
  reasonCode: 'ENGINE_STALL_REPLACE',
  status: 'proposed',
  baseRevision: 4,
  createdAt: '2026-10-05T08:00:00.000Z',
  expiresAt: '2026-10-12T08:00:00.000Z',
  decidedAt: null,
});

const SUSPENDED_A2 = changeRow('c-susp', {
  operations: [{ op: 'suspend_slot', slot: 'A2' }],
  reasonCode: 'USER_SUSPEND',
  createdAt: '2026-09-20T08:00:00.000Z',
  decidedAt: '2026-09-20T08:00:00.000Z',
});

describe('Mon programme (/program, spec §7.7)', () => {
  it('en-tête : nom, « Semaine 3 · bloc 3 / 5 », jours en vigueur et début', async () => {
    await openProgram({ seed: (db) => seedCompletedSessions(db, 4) });
    expect(screen.getByText('Semaine 3 · bloc 3 / 5')).toBeTruthy();
    expect(screen.getByText('2 jours par semaine · depuis le 01/09/2026')).toBeTruthy();
  });

  it('jours en vigueur : ceux du programme effectif (set_days_per_week accepté), pas ceux de l’inscription', async () => {
    await openProgram({
      seed: (db) =>
        seedMirror(db, 'instance_change', [
          changeRow('c-days', { operations: [{ op: 'set_days_per_week', days: 3 }] }),
        ]),
    });
    expect(screen.getByText('3 jours par semaine · depuis le 01/09/2026')).toBeTruthy();
  });

  it('séances du modèle : exercice résolu au lieu principal, séries × répétitions, repos, « Suspendu »', async () => {
    await openProgram({ seed: (db) => seedMirror(db, 'instance_change', [SUSPENDED_A2]) });
    const a = region('Séance A');
    const squat = button('Squat barre', a);
    expect(squat.getAttribute('aria-describedby')).toBeTruthy();
    expect(within(a).getByText('3 × 6 · repos 3 min')).toBeTruthy();
    expect(within(a).getByText('3 × 30–45 s · repos 1 min')).toBeTruthy();
    expect(within(a).getByText('Suspendu')).toBeTruthy();
    expect(within(region('Séance B')).queryByText('Suspendu')).toBeNull();
  });

  it('proposition du moteur : « Proposition de Rune », raison, avant / après, date limite, Accepter', async () => {
    const { api } = await openProgram({ seed: (db) => seedMirror(db, 'instance_change', [PROPOSAL]) });
    const proposals = region('Propositions en attente');
    expect(within(proposals).getByText('Proposition de Rune')).toBeTruthy();
    expect(within(proposals).getByText(REASON_TEXTS.ENGINE_STALL_REPLACE)).toBeTruthy();
    expect(within(proposals).getByText('Avant')).toBeTruthy();
    expect(within(proposals).getByText('Squat barre · 3 × 6')).toBeTruthy();
    expect(within(proposals).getByText('Après')).toBeTruthy();
    expect(within(proposals).getByText('Squat goblet · 3 × 6')).toBeTruthy();
    expect(within(proposals).getByText("Jusqu'au 12/10/2026")).toBeTruthy();
    api.on('POST', `${CHANGES}/:id/accept`, {
      status: 200,
      body: { change: { ...CHANGE_VIEW, id: 'c-prop' }, instance: INSTANCE_VIEW },
    });
    fireEvent.click(button('Accepter', proposals));
    await until(() => api.calls.some((c) => c.path === `${CHANGES}/c-prop/accept`));
    expect(api.calls.find((c) => c.path === `${CHANGES}/c-prop/accept`)?.body).toEqual({ baseRevision: 4 });
  });

  it('« Refuser » envoie le refus', async () => {
    const { api } = await openProgram({ seed: (db) => seedMirror(db, 'instance_change', [PROPOSAL]) });
    api.on('POST', `${CHANGES}/:id/reject`, { status: 200, body: { change: CHANGE_VIEW } });
    fireEvent.click(button('Refuser', region('Propositions en attente')));
    await until(() => api.calls.some((c) => c.path === `${CHANGES}/c-prop/reject`));
    expect(api.calls.find((c) => c.path === `${CHANGES}/c-prop/reject`)?.body).toEqual({});
  });

  it('409 stale_revision à l’acceptation : « Le programme a changé : vérifie et recommence. », proposition gardée', async () => {
    const { api } = await openProgram({ seed: (db) => seedMirror(db, 'instance_change', [PROPOSAL]) });
    api.on('POST', `${CHANGES}/:id/accept`, { status: 409, body: { error: 'stale_revision' } });
    fireEvent.click(button('Accepter', region('Propositions en attente')));
    await screen.findByText(STALE);
    expect(within(region('Propositions en attente')).getByText('Proposition de Rune')).toBeTruthy();
  });

  it('409 expired : « Cette proposition a expiré. » et un pull qui la range au journal', async () => {
    const { api, sync } = await openProgram({ seed: (db) => seedMirror(db, 'instance_change', [PROPOSAL]) });
    api.on('POST', `${CHANGES}/:id/accept`, { status: 409, body: { error: 'expired' } });
    fireEvent.click(button('Accepter', region('Propositions en attente')));
    await screen.findByText('Cette proposition a expiré.');
    await until(() => sync.pullCount > 0);
  });

  describe('feuille d’un slot : chaque action envoie son opération', () => {
    const cases: { title: string; slot: string; act(sheet: HTMLElement): void; ops: unknown[] }[] = [
      {
        title: 'remplacer l’exercice',
        slot: 'Squat barre',
        act: (sheet) => {
          fireEvent.click(button("Remplacer l'exercice", sheet));
          fireEvent.click(within(sheet).getByRole('radio', { name: 'Squat goblet' }));
          fireEvent.click(button('Remplacer', sheet));
        },
        ops: [{ op: 'replace_exercise', slot: 'A1', exercise: 'goblet-squat' }],
      },
      {
        title: 'une série de plus',
        slot: 'Squat barre',
        act: (sheet) => fireEvent.click(button('Ajouter une série', sheet)),
        ops: [{ op: 'change_sets', slot: 'A1', delta: 1 }],
      },
      {
        title: 'une série de moins',
        slot: 'Squat barre',
        act: (sheet) => fireEvent.click(button('Retirer une série', sheet)),
        ops: [{ op: 'change_sets', slot: 'A1', delta: -1 }],
      },
      {
        title: 'fourchette de répétitions',
        slot: 'Squat barre',
        act: (sheet) => {
          fireEvent.change(within(sheet).getByLabelText('Minimum'), { target: { value: '8' } });
          fireEvent.change(within(sheet).getByLabelText('Maximum'), { target: { value: '12' } });
          fireEvent.click(button('Enregistrer les répétitions', sheet));
        },
        ops: [{ op: 'set_rep_range', slot: 'A1', min: 8, max: 12 }],
      },
      {
        title: 'repos',
        slot: 'Squat barre',
        act: (sheet) => {
          fireEvent.change(within(sheet).getByLabelText('Repos (secondes)'), { target: { value: '150' } });
          fireEvent.click(button('Enregistrer le repos', sheet));
        },
        ops: [{ op: 'set_rest', slot: 'A1', seconds: 150 }],
      },
      {
        title: 'effort visé, sous « Réglages avancés »',
        slot: 'Squat barre',
        act: (sheet) => {
          expect(within(sheet).queryByRole('radio', { name: '3' })).toBeNull();
          fireEvent.click(button('Réglages avancés', sheet));
          fireEvent.click(within(sheet).getByRole('radio', { name: '3' }));
          fireEvent.click(button("Enregistrer l'effort visé", sheet));
        },
        ops: [{ op: 'set_target_rir', slot: 'A1', value: 3 }],
      },
      {
        title: 'alléger la prochaine fois',
        slot: 'Squat barre',
        act: (sheet) => fireEvent.click(button('Alléger la prochaine fois', sheet)),
        ops: [{ op: 'lighten_exercise', slot: 'A1' }],
      },
      {
        title: 'suspendre',
        slot: 'Squat barre',
        act: (sheet) => fireEvent.click(button('Suspendre', sheet)),
        ops: [{ op: 'suspend_slot', slot: 'A1' }],
      },
      {
        title: 'retirer de la séance, après confirmation',
        slot: 'Planche',
        act: (sheet) => {
          fireEvent.click(button('Retirer de la séance', sheet));
          fireEvent.click(button('Retirer', sheet));
        },
        ops: [{ op: 'remove_slot', slot: 'A5' }],
      },
    ];

    for (const c of cases) {
      it(c.title, async () => {
        const { api } = await openProgram();
        acceptChanges(api);
        const sheet = await openSlot(c.slot);
        c.act(sheet);
        await until(() => sentChanges(api).length > 0);
        expect(sentChanges(api)).toEqual([{ baseRevision: 4, operations: c.ops }]);
        // Changement accepté : la feuille se ferme.
        await until(() => screen.queryByRole('dialog') === null);
      });
    }

    it('slot suspendu : « Reprendre » seul, ou « Remplacer et reprendre » en un seul changement (R23)', async () => {
      const { api } = await openProgram({ seed: (db) => seedMirror(db, 'instance_change', [SUSPENDED_A2]) });
      acceptChanges(api);
      let sheet = await openSlot('Soulevé de terre roumain');
      expect(within(sheet).queryByRole('button', { name: 'Suspendre' })).toBeNull();
      fireEvent.click(button('Reprendre', sheet));
      await until(() => sentChanges(api).length === 1);
      await until(() => screen.queryByRole('dialog') === null);
      sheet = await openSlot('Soulevé de terre roumain');
      fireEvent.click(button('Remplacer et reprendre', sheet));
      fireEvent.click(within(sheet).getByRole('radio', { name: 'Soulevé de terre roumain aux haltères' }));
      fireEvent.click(button('Remplacer et reprendre', sheet));
      await until(() => sentChanges(api).length === 2);
      expect(sentChanges(api)).toEqual([
        { baseRevision: 4, operations: [{ op: 'resume_slot', slot: 'A2' }] },
        {
          baseRevision: 4,
          operations: [
            { op: 'replace_exercise', slot: 'A2', exercise: 'dumbbell-romanian-deadlift' },
            { op: 'resume_slot', slot: 'A2' },
          ],
        },
      ]);
    });

    it('« Remplacer l’exercice » ne propose que des exercices du même mouvement, sans l’actuel', async () => {
      await openProgram();
      const sheet = await openSlot('Squat barre');
      fireEvent.click(button("Remplacer l'exercice", sheet));
      const names = within(sheet)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-labelledby'))
        .map((id) => (id ? document.getElementById(id)?.textContent : null));
      expect(names).toEqual(['Presse à cuisses', 'Squat goblet']);
    });

    it('422 : le message du code s’affiche sous l’action, la feuille reste ouverte', async () => {
      const { api } = await openProgram();
      api.on('POST', CHANGES, {
        status: 422,
        body: { error: 'invalid_change', errors: [{ op: 0, code: 'coverage_lost' }] },
      });
      const sheet = await openSlot('Squat barre');
      fireEvent.click(button('Suspendre', sheet));
      await within(sheet).findByText('Ce changement laisserait un groupe de mouvements sans exercice.');
      expect(screen.getByRole('dialog', { name: 'Squat barre' })).toBe(sheet);
    });

    it('409 stale_revision sur une action : « Le programme a changé : vérifie et recommence. »', async () => {
      const { api } = await openProgram();
      api.on('POST', CHANGES, { status: 409, body: { error: 'stale_revision' } });
      const sheet = await openSlot('Squat barre');
      fireEvent.click(button('Alléger la prochaine fois', sheet));
      await within(sheet).findByText(STALE);
    });
  });

  it('« Ajouter un exercice » envoie add_slot pour la séance', async () => {
    const { api } = await openProgram();
    acceptChanges(api);
    fireEvent.click(button('Ajouter un exercice', region('Séance A')));
    const sheet = dialog('Ajouter un exercice à Séance A');
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Presse à cuisses' }));
    fireEvent.click(button('Ajouter', sheet));
    await until(() => sentChanges(api).length > 0);
    expect(sentChanges(api)).toEqual([
      {
        baseRevision: 4,
        operations: [{ op: 'add_slot', workout: 'A', movementPattern: 'squat', exercises: ['leg-press'] }],
      },
    ]);
  });

  it('« Jours par semaine » envoie set_days_per_week, dans les bornes du modèle', async () => {
    const { api } = await openProgram();
    acceptChanges(api);
    fireEvent.click(button('Jours par semaine'));
    const sheet = dialog('Jours par semaine');
    const days = within(sheet)
      .getAllByRole('radio')
      .map((r) => (r as HTMLInputElement).value);
    expect(days).toEqual(['2', '3']);
    expect((within(sheet).getByRole('radio', { name: '2' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(sheet).getByRole('radio', { name: '3' }));
    fireEvent.click(button('Enregistrer', sheet));
    await until(() => sentChanges(api).length > 0);
    expect(sentChanges(api)).toEqual([
      { baseRevision: 4, operations: [{ op: 'set_days_per_week', days: 3 }] },
    ]);
  });

  it('« Commencer une semaine allégée » envoie start_deload après confirmation', async () => {
    const { api } = await openProgram();
    acceptChanges(api);
    fireEvent.click(button('Commencer une semaine allégée'));
    fireEvent.click(button('Commencer la semaine allégée', dialog('Commencer une semaine allégée')));
    await until(() => sentChanges(api).length > 0);
    expect(sentChanges(api)).toEqual([{ baseRevision: 4, operations: [{ op: 'start_deload' }] }]);
  });

  it('« Changer de programme » ouvre /program/choose', async () => {
    const { location } = await openProgram();
    fireEvent.click(screen.getByRole('link', { name: 'Changer de programme' }));
    await until(() => location() === '/program/choose');
  });

  it('journal : du plus récent au plus ancien, « Toi », « Rune », « Coach IA », résumé et statut', async () => {
    await openProgram({
      seed: (db) =>
        seedMirror(db, 'instance_change', [
          changeRow('c-user', { decidedAt: '2026-09-10T09:00:00.000Z' }),
          changeRow('c-engine', {
            author: 'engine',
            operations: [{ op: 'start_deload' }],
            reasonCode: 'ENGINE_REACTIVE_DELOAD',
            status: 'rejected',
            createdAt: '2026-09-12T09:00:00.000Z',
            expiresAt: '2026-09-19T09:00:00.000Z',
            decidedAt: '2026-09-13T09:00:00.000Z',
          }),
          changeRow('c-coach', {
            author: 'coach',
            operations: [{ op: 'set_rest', slot: 'A3', seconds: 90 }],
            createdAt: '2026-09-15T09:00:00.000Z',
            decidedAt: '2026-09-15T10:00:00.000Z',
          }),
        ]),
    });
    const items = within(region('Journal')).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      '15/09/2026 · Coach IADéveloppé couché : repos 1 min 30Accepté',
      '12/09/2026 · RuneSemaine allégéeRefusé',
      '10/09/2026 · ToiSquat barre : repos 2 min 30Accepté',
    ]);
  });

  it('profil prudent : ni « Ajouter un exercice » (phrase d’explication) ni hausse', async () => {
    await openProgram({ me: makeMe({ cautious: true }) });
    expect(screen.queryByRole('button', { name: 'Ajouter un exercice' })).toBeNull();
    expect(
      screen.getByText("Profil prudent : pas d'ajout d'exercice, pour garder un volume adapté."),
    ).toBeTruthy();
    const sheet = await openSlot('Squat barre');
    expect(within(sheet).queryByRole('button', { name: 'Ajouter une série' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Retirer une série' })).toBeTruthy();
    fireEvent.click(button('Réglages avancés', sheet));
    const rir = within(sheet)
      .getAllByRole('radio')
      .map((r) => (r as HTMLInputElement).value);
    // Effort visé : hausse seulement (2 aujourd'hui), jamais une marge plus courte.
    expect(rir).toEqual(['2', '3', '4']);
    expect(within(sheet).getByText('De 6 à 15 répétitions, écart de 2 au moins.')).toBeTruthy();
  });

  it('hors ligne : actions grisées, « Nécessite le réseau »', async () => {
    await openProgram({
      sync: createFakeSyncEngine({ connection: 'offline' }),
      seed: (db) => seedMirror(db, 'instance_change', [PROPOSAL]),
    });
    expect(screen.getAllByText(OFFLINE).length).toBeGreaterThan(0);
    expect(button('Accepter').disabled).toBe(true);
    expect(button('Refuser').disabled).toBe(true);
    expect(button('Jours par semaine').disabled).toBe(true);
    expect(button('Commencer une semaine allégée').disabled).toBe(true);
    const sheet = await openSlot('Squat barre');
    expect(button('Suspendre', sheet).disabled).toBe(true);
    expect(within(sheet).getByText(OFFLINE)).toBeTruthy();
  });

  it('nouvelle version du modèle : bandeau, puis switch_template sur le même modèle après l’avertissement', async () => {
    const newer = TEMPLATES.map((t) =>
      t.template.id === GYM_BEGINNER.id ? { ...t, template: { ...t.template, version: 2 } } : t,
    );
    const { api } = await openProgram({ setup: { templates: newer } });
    acceptChanges(api);
    expect(screen.getByText('Une nouvelle version de ton programme existe.')).toBeTruthy();
    fireEvent.click(button('Passer à la nouvelle version'));
    const sheet = dialog('Passer à la nouvelle version');
    expect(
      within(sheet).getByText(
        "Ton programme actuel s'arrête. Chaque exercice repart en calibration, avec ta dernière charge comme point de départ.",
      ),
    ).toBeTruthy();
    fireEvent.click(button('Passer à la nouvelle version', sheet));
    await until(() => sentChanges(api).length > 0);
    expect(sentChanges(api)).toEqual([
      {
        baseRevision: 4,
        operations: [{ op: 'switch_template', templateId: GYM_BEGINNER.id, daysPerWeek: 2 }],
      },
    ]);
  });

  it('nouvelle version que le catalogue ne permet pas de suivre : pas de bandeau', async () => {
    const unavailable = TEMPLATES.map((t) =>
      t.template.id === GYM_BEGINNER.id ? { available: false, template: { ...t.template, version: 2 } } : t,
    );
    await openProgram({ setup: { templates: unavailable } });
    expect(screen.queryByText('Une nouvelle version de ton programme existe.')).toBeNull();
  });

  it('sans nouvelle version : pas de bandeau', async () => {
    await openProgram();
    expect(screen.queryByText('Une nouvelle version de ton programme existe.')).toBeNull();
  });

  it('sans programme : « Choisis ton programme » mène à /program/choose', async () => {
    const db = createTestLocalDb();
    await seedProgram(db, { instance: false });
    const { location } = await renderApp({ path: '/program', db, me: makeMe() });
    fireEvent.click(await screen.findByRole('link', { name: 'Choisis ton programme' }, LAZY));
    await until(() => location() === '/program/choose');
  });
});
