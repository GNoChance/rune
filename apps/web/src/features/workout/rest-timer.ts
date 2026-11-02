import { useCallback, useMemo, useState } from 'react';
import { useServices } from '../../app-services';

/*
 * Minuteur de repos (spec brique 3 §7.3, D14, Review Focus 1) : une heure de fin absolue, tenue en mémoire (état de
 * l'écran) et dans `sessionStorage`. Une page rechargée, ou une appli que l'iPhone a déchargée, reprend donc au même
 * point ; l'affichage se recalcule à chaque tic et au retour au premier plan (`RestTimer`). Rien côté serveur : le
 * repos réel se déduit des heures de saisie des séries (05, modèle de données).
 */

export const REST_STORAGE_KEY = 'rune.restTimer';

/** Pas de « −15 s » et « +15 s ». */
export const REST_STEP_S = 15;

export interface RestState {
  sessionId: string;
  /** Heure de fin, en millisecondes depuis l'époque. */
  endsAt: number;
  /** La fin a été annoncée (texte, son) : elle ne l'est qu'une fois, même après un rechargement. */
  announced: boolean;
}

/** Repos gardé pour la séance `sessionId` ; null s'il n'y en a pas, s'il est illisible ou d'une autre séance. */
export function readRest(sessionId: string): RestState | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(REST_STORAGE_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return null;
    const { sessionId: id, endsAt, announced } = value as Record<string, unknown>;
    return id === sessionId && typeof endsAt === 'number' && Number.isFinite(endsAt)
      ? { sessionId, endsAt, announced: announced === true }
      : null;
  } catch {
    return null;
  }
}

/** Garde le repos (null : l'efface) ; un stockage refusé ne garde que l'état de l'écran. */
function writeRest(state: RestState | null): void {
  try {
    if (state === null) sessionStorage.removeItem(REST_STORAGE_KEY);
    else sessionStorage.setItem(REST_STORAGE_KEY, JSON.stringify(state));
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
  /** « Passer », ou « Fermer » une fois terminé. */
  stop(): void;
  markAnnounced(): void;
}

/** Repos de la séance `sessionId` : celui de `sessionStorage` au montage, puis ceux que l'écran lance. */
export function useRestTimer(sessionId: string): RestTimerApi {
  const services = useServices();
  const [state, setState] = useState<RestState | null>(() => readRest(sessionId));
  const current = state?.sessionId === sessionId ? state : null;

  const update = useCallback((next: RestState | null) => {
    writeRest(next);
    setState(next);
  }, []);

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
