import type { Effort } from '@rune/contracts';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useServices, useSyncState } from '../../app-services';
import {
  type LiveContext,
  useCatalog,
  useLiveContext,
  useRepos,
  useSession,
  type WorkoutExerciseView,
  type WorkoutSessionView,
  type WorkoutSetView,
} from '../../repos';
import { Banner, Button, EmptyState, Page, UNEXPECTED_ERROR_MESSAGE } from '../../ui';
import { clockText } from './DurationTimer';
import { EffortSheet } from './EffortSheet';
import { ExerciseCard, hasOpenWork, workLinesAt } from './ExerciseCard';
import { FinishSheet } from './FinishSheet';
import styles from './live.module.css';
import { ExerciseSheetSheet } from './PlanList';
import { SessionMenu } from './SessionMenu';
import { nameOf } from './workout-labels';

/*
 * Séance en cours (`/workout/:id`, spec brique 3 §7.3) : en-tête collant (nom, durée, « N en attente », menu), cartes
 * d'exercice dans l'ordre, l'exercice en cours ouvert, puis « Terminer » en bas. Tout s'écrit en local (outbox) : la
 * séance se fait hors ligne. Une séance tenue par un autre appareil se lit seulement ; une séance close se corrige dans
 * l'historique.
 */

const READ_ONLY = 'Cette séance continue sur un autre appareil.';
const EFFORT_FAILED = "L'effort n'a pas été enregistré.";

/** Nom de la séance : celui du modèle, sinon « Séance A » ; « Séance libre » sans programme (D7). */
const titleOf = (session: WorkoutSessionView, context: LiveContext): string =>
  context.workoutName ?? (session.workoutId === null ? 'Séance libre' : `Séance ${session.workoutId}`);

const isDone = (set: WorkoutSetView) => set.loggedAt !== null;

/** Exercices d'un programme dont aucune série de travail faite n'a d'effort : la charge n'augmentera pas (05 §7). */
const missingEffort = (session: WorkoutSessionView): WorkoutExerciseView[] =>
  session.instanceId === null
    ? []
    : session.exercises.filter((e) => {
        const done = e.sets.filter((s) => s.kind === 'work' && isDone(s));
        return e.slotId !== null && done.length > 0 && !done.some((s) => s.effort !== null);
      });

/** « 0:00 », « 12:34 », « 1:02:03 » depuis le début de la séance. */
function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  if (hours === 0) return clockText(seconds);
  const rest = seconds % 3600;
  return `${hours}:${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`;
}

/** Durée écoulée, mise à jour chaque seconde ; l'heure de début est absolue. */
function Elapsed(p: { startedAt: number }) {
  const services = useServices();
  const [now, setNow] = useState(() => services.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(services.now()), 1000);
    return () => clearInterval(timer);
  }, [services]);
  return (
    <span>
      <span className={styles.srOnly}>Durée : </span>
      <time dateTime={`PT${Math.max(0, Math.floor((now - p.startedAt) / 1000))}S`}>
        {elapsedText(now - p.startedAt)}
      </time>
    </span>
  );
}

/** « N en attente » : opérations de l'outbox pas encore acceptées par le serveur (R-SYN-34). */
function Pending() {
  const { pending } = useSyncState();
  return <span>{`${pending} en attente`}</span>;
}

export function LiveWorkout(p: { id: string }) {
  const session = useSession(p.id);
  const context = useLiveContext(p.id);
  const catalog = useCatalog();
  const [, navigate] = useLocation();
  // Fin ou suppression en cours : l'écran se tait le temps d'aller ailleurs (pas d'éclair « terminée » / introuvable).
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = (action: () => Promise<string>) => {
    setLeaving(true);
    setError(null);
    action().then(
      (to) => navigate(to),
      () => {
        setLeaving(false);
        setError(UNEXPECTED_ERROR_MESSAGE);
      },
    );
  };

  if (leaving || session === undefined || context === undefined || catalog.state === 'loading') return null;
  if (session === null || context === null) {
    return (
      <Page title="Séance" back="/workout">
        <EmptyState icon={<span>?</span>} title="Séance introuvable" text="Elle a peut-être été supprimée." />
      </Page>
    );
  }
  const title = titleOf(session, context);
  if (session.status !== 'in_progress') {
    return (
      <Page title={title} back="/workout">
        <p className={styles.closed}>Cette séance est terminée.</p>
        {session.status === 'completed' ? (
          <Link href={`/history/${session.id}`} className={styles.link}>
            Voir dans l'historique
          </Link>
        ) : null}
      </Page>
    );
  }
  return (
    <Live
      session={session}
      context={context}
      title={title}
      names={new Map(catalog.sheets.map((s) => [s.id, s.name]))}
      error={error}
      onLeave={leave}
    />
  );
}

interface EffortTarget {
  lines: WorkoutSetView[];
  detail: string;
}

function Live(p: {
  session: WorkoutSessionView;
  context: LiveContext;
  title: string;
  names: ReadonlyMap<string, string>;
  error: string | null;
  onLeave(action: () => Promise<string>): void;
}) {
  const { session } = p;
  const repos = useRepos();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [effort, setEffort] = useState<EffortTarget | null>(null);
  const [savingEffort, setSavingEffort] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readOnly = !session.heldHere;
  const name = (e: WorkoutExerciseView) => nameOf(p.names, e.exerciseId);
  // L'exercice en cours : le premier qui a encore une série de travail à faire.
  const currentId = session.exercises.find(hasOpenWork)?.id ?? null;
  const isOpen = (e: WorkoutExerciseView) => expanded[e.id] ?? e.id === currentId;
  const anyDone = session.exercises.some((e) => e.sets.some(isDone));
  const remaining = session.exercises.some(hasOpenWork);
  const missing = missingEffort(session);

  const askEffort = (exercise: WorkoutExerciseView, lines: WorkoutSetView[]) => {
    const position = lines[0]?.position;
    if (position === undefined) return;
    setEffort({ lines, detail: `${name(exercise)} · série ${position}` });
  };

  const pickEffort = async (value: Effort) => {
    if (!effort) return;
    setSavingEffort(true);
    setError(null);
    try {
      for (const line of effort.lines) await repos.workouts.setEffort(line.id, value);
    } catch {
      setError(EFFORT_FAILED);
    } finally {
      setSavingEffort(false);
      setEffort(null);
    }
  };

  const finish = () => {
    setFinishing(false);
    p.onLeave(async () => {
      const status = await repos.workouts.finish(session.id);
      // Une séance sans série de travail faite est abandonnée (D4) : rien à résumer.
      return status === 'completed' ? `/workout/${session.id}/summary` : '/workout';
    });
  };

  /** « Noter maintenant » : l'effort de la dernière série de travail faite du premier exercice concerné. */
  const rateMissing = () => {
    setFinishing(false);
    const exercise = missing[0];
    const last = exercise?.sets.filter((s) => s.kind === 'work' && isDone(s)).at(-1);
    if (exercise && last) askEffort(exercise, workLinesAt(exercise, last.position).filter(isDone));
  };

  const currentEffort = effort?.lines.find((l) => l.effort !== null)?.effort ?? null;

  return (
    <section className={styles.live}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>{p.title}</h1>
          <p className={styles.meta}>
            <Elapsed startedAt={session.startedAt} />
            <span aria-hidden="true"> · </span>
            <Pending />
          </p>
        </div>
        {readOnly ? null : (
          <SessionMenu session={session} title={p.title} anyDone={anyDone} onLeave={p.onLeave} />
        )}
      </header>
      {readOnly ? <Banner tone="info">{READ_ONLY}</Banner> : null}
      {p.error || error ? <Banner tone="error">{p.error ?? error}</Banner> : null}
      <div className={styles.cards}>
        {session.exercises.map((exercise) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            name={name(exercise)}
            context={p.context}
            open={isOpen(exercise)}
            readOnly={readOnly}
            onToggle={() => setExpanded((x) => ({ ...x, [exercise.id]: !isOpen(exercise) }))}
            onOpenSheet={() => setSheet(exercise.exerciseId)}
            onEffort={(lines) => askEffort(exercise, lines)}
            onLastWorkDone={(lines) => askEffort(exercise, lines)}
          />
        ))}
      </div>
      {readOnly ? null : (
        <div className={styles.footer}>
          <Button
            variant={remaining ? 'secondary' : 'primary'}
            block
            onClick={() => (missing.length > 0 ? setFinishing(true) : finish())}
          >
            Terminer
          </Button>
        </div>
      )}
      <EffortSheet
        open={effort !== null}
        detail={effort?.detail ?? ''}
        current={currentEffort}
        pending={savingEffort}
        onPick={(value) => void pickEffort(value)}
        onLater={() => setEffort(null)}
      />
      <FinishSheet
        open={finishing}
        exercises={missing.map((e) => ({ id: e.id, name: name(e) }))}
        onRate={rateMissing}
        onFinish={finish}
        onClose={() => setFinishing(false)}
      />
      {sheet ? (
        <ExerciseSheetSheet exerciseId={sheet} name={nameOf(p.names, sheet)} onClose={() => setSheet(null)} />
      ) : null}
    </section>
  );
}
