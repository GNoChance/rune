import { type Effort, REASON_TEXTS } from '@rune/contracts';
import { useId, useState } from 'react';
import { useLocation } from 'wouter';
import { useLive } from '../../app-services';
import {
  useCatalog,
  useRepos,
  useSession,
  useSessionDecisions,
  type WorkoutExerciseView,
  type WorkoutSessionView,
  type WorkoutSetView,
} from '../../repos';
import { Button, Dialog, EmptyState, formatKg, formatKgValue, Page, plural } from '../../ui';
import styles from './history.module.css';
import { dayLabel, minutesOf, sessionName, showsDecision } from './history-format';

const BACK = '/history';

/** Efforts en toutes lettres (RIR retenu : facile, correct, difficile, échec). */
const EFFORT_LABELS: Record<Effort, string> = {
  easy: 'Facile',
  ok: 'Correct',
  hard: 'Difficile',
  failed: 'Échec',
};
const EFFORT_ORDER: readonly Effort[] = ['easy', 'ok', 'hard', 'failed'];

const SIDE_LABELS = { left: 'gauche', right: 'droite' } as const;

const OUT_OF_RANGE = "Cette valeur n'est pas possible.";
const NOT_DELETED = "La séance n'a pas été supprimée.";
const NOT_SAVED = "La correction n'a pas été enregistrée.";

/** « Série 2 », « Série 1 · gauche », « Échauffement 1 ». */
function setName(set: WorkoutSetView): string {
  const base = set.kind === 'warmup' ? `Échauffement ${set.position}` : `Série ${set.position}`;
  return set.side === null ? base : `${base} · ${SIDE_LABELS[set.side]}`;
}

/** Charge affichée : rien pour un poids du corps sans charge ajoutée. */
const showsLoad = (set: WorkoutSetView): boolean =>
  set.loadG !== null && !(set.loadMode === 'bodyweight' && set.loadG === 0);

/** « 80 kg × 8 », « 12 répétitions », « 30 s », « 20 kg · 45 s ». */
function valueText(set: WorkoutSetView): string {
  const load = showsLoad(set) && set.loadG !== null ? formatKg(set.loadG) : null;
  if (set.reps !== null) {
    return load === null
      ? `${set.reps} ${plural(set.reps, 'répétition', 'répétitions')}`
      : `${load} × ${set.reps}`;
  }
  if (set.durationS !== null) return load === null ? `${set.durationS} s` : `${load} · ${set.durationS} s`;
  return load ?? 'Sans valeur';
}

/** Charge en kg (virgule ou point) vers grammes entiers ; null si le texte n'est pas une charge. */
function parseKg(text: string): number | null {
  const t = text.trim().replace(',', '.');
  return /^\d+(\.\d{1,3})?$/.test(t) ? Math.round(Number.parseFloat(t) * 1000) : null;
}

const parseCount = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

type Fix = { loadG: number } | { reps: number } | { durationS: number } | { effort: Effort | null };

function SetEditor(p: {
  set: WorkoutSetView;
  onFix(set: WorkoutSetView, fix: Fix): void;
  onInvalid(): void;
}) {
  const { set } = p;
  const name = setName(set).replace(' · ', ' ').toLowerCase();
  const hasLoad = set.loadG !== null || set.loadMode !== 'bodyweight';
  const hasReps = set.reps !== null || set.durationS === null;
  const hasDuration = set.durationS !== null;

  const commit = (current: number | null, parsed: number | null, make: (n: number) => Fix) => {
    if (parsed === null) return p.onInvalid();
    if (parsed !== current) p.onFix(set, make(parsed));
  };

  return (
    <div className={styles.editor}>
      {hasLoad ? (
        <label className={styles.editorField}>
          Charge en kg
          <input
            aria-label={`Charge en kg, ${name}`}
            inputMode="decimal"
            defaultValue={set.loadG === null ? '' : formatKgValue(set.loadG)}
            onBlur={(e) => commit(set.loadG, parseKg(e.currentTarget.value), (n) => ({ loadG: n }))}
          />
        </label>
      ) : null}
      {hasReps ? (
        <label className={styles.editorField}>
          Répétitions
          <input
            aria-label={`Répétitions, ${name}`}
            inputMode="numeric"
            defaultValue={set.reps === null ? '' : String(set.reps)}
            onBlur={(e) => commit(set.reps, parseCount(e.currentTarget.value), (n) => ({ reps: n }))}
          />
        </label>
      ) : null}
      {hasDuration ? (
        <label className={styles.editorField}>
          Durée en secondes
          <input
            aria-label={`Durée en secondes, ${name}`}
            inputMode="numeric"
            defaultValue={String(set.durationS)}
            onBlur={(e) =>
              commit(set.durationS, parseCount(e.currentTarget.value), (n) => ({ durationS: n }))
            }
          />
        </label>
      ) : null}
      <label className={styles.editorField}>
        Effort
        <select
          aria-label={`Effort, ${name}`}
          value={set.effort ?? ''}
          onChange={(e) => {
            const value = e.currentTarget.value;
            p.onFix(set, { effort: value === '' ? null : (value as Effort) });
          }}
        >
          <option value="">Pas noté</option>
          {EFFORT_ORDER.map((effort) => (
            <option key={effort} value={effort}>
              {EFFORT_LABELS[effort]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ExerciseCard(p: {
  exercise: WorkoutExerciseView;
  name: string;
  decision: { text: string; provisional: boolean } | null;
  editing: boolean;
  onFix(set: WorkoutSetView, fix: Fix): void;
  onInvalid(): void;
}) {
  const { exercise } = p;
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.exercise}>
      <h2 id={titleId} className={styles.exerciseTitle}>
        {p.name}
      </h2>
      {exercise.painLevel === 'pain' || exercise.painLevel === 'discomfort' ? (
        <p className={styles.pain}>{exercise.painLevel === 'pain' ? 'Douleur signalée' : 'Gêne signalée'}</p>
      ) : null}
      <ul className={styles.sets}>
        {exercise.sets.map((set) => (
          <li key={set.id} className={styles.set}>
            {p.editing && set.loggedAt !== null ? (
              <>
                <span>{setName(set)}</span>
                <SetEditor set={set} onFix={p.onFix} onInvalid={p.onInvalid} />
              </>
            ) : (
              <span>
                {[
                  setName(set),
                  valueText(set),
                  ...(set.effort === null ? [] : [EFFORT_LABELS[set.effort]]),
                ].join(' · ')}
              </span>
            )}
          </li>
        ))}
      </ul>
      {exercise.note !== null ? <p className={styles.note}>{exercise.note}</p> : null}
      {p.decision !== null ? (
        <p className={styles.decision} data-decision="">
          {p.decision.text}
          {p.decision.provisional ? <span className={styles.provisional}> · provisoire</span> : null}
        </p>
      ) : null}
    </section>
  );
}

function DeleteDialog(p: { onClose(): void; onConfirm(): void; pending: boolean; error: string | null }) {
  return (
    <Dialog
      open
      title="Supprimer la séance ?"
      onClose={p.onClose}
      actions={
        <>
          <Button variant="secondary" onClick={p.onClose} disabled={p.pending}>
            Annuler
          </Button>
          <Button variant="danger" onClick={p.onConfirm} disabled={p.pending}>
            Supprimer
          </Button>
        </>
      }
    >
      <p>Cette séance et ses séries disparaîtront de ton historique et de tes records.</p>
      {p.error ? <p role="alert">{p.error}</p> : null}
    </Dialog>
  );
}

function Loaded(p: { session: WorkoutSessionView; onDeleted(): void }) {
  const { session } = p;
  const repos = useRepos();
  const [, navigate] = useLocation();
  const catalog = useCatalog();
  const decisions = useSessionDecisions(session.id);
  const places = useLive(() => repos.places.list(), [repos]);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  });

  if (catalog.state === 'loading' || decisions === undefined || places === undefined) return null;

  const sheetNames = new Map(catalog.sheets.map((s) => [s.id, s.name]));
  // Ni exercice sauté ni NO_DATA : la phrase du moteur ne parle que d'un exercice fait (`showsDecision`).
  const exercises = new Map(session.exercises.map((e) => [e.id, e]));
  const reasons = new Map(
    decisions.flatMap((d) => {
      const exercise = exercises.get(d.performedExerciseId);
      return exercise && showsDecision(exercise, d)
        ? [[d.performedExerciseId, { text: REASON_TEXTS[d.reasonCode], provisional: d.provisional }] as const]
        : [];
    }),
  );
  const place = places.find((x) => x.id === session.placeId)?.name ?? 'Lieu inconnu';
  const minutes = minutesOf(session);
  const closed = session.status !== 'in_progress';

  const fix = (set: WorkoutSetView, change: Fix) => {
    const done =
      'effort' in change
        ? repos.workouts.setEffort(set.id, change.effort)
        : repos.workouts.logSet(set.id, change);
    done.then(
      () => setError(null),
      (e: unknown) =>
        setError(e instanceof Error && 'code' in e && e.code === 'out_of_range' ? OUT_OF_RANGE : NOT_SAVED),
    );
  };

  const confirm = () => {
    setRemoving({ pending: true, error: null });
    repos.workouts.remove(session.id).then(
      () => {
        p.onDeleted();
        navigate(BACK);
      },
      () => setRemoving({ pending: false, error: NOT_DELETED }),
    );
  };

  return (
    <Page title={sessionName(session)} back={BACK}>
      <div className={`${styles.content} stagger`}>
        <p className={styles.meta}>
          {[dayLabel(session.startedAt), place, ...(minutes === null ? [] : [`${minutes} min`])].join(' · ')}
        </p>
        {session.note !== null ? <p className={styles.note}>{session.note}</p> : null}
        {error !== null ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        {session.exercises.map((exercise) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            name={sheetNames.get(exercise.exerciseId) ?? 'Exercice inconnu'}
            decision={reasons.get(exercise.id) ?? null}
            editing={editing}
            onFix={fix}
            onInvalid={() => setError(OUT_OF_RANGE)}
          />
        ))}
        <div className={styles.actions}>
          {closed ? (
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(!editing);
                setError(null);
              }}
            >
              {editing ? 'Terminé' : 'Modifier'}
            </Button>
          ) : null}
          <Button variant="danger" className={styles.dangerZone} onClick={() => setConfirming(true)}>
            Supprimer la séance
          </Button>
        </div>
      </div>
      {confirming ? (
        <DeleteDialog
          onClose={() => {
            setConfirming(false);
            setRemoving({ pending: false, error: null });
          }}
          onConfirm={confirm}
          pending={removing.pending}
          error={removing.error}
        />
      ) : null}
    </Page>
  );
}

/** Une séance de l'historique : séries, efforts, décision du moteur ; corrections et suppression (spec §7.6). */
export function HistoryDetail(p: { id: string }) {
  const session = useSession(p.id);
  const [deleted, setDeleted] = useState(false);
  if (session === undefined || deleted) return null;
  if (session === null) {
    return (
      <Page title="Historique" back={BACK}>
        <EmptyState icon={<span>?</span>} title="Séance introuvable" text="Elle a peut-être été supprimée." />
      </Page>
    );
  }
  return <Loaded session={session} onDeleted={() => setDeleted(true)} />;
}
