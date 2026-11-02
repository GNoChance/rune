import { useEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useServices } from '../../app-services';
import { useDeviceSettings } from '../../repos';
import { LIVE_REGION_ATTR } from '../../ui';
import { clockText } from './DurationTimer';
import styles from './live.module.css';
import { playRestSound, unlockRestSound } from './rest-sound';
import { REST_STEP_S, type RestTimerApi, restLeftS } from './rest-timer';

export const REST_DONE = 'Repos terminé';

const isVisible = () => document.visibilityState === 'visible';

/**
 * Barre du minuteur de repos, au-dessus de « Terminer » (spec brique 3 §7.3) : « Repos 1:45 », −15 s, +15 s,
 * « Passer ». Le reste se lit sur l'heure de fin à chaque seconde et au retour au premier plan ; à zéro, la barre dit
 * « Repos terminé », la région d'annonce aussi (une fois), et un son court part si l'appli est à l'écran et le son
 * activé. Une fin passée pendant que l'appli était cachée s'annonce à son retour. La région d'annonce est posée à la
 * racine du document : une feuille ouverte (l'effort, après la dernière série) ne la rend pas muette.
 */
export function RestTimer(p: { rest: RestTimerApi }) {
  const { state, shift, stop, markAnnounced } = p.rest;
  const services = useServices();
  const [settings] = useDeviceSettings();
  const [visible, setVisible] = useState(isVisible);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const now = services.now();
  const left = state === null ? null : restLeftS(state, now);

  // Prochain tic au changement de seconde ; rien une fois à zéro.
  useEffect(() => {
    if (state === null) return;
    const ms = state.endsAt - services.now();
    if (ms <= 0) return;
    const timer = setTimeout(tick, ms % 1000 || 1000);
    return () => clearTimeout(timer);
  });

  // Page cachée puis revenue : les minuteurs ont pu geler, le reste se relit sur l'heure de fin.
  useEffect(() => {
    const onVisibility = () => {
      setVisible(isVisible());
      tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Fin : annoncée une fois, au premier plan seulement (la marque par heure de fin tient aussi en mode strict).
  const sound = useRef(settings.restSound);
  sound.current = settings.restSound;
  const announcedFor = useRef<number | null>(null);
  useEffect(() => {
    if (state === null || state.announced || left !== 0 || !visible) return;
    if (announcedFor.current === state.endsAt) return;
    announcedFor.current = state.endsAt;
    markAnnounced();
    if (sound.current) playRestSound();
  }, [state, left, visible, markAnnounced]);

  // Chaque geste sur l'écran débloque le son (iOS) : il est prêt à la fin du repos.
  useEffect(() => {
    if (!settings.restSound) return;
    const options = { capture: true, passive: true };
    document.addEventListener('pointerdown', unlockRestSound, options);
    document.addEventListener('keydown', unlockRestSound, options);
    return () => {
      document.removeEventListener('pointerdown', unlockRestSound, options);
      document.removeEventListener('keydown', unlockRestSound, options);
    };
  }, [settings.restSound]);

  const done = left === 0;
  return (
    <>
      {state === null ? null : (
        <fieldset className={styles.rest}>
          <legend className={styles.srOnly}>Minuteur de repos</legend>
          {done ? (
            <p className={styles.restText}>{REST_DONE}</p>
          ) : (
            <p role="timer" className={styles.restText}>
              Repos <time dateTime={`PT${left ?? 0}S`}>{clockText(left ?? 0)}</time>
            </p>
          )}
          <div className={styles.restActions}>
            {done ? (
              <button type="button" className={styles.restButton} onClick={stop}>
                Fermer
              </button>
            ) : (
              <>
                <button type="button" className={styles.restButton} onClick={() => shift(-REST_STEP_S)}>
                  −15 s
                </button>
                <button type="button" className={styles.restButton} onClick={() => shift(REST_STEP_S)}>
                  +15 s
                </button>
                <button type="button" className={styles.restButton} onClick={stop}>
                  Passer
                </button>
              </>
            )}
          </div>
        </fieldset>
      )}
      {createPortal(
        <p role="status" className={styles.srOnly} {...{ [LIVE_REGION_ATTR]: '' }}>
          {state?.announced ? REST_DONE : ''}
        </p>,
        document.body,
      )}
    </>
  );
}
