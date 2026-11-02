import { useEffect } from 'react';

/*
 * Écran gardé allumé pendant la séance (spec brique 3 D14, §7.3) : Screen Wake Lock, demandé à l'ouverture de
 * l'écran de séance, redemandé au retour au premier plan (le navigateur le relâche dès que la page est cachée), relâché
 * quand l'écran se ferme (fin de la séance, autre écran). Rien quand `active` est faux (réglage coupé, séance tenue
 * ailleurs) ou sans Wake Lock ; un refus (batterie faible) laisse l'écran s'éteindre comme d'habitude.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const api: WakeLock | undefined = 'wakeLock' in navigator ? navigator.wakeLock : undefined;
    if (!active || api === undefined) return;
    let sentinel: WakeLockSentinel | null = null;
    let pending = false;
    let stopped = false;

    const request = async () => {
      if (stopped || pending || document.visibilityState !== 'visible') return;
      if (sentinel !== null && !sentinel.released) return;
      pending = true;
      try {
        const lock = await api.request('screen');
        if (stopped) void lock.release().catch(() => {});
        else sentinel = lock;
      } catch {
        // Refusé : rien à faire, l'écran s'éteindra.
      } finally {
        pending = false;
      }
    };
    const onVisibility = () => void request();

    void request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel !== null && !sentinel.released) void sentinel.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
