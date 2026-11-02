import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { reposFor, type StartInput } from '../../src/repos';
import { readDeviceSettings, writeDeviceSettings } from '../../src/repos/device-settings';
import { createTestServices, renderApp } from '../support/render';
import { PLAN } from '../support/workout';
import { seedBase } from './seed';

// Écran gardé allumé pendant la séance (spec brique 3 D14, §7.3) et section « Séance » des Réglages (§7.12).

interface FakeSentinel {
  released: boolean;
  type: 'screen';
  release: ReturnType<typeof vi.fn>;
}

let visibility: DocumentVisibilityState = 'visible';
const setVisibility = (v: DocumentVisibilityState) => {
  visibility = v;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

/** Faux `navigator.wakeLock` : chaque demande rend un nouveau verrou, relâchable. */
function installWakeLock() {
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn(async (type: 'screen') => {
    const sentinel: FakeSentinel = {
      released: false,
      type,
      release: vi.fn(async () => {
        sentinel.released = true;
      }),
    };
    sentinels.push(sentinel);
    return sentinel;
  });
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  return { request, sentinels };
}

const opened: AppDb[] = [];
beforeEach(() => {
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(async () => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'wakeLock');
  localStorage.clear();
  sessionStorage.clear();
  for (const db of opened.splice(0)) await db.delete();
});

const START: StartInput = {
  plan: PLAN,
  placeId: 'p-1',
  instanceId: 'i-1',
  workoutId: 'A',
  profile: 'adult',
  templateVersion: 1,
};

async function openSession() {
  const db = await seedBase();
  opened.push(db);
  const { services } = await createTestServices({ db });
  const id = await reposFor(services).workouts.start(START);
  const view = await renderApp({ path: `/workout/${id}`, db });
  await screen.findByRole('heading', { level: 1, name: 'Séance A' });
  return view;
}

describe('écran gardé allumé (Wake Lock)', () => {
  it('demandé à l’ouverture de la séance', async () => {
    const lock = installWakeLock();
    await openSession();
    await waitFor(() => expect(lock.request).toHaveBeenCalledTimes(1));
    expect(lock.request).toHaveBeenCalledWith('screen');
  });

  it('redemandé au retour au premier plan (le navigateur le relâche quand la page est cachée)', async () => {
    const lock = installWakeLock();
    await openSession();
    await waitFor(() => expect(lock.request).toHaveBeenCalledTimes(1));
    const first = lock.sentinels[0];
    if (first) first.released = true;
    setVisibility('hidden');
    expect(lock.request).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await waitFor(() => expect(lock.request).toHaveBeenCalledTimes(2));
  });

  it('relâché à la fin de la séance', async () => {
    const lock = installWakeLock();
    const view = await openSession();
    await waitFor(() => expect(lock.sentinels).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Terminer' }));
    await waitFor(() => expect(view.location()).toBe('/workout'));
    await waitFor(() => expect(lock.sentinels[0]?.release).toHaveBeenCalledTimes(1));
  });

  it('jamais demandé quand le réglage est coupé', async () => {
    writeDeviceSettings({ keepScreenOn: false });
    const lock = installWakeLock();
    await openSession();
    setVisibility('hidden');
    setVisibility('visible');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lock.request).not.toHaveBeenCalled();
  });

  it('navigateur sans Wake Lock, ou refus : la séance s’ouvre quand même', async () => {
    const lock = installWakeLock();
    lock.request.mockRejectedValueOnce(new DOMException('Batterie faible', 'NotAllowedError'));
    await openSession();
    await waitFor(() => expect(lock.request).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Terminer' })).toBeTruthy();
  });
});

describe('Réglages › Séance (spec brique 3 §7.12)', () => {
  it('« Garder l’écran allumé pendant la séance » et « Son à la fin du repos » : activés par défaut, gardés sur l’appareil', async () => {
    const first = await renderApp({ path: '/settings' });
    const section = await screen.findByRole('region', { name: 'Séance' });
    const screenOn = screen.getByRole('switch', { name: "Garder l'écran allumé pendant la séance" });
    const sound = screen.getByRole('switch', { name: 'Son à la fin du repos' });
    expect(section.contains(screenOn) && section.contains(sound)).toBe(true);
    expect(screenOn.getAttribute('aria-checked')).toBe('true');
    expect(sound.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screenOn);
    expect(screenOn.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sound);
    expect(readDeviceSettings()).toEqual({ keepScreenOn: false, restSound: false });

    first.unmount();
    await renderApp({ path: '/settings' });
    await screen.findByRole('region', { name: 'Séance' });
    expect(
      screen
        .getByRole('switch', { name: "Garder l'écran allumé pendant la séance" })
        .getAttribute('aria-checked'),
    ).toBe('false');
    fireEvent.click(screen.getByRole('switch', { name: 'Son à la fin du repos' }));
    expect(readDeviceSettings()).toEqual({ keepScreenOn: false, restSound: true });
  });

  it('valeur illisible sur l’appareil : les réglages par défaut', () => {
    localStorage.setItem('rune.deviceSettings', '{pas du json');
    expect(readDeviceSettings()).toEqual({ keepScreenOn: true, restSound: true });
    localStorage.setItem('rune.deviceSettings', JSON.stringify({ keepScreenOn: 'oui' }));
    expect(readDeviceSettings()).toEqual({ keepScreenOn: true, restSound: true });
  });
});
