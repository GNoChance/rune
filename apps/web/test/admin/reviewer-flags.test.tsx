import type { MemberSummary } from '@rune/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MembersPage } from '../../src/features/admin/MembersPage';
import { fill } from '../support/auth';
import { createFakeApi, type FakeApi, type FakeReply } from '../support/fake-api';
import { makeMe, renderWithServices } from '../support/render';
import { until } from '../support/wait';

// Drapeaux de relecteur d'un membre (spec brique 2 §3.1, plan Task 17) : ligne « Relecture des exercices » de la
// feuille du membre, dialogue à deux interrupteurs et mot de passe de l'admin (P-AUT-5), interrupteur « Feu vert
// santé » absent sur son propre compte (`self_health_flag`), carte remplacée par le `MemberSummary` rendu.

const ADMIN = makeMe({ id: 'u-1', username: 'bastien', role: 'admin' });
const PASSWORD = 'mon mot de passe admin';
const FLAGS_PATH = (id: string) => `/api/admin/members/${id}/reviewer-flags`;

const member = (o: Partial<MemberSummary>): MemberSummary => ({
  id: 'u-2',
  username: 'ines.m',
  role: 'member',
  status: 'active',
  isMinor: false,
  lastLoginAt: null,
  onboardingCompleted: true,
  consents: { health: false, aiCoach: false },
  activeSessions: 1,
  aiCostMonthUsd: 0,
  catalogReviewer: false,
  healthProfessional: false,
  ...o,
});
const BASTIEN = member({ id: 'u-1', username: 'bastien', role: 'admin' });
const INES = member({});

async function renderMembers(api: FakeApi = createFakeApi(), members = [BASTIEN, INES]) {
  api.on('GET', '/api/admin/members', { status: 200, body: members });
  await renderWithServices(<MembersPage />, { api, me: ADMIN });
  await screen.findByRole('article', { name: 'ines.m' });
  return api;
}

const dialog = () => within(screen.getByRole('dialog'));
const sheetRow = (username: string) => {
  fireEvent.click(screen.getByRole('button', { name: `Actions pour ${username}` }));
  return within(screen.getByRole('dialog', { name: username })).getByRole('button', {
    name: 'Relecture des exercices',
  });
};
/** Ouvre le dialogue « Relecture de <pseudo> » depuis la feuille du membre. */
function openFlags(username: string) {
  fireEvent.click(sheetRow(username));
  return screen.getByRole('dialog', { name: `Relecture de ${username}` });
}
const toggle = (name: string) => dialog().getByRole('switch', { name }) as HTMLButtonElement;
const confirm = () => dialog().getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement;
const sent = (api: FakeApi, path: string) =>
  api.calls.filter((c) => c.method === 'POST' && c.path === path).map((c) => c.body);
const memberLoads = (api: FakeApi) =>
  api.calls.filter((c) => c.method === 'GET' && c.path === '/api/admin/members').length;
/** Valeur de la ligne « Relecture des exercices » (sa description), feuille ouverte puis refermée. */
function rowValue(username: string): string {
  const row = sheetRow(username);
  const value = document.getElementById(row.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
  fireEvent.click(
    within(screen.getByRole('dialog', { name: username })).getByRole('button', { name: 'Fermer' }),
  );
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MembersPage : relecture des exercices (spec brique 2 §3.1)', () => {
  it('ligne « Relecture des exercices » dans la feuille, avec l’état des drapeaux', async () => {
    await renderMembers(createFakeApi(), [
      BASTIEN,
      INES,
      member({ id: 'u-3', username: 'zoe', catalogReviewer: true }),
      member({ id: 'u-4', username: 'lea', catalogReviewer: true, healthProfessional: true }),
    ]);
    expect(rowValue('ines.m')).toBe('Désactivée');
    expect(rowValue('zoe')).toBe('Activée');
    expect(rowValue('lea')).toBe('Activée, feu vert santé');
  });

  it('dialogue : deux interrupteurs à l’état actuel, « Ton mot de passe » ; « Enregistrer » inactif sans changement ni mot de passe', async () => {
    await renderMembers();
    openFlags('ines.m');
    expect(toggle('Relecture des exercices').getAttribute('aria-checked')).toBe('false');
    expect(toggle('Feu vert santé').getAttribute('aria-checked')).toBe('false');
    expect(confirm().disabled).toBe(true);
    fireEvent.click(toggle('Relecture des exercices'));
    expect(toggle('Relecture des exercices').getAttribute('aria-checked')).toBe('true');
    expect(confirm().disabled).toBe(true);
    fill('Ton mot de passe', PASSWORD);
    expect(confirm().disabled).toBe(false);
    fireEvent.click(toggle('Relecture des exercices'));
    expect(confirm().disabled).toBe(true);
  });

  it('« Enregistrer » → POST reviewer-flags {catalogReviewer, healthProfessional, password} ; la carte est remplacée sans relire la liste', async () => {
    const updated = { ...INES, catalogReviewer: true, healthProfessional: true };
    const api = createFakeApi().on('POST', '/api/admin/members/:id/reviewer-flags', {
      status: 200,
      body: updated,
    });
    await renderMembers(api);
    openFlags('ines.m');
    fireEvent.click(toggle('Relecture des exercices'));
    fireEvent.click(toggle('Feu vert santé'));
    fill('Ton mot de passe', PASSWORD);
    fireEvent.click(confirm());
    await until(() => screen.queryByRole('dialog') === null);
    expect(sent(api, FLAGS_PATH('u-2'))).toEqual([
      { catalogReviewer: true, healthProfessional: true, password: PASSWORD },
    ]);
    expect(memberLoads(api)).toBe(1);
    expect(rowValue('ines.m')).toBe('Activée, feu vert santé');
  });

  it('son propre compte : pas d’interrupteur « Feu vert santé », drapeau santé envoyé à faux', async () => {
    const api = createFakeApi().on('POST', '/api/admin/members/:id/reviewer-flags', {
      status: 200,
      body: { ...BASTIEN, catalogReviewer: true },
    });
    await renderMembers(api);
    openFlags('bastien');
    expect(dialog().queryByRole('switch', { name: 'Feu vert santé' })).toBeNull();
    fireEvent.click(toggle('Relecture des exercices'));
    fill('Ton mot de passe', PASSWORD);
    fireEvent.click(confirm());
    await until(() => screen.queryByRole('dialog') === null);
    expect(sent(api, FLAGS_PATH('u-1'))).toEqual([
      { catalogReviewer: true, healthProfessional: false, password: PASSWORD },
    ]);
  });

  it('refus : mot de passe incorrect (401), feu vert santé sur soi (403 self_health_flag) ; dialogue gardé', async () => {
    let reply: FakeReply = { status: 401, body: { error: 'invalid_credentials' } };
    const api = createFakeApi().on('POST', '/api/admin/members/:id/reviewer-flags', () => reply);
    await renderMembers(api);
    openFlags('ines.m');
    fireEvent.click(toggle('Relecture des exercices'));
    fill('Ton mot de passe', 'faux');
    fireEvent.click(confirm());
    expect(await dialog().findByText('Mot de passe incorrect.')).toBeTruthy();
    reply = { status: 403, body: { error: 'self_health_flag' } };
    fireEvent.click(confirm());
    expect(
      await dialog().findByText('Tu ne peux pas activer le feu vert santé sur ton propre compte.'),
    ).toBeTruthy();
    expect(memberLoads(api)).toBe(1);
  });

  it('hors ligne : « Nécessite le réseau », rien n’est changé', async () => {
    const api = await renderMembers();
    openFlags('ines.m');
    fireEvent.click(toggle('Relecture des exercices'));
    fill('Ton mot de passe', PASSWORD);
    api.setOffline('reject');
    fireEvent.click(confirm());
    expect(await dialog().findByText('Nécessite le réseau')).toBeTruthy();
  });
});
