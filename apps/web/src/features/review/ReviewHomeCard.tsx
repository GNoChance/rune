import type { MeResponse, ReviewListItem, ReviewQueue } from '@rune/contracts';
import { isHealthReviewer } from '@rune/domain';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useSyncState } from '../../app-services';
import { isLostAccess, useRepos } from '../../repos';
import { plural } from '../../ui';
import styles from './review.module.css';

/** Files qui attendent l'appelant (spec brique 2 §4.4) : à relire ; plus, pour une relectrice santé, ses deux files. */
const WAITING: readonly ReviewQueue[] = ['to_review'];
const WAITING_HEALTH: readonly ReviewQueue[] = ['to_review', 'health_pending', 'revalidate'];

/**
 * Nombre de fiches qui attendent l'appelant : dans « À relire », plus « Feu vert santé » et « À revalider » pour
 * une relectrice santé. Une fiche à relire et sans feu vert compte une fois : la carte compte des fiches.
 */
export function waitingCount(items: readonly ReviewListItem[], healthReviewer: boolean): number {
  const queues = healthReviewer ? WAITING_HEALTH : WAITING;
  return items.filter((i) => i.queues.some((q) => queues.includes(q))).length;
}

function ReviewIcon() {
  return (
    <svg
      aria-hidden="true"
      className={styles.homeCardIcon}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3h6v1.5" />
      <path d="m9 13 2 2 4-4" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      className={styles.chevron}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/**
 * Carte d'accueil des relecteurs (spec brique 2 §4.4) : « Relecture : N fiches t'attendent », vers la relecture.
 * Lue en ligne à chaque ouverture de l'accueil, jamais gardée : hors ligne, pendant la lecture, sur un échec ou à
 * N = 0, rien ne s'affiche ; la connexion perdue la retire, la connexion retrouvée la relit. L'appelant ne la monte
 * que pour un relecteur effectif ; un accès perdu entre-temps relit le profil (la carte et la ligne du Profil
 * disparaissent), sans quitter l'accueil.
 */
export function ReviewHomeCard(p: { me: MeResponse }) {
  const repos = useRepos();
  const { connection } = useSyncState();
  const offline = connection === 'offline';
  // Profil gardé par une version d'avant la brique 2 : drapeaux absents, donc faux.
  const health = isHealthReviewer(p.me) === true;
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    setCount(null);
    if (offline) return;
    let live = true;
    repos.review.list().then(
      (list) => {
        if (live) setCount(waitingCount(list.items, health));
      },
      (error: unknown) => {
        if (isLostAccess(error)) void repos.me.refresh().catch(() => null);
      },
    );
    return () => {
      live = false;
    };
  }, [repos, offline, health]);

  if (offline || !count) return null;
  return (
    <Link href="/review/exercises" className={`enter-up ${styles.homeCard}`}>
      <ReviewIcon />
      <span className={styles.homeCardText}>
        {`Relecture : ${count} ${plural(count, "fiche t'attend", "fiches t'attendent")}`}
      </span>
      <Chevron />
    </Link>
  );
}
