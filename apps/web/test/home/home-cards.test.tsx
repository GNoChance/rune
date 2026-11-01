import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { getMeta, setMeta } from '../../src/local-db/meta';
import { DEFAULT_NOW, renderApp } from '../support/render';
import { seedMirror } from '../support/seed';
import { until } from '../support/wait';
import { seedBase, seedSession } from '../workout/seed';

// Cartes de l'accueil de la brique 3 (spec §7.9) : séance en cours, séance du jour ou « Choisis ton programme »,
// propositions en attente, Quêtes d'éveil tant qu'elles ne sont pas faites, bulle du coach, tuiles.

const HOUR = 3_600_000;

/** Base du membre (programme « Corps entier », Garage principal) ; `ready` : le voyant « Prêt hors ligne » au vert. */
async function homeDb(o: { ready?: boolean; template?: null } = {}): Promise<AppDb> {
  const db = await seedBase(o.template === null ? { template: null } : {});
  await setMeta(db, 'catalogVersion', 'cat-1');
  await setMeta(db, 'serverCatalogVersion', 'cat-1');
  if (o.ready !== false) await setMeta(db, 'lastPullOkAt', new Date(DEFAULT_NOW - HOUR).toISOString());
  return db;
}

async function openHome(db: AppDb) {
  const view = await renderApp({ db, path: '/' });
  await screen.findByRole('heading', { level: 1 });
  await until(() => document.querySelector('.stagger') !== null);
  return view;
}

const before = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const flat = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('séance du jour', () => {
  it('nom, nombre d’exercices, durée, lieu principal et « Commencer » vers /workout', async () => {
    const view = await openHome(await homeDb());
    const card = await screen.findByRole('region', { name: 'Séance A' });
    expect(within(card).getByText('Séance du jour')).toBeTruthy();
    expect(flat(card)).toContain('1 exercice · 45 min · Garage');
    const start = within(card).getByRole('link', { name: 'Commencer' });
    expect(start.getAttribute('href')).toBe('/workout');
    // « Commencer » ne démarre rien : l'écran de la séance du jour s'en charge.
    expect(await view.db.table('workout_session').count()).toBe(0);
    fireEvent.click(start);
    await until(() => view.location() === '/workout');
    expect(await view.db.table('workout_session').count()).toBe(0);
  });

  it('sans programme : « Choisis ton programme » vers /program/choose, pas de carte de séance', async () => {
    await openHome(await homeDb({ template: null }));
    const link = await screen.findByRole('link', { name: /Choisis ton programme/ });
    expect(link.getAttribute('href')).toBe('/program/choose');
    expect(screen.queryByRole('link', { name: 'Commencer' })).toBeNull();
  });
});

describe('ordre des cartes (spec §7.9)', () => {
  it('séance en cours, séance du jour, propositions, Quêtes d’éveil, bulle du coach, tuiles', async () => {
    const db = await homeDb({ ready: false });
    await seedSession(db, {
      id: 's-live',
      status: 'in_progress',
      deviceId: 'dev-A',
      startedAt: '2026-10-06T10:00:00.000Z',
    });
    await seedMirror(db, 'instance_change', [
      {
        id: 'c-prop',
        ownerId: 'u-1',
        instanceId: 'i-1',
        baseRevision: 0,
        author: 'engine',
        operations: [{ op: 'start_deload' }],
        reasonCode: 'ENGINE_REACTIVE_DELOAD',
        reason: null,
        status: 'proposed',
        createdAt: '2026-10-05T09:00:00.000Z',
        expiresAt: new Date(DEFAULT_NOW + 86_400_000).toISOString(),
        decidedAt: null,
        aiGenerated: false,
        aiModel: null,
        promptVersion: null,
        coachThreadId: null,
      },
    ]);
    await openHome(db);
    const resume = await screen.findByRole('link', { name: 'Reprendre' });
    expect(resume.getAttribute('href')).toBe('/workout/s-live');
    const today = screen.getByRole('region', { name: 'Séance A' });
    const proposal = screen.getByRole('link', { name: 'Voir la proposition' });
    expect(proposal.getAttribute('href')).toBe('/program');
    const quests = screen.getByRole('group', { name: 'Éveil en cours.' });
    const coach = screen.getByText("Aujourd'hui");
    const tile = screen.getByRole('link', { name: /^Lieu principal/ });
    const seq = [resume, today, proposal, quests, coach, tile];
    for (let i = 0; i < seq.length - 1; i++) {
      expect(before(seq[i] as Element, seq[i + 1] as Element), `carte ${i}`).toBe(true);
    }
  });
});

describe('Quêtes d’éveil', () => {
  it('« Tes programmes et tes séances arriveront ici. » a disparu, quêtes ouvertes ou non', async () => {
    await openHome(await homeDb({ ready: false }));
    expect(screen.getByRole('group', { name: 'Éveil en cours.' })).toBeTruthy();
    expect(screen.queryByText('Tes programmes et tes séances arriveront ici.')).toBeNull();
  });

  it('masquées une fois les trois quêtes faites', async () => {
    await openHome(await homeDb());
    await until(() => screen.queryByTestId('offline-ready')?.getAttribute('data-state') === 'ready');
    expect(screen.queryByRole('group', { name: /^Éveil/ })).toBeNull();
    expect(screen.queryByText("Quêtes d'éveil")).toBeNull();
    expect(screen.queryByText('Tes programmes et tes séances arriveront ici.')).toBeNull();
  });
});

describe('bandeau des 18 ans', () => {
  it('affiché une fois par appareil : « J’ai compris » le retire pour de bon', async () => {
    const db = await homeDb();
    await setMeta(db, 'lastAgeBand', 'minor');
    await openHome(db);
    const notice = () => screen.queryByText(/^Tu as 18 ans/);
    await until(() => notice() !== null);
    fireEvent.click(screen.getByRole('button', { name: "J'ai compris" }));
    await until(() => notice() === null);
    expect(await getMeta(db, 'lastAgeBand')).toBe('adult');
    cleanup();
    await openHome(db);
    expect(notice()).toBeNull();
  });
});
