import { FORBIDDEN_TERMS } from '@rune/contracts';
import { type FilterContext, normalizeForTerms, outputFilterText } from '@rune/domain';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { coachStoreFor } from '../../src/features/coach/coach-store';
import { ENTRY_TEXTS, PROGRAM_PREFILL } from '../../src/features/coach/coach-texts';
import type { AppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { coachStatus, serveCoach } from '../support/coach';
import { createFakeApi, createFakeSyncEngine, type FakeSyncEngine } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { seedPrimaryGym, seedProfile } from '../support/onboarding';
import { seedProgram } from '../support/program';
import { DEFAULT_NOW, makeMe, renderApp } from '../support/render';
import { seedMirror } from '../support/seed';
import { until } from '../support/wait';
import { seedBase } from '../workout/seed';

// Entrées vers le coach (spec brique 4 §16.1) : accueil, Mon programme, fin de séance. Aucune n'envoie quoi que
// ce soit : au plus un brouillon dans le magasin du coach, puis la navigation.

const LAZY = { timeout: 10_000 };
const OFFLINE = 'Nécessite le réseau';
const GRANTED = {
  health: { active: true, textVersion: '1.0', at: '2026-10-01T10:00:00.000Z' },
  aiCoach: { active: true, textVersion: '1.0', at: '2026-10-01T10:00:00.000Z' },
};
const WITH_CONSENT = makeMe({ consents: GRANTED });
const WITHOUT_CONSENT = makeMe();

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

async function openHome(me = WITH_CONSENT, sync?: FakeSyncEngine) {
  const db = createTestLocalDb();
  opened.push(db);
  await seedProfile(db, {
    coach: 'skald',
    goal: 'muscle',
    experience: 'none',
    daysPerWeek: 3,
    sessionMinutes: 45,
  });
  await seedPrimaryGym(db);
  await setMeta(db, 'catalogVersion', 'cat-1');
  await setMeta(db, 'serverCatalogVersion', 'cat-1');
  await setMeta(db, 'lastPullOkAt', new Date(DEFAULT_NOW - 3_600_000).toISOString());
  const api = createFakeApi();
  const view = await renderApp({ db, api, me, now: DEFAULT_NOW, sync });
  await screen.findByRole('heading', { level: 1 });
  await screen.findByText("Aujourd'hui");
  return { ...view, api };
}

describe("accueil : l'entrée de la bulle « Aujourd'hui »", () => {
  it('accord actif : « Parler au coach » vers /coach, sans rien envoyer', async () => {
    const { api } = await openHome();
    const link = screen.getByRole('link', { name: 'Parler au coach' });
    expect(link.getAttribute('href')).toBe('/coach');
    expect(screen.queryByText('Découvrir le coach IA')).toBeNull();
    expect(api.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('sans accord : « Découvrir le coach IA » vers /profile/coach', async () => {
    await openHome(WITHOUT_CONSENT);
    const link = screen.getByRole('link', { name: 'Découvrir le coach IA' });
    expect(link.getAttribute('href')).toBe('/profile/coach');
    expect(screen.queryByText('Parler au coach')).toBeNull();
  });

  it.each([
    ['accord actif', WITH_CONSENT, 'Parler au coach'],
    ['sans accord', WITHOUT_CONSENT, 'Découvrir le coach IA'],
  ])('hors ligne (%s) : grisé, « Nécessite le réseau »', async (_n, me, label) => {
    await openHome(me, createFakeSyncEngine({ connection: 'offline' }));
    const button = screen.getByRole('button', { name: new RegExp(label) }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.queryByRole('link', { name: label })).toBeNull();
    expect(screen.getByText(OFFLINE)).toBeTruthy();
  });
});

describe('Mon programme : « Ajuster mon programme avec le coach »', () => {
  async function openProgram(sync?: FakeSyncEngine, me = WITH_CONSENT) {
    const db = createTestLocalDb();
    opened.push(db);
    await seedProgram(db);
    const api = createFakeApi();
    serveCoach(api, coachStatus());
    const view = await renderApp({ path: '/program', db, api, me, sync });
    await screen.findByRole('button', { name: 'Ajuster mon programme avec le coach' }, LAZY);
    return { ...view, api };
  }

  it('met le préremplissage dans le champ, ouvre /coach, ne poste rien', async () => {
    const { api, location, services } = await openProgram();
    fireEvent.click(screen.getByRole('button', { name: 'Ajuster mon programme avec le coach' }));
    expect(coachStoreFor(services).getState().draft).toBe('Je voudrais ajuster mon programme : ');
    expect(PROGRAM_PREFILL).toBe('Je voudrais ajuster mon programme : ');
    const field = (await screen.findByRole('textbox', {}, LAZY)) as HTMLTextAreaElement;
    expect(location()).toBe('/coach');
    expect(field.value).toBe('Je voudrais ajuster mon programme : ');
    expect(api.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('sans l’accord : vers /profile/coach, sans brouillon ni envoi', async () => {
    const { api, location, services } = await openProgram(undefined, WITHOUT_CONSENT);
    fireEvent.click(screen.getByRole('button', { name: 'Ajuster mon programme avec le coach' }));
    await until(() => location() === '/profile/coach');
    expect(coachStoreFor(services).getState().draft).toBe('');
    expect(api.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('hors ligne : grisé, « Nécessite le réseau »', async () => {
    await openProgram(createFakeSyncEngine({ connection: 'offline' }));
    const button = screen.getByRole('button', {
      name: 'Ajuster mon programme avec le coach',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getAllByText(OFFLINE).length).toBeGreaterThan(0);
  });
});

describe('fin de séance : « Une question sur cette séance ? »', () => {
  async function openSummary(me: typeof WITH_CONSENT, sync?: FakeSyncEngine) {
    const db = await seedBase();
    opened.push(db);
    await seedMirror(db, 'workout_session', [
      {
        id: 's-now',
        ownerId: 'u-1',
        instanceId: 'i-1',
        workoutId: 'A',
        placeId: 'p-1',
        deviceId: 'dev-A',
        startedAt: '2026-10-06T10:00:00.000Z',
        endedAt: '2026-10-06T10:52:00.000Z',
        status: 'completed',
        weekType: 'normal',
        templateVersion: 1,
        rulesVersion: '1',
        appVersion: 'test',
        profile: 'adult',
        note: null,
      },
    ]);
    const view = await renderApp({ path: '/workout/s-now/summary', db, me, sync });
    await screen.findByRole('group', { name: 'Séance gravée.' }, { timeout: 5000 });
    return view;
  }

  it('avec l’accord : le lien vers /coach, sous la bulle « Fin de séance »', async () => {
    await openSummary(WITH_CONSENT);
    const link = screen.getByRole('link', { name: 'Une question sur cette séance ?' });
    expect(link.getAttribute('href')).toBe('/coach');
    const label = screen.getByText('Fin de séance');
    expect(label.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hors ligne : grisé, « Nécessite le réseau », plus de lien', async () => {
    await openSummary(WITH_CONSENT, createFakeSyncEngine({ connection: 'offline' }));
    const button = screen.getByRole('button', {
      name: 'Une question sur cette séance ?',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.queryByRole('link', { name: 'Une question sur cette séance ?' })).toBeNull();
    expect(screen.getByText(OFFLINE)).toBeTruthy();
  });

  it('sans l’accord : pas de lien', async () => {
    await openSummary(WITHOUT_CONSENT);
    expect(screen.getByText('Fin de séance')).toBeTruthy();
    expect(screen.queryByText('Une question sur cette séance ?')).toBeNull();
  });
});

describe('textes des entrées', () => {
  const contexts: FilterContext[] = (['adult', 'minor'] as const).map((audience) => ({
    audience,
    nutritionMode: 'none',
    allowed: { mass: new Set(), percent: new Set(), nutrition: new Set() },
  }));

  it('mot pour mot', () => {
    expect(ENTRY_TEXTS).toEqual({
      talk: 'Parler au coach',
      discover: 'Découvrir le coach IA',
      adjust: 'Ajuster mon programme avec le coach',
      question: 'Une question sur cette séance ?',
    });
  });

  it.each(Object.entries(ENTRY_TEXTS))('%s passe le filtre de sortie et les termes interdits', (_k, text) => {
    for (const ctx of contexts) expect(outputFilterText(text, ctx)).toEqual({ ok: true });
    const haystack = ` ${normalizeForTerms(text)} `;
    for (const t of [...FORBIDDEN_TERMS.all, ...FORBIDDEN_TERMS.minor]) {
      for (const form of [t.term, ...t.forms]) {
        expect(haystack).not.toContain(` ${normalizeForTerms(form)} `);
      }
    }
  });
});
