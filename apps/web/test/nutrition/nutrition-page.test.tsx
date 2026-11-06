import { HELP_RESOURCES, helpPhones } from '@rune/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { HEALTH_WARNING_TEXT } from '../../src/ui';
import { createFakeApi } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { seedProfile } from '../support/onboarding';
import { makeMe, renderApp } from '../support/render';

const LAZY = { timeout: 10_000 };
const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

const state = (effective: 'qualitative' | 'disabled', cause: string) => ({
  effective_mode: effective,
  cause,
  stored_mode: effective === 'disabled' ? 'disabled' : 'full',
  full_open: cause !== 'full_closed',
  screen_version_current: 1,
  needs: null,
  mode_reason: null,
});

async function openNutrition(
  o: { mode?: 'full' | 'qualitative' | 'disabled'; open?: unknown; me?: ReturnType<typeof makeMe> } = {},
) {
  const db = createTestLocalDb();
  opened.push(db);
  await seedProfile(db, { coach: 'skald', goal: 'muscle', experience: 'none', daysPerWeek: 3 });
  await setMeta(db, 'nutritionEffectiveMode', o.mode ?? 'disabled');
  const api = createFakeApi();
  if (o.open) api.on('POST', '/api/nutrition/open', { status: 200, body: o.open });
  const view = await renderApp({ db, api, path: '/nutrition', me: o.me });
  await screen.findByRole('heading', { level: 1, name: 'Nutrition' }, LAZY);
  return { ...view, api, db };
}

describe('module Nutrition : en tête', () => {
  it('la bulle du coach avec son avatar « nutrition », sans chiffre', async () => {
    await openNutrition();
    expect(screen.getByText('Le Skald · Nutrition')).toBeTruthy();
  });
});

describe('module Nutrition : disabled', () => {
  it('explique le module et propose « Activer » vers /nutrition/start', async () => {
    await openNutrition();
    const link = screen.getByRole('link', { name: 'Activer' });
    expect(link.getAttribute('href')).toBe('/nutrition/start');
    expect(screen.queryByRole('button', { name: 'Activer les conseils' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Tes repères' })).toBeNull();
  });

  it('mineur : « Activer les conseils » passe en qualitatif sans rien demander', async () => {
    const { api } = await openNutrition({
      me: makeMe({ ageBand: 'minor' }),
      open: state('disabled', 'stored'),
    });
    api.on('PUT', '/api/nutrition/mode', { status: 200, body: state('qualitative', 'stored') });
    expect(screen.queryByRole('link', { name: 'Activer' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Activer les conseils' }));
    await screen.findByRole('heading', { name: 'Conseils sans chiffres' });
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ mode: 'qualitative' });
  });

  it('mineur hors ligne : « Nécessite le réseau »', async () => {
    const { api } = await openNutrition({ me: makeMe({ ageBand: 'minor' }) });
    api.setOffline('reject');
    fireEvent.click(screen.getByRole('button', { name: 'Activer les conseils' }));
    await screen.findByText('Nécessite le réseau');
    expect(screen.queryByRole('heading', { name: 'Conseils sans chiffres' })).toBeNull();
  });
});

describe('module Nutrition : qualitative', () => {
  it('« Conseils sans chiffres », sans ligne de cause quand c’est le choix de la personne', async () => {
    await openNutrition({ mode: 'qualitative', open: state('qualitative', 'stored') });
    expect(screen.getByRole('heading', { name: 'Conseils sans chiffres' })).toBeTruthy();
    expect(screen.queryByTestId('mode-cause')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Fiches' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Réglages' }).getAttribute('href')).toBe('/nutrition/settings');
  });

  it.each([
    ['minor', /18 ans/, null],
    ['over_max_age', /78 ans/, null],
    ['no_health_consent', /accord santé/, '/profile/health'],
    ['screen_outdated', /questions/, '/nutrition/start'],
    ['full_closed', /pas encore ouverts dans ce cercle/, null],
  ])('cause %s : une ligne neutre, avec son action possible', async (cause, line, href) => {
    await openNutrition({ mode: 'qualitative', open: state('qualitative', cause) });
    const box = await screen.findByTestId('mode-cause');
    expect(box.textContent).toMatch(line);
    const link = within(box).queryByRole('link');
    if (href) expect(link?.getAttribute('href')).toBe(href);
    else expect(link).toBeNull();
  });
});

describe('module Nutrition : full', () => {
  it('les sections du §12.2, titrées', async () => {
    await openNutrition({ mode: 'full' });
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual([
      'Tes repères',
      'Bilan de la semaine',
      'Poids',
      'Fiches',
      'Réglages',
      "Besoin d'en parler ?",
    ]);
    expect(screen.getByText('Une estimation, pas une consigne.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Comment sont calculés mes repères' }).getAttribute('href')).toBe(
      '/nutrition/how',
    );
    expect(screen.getByRole('link', { name: 'Voir la courbe' }).getAttribute('href')).toBe(
      '/nutrition/weight',
    );
    expect(screen.getByRole('link', { name: 'Réglages' }).getAttribute('href')).toBe('/nutrition/settings');
  });
});

describe('module Nutrition : pied', () => {
  it.each(['disabled', 'qualitative', 'full'] as const)(
    'mode %s : « Besoin d’en parler ? », la ligne TCA de HELP_RESOURCES et l’avertissement santé',
    async (mode) => {
      await openNutrition({ mode });
      const footer = screen.getByRole('region', { name: "Besoin d'en parler ?" });
      expect(within(footer).getByText("Besoin d'en parler ?")).toBeTruthy();
      const tca = HELP_RESOURCES.find((r) => r.id === 'eating_disorder');
      if (!tca) throw new Error('ligne TCA absente');
      const [phone] = helpPhones(tca);
      const call = within(footer).getByRole('link', { name: new RegExp(phone?.label ?? '') });
      expect(call.getAttribute('href')).toBe(`tel:${phone?.digits}`);
      expect(within(footer).getByRole('link', { name: "Demander de l'aide" }).getAttribute('href')).toBe(
        '/help/nutrition',
      );
      expect(within(footer).getByText(HEALTH_WARNING_TEXT)).toBeTruthy();
    },
  );
});
