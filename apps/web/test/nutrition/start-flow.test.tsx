import { HELP_RESOURCES, helpPhones } from '@rune/contracts';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseWeight } from '../../src/features/nutrition/parse-weight';
import type { AppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { createFakeApi } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { seedProfile } from '../support/onboarding';
import { makeMe, renderApp } from '../support/render';
import { until } from '../support/wait';

const LAZY = { timeout: 10_000 };
const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

const healthOn = makeMe({
  consents: {
    health: { active: true, textVersion: '1.0', at: '2026-10-01T10:00:00.000Z' },
    aiCoach: { active: false, textVersion: null, at: null },
  },
});

const state = (o: { full_open?: boolean; needs?: string | null } = {}) => ({
  effective_mode: 'disabled',
  cause: 'stored',
  stored_mode: 'disabled',
  full_open: o.full_open ?? true,
  screen_version_current: 1,
  needs: o.needs ?? null,
  mode_reason: null,
});

interface StartOptions {
  me?: ReturnType<typeof makeMe>;
  path?: string;
  full_open?: boolean;
  needs?: string | null;
  profile?: Record<string, unknown>;
  offline?: boolean;
}

async function openStart(o: StartOptions = {}) {
  const db = createTestLocalDb();
  opened.push(db);
  await seedProfile(db, {
    coach: 'skald',
    goal: 'muscle',
    experience: 'none',
    daysPerWeek: 3,
    ...o.profile,
  });
  await setMeta(db, 'nutritionEffectiveMode', 'disabled');
  const api = createFakeApi();
  api.on('POST', '/api/nutrition/open', { status: 200, body: state(o) });
  api.on('POST', '/api/nutrition/screen', {
    status: 200,
    body: { ...state(o), effective_mode: 'qualitative' },
  });
  api.on('PUT', '/api/nutrition/mode', {
    status: 200,
    body: { ...state(o), effective_mode: 'qualitative' },
  });
  if (o.offline) api.setOffline('reject');
  const view = await renderApp({ db, api, path: o.path ?? '/nutrition/start', me: o.me ?? healthOn });
  await screen.findByRole('heading', { level: 1, name: 'Nutrition' }, LAZY);
  return { ...view, api, db };
}

const begin = async () => fireEvent.click(await screen.findByRole('button', { name: 'Commencer' }));
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const answers = (...a: ('Oui' | 'Non' | 'Je préfère ne pas répondre')[]) => {
  for (const x of a) click(x);
};
const submitted = (api: { calls: { method: string; path: string; body: unknown }[] }) =>
  api.calls.filter((c) => c.path === '/api/nutrition/screen');

async function toOutcome(o: StartOptions, ...a: Parameters<typeof answers>) {
  const view = await openStart(o);
  await until(() => view.api.calls.some((c) => c.path === '/api/nutrition/open'));
  await begin();
  answers(...a);
  await screen.findByText('Ce que tu peux choisir');
  return view;
}

describe('parseWeight', () => {
  it.each([
    ['72,4', 72400],
    ['72.4', 72400],
    [' 80 ', 80000],
    ['30', 30000],
    ['250', 250000],
  ])('« %s » donne %i g', (text, weightG) => {
    expect(parseWeight(text)).toEqual({ ok: true, weightG });
  });
  it.each([
    ['', 'empty'],
    ['abc', 'format'],
    ['72,', 'format'],
    ['72,45', 'decimals'],
    ['29,9', 'range'],
    ['250,1', 'range'],
  ])('« %s » est refusé : %s', (text, reason) => {
    expect(parseWeight(text)).toEqual({ ok: false, reason });
  });
});

describe('activation : accord santé', () => {
  it('accord refusé : conseils sans chiffres, sans écran de sécurité', async () => {
    const { api } = await openStart({ me: makeMe() });
    await until(() => api.calls.some((c) => c.path === '/api/nutrition/open'));
    await begin();
    await screen.findByRole('checkbox');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    click('Conseils sans chiffres');
    await until(() => api.calls.some((c) => c.method === 'PUT' && c.path === '/api/nutrition/mode'));
    expect(api.calls.find((c) => c.path === '/api/nutrition/mode')?.body).toEqual({ mode: 'qualitative' });
    expect(screen.queryByText('Question 1 sur 3')).toBeNull();
    expect(submitted(api)).toHaveLength(0);
  });

  it('accord déjà actif : on passe tout de suite à la première question', async () => {
    const { api } = await openStart();
    await until(() => api.calls.some((c) => c.path === '/api/nutrition/open'));
    await begin();
    expect(await screen.findByText('Question 1 sur 3')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('écran de sécurité', () => {
  it('trois boutons par question, une question par écran, retour possible', async () => {
    const { api } = await openStart();
    await until(() => api.calls.some((c) => c.path === '/api/nutrition/open'));
    await begin();
    expect(await screen.findByText(/Grossesse en cours ou allaitement/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Je préfère ne pas répondre' })).toBeTruthy();
    click('Non');
    expect(screen.getByText(/trouble du comportement alimentaire/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retour/ }));
    expect(await screen.findByText(/Grossesse en cours ou allaitement/)).toBeTruthy();
  });

  it("Q2 « Oui » : la ligne TCA s'affiche avant le choix du mode", async () => {
    await toOutcome({}, 'Non', 'Oui', 'Non');
    const resource = HELP_RESOURCES.find((r) => r.id === 'eating_disorder');
    if (!resource) throw new Error('ligne TCA absente');
    const tel = screen.getByRole('link', { name: `Appeler le ${helpPhones(resource)[0]?.label}` });
    const modes = screen.getByRole('group', { name: 'Mode' });
    expect(tel.compareDocumentPosition(modes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Repères chiffrés/ })).toBeNull();
    expect(screen.getByRole('radio', { name: /Conseils sans chiffres/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Désactivée/ })).toBeTruthy();
  });

  it('Q1 « Oui » : orientation vers une sage-femme ou un médecin, jamais le mode complet', async () => {
    await toOutcome({}, 'Oui', 'Non', 'Non');
    expect(screen.getByText(/sage-femme/)).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Repères chiffrés/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Appeler/ })).toBeNull();
  });

  it('« Je préfère ne pas répondre » : qualitatif seulement', async () => {
    await toOutcome({}, 'Non', 'Non', 'Je préfère ne pas répondre');
    expect(screen.queryByRole('radio', { name: /Repères chiffrés/ })).toBeNull();
    expect(screen.getByRole('radio', { name: /Conseils sans chiffres/ })).toBeTruthy();
  });

  it("mode complet grisé, avec sa raison, tant que le cercle ne l'a pas ouvert", async () => {
    await toOutcome({ full_open: false }, 'Non', 'Non', 'Non');
    const full = screen.getByRole('radio', { name: /Repères chiffrés/ }) as HTMLInputElement;
    expect(full.disabled).toBe(true);
    expect(screen.getByText('Pas encore ouvert dans ce cercle')).toBeTruthy();
    const qualitative = screen.getByRole('radio', { name: /Conseils sans chiffres/ }) as HTMLInputElement;
    expect(qualitative.disabled).toBe(false);
  });

  it("rien n'est envoyé avant la dernière étape, puis une seule requête POST /screen", async () => {
    const { api } = await toOutcome({}, 'Non', 'Non', 'Non');
    fireEvent.click(screen.getByRole('radio', { name: /Conseils sans chiffres/ }));
    expect(api.calls.filter((c) => c.method !== 'GET' && c.path !== '/api/nutrition/open')).toHaveLength(0);
    click('Valider');
    await until(() => submitted(api).length === 1);
    expect(submitted(api)[0]?.body).toEqual({
      answers: { pregnancy: 'no', eating_disorder: 'no', medical: 'no' },
      mode: 'qualitative',
    });
  });
});

describe('mode complet : sexe, taille, première pesée, activité, objectif', () => {
  async function toSetup(o: StartOptions = {}) {
    const view = await toOutcome(o, 'Non', 'Non', 'Non');
    fireEvent.click(screen.getByRole('radio', { name: /Repères chiffrés/ }));
    click('Continuer');
    await screen.findByText('Tes repères de départ');
    return view;
  }
  const fill = (height: string, weight: string) => {
    fireEvent.change(screen.getByLabelText('Taille (cm)'), { target: { value: height } });
    fireEvent.change(screen.getByLabelText('Première pesée (kg)'), { target: { value: weight } });
  };
  const checked = (name: RegExp) => (screen.getByRole('radio', { name }) as HTMLInputElement).checked;

  it("présélections affichées d'après le profil, et modifiables", async () => {
    await toSetup({ profile: { goal: 'fat_loss', sportCode: null } });
    fill('175', '80');
    expect(checked(/Perte de gras/)).toBe(true);
    expect(checked(/Un peu actif/)).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Maintien/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Actif : métier debout/ }));
    expect(checked(/Maintien/)).toBe(true);
    expect(checked(/Actif : métier debout/)).toBe(true);
  });

  it('un sport au profil présélectionne le niveau 3', async () => {
    await toSetup({ profile: { sportCode: 'running' } });
    fill('175', '80');
    expect(checked(/Actif : métier debout/)).toBe(true);
  });

  it('160 cm / 47 kg : « perte » absent, sans message chiffré', async () => {
    await toSetup({ profile: { goal: 'fat_loss' } });
    fill('160', '47');
    expect(screen.queryByRole('radio', { name: /Perte/ })).toBeNull();
    expect(checked(/Maintien/)).toBe(true);
    expect(document.body.textContent).not.toMatch(/IMC|18[,.]5/);
  });

  it('envoie une seule requête avec le setup (pesée du jour, identifiant client)', async () => {
    const { api } = await toSetup();
    fireEvent.click(screen.getByRole('radio', { name: 'Femme' }));
    fill('168', '62,5');
    expect((screen.getByRole('button', { name: 'Valider' }) as HTMLButtonElement).disabled).toBe(false);
    click('Valider');
    await until(() => submitted(api).length === 1);
    const body = submitted(api)[0]?.body as { mode: string; setup: Record<string, unknown> };
    expect(body.mode).toBe('full');
    expect(body.setup).toMatchObject({
      sex_for_calc: 'female',
      height_cm: 168,
      activity_level: 2,
      goal: 'gain',
      weigh_in: { date: '2026-10-06', weight_g: 62500 },
    });
    expect(typeof (body.setup.weigh_in as { id: string }).id).toBe('string');
  });

  it("poids invalide : message, pas d'envoi", async () => {
    const { api } = await toSetup();
    fill('168', '62,45');
    expect(screen.getByText('Une décimale au plus.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Valider' }) as HTMLButtonElement).disabled).toBe(true);
    expect(submitted(api)).toHaveLength(0);
  });
});

describe("hors ligne, mineur, repasser l'écran", () => {
  it('hors ligne : « Nécessite le réseau », rien ne démarre', async () => {
    const { api } = await openStart({ offline: true });
    expect(await screen.findByText('Nécessite le réseau')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Commencer' })).toBeNull();
    expect(submitted(api)).toHaveLength(0);
  });

  it('envoi final hors ligne : « Nécessite le réseau »', async () => {
    const { api } = await toOutcome({}, 'Non', 'Non', 'Non');
    fireEvent.click(screen.getByRole('radio', { name: /Conseils sans chiffres/ }));
    api.setOffline('reject');
    click('Valider');
    expect(await screen.findByText('Nécessite le réseau')).toBeTruthy();
  });

  it('un mineur voit « Activer les conseils » et aucune question', async () => {
    const { location } = await openStart({ me: makeMe({ ageBand: 'minor' }) });
    await until(() => location() === '/nutrition');
    await screen.findByRole('button', { name: 'Activer les conseils' });
    expect(screen.queryByText(/Question 1 sur 3/)).toBeNull();
  });

  it("repasser depuis Réglages : directement la question 1, puis l'issue et l'envoi, sans explication ni accord", async () => {
    const { api } = await openStart({ path: '/nutrition/start?screen=1', me: makeMe() });
    expect(await screen.findByText('Question 1 sur 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Commencer' })).toBeNull();
    await until(() => api.calls.some((c) => c.path === '/api/nutrition/open'));
    answers('Non', 'Non', 'Non');
    await screen.findByText('Ce que tu peux choisir');
    fireEvent.click(screen.getByRole('radio', { name: /Repères chiffrés/ }));
    click('Valider');
    await until(() => submitted(api).length === 1);
    expect(submitted(api)[0]?.body).toEqual({
      answers: { pregnancy: 'no', eating_disorder: 'no', medical: 'no' },
      mode: 'full',
    });
  });

  it("repasser alors que les réglages manquent (needs = setup) : l'étape des réglages s'intercale", async () => {
    const { api } = await openStart({ path: '/nutrition/start?screen=1', needs: 'setup' });
    await until(() => api.calls.some((c) => c.path === '/api/nutrition/open'));
    answers('Non', 'Non', 'Non');
    await screen.findByText('Ce que tu peux choisir');
    fireEvent.click(screen.getByRole('radio', { name: /Repères chiffrés/ }));
    click('Continuer');
    expect(await screen.findByText('Tes repères de départ')).toBeTruthy();
  });
});
