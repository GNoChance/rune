import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ADULT_NOTICE_TEXT } from '../../src/features/home/HomePage';
import { checkinToHandle, sheetOfTheDay } from '../../src/features/nutrition/HomeNutritionCard';
import type { AppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { activeTab } from '../../src/ui/TabBar';
import { createFakeApi } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { seedPrimaryGym, seedProfile } from '../support/onboarding';
import { DEFAULT_NOW, renderApp } from '../support/render';
import { until } from '../support/wait';

const LAZY = { timeout: 10_000 };
const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

async function dbWith(mode?: 'full' | 'qualitative' | 'disabled'): Promise<AppDb> {
  const db = createTestLocalDb();
  opened.push(db);
  await seedProfile(db, { coach: 'skald', goal: 'muscle', experience: 'none', daysPerWeek: 3 });
  await seedPrimaryGym(db);
  await setMeta(db, 'catalogVersion', 'cat-1');
  await setMeta(db, 'serverCatalogVersion', 'cat-1');
  await setMeta(db, 'lastPullOkAt', new Date(DEFAULT_NOW - 3_600_000).toISOString());
  if (mode) await setMeta(db, 'nutritionEffectiveMode', mode);
  return db;
}

describe('onglet de /nutrition', () => {
  it('la section Profil porte /nutrition et ses sous-pages, sans confondre avec un autre préfixe', () => {
    expect(activeTab('/nutrition')).toBe('/profile');
    expect(activeTab('/nutrition/weight')).toBe('/profile');
    expect(activeTab('/Nutrition/')).toBe('/profile');
    expect(activeTab('/nutritions')).toBeNull();
  });
});

describe('Profil › Entraînement › Nutrition', () => {
  it.each([
    ['disabled', 'Désactivée'],
    ['qualitative', 'Conseils sans chiffres'],
    ['full', 'Repères chiffrés'],
  ] as const)('mode %s : la ligne dit « %s »', async (mode, subtitle) => {
    await renderApp({ db: await dbWith(mode), path: '/profile' });
    const row = await screen.findByRole('link', { name: 'Nutrition' });
    expect(row.getAttribute('href')).toBe('/nutrition');
    await until(() => row.textContent?.includes(subtitle) === true);
    expect(
      within(screen.getByRole('region', { name: 'Entraînement' })).getByRole('link', { name: 'Nutrition' }),
    ).toBe(row);
  });

  it('un mode jamais lu : la ligne existe', async () => {
    await renderApp({ db: await dbWith(), path: '/profile' });
    expect(await screen.findByRole('link', { name: 'Nutrition' })).toBeTruthy();
  });
});

describe("carte Nutrition de l'accueil", () => {
  it('absente en disabled', async () => {
    await renderApp({ db: await dbWith('disabled'), path: '/' });
    await screen.findByText("Aujourd'hui");
    expect(screen.queryByRole('region', { name: 'Nutrition' })).toBeNull();
  });

  it.each(['qualitative', 'full'] as const)('présente en %s, avec un lien vers /nutrition', async (mode) => {
    await renderApp({ db: await dbWith(mode), path: '/', api: createFakeApi() });
    const card = await screen.findByRole('region', { name: 'Nutrition' });
    expect(within(card).getAllByRole('link')[0]?.getAttribute('href')).toBe('/nutrition');
  });

  it('qualitatif : « Conseils nutrition »', async () => {
    await renderApp({ db: await dbWith('qualitative'), path: '/' });
    const card = await screen.findByRole('region', { name: 'Nutrition' });
    expect(within(card).getByText('Conseils nutrition')).toBeTruthy();
  });
});

describe('Aide', () => {
  it("rubrique « Alimentation : demander de l'aide » vers /help/nutrition", async () => {
    await renderApp({ path: '/help', me: null });
    const section = await screen.findByRole('region', { name: "Alimentation : demander de l'aide" });
    expect(within(section).getByRole('link', { name: "Demander de l'aide" }).getAttribute('href')).toBe(
      '/help/nutrition',
    );
  });
});

describe('/help/nutrition', () => {
  it('lisible sans session et sans requête, avec la ligne TCA et les orientations', async () => {
    const { api } = await renderApp({ path: '/help/nutrition', me: null });
    await screen.findByRole('heading', { level: 1, name: "Demander de l'aide" }, LAZY);
    expect(api.calls).toEqual([]);
    expect(screen.getByRole('link', { name: /09 69 325 900/ }).getAttribute('href')).toBe('tel:0969325900');
    expect(
      document.querySelector('a[href="https://www.ffab.fr/500-ligne-tca-nouveau-numero"]'),
    ).not.toBeNull();
    expect(screen.getByText(/médecin traitant/i)).toBeTruthy();
    expect(screen.getByText(/diététicien/i)).toBeTruthy();
    expect(screen.getByText(/sage-femme/i)).toBeTruthy();
  });
});

describe('R-AGE-6', () => {
  it('le message des 18 ans cite les repères nutrition chiffrés, depuis Profil › Nutrition', () => {
    expect(ADULT_NOTICE_TEXT).toContain('repères nutrition chiffrés');
    expect(ADULT_NOTICE_TEXT).toContain('Profil › Nutrition');
    expect(ADULT_NOTICE_TEXT).toContain('« Perdre du gras »');
  });
});

describe("carte de l'accueil : fiche du jour et bilan à traiter", () => {
  const DAY = 86_400_000;
  it('la fiche change chaque jour, à tour de rôle, dans l’ordre des titres', () => {
    const titles = ['Sommeil', 'Hydratation', 'Protéines'];
    const day0 = Date.parse('2026-10-06T12:00:00Z');
    const seen = [0, 1, 2].map((i) => sheetOfTheDay(titles, day0 + i * DAY));
    expect(new Set(seen).size).toBe(3);
    expect(sheetOfTheDay(titles, day0)).toBe(sheetOfTheDay(titles, day0 + 3 * DAY));
    expect(sheetOfTheDay([], day0)).toBeNull();
  });

  it('un bilan est à traiter quand le plus récent propose un changement sans réponse', () => {
    const base = { weekStart: '2026-09-28', weighInCount: 4, meanWeightG: 70_000, changePct: -0.4 };
    const view = (c: object) =>
      ({ mode: 'full', descentPending: false, settings: null, target: null, checkins: [c] }) as never;
    const open = { ...base, representative: true, position: 'in', proposedDeltaKcal: -100, response: null };
    expect(checkinToHandle(view({ ...open, decision: 'proposal' }))).toBe(true);
    expect(checkinToHandle(view({ ...open, decision: 'rapid_loss' }))).toBe(true);
    expect(checkinToHandle(view({ ...open, decision: 'in_band' }))).toBe(false);
    expect(checkinToHandle(view({ ...open, decision: 'proposal', response: 'accepted' }))).toBe(false);
  });

  it('pendant une pause de sécurité, une baisse proposée n’est pas à traiter ; une hausse l’est', () => {
    const base = { weekStart: '2026-09-28', weighInCount: 4, meanWeightG: 70_000, changePct: -0.4 };
    const paused = (c: object) =>
      ({
        mode: 'full',
        descentPending: false,
        safetyPause: true,
        settings: null,
        target: null,
        checkins: [c],
      }) as never;
    const open = { ...base, representative: true, position: 'in', response: null, decision: 'proposal' };
    expect(checkinToHandle(paused({ ...open, proposedDeltaKcal: -100 }))).toBe(false);
    expect(checkinToHandle(paused({ ...open, proposedDeltaKcal: 100 }))).toBe(true);
  });
});
