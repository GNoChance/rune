import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { createFakeApi } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { seedPrimaryGym, seedProfile } from '../support/onboarding';
import { makeMe, renderApp } from '../support/render';
import { seedMirror } from '../support/seed';
import { seedHealthConsent } from '../support/workout';

const LAZY = { timeout: 10_000 };
const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

// « Aujourd'hui » des tests : 2026-10-06 (mardi).
const base = { ownerId: 'u-1', serverRevSeen: 1, deletedAt: null, updatedAt: '2026-10-01T10:00:00.000Z' };
const me = makeMe({
  consents: {
    health: { active: true, textVersion: '1.0', at: null },
    aiCoach: { active: false, textVersion: null, at: null },
  },
});

async function dbWith(mode: 'full' | 'qualitative', weighIns: [string, number][] = []): Promise<AppDb> {
  const db = createTestLocalDb();
  opened.push(db);
  await seedProfile(db, { coach: 'skald', goal: 'muscle', experience: 'none', daysPerWeek: 3 });
  await seedPrimaryGym(db);
  await setMeta(db, 'catalogVersion', 'cat-1');
  await setMeta(db, 'serverCatalogVersion', 'cat-1');
  await setMeta(db, 'nutritionEffectiveMode', mode);
  await seedHealthConsent(db);
  if (weighIns.length > 0) {
    await seedMirror(
      db,
      'weigh_in',
      weighIns.map(([date, weightG]) => ({ id: `w-${date}`, ...base, date, weightG })),
    );
  }
  return db;
}

async function open(path: string, mode: 'full' | 'qualitative', weighIns: [string, number][] = []) {
  const db = await dbWith(mode, weighIns);
  const api = createFakeApi();
  const view = await renderApp({ db, api, path, me });
  return { ...view, db, api };
}

const liveWeighIns = async (db: AppDb) =>
  (await db.mirror('weigh_in').toArray())
    .filter((r) => r.deletedAt === null)
    .map((r) => [r.date, r.weightG])
    .sort();

async function openSheet() {
  fireEvent.click(await screen.findByRole('button', { name: 'Noter mon poids' }, LAZY));
  return screen.findByRole('dialog', { name: 'Noter mon poids' });
}

function fillWeight(sheet: HTMLElement, text: string) {
  fireEvent.change(within(sheet).getByLabelText('Poids (kg)'), { target: { value: text } });
}

describe('feuille de pesée', () => {
  it('date du jour par défaut, jamais plus tard ; le conseil en petit', async () => {
    await open('/nutrition', 'full');
    const sheet = await openSheet();
    const date = within(sheet).getByLabelText('Date') as HTMLInputElement;
    expect(date.value).toBe('2026-10-06');
    expect(date.max).toBe('2026-10-06');
    expect(
      within(sheet).getByText(
        'Pèse-toi 3 fois par semaine ou plus, le matin, avant de manger, dans la même tenue, pour un bilan fiable.',
      ),
    ).toBeTruthy();
  });

  it('enregistre la pesée du jour, hors ligne par l’outbox', async () => {
    const { db, api } = await open('/nutrition', 'full');
    const sheet = await openSheet();
    api.setOffline('reject');
    fillWeight(sheet, '72,5');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await liveWeighIns(db)).toEqual([['2026-10-06', 72_500]]);
    const ops = await db.table('outbox').toArray();
    expect(ops.filter((o) => o.entity === 'weigh_in')).toHaveLength(1);
  });

  it('une date passée est possible', async () => {
    const { db } = await open('/nutrition', 'full');
    const sheet = await openSheet();
    fireEvent.change(within(sheet).getByLabelText('Date'), { target: { value: '2026-10-01' } });
    fillWeight(sheet, '71');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await liveWeighIns(db)).toEqual([['2026-10-01', 71_000]]);
  });

  it('une date future est impossible', async () => {
    const { db } = await open('/nutrition', 'full');
    const sheet = await openSheet();
    fireEvent.change(within(sheet).getByLabelText('Date'), { target: { value: '2026-10-07' } });
    fillWeight(sheet, '71');
    expect(within(sheet).getByText("Choisis un jour qui n'est pas encore passé.")).toBeTruthy();
    const save = within(sheet).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(await liveWeighIns(db)).toEqual([]);
  });

  it('« Remplace la pesée de ce jour » quand la date est prise, et la remplace', async () => {
    const { db } = await open('/nutrition', 'full', [
      ['2026-10-06', 70_000],
      ['2026-10-05', 70_000],
    ]);
    const sheet = await openSheet();
    expect(await within(sheet).findByText('Remplace la pesée de ce jour')).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText('Date'), { target: { value: '2026-10-04' } });
    expect(within(sheet).queryByText('Remplace la pesée de ce jour')).toBeNull();
    fireEvent.change(within(sheet).getByLabelText('Date'), { target: { value: '2026-10-06' } });
    fillWeight(sheet, '70,6');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await liveWeighIns(db)).toEqual([
      ['2026-10-05', 70_000],
      ['2026-10-06', 70_600],
    ]);
  });

  it('« Vérifie ta saisie » au-delà de 3 kg d’écart, sans bloquer', async () => {
    const { db } = await open('/nutrition', 'full', [['2026-10-04', 70_000]]);
    const sheet = await openSheet();
    fillWeight(sheet, '73,2');
    expect(await within(sheet).findByText('Vérifie ta saisie')).toBeTruthy();
    fillWeight(sheet, '73');
    expect(within(sheet).queryByText('Vérifie ta saisie')).toBeNull();
    fillWeight(sheet, '73,2');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await liveWeighIns(db)).toEqual([
      ['2026-10-04', 70_000],
      ['2026-10-06', 73_200],
    ]);
  });

  it('un poids invalide : le message du champ, rien d’enregistré', async () => {
    await open('/nutrition', 'full');
    const sheet = await openSheet();
    fillWeight(sheet, '72,55');
    expect(within(sheet).getByText('Une décimale au plus.')).toBeTruthy();
    expect((within(sheet).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('résumé du poids et accueil', () => {
  it('moyenne sur 7 jours et variation de la semaine, en neutre, avec « Voir la courbe »', async () => {
    await open('/nutrition', 'full', [
      ['2026-10-05', 70_200],
      ['2026-10-06', 70_400],
      ['2026-09-29', 70_000],
      ['2026-09-30', 70_000],
    ]);
    const section = (await screen.findByRole('heading', { name: 'Poids' }, LAZY)).closest(
      'section',
    ) as HTMLElement;
    expect((await within(section).findByText(/Moyenne sur 7 jours/)).textContent).toContain('70,2');
    expect(within(section).getByText(/sur la semaine/).textContent).toContain('+0,3');
    expect(within(section).getByRole('link', { name: 'Voir la courbe' }).getAttribute('href')).toBe(
      '/nutrition/weight',
    );
  });

  it('la carte de l’accueil porte « Noter mon poids » en mode complet', async () => {
    await open('/', 'full');
    const sheet = await openSheet();
    expect(within(sheet).getByLabelText('Poids (kg)')).toBeTruthy();
  });
});

describe('page /nutrition/weight', () => {
  it('hors du mode complet : retour à /nutrition, rien du poids', async () => {
    const { location } = await open('/nutrition/weight', 'qualitative');
    await screen.findByRole('heading', { level: 1, name: 'Nutrition' }, LAZY);
    expect(location()).toBe('/nutrition');
    expect(screen.queryByRole('heading', { name: 'Poids' })).toBeNull();
  });

  const SERIES: [string, number][] = [
    ['2026-10-05', 70_000],
    ['2026-09-20', 71_000],
    ['2026-07-20', 72_000],
    ['2026-02-01', 73_000],
  ];
  const count = () =>
    within(screen.getByRole('list', { name: 'Mes pesées' })).getAllByRole('listitem').length;

  it('plages de 4 semaines, 3 mois et 1 an', async () => {
    await open('/nutrition/weight', 'full', SERIES);
    await screen.findByRole('list', { name: 'Mes pesées' }, LAZY);
    expect(count()).toBe(2);
    fireEvent.click(screen.getByRole('radio', { name: '3 mois' }));
    expect(count()).toBe(3);
    fireEvent.click(screen.getByRole('radio', { name: '1 an' }));
    expect(count()).toBe(4);
    fireEvent.click(screen.getByRole('radio', { name: '4 semaines' }));
    expect(count()).toBe(2);
  });

  it('table des moyennes de semaine ; la courbe est cachée aux lecteurs d’écran', async () => {
    const { container } = await open('/nutrition/weight', 'full', [
      ['2026-09-28', 70_000],
      ['2026-09-29', 70_200],
      ['2026-09-30', 70_400],
      ['2026-10-05', 70_000],
    ]);
    const table = await screen.findByRole('table', { name: 'Moyennes par semaine' }, LAZY);
    const text = within(table)
      .getAllByRole('row')
      .map((r) => r.textContent ?? '');
    expect(text.some((t) => t.includes('28/09/2026') && t.includes('70,2') && t.includes('3'))).toBe(true);
    // la semaine du 5 octobre n'a qu'une pesée : pas de moyenne
    expect(text.some((t) => t.includes('05/10/2026') && !t.includes('70,0'))).toBe(true);
    expect(container.querySelector('[data-chart]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('corriger puis supprimer une pesée', async () => {
    const { db } = await open('/nutrition/weight', 'full', [['2026-10-05', 70_000]]);
    fireEvent.click(await screen.findByRole('button', { name: 'Corriger la pesée du 05/10/2026' }, LAZY));
    fireEvent.change(screen.getByLabelText('Poids (kg)'), { target: { value: '71,2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(async () => expect(await liveWeighIns(db)).toEqual([['2026-10-05', 71_200]]));
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer la pesée du 05/10/2026' }));
    await waitFor(async () => expect(await liveWeighIns(db)).toEqual([]));
  });

  it('ni couleur danger/succès, ni félicitation dans le rendu', async () => {
    const { container } = await open('/nutrition/weight', 'full', [
      ['2026-10-04', 70_000],
      ['2026-10-05', 74_000],
    ]);
    await screen.findByRole('table', { name: 'Moyennes par semaine' }, LAZY);
    expect(container.innerHTML).not.toMatch(/danger|success|green|\bred\b/i);
    expect(container.textContent).not.toMatch(/bravo|félicit|bien joué|objectif atteint|super/i);
    const css = readFileSync(
      resolve(import.meta.dirname, '../../src/features/nutrition/weight.module.css'),
      'utf8',
    );
    expect(css).not.toMatch(/danger|success|green|\bred\b|#(?:f00|0f0)/i);
  });
});
