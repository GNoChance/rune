import type { ServedProgramTemplate } from '@rune/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ONBOARDING_COMPLETED_EVENT } from '../../src/app-events';
import { getMeta, setMeta } from '../../src/local-db/meta';
import { createFakeApi } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import {
  button,
  currentStep,
  newcomer,
  seedPrimaryGym,
  seedProfile,
  serveProfile,
} from '../support/onboarding';
import { GYM_BEGINNER, INSTANCE_VIEW, seedTemplates, TEMPLATES } from '../support/program';
import { DEFAULT_NOW, makeMe, renderApp } from '../support/render';
import { until } from '../support/wait';

const HOUR = 3_600_000;
const COMPLETE = '/api/me/onboarding/complete';
const INCOMPLETE = "Termine d'abord ta prise en main.";

let events = 0;
const count = () => {
  events += 1;
};
afterEach(() => {
  window.removeEventListener(ONBOARDING_COMPLETED_EVENT, count);
  events = 0;
});

/**
 * Onboarding repris à « C'est prêt » ; dernier pull il y a `pullAgoMs`. Sans `templates`, aucun modèle de programme
 * n'est servi.
 */
async function openReady(pullAgoMs: number, o: { templates?: readonly ServedProgramTemplate[] } = {}) {
  const me = newcomer({ onboardingStep: 'health' });
  const db = createTestLocalDb();
  const api = createFakeApi().on('GET', '/api/catalog', { status: 304 });
  await seedProfile(db, { goal: 'muscle', experience: 'none', daysPerWeek: 3, sessionMinutes: 45 });
  await seedPrimaryGym(db);
  if (o.templates) await seedTemplates(db, o.templates);
  await setMeta(db, 'catalogVersion', 'cat-1');
  await setMeta(db, 'serverCatalogVersion', 'cat-1');
  await setMeta(db, 'lastPullOkAt', new Date(DEFAULT_NOW - pullAgoMs).toISOString());
  serveProfile(api, db, me);
  const rendered = await renderApp({ path: '/onboarding', me, db, api });
  await until(() => currentStep() === 'ready');
  return { ...rendered, api };
}

/** Quête d'éveil `name` cochée (sans lever si l'écran n'est pas affiché). */
const questDone = (name: string) =>
  screen.queryByRole('checkbox', { name })?.getAttribute('aria-checked') === 'true';
/** Quête « Prêt hors ligne » de la célébration : cochée quand le voyant est au vert (R-SYN-33). */
const offlineReady = () => questDone('Prêt hors ligne');
const IN_PROGRESS = "Quêtes d'éveil en cours. Ta progression commencera au rang E.";

describe('ReadyStep (E8, R-SYN-33)', () => {
  it('récapitulatif, voyant vert, « Commencer » → fin de l’onboarding, événement, accueil', async () => {
    const { api, location } = await openReady(HOUR);
    api.on('POST', COMPLETE, { status: 200, body: makeMe() });
    window.addEventListener(ONBOARDING_COMPLETED_EVENT, count);
    for (const text of ['Prendre du muscle', '3 séances de 45 min', 'Basic Fit', 'Jamais']) {
      await screen.findByText(text);
    }
    await until(offlineReady);
    await until(() => !button('Commencer').disabled);
    fireEvent.click(button('Commencer'));
    await until(() => location() === '/');
    expect(api.calls.filter((c) => c.path === COMPLETE).map((c) => c.method)).toEqual(['POST']);
    await screen.findByText('Bonjour, lea');
    expect(events).toBe(1);
  });

  it('dernier pull il y a 25 h : « Commencer » désactivé, « Réessayer » lance une synchro manuelle', async () => {
    const { sync, api } = await openReady(25 * HOUR);
    // Pas prêt : le voyant explique ce qui manque, avec « Réessayer ».
    await until(() => screen.queryByTestId('offline-ready')?.getAttribute('data-state') === 'not-ready');
    expect(offlineReady()).toBe(false);
    expect(button('Commencer').disabled).toBe(true);
    fireEvent.click(button('Réessayer'));
    await until(() => sync.triggers.includes('manual'));
    expect(api.calls.some((c) => c.path === COMPLETE)).toBe(false);
  });

  it('« Réessayer » réussi : « Prêt hors ligne » annoncé par une région déjà en place, focus sur « Commencer »', async () => {
    const { sync, db } = await openReady(25 * HOUR);
    await until(() => screen.queryByTestId('offline-ready')?.getAttribute('data-state') === 'not-ready');
    // Région polie montée avant le changement : un texte qui y arrive est annoncé, une région retirée ne l'est pas.
    const status = within(screen.getByTestId('onboarding-step')).getByRole('status');
    expect(status.textContent).toBe('');
    // La synchro manuelle de « Réessayer » réussit : pull frais.
    sync.syncNow = async (trigger) => {
      sync.triggers.push(trigger);
      await setMeta(db, 'lastPullOkAt', new Date(DEFAULT_NOW - HOUR).toISOString());
    };
    const retry = button('Réessayer');
    retry.focus();
    fireEvent.click(retry);
    await until(offlineReady);
    expect(status.isConnected).toBe(true);
    expect(status.textContent).toBe('Prêt hors ligne');
    // « Réessayer » a disparu avec le focus : il passe à « Commencer », désormais actif.
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    expect(button('Commencer').disabled).toBe(false);
    await until(() => document.activeElement === button('Commencer'));
  });

  it('voyant au vert sans « Réessayer » (synchro en fond) : annoncé, le focus posé sur le titre ne bouge pas', async () => {
    const { sync, db } = await openReady(25 * HOUR);
    await until(() => screen.queryByTestId('offline-ready')?.getAttribute('data-state') === 'not-ready');
    const status = within(screen.getByTestId('onboarding-step')).getByRole('status');
    const title = screen.getByRole('heading', { level: 2, name: /C'est prêt$/ });
    title.focus();
    // Un pull réussi en fond : le voyant est recalculé à ce nouvel état de synchro.
    const fresh = new Date(DEFAULT_NOW - HOUR).toISOString();
    await setMeta(db, 'lastPullOkAt', fresh);
    sync.set({ lastPullOkAt: fresh });
    await until(offlineReady);
    expect(status.textContent).toBe('Prêt hors ligne');
    expect(document.activeElement).toBe(title);
  });

  it('409 onboarding_incomplete : retour au premier écran incomplet, avec la raison', async () => {
    const { api, location } = await openReady(HOUR);
    api.on('POST', COMPLETE, { status: 409, body: { error: 'onboarding_incomplete', step: 'availability' } });
    window.addEventListener(ONBOARDING_COMPLETED_EVENT, count);
    await until(offlineReady);
    await until(() => !button('Commencer').disabled);
    expect(screen.queryByText(INCOMPLETE)).toBeNull();
    fireEvent.click(button('Commencer'));
    await until(() => currentStep() === 'availability');
    expect(screen.getByText(INCOMPLETE).closest('[role="status"]')).not.toBeNull();
    expect(location()).toBe('/onboarding');
    expect(events).toBe(0);
    // Message affiché une fois : il disparaît à l'écran suivant.
    fireEvent.click(await screen.findByRole('button', { name: 'Retour' }));
    await until(() => currentStep() === 'experience');
    expect(screen.queryByText(INCOMPLETE)).toBeNull();
  });

  it('409 sans étape lisible : écran recalculé depuis la base locale', async () => {
    const { api, db, location } = await openReady(HOUR);
    api.on('POST', COMPLETE, { status: 409, body: { error: 'onboarding_incomplete' } });
    window.addEventListener(ONBOARDING_COMPLETED_EVENT, count);
    await until(offlineReady);
    await until(() => !button('Commencer').disabled);
    await until(() => questDone('Profil complété'));
    // Disponibilité effacée depuis un autre appareil, sans nouveau pull : l'écran reste « C'est prêt », et la
    // quête « Profil complété » se décoche (vrais états).
    await seedProfile(db, { goal: 'muscle', experience: 'none', daysPerWeek: null, sessionMinutes: 45 });
    await until(() => !questDone('Profil complété'));
    expect(screen.getByText(IN_PROGRESS)).toBeTruthy();
    expect(screen.queryByText('3/3')).toBeNull();
    fireEvent.click(button('Commencer'));
    await until(() => currentStep() === 'availability');
    expect(screen.getByText(INCOMPLETE)).toBeTruthy();
    expect(location()).toBe('/onboarding');
    expect(events).toBe(0);
  });

  it('« Retour » ramène à la santé', async () => {
    await openReady(HOUR);
    fireEvent.click(button('Retour'));
    await until(() => currentStep() === 'health');
  });
});

describe('ReadyStep : programme recommandé (D15, spec §7.8)', () => {
  const ENROLL = '/api/program/enroll';
  const START = 'Commencer avec ce programme';
  const NO_TEMPLATE = 'Pas encore de programme disponible : tu pourras faire des séances libres.';
  const ENROL_FAILED =
    "Le programme n'a pas pu être enregistré. Réessaie, ou décoche la case pour continuer sans programme.";
  const posts = (api: { calls: { method: string; path: string }[] }) =>
    api.calls.filter((c) => c.method === 'POST').map((c) => c.path);

  it('carte du programme recommandé, case « Commencer avec ce programme » cochée par défaut', async () => {
    await openReady(HOUR, { templates: TEMPLATES });
    const section = await screen.findByRole('region', { name: 'Ton programme' });
    expect(within(section).getByRole('heading', { name: GYM_BEGINNER.name })).toBeTruthy();
    expect(within(section).getByText('Recommandé pour toi')).toBeTruthy();
    expect(within(section).getByText('2 à 3 jours par semaine · 50 min environ')).toBeTruthy();
    expect((within(section).getByRole('checkbox', { name: START }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText(NO_TEMPLATE)).toBeNull();
  });

  it('« Commencer » inscrit au programme recommandé, puis termine l’onboarding', async () => {
    const { api, db, location } = await openReady(HOUR, { templates: TEMPLATES });
    api.on('POST', ENROLL, { status: 201, body: { instance: INSTANCE_VIEW } });
    api.on('POST', COMPLETE, { status: 200, body: makeMe() });
    await screen.findByRole('checkbox', { name: START });
    await until(offlineReady);
    await until(() => !button('Commencer').disabled);
    fireEvent.click(button('Commencer'));
    await until(() => location() === '/');
    expect(posts(api)).toEqual([ENROLL, COMPLETE]);
    expect(api.calls.find((c) => c.path === ENROLL)?.body).toEqual({
      templateId: GYM_BEGINNER.id,
      daysPerWeek: 3,
    });
    expect(await getMeta(db, 'recommendationSeen')).toBe(GYM_BEGINNER.id);
  });

  it('déjà inscrit (409 already_enrolled, nouvel essai) : l’onboarding se termine quand même', async () => {
    const { api, location } = await openReady(HOUR, { templates: TEMPLATES });
    api.on('POST', ENROLL, { status: 409, body: { error: 'already_enrolled' } });
    api.on('POST', COMPLETE, { status: 200, body: makeMe() });
    await screen.findByRole('checkbox', { name: START });
    await until(offlineReady);
    await until(() => !button('Commencer').disabled);
    fireEvent.click(button('Commencer'));
    await until(() => location() === '/');
    expect(posts(api)).toEqual([ENROLL, COMPLETE]);
  });

  /** Message d'un échec d'inscription (ruling R40), lu avec la case : texte affiché et description de la case. */
  async function enrolFailed(): Promise<void> {
    const message = await screen.findByText(ENROL_FAILED);
    const box = screen.getByRole('checkbox', { name: START });
    expect(box.getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
  }

  it('inscription refusée (422) : l’onboarding ne se termine pas, la marche à suivre s’affiche (R40)', async () => {
    const { api, location } = await openReady(HOUR, { templates: TEMPLATES });
    api.on('POST', ENROLL, { status: 422, body: { error: 'template_unavailable' } });
    await screen.findByRole('checkbox', { name: START });
    await until(offlineReady);
    await until(() => !button('Commencer').disabled);
    fireEvent.click(button('Commencer'));
    await enrolFailed();
    expect(posts(api)).toEqual([ENROLL]);
    expect(location()).toBe('/onboarding');
  });

  it('erreur du serveur (5xx) : message sur la case, « Commencer » reste utilisable et réessaie (R40)', async () => {
    const { api, location } = await openReady(HOUR, { templates: TEMPLATES });
    api.on('POST', ENROLL, { status: 500, body: { error: 'internal' } });
    await screen.findByRole('checkbox', { name: START });
    await until(offlineReady);
    await until(() => !button('Commencer').disabled);
    fireEvent.click(button('Commencer'));
    await enrolFailed();
    expect(location()).toBe('/onboarding');
    await until(() => !button('Commencer').disabled);
    // Réessayer : le serveur répond cette fois.
    api.on('POST', ENROLL, { status: 201, body: { instance: INSTANCE_VIEW } });
    api.on('POST', COMPLETE, { status: 200, body: makeMe() });
    fireEvent.click(button('Commencer'));
    await until(() => location() === '/');
    expect(posts(api)).toEqual([ENROLL, ENROLL, COMPLETE]);
  });

  it('hors ligne : message sur la case ; décochée, l’onboarding se termine sans programme (R40)', async () => {
    const { api, location } = await openReady(HOUR, { templates: TEMPLATES });
    api.on('POST', COMPLETE, { status: 200, body: makeMe() });
    await screen.findByRole('checkbox', { name: START });
    await until(offlineReady);
    await until(() => !button('Commencer').disabled);
    api.setOffline('reject');
    fireEvent.click(button('Commencer'));
    await enrolFailed();
    expect(location()).toBe('/onboarding');
    await until(() => !button('Commencer').disabled);
    // « décoche la case pour continuer sans programme » : le message s'en va, « Commencer » termine.
    fireEvent.click(screen.getByRole('checkbox', { name: START }));
    expect(screen.queryByText(ENROL_FAILED)).toBeNull();
    api.setOffline(false);
    fireEvent.click(button('Commencer'));
    await until(() => location() === '/');
    expect(posts(api)).toEqual([ENROLL, COMPLETE]);
  });

  it('case décochée : aucune inscription, l’onboarding se termine', async () => {
    const { api, location } = await openReady(HOUR, { templates: TEMPLATES });
    api.on('POST', COMPLETE, { status: 200, body: makeMe() });
    fireEvent.click(await screen.findByRole('checkbox', { name: START }));
    expect((screen.getByRole('checkbox', { name: START }) as HTMLInputElement).checked).toBe(false);
    await until(offlineReady);
    await until(() => !button('Commencer').disabled);
    fireEvent.click(button('Commencer'));
    await until(() => location() === '/');
    expect(posts(api)).toEqual([COMPLETE]);
  });

  it('aucun modèle disponible : la phrase de la séance libre, ni carte ni case', async () => {
    await openReady(HOUR);
    await screen.findByText(NO_TEMPLATE);
    expect(screen.queryByRole('checkbox', { name: START })).toBeNull();
  });
});
