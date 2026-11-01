import { useEffect, useState } from 'react';
import { useServices } from '../../app-services';
import styles from './live.module.css';

/** « 0:12 », « 1:05 » : secondes écoulées d'un chronomètre. */
export const clockText = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Chronomètre d'un exercice en durée (spec brique 3 §7.3) : « Lancer le chrono », puis « Arrêter le chrono », qui
 * remplit le champ « Secondes » (secondes arrondies). L'heure de départ est absolue (horloge des services) : un écran
 * en arrière-plan qui ralentit les minuteurs ne fausse pas la durée.
 */
export function DurationTimer(p: { onStop(seconds: number): void }) {
  // Horloge lue au moment du geste (`services.now()`), jamais celle d'un rendu passé.
  const services = useServices();
  const now = () => services.now();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const elapsed = (at: number) => Math.max(0, Math.round((now() - at) / 1000));
  const toggle = () => {
    if (startedAt === null) {
      setStartedAt(now());
      return;
    }
    p.onStop(elapsed(startedAt));
    setStartedAt(null);
  };

  return (
    <div className={styles.timerGroup}>
      <button type="button" className={styles.chrono} onClick={toggle}>
        {startedAt === null ? 'Lancer le chrono' : 'Arrêter le chrono'}
      </button>
      {startedAt !== null ? (
        <span role="timer" className={styles.timer}>
          {clockText(elapsed(startedAt))}
        </span>
      ) : null}
    </div>
  );
}
