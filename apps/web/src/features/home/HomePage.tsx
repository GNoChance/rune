import { type CoachAdminView, EXPERIENCE_LABELS, GOAL_LABELS } from '@rune/contracts';
import { isReviewer } from '@rune/domain';
import { useEffect, useId, useState } from 'react';
import { Link } from 'wouter';
import { useLive, useMe, useSyncState } from '../../app-services';
import {
  type PlannedSession,
  type ProgramView,
  useActiveSession,
  usePlannedWorkout,
  useProgramView,
  useRepos,
} from '../../repos';
import {
  Banner,
  Button,
  CoachBubble,
  CountUp,
  NETWORK_REQUIRED_MESSAGE,
  Page,
  plural,
  ReadErrorBoundary,
  SystemPanel,
} from '../../ui';
import { coachLine } from '../coach/coach-lines';
import { COACH_ADMIN_TEXTS, ENTRY_TEXTS } from '../coach/coach-texts';
import { AwakeningQuests, awakeningQuests } from '../onboarding/AwakeningQuests';
import { ReviewHomeCard } from '../review/ReviewHomeCard';
import { OfflineReadyIndicator } from '../status/OfflineReadyIndicator';
import { useReadiness } from '../status/use-readiness';
import styles from './home.module.css';
import { useNow } from './use-now';

/** R-AGE-6 : affiché une fois par appareil, au passage de mineur à adulte. */
export const ADULT_NOTICE_TEXT =
  "Tu as 18 ans : tu peux désormais choisir l'objectif « Perdre du gras » dans ton profil.";

const parisHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  hourCycle: 'h23',
});

/** « Bonjour, {pseudo} » de 5 h à 17 h 59 à l'heure de Paris, « Bonsoir, {pseudo} » le reste du temps. */
function greeting(nowMs: number, pseudo: string): string {
  const hour = Number(parisHour.formatToParts(nowMs).find((part) => part.type === 'hour')?.value);
  return `${hour >= 5 && hour < 18 ? 'Bonjour' : 'Bonsoir'}, ${pseudo}`;
}

function PlaceIcon() {
  return (
    <svg
      aria-hidden="true"
      className={styles.tileIcon}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      className={`${styles.tileIcon} ${styles.rhythmIcon}`}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
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
 * Entrée vers le coach, sous la bulle « Aujourd'hui » (spec brique 4 §16.1) : « Parler au coach » avec l'accord actif,
 * « Découvrir le coach IA » (vers Mon coach) sans. Elle n'envoie rien. Hors ligne, grisée, avec « Nécessite le réseau ».
 */
function CoachEntry(p: { active: boolean; offline: boolean }) {
  const noteId = useId();
  const label = p.active ? ENTRY_TEXTS.talk : ENTRY_TEXTS.discover;
  if (p.offline) {
    return (
      <div className={styles.coachEntry}>
        <Button variant="secondary" disabled aria-describedby={noteId}>
          {label}
        </Button>
        <p id={noteId} className={styles.cardMeta}>
          {NETWORK_REQUIRED_MESSAGE}
        </p>
      </div>
    );
  }
  return (
    <div className={styles.coachEntry}>
      <Link href={p.active ? '/coach' : '/profile/coach'} className={styles.action}>
        {label}
      </Link>
    </div>
  );
}

/**
 * Lignes de l'admin sur l'accueil (spec brique 4 §17.1), en ligne seulement : signalements du coach à lire, et la
 * suspension du coach quand la limite de dépense est atteinte. Une lecture qui échoue n'affiche rien.
 */
function AdminCoachLines() {
  const repos = useRepos();
  const { connection } = useSyncState();
  const offline = connection === 'offline';
  const [view, setView] = useState<CoachAdminView | null>(null);
  useEffect(() => {
    if (offline) {
      setView(null);
      return;
    }
    let live = true;
    repos.admin.coach().then(
      (v) => live && setView(v),
      () => live && setView(null),
    );
    return () => {
      live = false;
    };
  }, [repos, offline]);
  if (offline || view === null) return null;
  return (
    <>
      {view.openReports > 0 ? (
        <Banner tone="info">
          <Link href="/admin/coach">{COACH_ADMIN_TEXTS.homeReports(view.openReports)}</Link>
        </Banner>
      ) : null}
      {view.state.suspendedUntil !== null ? (
        <Banner tone="warning">{COACH_ADMIN_TEXTS.homeSuspended}</Banner>
      ) : null}
    </>
  );
}

/**
 * Séance du jour (spec brique 3 §7.9) : son nom, le nombre d'exercices, la durée et le lieu. « Commencer » ouvre
 * l'écran de la séance du jour, qui seul démarre la séance (changer de lieu ou de séance y reste possible).
 */
function TodayCard(p: { view: ProgramView; planned: PlannedSession; placeName: string | null }) {
  const titleId = useId();
  const { workouts, estimatedMinutes } = p.view.program.template;
  const name = workouts.find((w) => w.id === p.planned.workoutId)?.name ?? p.planned.workoutId;
  const count = p.planned.plan.exercises.filter((e) => e.exerciseId !== null).length;
  const meta = [`${count} ${plural(count, 'exercice', 'exercices')}`, `${estimatedMinutes} min`];
  if (p.placeName) meta.push(p.placeName);
  return (
    <section aria-labelledby={titleId} className={styles.card}>
      <p className={styles.tileKey}>Séance du jour</p>
      <h2 id={titleId} className={styles.cardTitle}>
        {name}
      </h2>
      <p className={styles.cardMeta}>{meta.join(' · ')}</p>
      <Link href="/workout" className={styles.action}>
        Commencer
      </Link>
    </section>
  );
}

/**
 * Cartes du programme : séance du jour (ou « Choisis ton programme »), proposition en attente. Leurs lectures sont
 * les seules de l'accueil à rejouer le moteur : elles vivent ici, derrière leur propre frontière d'erreur, pour
 * qu'un rejeu qui lève ne prenne pas la bulle du coach et les tuiles avec lui (M5).
 */
function ProgramCards(p: { places: readonly { id: string; name: string }[] | undefined }) {
  const view = useProgramView();
  const planned = usePlannedWorkout(null, null);
  if (view === undefined || planned === undefined) return null;
  return (
    <>
      {view === null ? (
        <Link href="/program/choose" className={styles.row}>
          <span className={styles.rowText}>
            <span className={styles.tileKey}>Programme</span>{' '}
            <span className={styles.rowValue}>Choisis ton programme</span>
          </span>
          <Chevron />
        </Link>
      ) : planned ? (
        <TodayCard
          view={view}
          planned={planned}
          placeName={p.places?.find((place) => place.id === planned.placeId)?.name ?? null}
        />
      ) : null}
      {view && view.proposals.length > 0 ? (
        <div className={styles.card}>
          <p className={styles.cardMeta}>Une proposition t'attend.</p>
          <Link href="/program" className={styles.action}>
            Voir la proposition
          </Link>
        </div>
      ) : null}
    </>
  );
}

/**
 * Accueil (spec refonte §10.2, maquettes MixSombre / MixClair, prototype « Accueil ») : salutation selon l'heure
 * de Paris, bandeaux du compte, carte « Relecture : N fiches t'attendent » pour un relecteur (en ligne seulement,
 * spec brique 2 §4.4), puis, dans l'ordre de la spec brique 3 §7.9 : séance en cours (« Reprendre »), séance du jour
 * (« Commencer ») ou « Choisis ton programme », proposition en attente, fenêtre « Éveil en cours. » et ses quêtes
 * d'éveil aux vrais états (masquée une fois les 3 faites ; une quête reste ouverte tant que le pull a plus de 24 h ou
 * que le nouvel appareil n'a pas encore tiré), bulle du coach « Aujourd'hui » avec sa ligne du jour, tuiles lieu
 * principal et rythme, ligne
 * objectif et niveau, puis le voyant « Prêt hors ligne » (R-SYN-33). Les cartes, voyant compris, entrent en
 * cascade, d'un bloc, une fois le profil, les lieux et le voyant lus : jamais une fenêtre à 0/3 qu'une bulle
 * viendrait pousser.
 *
 * Aucune fausse donnée : une valeur pas encore connue (profil pas encore reçu sur ce nouvel appareil) n'affiche
 * ni bulle, ni tuile, ni ligne ; une quête n'est cochée que quand son état réel l'est. Le voyant et la quête
 * « Prêt hors ligne » lisent le même calcul. L'heure et le jour viennent de l'horloge des services (injectée
 * dans les tests), relue à chaque minute pleine (`useNow`) : un accueil resté ouvert dit « Bonsoir » dès 18 h et
 * passe à la ligne du lendemain dès minuit, sans dépendre d'un autre rendu.
 */
export function HomePage() {
  const me = useMe();
  const repos = useRepos();
  const now = useNow();
  const adultNotice = useLive(() => repos.me.adultNotice(), [repos]);
  const profile = useLive(() => repos.profile.get(), [repos]);
  const places = useLive(() => repos.places.list(), [repos]);
  const active = useActiveSession();
  const { readiness, loaded, retry } = useReadiness();
  const { connection } = useSyncState();
  const [retrying, setRetrying] = useState(false);
  const resumeTitle = useId();
  if (!me) return null;

  const onRetry = () => {
    setRetrying(true);
    void retry().finally(() => setRetrying(false));
  };
  const primary = places?.find((place) => place.isPrimary);
  const quests = awakeningQuests({
    profile,
    hasPrimaryPlace: primary !== undefined,
    offlineReady: loaded && readiness.ready,
  });
  const coach = profile?.coach ?? null;
  const days = profile?.daysPerWeek ?? null;
  const goal = profile?.goal ?? null;
  const experience = profile?.experience ?? null;
  // Lectures locales faites (profil, même absent, lieux, voyant) : la pile entre alors d'un bloc, en cascade.
  const readsDone = profile !== undefined && places !== undefined && active !== undefined && loaded;

  return (
    <Page title={greeting(now, me.username)}>
      {me.passwordReminderDue ? (
        <Banner tone="warning">Pense à changer ton mot de passe (rappel annuel).</Banner>
      ) : null}
      {adultNotice ? (
        <Banner tone="info">
          <p className={styles.notice}>{ADULT_NOTICE_TEXT}</p>
          <Button variant="secondary" onClick={() => void repos.me.dismissAdultNotice()}>
            J'ai compris
          </Button>
        </Banner>
      ) : null}
      {isReviewer(me) ? <ReviewHomeCard me={me} /> : null}
      {me.role === 'admin' ? <AdminCoachLines /> : null}
      {readsDone ? (
        <div className={`${styles.cards} stagger`}>
          {active ? (
            <ReadErrorBoundary compact>
              <section aria-labelledby={resumeTitle} className={styles.card}>
                <h2 id={resumeTitle} className={styles.cardTitle}>
                  Séance en cours
                </h2>
                <Link href={`/workout/${active.id}`} className={styles.action}>
                  Reprendre
                </Link>
              </section>
            </ReadErrorBoundary>
          ) : null}
          <ReadErrorBoundary compact>
            <ProgramCards places={places} />
          </ReadErrorBoundary>
          {quests.every((q) => q.done) ? null : (
            <ReadErrorBoundary compact>
              <SystemPanel title="Éveil en cours.">
                <AwakeningQuests quests={quests} />
              </SystemPanel>
            </ReadErrorBoundary>
          )}
          {coach ? (
            <ReadErrorBoundary compact>
              <CoachBubble coach={coach} label="Aujourd'hui">
                <p>{coachLine(coach, 'daily', new Date(now), me.username, days)}</p>
                <CoachEntry active={me.consents.aiCoach.active} offline={connection === 'offline'} />
              </CoachBubble>
            </ReadErrorBoundary>
          ) : null}
          {primary || days !== null ? (
            <ReadErrorBoundary compact>
              <div className={styles.tiles}>
                {primary ? (
                  <Link href={`/places/${primary.id}`} className={styles.tile}>
                    <PlaceIcon />
                    <span className={styles.tileKey}>Lieu principal</span>{' '}
                    <span className={styles.tileValue}>{primary.name}</span>
                  </Link>
                ) : null}
                {days !== null ? (
                  <Link href="/profile" className={styles.tile}>
                    <CalendarIcon />
                    <span className={styles.tileKey}>Rythme</span>{' '}
                    <span className={styles.tileNumber}>
                      <CountUp to={days} />
                      <small aria-hidden="true">{` ${plural(days, 'séance', 'séances')} / sem.`}</small>
                      <span
                        className={styles.srOnly}
                      >{` ${plural(days, 'séance', 'séances')} par semaine`}</span>
                    </span>
                  </Link>
                ) : null}
              </div>
            </ReadErrorBoundary>
          ) : null}
          {goal && experience ? (
            <ReadErrorBoundary compact>
              <Link href="/profile" className={styles.row}>
                <span className={styles.rowText}>
                  <span className={styles.tileKey}>Objectif · niveau</span>{' '}
                  <span
                    className={styles.rowValue}
                  >{`${GOAL_LABELS[goal]} · ${EXPERIENCE_LABELS[experience]}`}</span>
                </span>
                <Chevron />
              </Link>
            </ReadErrorBoundary>
          ) : null}
          <ReadErrorBoundary compact>
            <div className={styles.readiness}>
              <OfflineReadyIndicator readiness={readiness} />
              {readiness.ready ? null : (
                <Button variant="secondary" block onClick={onRetry} disabled={retrying}>
                  Réessayer
                </Button>
              )}
            </div>
          </ReadErrorBoundary>
        </div>
      ) : null}
    </Page>
  );
}
