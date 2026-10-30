import { useSyncState } from '../../app-services';
import { SystemPanel } from '../../ui';
import styles from './exercises.module.css';

/**
 * Catalogue pas encore téléchargé (spec brique 2 §4.1), à la place du contenu de toute page `/exercises…` : en
 * ligne, « Le catalogue arrive… » ; hors ligne (état de connexion de la synchro, jamais `navigator.onLine`), la
 * voix du Système demande une première connexion. Jamais des tuiles ou une fiche vides (Review Focus 5).
 */
export function CatalogMissing() {
  const { connection } = useSyncState();
  if (connection === 'offline') {
    return (
      <SystemPanel title="Catalogue absent">
        <p>Connecte-toi une fois pour récupérer les exercices.</p>
      </SystemPanel>
    );
  }
  return (
    <p role="status" className={styles.catalogArriving}>
      Le catalogue arrive…
    </p>
  );
}
