import Dexie from 'dexie';
import type { AppDb } from './db';
import { getMeta } from './meta';

/** Accord santé actif d'après le miroir : dernier événement `health` (index `[type+createdAt]`) = grant. */
export async function localHealthConsentActive(db: AppDb): Promise<boolean> {
  const last = await db
    .mirror('consent_event')
    .where('[type+createdAt]')
    .between(['health', Dexie.minKey], ['health', Dexie.maxKey])
    .last();
  return last?.action === 'grant';
}

/**
 * Accord santé actif dans le cache de l'appareil (R-SYN-9), pour écrire une donnée de douleur : `meta.me` et le
 * dernier `consent_event` health le disent tous les deux. Au moindre doute (retrait déjà tiré, profil pas encore
 * relu), rien de santé n'est écrit (R-SYN-10).
 */
export async function healthConsentCached(db: AppDb): Promise<boolean> {
  const me = await getMeta(db, 'me');
  return me?.consents.health.active === true && (await localHealthConsentActive(db));
}
