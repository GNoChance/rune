import { type CSSProperties, type ReactNode, useId, useMemo } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { useLive, useMe, useSyncState } from '../../app-services';
import {
  useCatalog,
  useHistory,
  useRepos,
  useSession,
  useSessionDecisions,
  type WorkoutSessionView,
} from '../../repos';
import {
  Button,
  CoachBubble,
  EmptyState,
  formatInt,
  NETWORK_REQUIRED_MESSAGE,
  Page,
  RankBadge,
  SystemPanel,
} from '../../ui';
import { coachLine } from '../coach/coach-lines';
import { ENTRY_TEXTS } from '../coach/coach-texts';
import { sessionName, workStat } from '../history/history-format';
import styles from './summary.module.css';
import {
  groupLabel,
  type NextLine,
  nextLines,
  type RecordLines,
  rankRatio,
  type SessionSummary,
  sessionSummary,
} from './summary-model';
import { nameOf } from './workout-labels';

/*
 * Fin de séance (`/workout/:id/summary`, spec brique 3 §7.4) : la fenêtre du Système « Séance gravée. » (durée, séries
 * de travail, kg soulevés, ou sans charge les répétitions ou le temps d'effort (ruling R56), XP gagnée, rang et sa
 * barre qui se remplit, rangs gagnés dont la pierre se grave comme
 * « Éveil terminé »), les records battus, « La prochaine fois » (séance de programme seulement, D7), la bulle du coach,
 * puis « Terminé » vers l'accueil. Tout se lit en local : le résumé s'ouvre hors ligne. Une séance encore en cours
 * renvoie à son écran ; une séance abandonnée n'a pas de résumé (ruling R39).
 */

const NO_TARGETS_YET = 'Tes prochaines cibles arriveront avec la synchronisation.';

/** Étincelles autour de la pierre qui se grave : direction (degrés) et distance (px), décor seulement. */
const SPARKS = [
  { angle: -80, distance: 46 },
  { angle: -20, distance: 52 },
  { angle: 40, distance: 48 },
  { angle: 100, distance: 50 },
  { angle: 160, distance: 46 },
  { angle: 220, distance: 52 },
];

export function WorkoutSummary(p: { id: string }) {
  const session = useSession(p.id);
  if (session === undefined) return null;
  if (session === null) {
    return (
      <Page title="Séance" back="/workout">
        <EmptyState icon={<span>?</span>} title="Séance introuvable" text="Elle a peut-être été supprimée." />
      </Page>
    );
  }
  if (session.status === 'in_progress') return <Redirect to={`/workout/${session.id}`} replace />;
  if (session.status === 'abandoned') return <Redirect to="/workout" replace />;
  return <Summary session={session} />;
}

function Summary(p: { session: WorkoutSessionView }) {
  const { session } = p;
  const repos = useRepos();
  const me = useMe();
  const offline = useSyncState().connection === 'offline';
  const [, navigate] = useLocation();
  const history = useHistory();
  const catalog = useCatalog();
  const decisions = useSessionDecisions(session.id);
  const profile = useLive(() => repos.profile.get(), [repos]);
  const loading = history === undefined || catalog.state === 'loading';
  const { sheets } = catalog;
  const summary = useMemo(
    () => (loading ? undefined : sessionSummary(history, sheets, session)),
    [loading, history, sheets, session],
  );
  if (summary === undefined || decisions === undefined || profile === undefined) return null;

  const names = new Map(sheets.map((s) => [s.id, s.name]));
  const coach = profile?.coach ?? null;
  const next = nextLines(session.exercises, decisions);
  // Des décisions arrivées mais aucune à montrer (NO_DATA seulement) : rien à annoncer pour la prochaine fois.
  const showNext = session.instanceId !== null && (next.length > 0 || decisions.length === 0);
  return (
    <Page title={sessionName(session)}>
      <div className={`${styles.content} stagger`}>
        <SystemPanel title="Séance gravée.">
          <Engraved summary={summary} />
        </SystemPanel>
        {summary.records.length > 0 ? <Records records={summary.records} names={names} /> : null}
        {showNext ? <NextTime lines={next} names={names} /> : null}
        {coach && me ? (
          <CoachBubble coach={coach} label="Fin de séance">
            <p>{coachLine(coach, 'session_end', new Date(session.startedAt), me.username)}</p>
          </CoachBubble>
        ) : null}
        {me?.consents.aiCoach.active ? (
          offline ? (
            <div className={styles.coachLink}>
              <Button variant="secondary" disabled aria-describedby="coach-offline">
                {ENTRY_TEXTS.question}
              </Button>
              <p id="coach-offline">{NETWORK_REQUIRED_MESSAGE}</p>
            </div>
          ) : (
            <Link href="/coach" className={styles.coachLink}>
              {ENTRY_TEXTS.question}
            </Link>
          )
        ) : null}
        <Button block onClick={() => navigate('/')}>
          Terminé
        </Button>
      </div>
    </Page>
  );
}

/**
 * La pierre qui se grave (rang gagné) : animation CSS, en fondu sous mouvement réduit ; le rang global a en plus
 * quelques étincelles, en décor.
 */
function Stone(p: { children: ReactNode; global?: boolean }) {
  return (
    <span className={`${styles.stone} ${styles.engrave}`} data-rank-up={p.global ? 'global' : undefined}>
      {p.children}
      {p.global ? (
        <span className={styles.sparks} aria-hidden="true">
          {SPARKS.map((s) => (
            <span
              key={s.angle}
              className={styles.spark}
              style={
                { '--spark-angle': `${s.angle}deg`, '--spark-distance': `${s.distance}px` } as CSSProperties
              }
            />
          ))}
        </span>
      ) : null}
    </span>
  );
}

/** Contenu de la fenêtre du Système : chiffres de la séance, XP, rang et sa barre, rangs gagnés. */
function Engraved(p: { summary: SessionSummary }) {
  const { summary } = p;
  const { after, rankUp } = summary;
  const work = workStat(summary.work);
  const next = after.nextRankXp;
  const xpText = next === null ? formatInt(after.xp) : `${formatInt(after.xp)} / ${formatInt(next)}`;
  const rankText = `Rang ${after.rank} · ${xpText} XP`;
  const from = rankUp.global === null ? rankRatio(summary.before) : 0;
  const badge = <RankBadge rank={after.rank} size={56} />;
  return (
    <div className={styles.engraved}>
      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>Durée</dt>
          <dd>{summary.minutes === null ? '—' : `${summary.minutes} min`}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Séries de travail</dt>
          <dd>{formatInt(summary.sets)}</dd>
        </div>
        <div className={styles.stat}>
          <dt>{work.term}</dt>
          <dd>{work.value}</dd>
        </div>
        <div className={styles.stat}>
          <dt>XP gagnée</dt>
          <dd>{`+${formatInt(summary.xp)} XP`}</dd>
        </div>
      </dl>
      <div className={styles.rank}>
        {rankUp.global === null ? (
          <span className={styles.stone}>{badge}</span>
        ) : (
          <Stone global>{badge}</Stone>
        )}
        <div className={styles.rankInfo}>
          {next === null ? (
            <p className={styles.rankName}>{rankText}</p>
          ) : (
            <p className={styles.rankName}>
              <span aria-hidden="true">{rankText}</span>
              <span className={styles.srOnly}>
                {`Rang ${after.rank} · ${formatInt(after.xp)} sur ${formatInt(next)} XP`}
              </span>
            </p>
          )}
          <div className={styles.xpBar} data-xp-bar="" aria-hidden="true">
            <span
              className={styles.xpFill}
              data-fill=""
              style={{ '--from': String(from), '--to': String(rankRatio(after)) } as CSSProperties}
            />
          </div>
        </div>
      </div>
      {rankUp.global === null ? null : <p className={styles.rankUp}>{`Rang ${rankUp.global} atteint.`}</p>}
      {rankUp.groups.length > 0 ? (
        <ul className={styles.groups}>
          {rankUp.groups.map((code) => {
            const rank = after.groups[code].rank;
            return (
              <li key={code} className={styles.group} data-rank-up="group">
                <Stone>
                  <RankBadge rank={rank} size={32} mini />
                </Stone>
                <span>{`${groupLabel(code)} : rang ${rank}`}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function Records(p: { records: RecordLines[]; names: ReadonlyMap<string, string> }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.section}>
      <h2 id={titleId} className={styles.sectionTitle}>
        Records battus
      </h2>
      <ul className={styles.list}>
        {p.records.map((r) => (
          <li key={r.exerciseId} className={styles.item}>
            <span className={styles.itemName}>{nameOf(p.names, r.exerciseId)}</span>
            {r.lines.map((line) => (
              <span key={line} className={styles.itemText}>
                {line}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** « La prochaine fois » : cible et phrase du code raison, « provisoire » tant que le serveur n'a pas répondu. */
function NextTime(p: { lines: NextLine[]; names: ReadonlyMap<string, string> }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.section}>
      <h2 id={titleId} className={styles.sectionTitle}>
        La prochaine fois
      </h2>
      {p.lines.length === 0 ? (
        <p className={styles.hint}>{NO_TARGETS_YET}</p>
      ) : (
        <ul className={styles.list}>
          {p.lines.map((line) => (
            <li key={line.performedExerciseId} className={styles.item}>
              <span className={styles.itemName}>{nameOf(p.names, line.exerciseId)}</span>
              {line.target ? (
                <span className={styles.target}>
                  {line.variantId === null
                    ? line.target
                    : `${nameOf(p.names, line.variantId)} · ${line.target}`}
                </span>
              ) : null}
              <span className={styles.reason}>
                {line.reason}
                {line.provisional ? <span className={styles.provisional}> · provisoire</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
