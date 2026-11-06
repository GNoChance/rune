import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useRepos } from '../../repos';
import { Banner, Button, errorMessage, Page } from '../../ui';
import styles from './coach-account.module.css';
import { useCoachStore } from './coach-store';
import { THREAD_TEXTS } from './coach-texts';
import { ConfirmDeleteSheet } from './DeactivateSheet';

type Threads = Awaited<ReturnType<ReturnType<typeof useRepos>['coach']['threads']>>['threads'];

/**
 * Conversations précédentes (spec brique 4 §16.3) : une ligne par jour (« mar. 28 oct. · 6 messages ») qui ouvre
 * le fil en lecture seule, et, en tête, « Supprimer toutes mes conversations » (confirmation, sans mot de passe).
 * Aucun champ de saisie : on ne reprend pas un fil passé.
 */
export function ThreadsPage() {
  const repos = useRepos();
  const { store } = useCoachStore();
  const [threads, setThreads] = useState<Threads | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const close = useCallback(() => setConfirming(false), []);

  const read = useCallback(async () => {
    try {
      setThreads((await repos.coach.threads()).threads);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [repos]);

  useEffect(() => {
    void read();
  }, [read]);

  async function deleteAll() {
    await repos.coach.deleteAllThreads();
    // Le fil du jour a pu disparaître avec les autres.
    await store.load();
    await read();
  }

  return (
    <Page title={THREAD_TEXTS.title} back="/profile/coach">
      <div className={styles.stack}>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {threads !== null && threads.length === 0 ? (
          <p className={styles.lead}>{THREAD_TEXTS.empty}</p>
        ) : null}
        {threads !== null && threads.length > 0 ? (
          <>
            <Button variant="danger" block onClick={() => setConfirming(true)}>
              {THREAD_TEXTS.deleteAll}
            </Button>
            <ul className={styles.days}>
              {threads.map((t) => (
                <li key={t.id}>
                  <Link href={`/coach/threads/${encodeURIComponent(t.id)}`} className={styles.day}>
                    {THREAD_TEXTS.label(t.day, t.userMessageCount, t.persona)}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <ConfirmDeleteSheet
        open={confirming}
        title={THREAD_TEXTS.deleteAll}
        body={THREAD_TEXTS.deleteAllBody}
        onConfirm={deleteAll}
        onClose={close}
      />
    </Page>
  );
}
