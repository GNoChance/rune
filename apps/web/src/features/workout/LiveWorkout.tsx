import type { Effort } from '@rune/contracts';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useMe, useServices, useSyncState } from '../../app-services';
import {
  type LiveContext,
  useCatalog,
  useDeviceSettings,
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
import { ExerciseCard, hasOpenWork, measureOf, workLinesAt } from './ExerciseCard';
import { FinishSheet } from './FinishSheet';
import { AddSetButton, FreeWorkout } from './FreeWorkout';
import styles from './live.module.css';
import { ExerciseSheetSheet } from './PlanList';
import { RestTimer } from './RestTimer';
import { clearRest, useRestTimer } from './rest-timer';
import { SessionMenu } from './SessionMenu';
import { useWakeLock } from './wake-lock';
import { nameOf } from './workout-labels';

/*
 * Séance en cours (`/workout/:id`, spec brique 3 §7.3) : en-tête collant (nom, durée, « N en attente », menu), cartes
 * d'exercice dans l'ordre, l'exercice en cours ouvert, puis le minuteur de repos et « Terminer » en bas. L'écran reste
 * allumé (D14, réglage de l'appareil). Tout s'écrit en local (outbox) : la séance se fait hors ligne. Une séance tenue
 * par un autre appareil se lit seulement ; une séance close se corrige dans l'historique.
 */

const READ_ONLY = 'Cette séance continue sur un autre appareil.';
const EFFORT_FAILED = "L'effort n'a pas été enregistré.";

/** Nom de la séance : celui du modèle, sinon « Séance A » ; « Séance libre » sans programme (D7). */
const titleOf = (session: WorkoutSessionView, context: LiveContext): string =>
  context.workoutName ?? (session.workoutId === null ? 'Séance libre' : `Séance ${session.workoutId}`);

const isDone = (set: WorkoutSetView) => set.loggedAt !== null;

/**
 * Effort à demander avant la fin (05 §7 : au minimum sur la dernière série de travail). Programme : exercices dont
 * aucune série de travail faite n'a d'effort, la charge n'augmentera pas. Séance libre : exercices dont la dernière
 * série de travail faite n'en a pas (celle que compte l'XP) ; facultatif, rien n'en dépend d'autre (D7).
 */
const missingEffort = (session: WorkoutSessionView): WorkoutExerciseView[] =>
  session.exercises.filter((e) => {
    const done = e.sets.filter((s) => s.kind === 'work' && isDone(s));
    if (done.length === 0) return false;
    if (session.instanceId === null) return done.at(-1)?.effort === null;
    return e.slotId !== null && !done.some((s) => s.effort !== null);
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
      (to) => {
        // Séance finie ou supprimée : son repos ne servira plus (il serait de toute façon ignoré, ruling R44).
        clearRest(p.id);
        navigate(to);
      },
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
      measures={new Map(catalog.sheets.map((s) => [s.id, s.measure]))}
      error={error}
      onLeave={leave}
    />
  );
}

/**
 * Où rendre le focus à la fermeture de la feuille d'effort quand son déclencheur n'est plus là : après la dernière
 * série, le ✓ est dans une carte qui se replie (`next` : la carte suivante qui a encore une série de travail à faire,
 * sinon « Terminer » ; l'exercice qui vient d'être fini est écarté même si la séance observée ne l'a pas encore vu) ; après
 * « Noter maintenant », le bouton est parti avec la feuille de fin (`exercise` : la carte notée). La pastille
 * « Effort » reste en place : la feuille lui rend le focus elle-même.
 */
type FocusAfter = { kind: 'next'; done: string } | { kind: 'exercise'; id: string } | null;

interface EffortTarget {
  lines: WorkoutSetView[];
  detail: string;
  after: FocusAfter;
}

function Live(p: {
  session: WorkoutSessionView;
  context: LiveContext;
  title: string;
  names: ReadonlyMap<string, string>;
  /** Mesure de chaque fiche (répétitions ou durée), par id. */
  measures: ReadonlyMap<string, 'reps' | 'duration'>;
  error: string | null;
  onLeave(action: () => Promise<string>): void;
}) {
  const { session } = p;
  const repos = useRepos();
  const me = useMe();
  const { connection } = useSyncState();
  const [settings] = useDeviceSettings();
  const readOnly = !session.heldHere;
  // Séance libre (§7.5) : exercices ajoutés par recherche, séries ajoutées une à une.
  const free = session.instanceId === null && !readOnly;
  const rest = useRestTimer(session.id, !readOnly);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [effort, setEffort] = useState<EffortTarget | null>(null);
  const [savingEffort, setSavingEffort] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refocus, setRefocus] = useState<FocusAfter>(null);
  const root = useRef<HTMLElement>(null);
  const finishButton = useRef<HTMLButtonElement>(null);
  // « Terminer » en cours de vérification : un second appui ne relance rien.
  const checkingFinish = useRef(false);

  useWakeLock(!readOnly && settings.keepScreenOn);
  // Faute de savoir, les messages aux mineurs s'affichent (comme la séance du jour).
  const minor = (me?.ageBand ?? 'minor') === 'minor';
  const name = (e: WorkoutExerciseView) => nameOf(p.names, e.exerciseId);
  // L'exercice en cours : le premier qui a encore une série de travail à faire.
  const currentId = session.exercises.find(hasOpenWork)?.id ?? null;
  const isOpen = (e: WorkoutExerciseView) => expanded[e.id] ?? e.id === currentId;
  const anyDone = session.exercises.some((e) => e.sets.some(isDone));
  const remaining = session.exercises.some(hasOpenWork);
  const missing = missingEffort(session);

  const askEffort = (exercise: WorkoutExerciseView, lines: WorkoutSetView[], after: FocusAfter = null) => {
    const position = lines[0]?.position;
    if (position === undefined) return;
    setEffort({ lines, detail: `${name(exercise)} · série ${position}`, after });
  };

  const closeEffort = () => {
    setRefocus(effort?.after ?? null);
    setEffort(null);
  };

  // Après la fermeture de la feuille (et le retour de focus qu'elle tente), le focus va où on l'attend.
  useEffect(() => {
    if (refocus === null || effort !== null) return;
    const toggle = (id: string) =>
      root.current?.querySelector<HTMLElement>(`[data-toggle-for="${id}"]`) ?? null;
    const nextId =
      refocus.kind === 'next'
        ? (session.exercises.find((e) => e.id !== refocus.done && hasOpenWork(e))?.id ?? null)
        : refocus.id;
    (nextId === null ? finishButton.current : toggle(nextId))?.focus();
    setRefocus(null);
  }, [refocus, effort, session]);

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
      closeEffort();
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

  /**
   * « Terminer » : les efforts manquants se lisent sur la séance relue en base, pas sur la séance observée, qui n'a pas
   * encore l'effort noté juste avant tant que la requête vivante n'est pas repassée.
   */
  const tapFinish = async () => {
    if (checkingFinish.current) return;
    checkingFinish.current = true;
    try {
      const fresh = await repos.workouts.session(session.id).catch(() => null);
      if (missingEffort(fresh ?? session).length > 0) setFinishing(true);
      else finish();
    } finally {
      checkingFinish.current = false;
    }
  };

  // Filet : la feuille de fin ouverte sur une liste qui se vide (l'effort est arrivé entre-temps) se ferme et termine.
  const emptied = finishing && missing.length === 0;
  const finishOnEmpty = useRef(finish);
  finishOnEmpty.current = finish;
  useEffect(() => {
    if (emptied) finishOnEmpty.current();
  }, [emptied]);

  /** « Noter maintenant » : l'effort de la dernière série de travail faite du premier exercice concerné. */
  const rateMissing = () => {
    setFinishing(false);
    const exercise = missing[0];
    const last = exercise?.sets.filter((s) => s.kind === 'work' && isDone(s)).at(-1);
    if (exercise && last) {
      askEffort(exercise, workLinesAt(exercise, last.position).filter(isDone), {
        kind: 'exercise',
        id: exercise.id,
      });
    }
  };

  const currentEffort = effort?.lines.find((l) => l.effort !== null)?.effort ?? null;

  return (
    <section ref={root} className={styles.live}>
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
            measure={measureOf(exercise, p.measures.get(exercise.exerciseId))}
            context={p.context}
            open={isOpen(exercise)}
            readOnly={readOnly}
            minor={minor}
            offline={connection === 'offline'}
            onToggle={() => setExpanded((x) => ({ ...x, [exercise.id]: !isOpen(exercise) }))}
            onOpenSheet={() => setSheet(exercise.exerciseId)}
            onEffort={(lines) => askEffort(exercise, lines)}
            onLastWorkDone={(lines) => askEffort(exercise, lines, { kind: 'next', done: exercise.id })}
            onWorkSetDone={() => {
              const restS = p.context.restS[exercise.id];
              if (restS !== undefined) rest.start(restS);
            }}
            footer={free ? <AddSetButton performedExerciseId={exercise.id} /> : undefined}
          />
        ))}
      </div>
      {free ? (
        <FreeWorkout session={session} onAdded={(id) => setExpanded((x) => ({ ...x, [id]: true }))} />
      ) : null}
      {readOnly ? null : (
        <div className={styles.footer}>
          <RestTimer rest={rest} />
          <Button
            ref={finishButton}
            variant={remaining ? 'secondary' : 'primary'}
            block
            onClick={() => void tapFinish()}
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
        onLater={closeEffort}
      />
      <FinishSheet
        open={finishing}
        free={session.instanceId === null}
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
