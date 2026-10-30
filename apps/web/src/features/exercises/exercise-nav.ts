import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useLocation } from 'wouter';
import { type AppServices, useServices } from '../../app-services';

/*
 * Navigation de l'onglet Exercices (spec brique 2 §4.1 et §4.2) : Retour par l'historique quand on vient d'un
 * écran de l'appli, défilement rendu à la liste au retour, et interrupteur « Faisable » partagé par l'accueil de
 * l'onglet, la liste d'un groupe et les résultats de recherche.
 */

/**
 * État d'historique posé par un lien de l'appli (tuile, ligne de liste, variante, rang de la Progression) sur
 * l'entrée qu'il ouvre : l'écran d'avant est celui du lien, Retour y revient par `history.back()` et il retrouve
 * sa recherche (dans l'adresse) et son défilement (dans son propre état d'historique).
 */
export const BACK_IN_HISTORY = { runeBack: 'history' } as const;

/** Clé de l'état d'historique d'une liste : position de défilement notée au départ vers une fiche ou un groupe. */
const SCROLL_KEY = 'runeScrollY';

function historyState(): Record<string, unknown> | null {
  const state: unknown = window.history.state;
  return typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : null;
}

/** L'entrée courante a été ouverte par un lien de l'appli (`BACK_IN_HISTORY`). */
export function openedFromApp(): boolean {
  return historyState()?.runeBack === BACK_IN_HISTORY.runeBack;
}

/**
 * État d'historique de l'entrée courante, à repasser quand on la remplace (onglet de la fiche) : sans lui, le
 * routeur poserait `null` et Retour perdrait le chemin de la liste.
 */
export function currentHistoryState(): unknown {
  return window.history.state ?? undefined;
}

/**
 * Retour d'un écran des Exercices : l'écran d'avant par l'historique s'il a ouvert celui-ci (recherche et
 * défilement retrouvés, aucune entrée ajoutée) ; sinon (adresse ouverte directement, rechargement), `fallback`.
 */
export function useBack(fallback: string): () => void {
  const [, navigate] = useLocation();
  return useCallback(() => {
    if (openedFromApp()) window.history.back();
    else navigate(fallback);
  }, [navigate, fallback]);
}

/** Note la position de défilement dans l'entrée courante, juste avant de la quitter par un lien (deux arguments : l'adresse ne change pas). */
export function rememberScroll(): void {
  window.history.replaceState({ ...historyState(), [SCROLL_KEY]: window.scrollY }, '');
}

function rememberedScroll(): number | null {
  const y = historyState()?.[SCROLL_KEY];
  return typeof y === 'number' && Number.isFinite(y) && y > 0 ? y : null;
}

/**
 * Rend à la liste la position notée dans son entrée d'historique (retour d'une fiche ou d'un groupe), une seule
 * fois, dès que son contenu est affiché (`ready`) : la coquille replace la page au changement d'adresse, mais la
 * liste, lue dans la base locale, n'est pas encore là et la page est trop courte pour y descendre.
 */
export function useRestoreScroll(ready: boolean): void {
  const target = useRef<number | null | undefined>(undefined);
  if (target.current === undefined) target.current = rememberedScroll();
  useLayoutEffect(() => {
    if (!ready || target.current === null || target.current === undefined) return;
    window.scrollTo(0, target.current);
    target.current = null;
  }, [ready]);
}

interface FilterStore {
  get(): boolean;
  set(value: boolean): void;
  subscribe(onChange: () => void): () => void;
}

const filters = new WeakMap<AppServices, FilterStore>();

function filterStore(services: AppServices): FilterStore {
  const known = filters.get(services);
  if (known) return known;
  let value = true;
  const listeners = new Set<() => void>();
  const store: FilterStore = {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
  filters.set(services, store);
  return store;
}

/**
 * Interrupteur « Faisable : <lieu> » (spec brique 2 §4.1) : activé au lancement de l'appli, puis le même pour
 * l'accueil de l'onglet, la liste d'un groupe et les résultats, d'un écran à l'autre et au retour. Sans lieu
 * principal, le dépôt l'ignore (aucun filtre).
 */
export function useFeasibleOnly(): [boolean, (value: boolean) => void] {
  const services = useServices();
  const store = useMemo(() => filterStore(services), [services]);
  const value = useSyncExternalStore(store.subscribe, store.get);
  return [value, store.set];
}
