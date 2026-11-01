import { Link } from 'wouter';
import { useLive } from '../../app-services';
import { useHistory, useRepos, type WorkoutSessionView } from '../../repos';
import { EmptyState, Page } from '../../ui';
import styles from './history.module.css';
import {
  dayLabel,
  liftedLabel,
  minutesOf,
  monthKey,
  monthLabel,
  sessionName,
  setsLabel,
  totalsOf,
} from './history-format';

/** Retour : Progression, d'où l'historique s'ouvre (spec brique 3 §7.6). */
const BACK = '/progression';

export const historyPath = (id: string) => `/history/${id}`;

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      className={styles.chevron}
      aria-hidden="true"
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

/** « mar. 28 oct. · Séance A · Salle du centre · 52 min · 15 séries · 3 200 kg ». */
function rowText(s: WorkoutSessionView, placeName: string): string {
  const { sets, liftedG } = totalsOf(s);
  const minutes = minutesOf(s);
  return [
    dayLabel(s.startedAt),
    sessionName(s),
    placeName,
    ...(minutes === null ? [] : [`${minutes} min`]),
    setsLabel(sets),
    liftedLabel(liftedG),
  ].join(' · ');
}

/** Séances terminées, par mois, la plus récente d'abord (spec brique 3 §7.6). */
export function HistoryList() {
  const repos = useRepos();
  const history = useHistory();
  const places = useLive(() => repos.places.list(), [repos]);
  if (history === undefined || places === undefined) return null;

  const names = new Map(places.map((p) => [p.id, p.name]));
  // `history()` est déjà trié du plus récent au plus ancien ; les séances abandonnées (rien de fait) restent hors liste.
  const sessions = history.filter((s) => s.status === 'completed');
  const months: { key: string; label: string; sessions: WorkoutSessionView[] }[] = [];
  for (const s of sessions) {
    const key = monthKey(s.startedAt);
    const last = months.at(-1);
    if (last?.key === key) last.sessions.push(s);
    else months.push({ key, label: monthLabel(s.startedAt), sessions: [s] });
  }

  return (
    <Page title="Historique" back={BACK}>
      {months.length === 0 ? (
        <EmptyState
          icon={<ClockIcon />}
          title="Pas encore de séance"
          text="Tes séances terminées apparaîtront ici."
        />
      ) : (
        <div className={`${styles.content} stagger`}>
          {months.map((month) => (
            <section key={month.key} className={styles.month} aria-labelledby={`month-${month.key}`}>
              <h2 id={`month-${month.key}`} className={styles.monthTitle}>
                {month.label}
              </h2>
              <ul className={styles.list}>
                {month.sessions.map((s) => (
                  <li key={s.id}>
                    <Link href={historyPath(s.id)} className={styles.row}>
                      <span className={styles.rowText}>
                        {rowText(
                          s,
                          (s.placeId !== null ? names.get(s.placeId) : undefined) ?? 'Lieu inconnu',
                        )}
                      </span>
                      <Chevron />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}
