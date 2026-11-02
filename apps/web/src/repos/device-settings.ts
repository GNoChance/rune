import { useSyncExternalStore } from 'react';

/*
 * Réglages de l'appareil (spec brique 3 §7.12, D14) : « Garder l'écran allumé pendant la séance » et « Son à la fin du
 * repos », vrais par défaut. Gardés sur l'appareil (`localStorage`, comme l'apparence) : ni synchro ni colonne serveur,
 * ils restent après une déconnexion. Une valeur illisible vaut le défaut.
 */

export interface DeviceSettings {
  keepScreenOn: boolean;
  restSound: boolean;
}

export const DEFAULT_DEVICE_SETTINGS: Readonly<DeviceSettings> = { keepScreenOn: true, restSound: true };

const STORAGE_KEY = 'rune.deviceSettings';

function parse(raw: string | null): DeviceSettings {
  let value: unknown = null;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    // Valeur abîmée : le défaut.
  }
  const stored = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const flag = (key: keyof DeviceSettings) =>
    typeof stored[key] === 'boolean' ? stored[key] : DEFAULT_DEVICE_SETTINGS[key];
  return { keepScreenOn: flag('keepScreenOn'), restSound: flag('restSound') };
}

/** Dernier choix, quand le stockage le refuse (navigation privée, stockage plein) : il vaut pour la page ouverte. */
let memory: DeviceSettings = { ...DEFAULT_DEVICE_SETTINGS };
/** Dernière lecture, par texte stocké : `useSyncExternalStore` reçoit le même objet tant que rien ne change. */
let cache: { raw: string | null; value: DeviceSettings } | null = null;

export function readDeviceSettings(): DeviceSettings {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return memory;
  }
  if (cache === null || cache.raw !== raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of listeners) fn();
};

/** Garde les réglages changés et prévient les écrans abonnés. */
export function writeDeviceSettings(patch: Partial<DeviceSettings>): void {
  const next = { ...readDeviceSettings(), ...patch };
  memory = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Stockage refusé : le choix tient jusqu'au rechargement (`memory` si la lecture échoue aussi, sinon `cache`).
    if (cache !== null) cache = { raw: cache.raw, value: next };
  }
  notify();
}

/** Un autre onglet change les réglages : cette page les suit. */
const onStorage = (event: StorageEvent) => {
  if (event.key === STORAGE_KEY || event.key === null) notify();
};

function subscribe(fn: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/** Réglages de l'appareil, suivis, et de quoi les changer. */
export function useDeviceSettings(): [DeviceSettings, (patch: Partial<DeviceSettings>) => void] {
  return [useSyncExternalStore(subscribe, readDeviceSettings), writeDeviceSettings];
}
