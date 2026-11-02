import { useCallback, useMemo, useState } from 'react';
import { useServices } from '../../app-services';

/*
 * Minuteur de repos (spec brique 3 §7.3, D14, Review Focus 1, ruling R44) : une heure de fin absolue, tenue en mémoire
 * (état de l'écran) et sur l'appareil (`localStorage`). Une page rechargée, une appli que l'iPhone a déchargée ou tuée
 * (batterie, appli balayée) la retrouve donc à la réouverture ; l'affichage se recalcule à chaque tic et au retour au
 * premier plan (`RestTimer`). Rien côté serveur : le repos réel se déduit des heures de saisie des séries (05, modèle
 * de données).
 *
 * Une entrée gardée ne vaut que pour sa séance, quand elle est en cours et tenue ici, et tant que sa fin n'est pas
 * passée depuis plus de `REST_STALE_MS` : une entrée laissée par une séance finie, supprimée ou reprise ailleurs ne
 * montre rien et ne sonne jamais. Elle est effacée quand on peut (« Passer », « Fermer », fin annoncée, fin de la
 * séance, entrée trop ancienne), sans que la justesse en dépende.
 */

export const REST_STORAGE_KEY = 'rune.restTimer';

/** Pas de « −15 s » et « +15 s ». */
export const REST_STEP_S = 15;

/** Au-delà, une fin de repos n'est plus annoncée : la barre, l'annonce et le son n'auraient plus de sens. */
export const REST_STALE_MS = 5 * 60_000;

export interface RestState {
  sessionId: string;
  /** Heure de fin, en millisecondes depuis l'époque. */
  endsAt: number;
  /** La fin a été annoncée (texte, son) ; l'entrée gardée est alors effacée : elle ne s'annonce qu'une fois. */
  announced: boolean;
}

/** Fin passée depuis plus de `REST_STALE_MS` sans avoir été annoncée. */
export const isRestStale = (state: RestState, now: number): boolean =>
  !state.announced && now - state.endsAt > REST_STALE_MS;

function stored(): { sessionId: unknown; endsAt: unknown } | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(REST_STORAGE_KEY) ?? 'null');
    return typeof value === 'object' && value !== null
      ? (value as { sessionId: unknown; endsAt: unknown })
      : null;
  } catch {
    return null;
  }
}

/** Efface l'entrée gardée si elle est celle de la séance `sessionId` (fin de la séance, entrée périmée). */
export function clearRest(sessionId: string): void {
  try {
    if (stored()?.sessionId === sessionId) localStorage.removeItem(REST_STORAGE_KEY);
  } catch {
    // Stockage refusé : rien à effacer.
  }
}

/** Repos gardé pour la séance `sessionId` ; null s'il n'y en a pas, s'il est illisible, d'une autre séance ou périmé. */
function readRest(sessionId: string, now: number): RestState | null {
  const value = stored();
  if (value === null || value.sessionId !== sessionId) return null;
  const { endsAt } = value;
  if (typeof endsAt !== 'number' || !Number.isFinite(endsAt)) return null;
  const state = { sessionId, endsAt, announced: false };
  if (!isRestStale(state, now)) return state;
  clearRest(sessionId);
  return null;
}

/** Garde le repos en cours ; l'efface une fois arrêté ou annoncé. Un stockage refusé ne garde que l'état de l'écran. */
function writeRest(state: RestState | null, sessionId: string): void {
  try {
    if (state === null || state.announced) clearRest(sessionId);
    else localStorage.setItem(REST_STORAGE_KEY, JSON.stringify({ sessionId, endsAt: state.endsAt }));
  } catch {
    // Navigation privée ou stockage plein : le minuteur tient jusqu'au rechargement.
  }
}

/** Secondes restantes, arrondies au-dessus : « 0:01 » jusqu'à la fin, puis 0. */
export const restLeftS = (state: RestState, now: number): number =>
  Math.max(0, Math.ceil((state.endsAt - now) / 1000));

export interface RestTimerApi {
  state: RestState | null;
  /** Repos de `restS` secondes à partir de maintenant ; remplace celui en cours. */
  start(restS: number): void;
  /** −15 s ou +15 s ; jamais avant maintenant. */
  shift(deltaS: number): void;
  /** « Passer », « Fermer », ou fin trop ancienne effacée sans bruit. */
  stop(): void;
  markAnnounced(): void;
}

/**
 * Repos de la séance `sessionId` : celui gardé sur l'appareil au montage, puis ceux que l'écran lance. `active` : la
 * séance est en cours et tenue ici ; sinon, aucun repos.
 */
export function useRestTimer(sessionId: string, active: boolean): RestTimerApi {
  const services = useServices();
  const [state, setState] = useState<RestState | null>(() => readRest(sessionId, services.now()));
  const current = active && state?.sessionId === sessionId ? state : null;

  const update = useCallback(
    (next: RestState | null) => {
      writeRest(next, sessionId);
      setState(next);
    },
    [sessionId],
  );

  return useMemo(
    () => ({
      state: current,
      start: (restS) => update({ sessionId, endsAt: services.now() + restS * 1000, announced: false }),
      shift: (deltaS) => {
        if (current === null || current.announced) return;
        update({ ...current, endsAt: Math.max(services.now(), current.endsAt + deltaS * 1000) });
      },
      stop: () => update(null),
      markAnnounced: () => {
        if (current !== null && !current.announced) update({ ...current, announced: true });
      },
    }),
    [current, sessionId, services, update],
  );
}
