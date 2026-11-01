import { Banner, NETWORK_REQUIRED_MESSAGE } from '../../ui';
import styles from './program.module.css';

/** Refus du serveur, sous l'action qui l'a levé (spec §7.7), annoncé tout de suite. */
export function ActionError(p: { message: string | null }) {
  return p.message ? (
    <p role="alert" className={styles.error}>
      {p.message}
    </p>
  ) : null;
}

/** Hors ligne, les actions sont grisées : « Nécessite le réseau » (spec §6). */
export function OfflineNotice(p: { offline: boolean }) {
  return p.offline ? <Banner tone="warning">{NETWORK_REQUIRED_MESSAGE}</Banner> : null;
}
