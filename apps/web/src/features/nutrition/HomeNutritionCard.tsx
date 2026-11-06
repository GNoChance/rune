import { parisDate } from '@rune/domain';
import { useEffect, useId, useState } from 'react';
import { Link } from 'wouter';
import { type NutritionView, useNutritionView, useRepos } from '../../repos';
import styles from './nutrition.module.css';
import { NUTRITION_TEXTS } from './nutrition-texts';

const T = NUTRITION_TEXTS.home;
const DAY_MS = 86_400_000;

/** Un bilan attend la réponse de la personne : le plus récent, avec une proposition, sans réponse. */
export function checkinToHandle(view: NutritionView): boolean {
  const latest = view.checkins[0];
  return (
    latest !== undefined &&
    latest.response === null &&
    (latest.decision === 'proposal' || latest.decision === 'rapid_loss')
  );
}

/** Fiche du jour : à tour de rôle par jour civil de Paris, dans l'ordre des titres (choix C29). */
export function sheetOfTheDay(titles: readonly string[], nowMs: number): string | null {
  if (titles.length === 0) return null;
  const day = Math.floor(Date.parse(`${parisDate(new Date(nowMs))}T00:00:00Z`) / DAY_MS);
  return (
    [...titles].sort((a, b) => a.localeCompare(b, 'fr'))[
      ((day % titles.length) + titles.length) % titles.length
    ] ?? null
  );
}

/**
 * Carte Nutrition de l'accueil (spec brique 5 §12.1), absente en mode `disabled`. En `full` : la fourchette d'énergie
 * du jour et « Bilan de la semaine prêt » s'il y en a un à traiter ; en qualitatif : « Conseils nutrition » et le titre
 * d'une fiche qui change chaque jour. Elle ne montre que ce que l'appareil sait : rien d'inventé tant que la cible ou
 * les fiches ne sont pas là.
 */
export function HomeNutritionCard(p: { nowMs: number }) {
  const view = useNutritionView();
  const repos = useRepos();
  const titleId = useId();
  const [titles, setTitles] = useState<readonly string[]>([]);
  const mode = view?.mode;
  useEffect(() => {
    if (mode !== 'qualitative') {
      setTitles([]);
      return;
    }
    let live = true;
    repos.nutrition.sheets().then(
      (list) => live && setTitles(list.map((sheet) => sheet.title)),
      () => live && setTitles([]),
    );
    return () => {
      live = false;
    };
  }, [repos, mode]);
  if (!view || view.mode === 'disabled') return null;

  const full = view.mode === 'full';
  const sheet = full ? null : sheetOfTheDay(titles, p.nowMs);
  return (
    <section aria-labelledby={titleId} className={styles.homeCard}>
      <h2 id={titleId}>{T.title}</h2>
      {full ? (
        <>
          {view.target ? <p>{T.energyRange(view.target.kcalMin, view.target.kcalMax)}</p> : null}
          {checkinToHandle(view) ? <p>{T.checkinReady}</p> : null}
        </>
      ) : (
        <>
          <p>{T.qualitativeTitle}</p>
          {sheet ? <p>{sheet}</p> : null}
        </>
      )}
      <Link href="/nutrition" className={styles.action}>
        {full ? T.openFull : T.openQualitative}
      </Link>
    </section>
  );
}
