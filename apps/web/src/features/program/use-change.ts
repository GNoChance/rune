import { useCallback, useEffect, useRef, useState } from 'react';
import { changeErrorsOf, isStaleRevision } from '../../repos';
import { errorMessage } from '../../ui';
import { CHANGE_ERROR_MESSAGES, STALE_MESSAGE } from './program-labels';

/**
 * Message d'un refus du serveur : un par code de l'erreur 422 (sans doublon), « Le programme a changé : vérifie et
 * recommence. » pour 409 `stale_revision`, sinon celui de la boîte à outils (« Nécessite le réseau », 409 `expired`,
 * `session_in_progress`…).
 */
export function programErrorMessage(e: unknown): string {
  const errors = changeErrorsOf(e);
  if (errors) return [...new Set(errors.map((x) => CHANGE_ERROR_MESSAGES[x.code]))].join(' ');
  if (isStaleRevision(e)) return STALE_MESSAGE;
  return errorMessage(e);
}

/**
 * Action en ligne d'un écran du programme, nommée par `key` : l'erreur s'affiche sous l'action qui l'a levée
 * (spec §7.7). `run` rend vrai si l'action a réussi.
 */
export function useProgramAction(): {
  run(key: string, fn: () => Promise<unknown>): Promise<boolean>;
  pending: boolean;
  /** Clé de la dernière action en erreur, et son message. */
  failed: { key: string; message: string } | null;
  /** Message d'erreur de l'action `key`, s'il y en a un. */
  errorOf(key: string): string | null;
  reset(): void;
} {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (key: string, fn: () => Promise<unknown>): Promise<boolean> => {
    setPending(true);
    setFailed(null);
    try {
      await fn();
      return true;
    } catch (e) {
      if (mounted.current) setFailed({ key, message: programErrorMessage(e) });
      return false;
    } finally {
      if (mounted.current) setPending(false);
    }
  }, []);
  const reset = useCallback(() => setFailed(null), []);
  const errorOf = (key: string) => (failed?.key === key ? failed.message : null);
  return { run, pending, failed, errorOf, reset };
}
