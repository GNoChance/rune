import { useCallback, useEffect, useRef, useState } from 'react';
import { Banner, Button } from '../../ui';
import styles from './review.module.css';
import { useOnLostAccess } from './use-lost-access';

/**
 * Lecture en ligne d'un écran de relecture (classe H, rien n'est gardé) : la dernière lecture lancée l'emporte ;
 * un échec garde les données déjà affichées et rend l'erreur (l'écran choisit son message) ; un accès perdu
 * (`ReviewAccessLostError`) renvoie au Profil sans rien afficher. `loading` : première lecture en cours.
 * `load` doit être stable (`useCallback`) : la lecture repart quand il change.
 */
export function useReviewData<T>(load: () => Promise<T>): {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload(): Promise<void>;
} {
  const onLostAccess = useOnLostAccess();
  const [state, setState] = useState<{ data: T | null; error: unknown }>({ data: null, error: null });
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const id = ++latest.current;
    try {
      const data = await load();
      if (id === latest.current) setState({ data, error: null });
    } catch (error) {
      if (id !== latest.current || onLostAccess(error)) return;
      setState((s) => ({ data: s.data, error }));
    }
  }, [load, onLostAccess]);

  useEffect(() => {
    void reload();
    return () => {
      // Démontage ou nouvelle lecture : une réponse en retard est ignorée.
      latest.current += 1;
    };
  }, [reload]);

  return { ...state, loading: state.data === null && state.error === null, reload };
}

/** Lecture en cours, annoncée poliment. */
export function Loading() {
  return (
    <p role="status" className={styles.muted}>
      Chargement…
    </p>
  );
}

/** Lecture impossible (hors ligne : « Nécessite le réseau ») et « Réessayer ». */
export function LoadFailure(p: { message: string; onRetry(): void }) {
  return (
    <div className={styles.failure}>
      <Banner tone="error">{p.message}</Banner>
      <Button variant="secondary" onClick={p.onRetry}>
        Réessayer
      </Button>
    </div>
  );
}
