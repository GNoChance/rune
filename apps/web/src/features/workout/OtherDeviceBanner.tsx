import { useState } from 'react';
import { useLocation } from 'wouter';
import { useServices } from '../../app-services';
import { useRepos, type WorkoutSessionView } from '../../repos';
import { Banner, Button, Dialog, formatAge, Page, useAction } from '../../ui';
import styles from './workout.module.css';

/**
 * Séance en cours sur un autre appareil (spec brique 3 §7.1, R-SYN-7) : « Continuer ici » la rapatrie (le
 * `device_id` est réécrit) et ouvre la séance, « La terminer » la clôt comme « Terminer », « La supprimer » la
 * retire après confirmation. Aucune de ces actions n'a besoin du réseau.
 */
export function OtherDeviceBanner(p: { session: WorkoutSessionView }) {
  const repos = useRepos();
  const { now } = useServices();
  const [, navigate] = useLocation();
  const [confirming, setConfirming] = useState(false);
  const { id } = p.session;
  const resume = useAction(async () => {
    await repos.workouts.continueHere(id);
    navigate(`/workout/${id}`);
  });
  const finish = useAction(() => repos.workouts.finish(id));
  const remove = useAction(async () => {
    await repos.workouts.remove(id);
    setConfirming(false);
  });
  const busy = resume.pending || finish.pending || remove.pending;
  const error = resume.error ?? finish.error ?? remove.error;
  return (
    <Page title="Séance">
      <section aria-labelledby="other-device-title" className={styles.card}>
        <h2 id="other-device-title" className={styles.cardTitle}>
          Séance en cours sur un autre appareil
        </h2>
        <p className={styles.hint}>
          {`Commencée ${formatAge(new Date(p.session.startedAt).toISOString(), now())}. Tu peux la reprendre ici, la terminer ou la supprimer.`}
        </p>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <div className={styles.actions}>
          <Button block disabled={busy} onClick={() => void resume.run()}>
            Continuer ici
          </Button>
          <Button variant="secondary" block disabled={busy} onClick={() => void finish.run()}>
            La terminer
          </Button>
          <Button variant="danger" block disabled={busy} onClick={() => setConfirming(true)}>
            La supprimer
          </Button>
        </div>
      </section>
      <Dialog
        open={confirming}
        title="Supprimer cette séance ?"
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button variant="danger" block disabled={remove.pending} onClick={() => void remove.run()}>
              Supprimer
            </Button>
            <Button variant="secondary" block onClick={() => setConfirming(false)}>
              Annuler
            </Button>
          </>
        }
      >
        <p>La séance et ses séries seront supprimées.</p>
      </Dialog>
    </Page>
  );
}
