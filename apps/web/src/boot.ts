import type { AppServices } from './app-services';
import { closeStaleAfterPull } from './repos/workout-repo';

/**
 * Démarrage de l'appli : le moteur pose ses déclencheurs (premier plan, `online`, intervalle) puis
 * lance la synchro de lancement (R-SYN-29) ; les séances oubliées se clôturent après le premier pull
 * réussi (D12, ruling R33). Rend la fonction d'arrêt.
 */
export function bootApp(s: AppServices): () => void {
  const stopClosing = closeStaleAfterPull(s);
  s.sync.start();
  return () => {
    stopClosing();
    s.sync.stop();
  };
}
