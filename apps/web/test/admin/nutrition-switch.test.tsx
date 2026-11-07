import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ServerHealthPage } from '../../src/features/admin/ServerHealthPage';
import { NUTRITION_ADMIN_TEXTS } from '../../src/features/nutrition/nutrition-texts';
import { createFakeApi, type FakeApi } from '../support/fake-api';
import { makeMe, renderWithServices } from '../support/render';
import { until } from '../support/wait';

/* Interrupteur « Repères chiffrés » d'Admin › Serveur (spec brique 5 §7, §2.1 prérequis 2). */

const ADMIN = makeMe({ id: 'u-1', username: 'bastien', role: 'admin' });
const PATH = '/api/admin/nutrition';

async function open(fullOpen: boolean | null, api: FakeApi = createFakeApi()) {
  api.on('GET', '/api/admin/ops-status', { status: 200, body: { version: 'v1.2.3', opsStatus: null } });
  if (fullOpen !== null) api.on('GET', PATH, { status: 200, body: { full_open: fullOpen } });
  await renderWithServices(<ServerHealthPage />, { api, me: ADMIN });
  await screen.findByRole('region', { name: 'Résumé' });
  return api;
}

const puts = (api: FakeApi) => api.calls.filter((c) => c.method === 'PUT' && c.path === PATH);

describe('interrupteur « Repères chiffrés »', () => {
  it('lit l’état : fermé à l’installation, avec le rappel du prérequis 2', async () => {
    await open(false);
    const sw = await screen.findByRole('switch', { name: 'Repères chiffrés' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-describedby')).not.toBeNull();
    expect(screen.getByText(NUTRITION_ADMIN_TEXTS.help)).toBeTruthy();
    expect(NUTRITION_ADMIN_TEXTS.help).toContain('diététicien');
    expect(screen.getByText('Repères chiffrés fermés')).toBeTruthy();
  });

  it('l’ouvrir appelle PUT /api/admin/nutrition { full_open: true } et suit la réponse', async () => {
    const api = createFakeApi().on('PUT', PATH, { status: 200, body: { full_open: true } });
    await open(false, api);
    fireEvent.click(await screen.findByRole('switch', { name: 'Repères chiffrés' }));
    await until(() => puts(api).length === 1);
    expect(puts(api)[0]?.body).toEqual({ full_open: true });
    await until(
      () => screen.getByRole('switch', { name: 'Repères chiffrés' }).getAttribute('aria-checked') === 'true',
    );
    expect(screen.getByText('Repères chiffrés ouverts')).toBeTruthy();
  });

  it('le fermer (arrêt d’urgence) envoie { full_open: false }', async () => {
    const api = createFakeApi().on('PUT', PATH, { status: 200, body: { full_open: false } });
    await open(true, api);
    const sw = await screen.findByRole('switch', { name: 'Repères chiffrés' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    await until(() => puts(api).length === 1);
    expect(puts(api)[0]?.body).toEqual({ full_open: false });
  });

  it('une écriture refusée garde l’état affiché et le dit', async () => {
    const api = createFakeApi().on('PUT', PATH, { status: 500, body: { error: 'internal' } });
    await open(false, api);
    fireEvent.click(await screen.findByRole('switch', { name: 'Repères chiffrés' }));
    await screen.findByText(NUTRITION_ADMIN_TEXTS.failed);
    expect(screen.getByRole('switch', { name: 'Repères chiffrés' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('lecture impossible : la page Serveur reste, sans l’interrupteur', async () => {
    await open(null);
    expect(screen.queryByRole('switch', { name: 'Repères chiffrés' })).toBeNull();
  });
});
