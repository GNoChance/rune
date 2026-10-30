import { useEffect, useState } from 'react';
import { useRepos } from '../../repos';
import { Banner, errorMessage, Page } from '../../ui';
import { useOnLostAccess } from './use-lost-access';

/**
 * Provisoire (plan brique 2, Task 15) : page « Relecture » de /review/exercises en attendant l'écran de relecture
 * (Task 16), qui la remplace. Elle lit la liste comme le fera l'écran : un compte qui n'est plus relecteur revient
 * au Profil (`useOnLostAccess`) ; un autre échec (hors ligne : « Nécessite le réseau ») est écrit dessous.
 */
export function ReviewPlaceholder() {
  const repos = useRepos();
  const onLostAccess = useOnLostAccess();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    repos.review.list().then(
      () => {
        if (live) setError(null);
      },
      (e: unknown) => {
        if (!live || onLostAccess(e)) return;
        setError(errorMessage(e));
      },
    );
    return () => {
      live = false;
    };
  }, [repos, onLostAccess]);

  return (
    <Page title="Relecture" back="/profile">
      <p>L'écran de relecture arrive bientôt.</p>
      {error ? <Banner tone="error">{error}</Banner> : null}
    </Page>
  );
}
