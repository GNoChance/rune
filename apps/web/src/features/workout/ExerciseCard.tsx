import { type ReactNode, useId, useState } from 'react';
import {
  type LiveContext,
  type SetInput,
  useRepos,
  type WorkoutExerciseView,
  type WorkoutSetView,
} from '../../repos';
import { Banner, BottomSheet, NETWORK_REQUIRED_MESSAGE, UNEXPECTED_ERROR_MESSAGE } from '../../ui';
import { ADJUSTMENT_NOTES, AdjustSheet } from './AdjustSheet';
import styles from './live.module.css';
import { MachineStepSheet } from './MachineStepSheet';
import { NoteSheet } from './NoteSheet';
import { gridFor, loadEntryOf } from './number-input';
import { MINOR_BARBELL, PainSheet } from './PainSheet';
import { MenuButton, useSheetAfterMenu } from './SessionMenu';
import { SetRow } from './SetRow';
import { SwapSheet } from './SwapSheet';
import { targetSummary } from './workout-labels';

/*
 * Carte d'un exercice de la séance en cours (spec brique 3 §7.3) : nom (vers la fiche), cible, messages (mineur à la
 * barre, ajustement de la prochaine fois), « 2 / 3 » des séries de travail faites, puis les lignes (échauffement
 * d'abord). Repliée, elle ne garde que son en-tête ; ses champs restent montés (une saisie en cours ne se perd pas).
 * Menu « ⋯ » : Changer d'exercice, Douleur ou gêne, La prochaine fois, Note, Pas de cette machine, Ajouter une série,
 * Retirer une série non faite ; chaque feuille s'ouvre une fois le menu fermé (`useSheetAfterMenu`).
 */

/** Feuilles ouvertes depuis le menu ; `painSwap` suit « Douleur » (conseil et changement d'exercice). */
type Sub = 'note' | 'swap' | 'pain' | 'painSwap' | 'adjust' | 'machine';

const isDone = (set: WorkoutSetView) => set.loggedAt !== null;

/**
 * Mesure d'un exercice : celle de sa fiche (`measure` du catalogue, juste aussi en séance libre, sans cible) ; faute de
 * fiche, une série avec une durée visée ou saisie.
 */
export const measureOf = (
  exercise: WorkoutExerciseView,
  sheetMeasure: 'reps' | 'duration' | undefined,
): 'reps' | 'duration' =>
  sheetMeasure ??
  (exercise.sets.some((s) => s.targetDurationS !== null || s.durationS !== null) ? 'duration' : 'reps');

/** Lignes d'une série de travail : une, ou gauche et droite en unilatéral. */
export const workLinesAt = (exercise: WorkoutExerciseView, position: number): WorkoutSetView[] =>
  exercise.sets.filter((s) => s.kind === 'work' && s.position === position);

/** Positions des séries de travail, dans l'ordre. */
const workPositions = (exercise: WorkoutExerciseView): number[] =>
  [...new Set(exercise.sets.filter((s) => s.kind === 'work').map((s) => s.position))].sort((a, b) => a - b);

/** Séries de travail faites (une paire compte quand ses deux côtés le sont) et prévues. */
export function workProgress(exercise: WorkoutExerciseView): { done: number; total: number } {
  const positions = workPositions(exercise);
  const done = positions.filter((n) => workLinesAt(exercise, n).every(isDone)).length;
  return { done, total: positions.length };
}

/** Il reste une série de travail à faire. */
export const hasOpenWork = (exercise: WorkoutExerciseView): boolean =>
  exercise.sets.some((s) => s.kind === 'work' && !isDone(s));

/** Entrée du menu « ⋯ » ; grisée, elle dit pourquoi sous son nom (`hint`). */
function MenuItem(p: { children: ReactNode; onClick(): void; disabled?: boolean; hint?: string }) {
  const hintId = useId();
  return (
    <li>
      <button
        type="button"
        className={styles.menuItem}
        disabled={p.disabled}
        aria-describedby={p.hint ? hintId : undefined}
        onClick={p.onClick}
      >
        {p.children}
      </button>
      {p.hint ? (
        <span id={hintId} className={styles.menuHint}>
          {p.hint}
        </span>
      ) : null}
    </li>
  );
}

function Chevron(p: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={styles.chevron}
      data-open={p.open ? '' : undefined}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export interface ExerciseCardProps {
  exercise: WorkoutExerciseView;
  name: string;
  /** Répétitions ou durée (`measureOf`). */
  measure: 'reps' | 'duration';
  context: LiveContext;
  open: boolean;
  readOnly: boolean;
  /** Membre mineur (05 §14) : message à la barre, conseil de douleur. */
  minor: boolean;
  /** Hors ligne : « Pas de cette machine » (API en ligne) est grisé. */
  offline: boolean;
  onToggle(): void;
  /** L'exercice a été changé : `id` est le nouvel exercice du slot, qui remplace cette carte. */
  onSwapped(id: string): void;
  /** Le nom ouvre la fiche de l'exercice. */
  onOpenSheet(): void;
  /** Effort à noter pour ces lignes : une série de travail, ses deux côtés en unilatéral. */
  onEffort(lines: WorkoutSetView[]): void;
  /** La dernière série de travail prévue vient d'être faite (exercice d'un programme) : l'effort est demandé. */
  onLastWorkDone(lines: WorkoutSetView[]): void;
  /**
   * Une série de travail vient d'être faite, ses deux côtés en unilatéral : le repos commence. Jamais après un
   * échauffement ni après la correction d'une série déjà faite (ruling R43).
   */
  onWorkSetDone(): void;
  /** Sous les lignes, dans le corps de la carte : « Ajouter une série » d'un exercice de séance libre. */
  footer?: ReactNode;
}

export function ExerciseCard(p: ExerciseCardProps) {
  const { exercise, context } = p;
  const repos = useRepos();
  const bodyId = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [sub, openAfterMenu, closeSub] = useSheetAfterMenu<Sub>(menu);
  const [error, setError] = useState<string | null>(null);
  const pick = (next: Sub) => {
    setMenu(false);
    openAfterMenu(next);
  };

  const first = exercise.sets.find((s) => s.kind === 'work') ?? exercise.sets[0];
  const loadMode = first?.loadMode ?? 'bodyweight';
  const grid = gridFor(loadMode, context.loadSettings, context.machineStepG[exercise.id] ?? null);
  const { measure } = p;
  // Élastique et poids du corps : pas de colonne kg ; lest : kg facultatif.
  const showLoad = loadEntryOf(loadMode, grid) !== 'none';
  const summary = targetSummary({
    sets: exercise.sets,
    loadMode,
    // Exercice d'un programme sur une grille de charges, sans charge visée : la calibration (05 §9).
    calibration: exercise.slotId !== null && grid.kind !== 'none' && first?.targetLoadG === null,
  });
  const progress = workProgress(exercise);
  const previous = context.previous[exercise.exerciseId] ?? [];
  const previousOf = (line: WorkoutSetView) =>
    previous.find((s) => s.kind === line.kind && s.position === line.position && s.side === line.side) ??
    null;

  const open = exercise.sets.filter((s) => !isDone(s));
  const active = open.find((s) => s.id === activeId) ?? open[0] ?? null;
  const warmups = exercise.sets.filter((s) => s.kind === 'warmup');
  const work = exercise.sets.filter((s) => s.kind === 'work');
  const positions = workPositions(exercise);
  const lastPosition = positions.at(-1);
  /** Dernière position de travail sans aucune ligne faite : « Retirer une série ». */
  const removable = [...positions].reverse().find((n) => !workLinesAt(exercise, n).some(isDone));
  // Exercice d'un programme : changement parmi les candidats du slot, ajustement neutre, pas de machine.
  const program = exercise.slotId !== null;
  const swappable = program && open.length > 0;
  const stateId = context.slotStateIds[exercise.id];
  const machine = program && loadMode === 'machine' && stateId !== undefined;
  const barbell = loadMode === 'barbell';

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch {
      setError(UNEXPECTED_ERROR_MESSAGE);
    }
  };

  const log = async (line: WorkoutSetView, values: SetInput) => {
    // Une correction (série déjà faite) ne redemande pas l'effort et ne relance pas le repos.
    const fresh = line.kind === 'work' && !isDone(line);
    const last = fresh && !exercise.sets.some((s) => s.kind === 'work' && !isDone(s) && s.id !== line.id);
    const rest = fresh && workLinesAt(exercise, line.position).every((l) => l.id === line.id || isDone(l));
    await repos.workouts.logSet(line.id, values);
    if (rest) p.onWorkSetDone();
    // L'effort se demande après la dernière série de travail d'un exercice du programme (05 §7) ; facultatif ailleurs.
    if (last && exercise.slotId !== null && lastPosition !== undefined) {
      p.onLastWorkDone(workLinesAt(exercise, lastPosition));
    }
  };

  /** La pastille « Effort » va sur la dernière ligne faite de chaque série de travail. */
  const chipOn = (line: WorkoutSetView) =>
    line.kind === 'work' && workLinesAt(exercise, line.position).filter(isDone).at(-1)?.id === line.id;

  const row = (line: WorkoutSetView) => (
    <SetRow
      key={line.id}
      line={line}
      previous={previousOf(line)}
      grid={grid}
      measure={measure}
      active={active?.id === line.id}
      readOnly={p.readOnly}
      effortChip={chipOn(line)}
      onLog={(values) => log(line, values)}
      onEffort={() => p.onEffort(workLinesAt(exercise, line.position).filter(isDone))}
      onActivate={() => setActiveId(line.id)}
    />
  );

  return (
    <section
      className={styles.card}
      aria-label={p.name}
      data-measure={measure}
      data-load={showLoad ? undefined : 'none'}
    >
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>
          <button type="button" className={styles.nameButton} onClick={p.onOpenSheet}>
            {p.name}
          </button>
        </h2>
        {p.readOnly ? null : (
          <MenuButton label={`Options pour ${p.name}`} menuFor={exercise.id} onClick={() => setMenu(true)} />
        )}
      </div>
      {summary ? <p className={styles.target}>{summary}</p> : null}
      {p.minor && barbell ? <p className={styles.cardNote}>{MINOR_BARBELL}</p> : null}
      {program && exercise.nextAdjustment ? (
        <p className={styles.cardNote}>{ADJUSTMENT_NOTES[exercise.nextAdjustment]}</p>
      ) : null}
      {exercise.sets.length > 0 ? (
        <button
          type="button"
          className={styles.toggle}
          data-toggle-for={exercise.id}
          aria-expanded={p.open}
          aria-controls={bodyId}
          onClick={p.onToggle}
        >
          <span>
            <span className={styles.srOnly}>Séries faites : </span>
            {`${progress.done} / ${progress.total}`}
          </span>
          <Chevron open={p.open} />
        </button>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      <div id={bodyId} className={styles.cardBody} hidden={!p.open}>
        <div className={styles.columns} aria-hidden="true">
          <span>Série</span>
          <span>Préc.</span>
          <span>{showLoad ? 'kg' : ''}</span>
          <span>{measure === 'duration' ? 'Secondes' : 'Reps'}</span>
          <span>✓</span>
        </div>
        {warmups.length > 0 ? (
          <>
            <p className={styles.caption}>Échauffement</p>
            <ol className={styles.lines}>{warmups.map(row)}</ol>
          </>
        ) : null}
        <ol className={styles.lines}>{work.map(row)}</ol>
        {p.footer}
      </div>
      <BottomSheet open={menu} title={p.name} onClose={() => setMenu(false)}>
        <ul className={styles.menuList}>
          {swappable ? <MenuItem onClick={() => pick('swap')}>Changer d'exercice</MenuItem> : null}
          <MenuItem onClick={() => pick('pain')}>Douleur ou gêne</MenuItem>
          {program ? <MenuItem onClick={() => pick('adjust')}>La prochaine fois</MenuItem> : null}
          <MenuItem onClick={() => pick('note')}>Note</MenuItem>
          {machine ? (
            <MenuItem
              disabled={p.offline}
              hint={p.offline ? NETWORK_REQUIRED_MESSAGE : undefined}
              onClick={() => pick('machine')}
            >
              Pas de cette machine
            </MenuItem>
          ) : null}
          <MenuItem
            onClick={() => {
              setMenu(false);
              void run(() => repos.workouts.addSet(exercise.id));
            }}
          >
            Ajouter une série
          </MenuItem>
          {removable !== undefined ? (
            <MenuItem
              onClick={() => {
                setMenu(false);
                const target = workLinesAt(exercise, removable)[0];
                if (target) void run(() => repos.workouts.removeSet(target.id));
              }}
            >
              Retirer une série
            </MenuItem>
          ) : null}
        </ul>
      </BottomSheet>
      {sub === 'note' ? (
        <NoteSheet
          title={`Note : ${p.name}`}
          initial={exercise.note}
          onSave={(text) => repos.workouts.setNote({ kind: 'exercise', id: exercise.id }, text)}
          onClose={closeSub}
        />
      ) : null}
      {sub === 'swap' || sub === 'painSwap' ? (
        <SwapSheet
          exercise={exercise}
          name={p.name}
          pain={sub === 'painSwap' ? { minor: p.minor, barbell } : null}
          swappable={swappable}
          onSwapped={p.onSwapped}
          onClose={closeSub}
        />
      ) : null}
      {sub === 'pain' ? (
        <PainSheet
          exercise={exercise}
          name={p.name}
          onPain={() => {
            // Le conseil et le changement suivent, dans une feuille qui rendra le focus au « ⋯ ».
            closeSub();
            openAfterMenu('painSwap');
          }}
          onClose={closeSub}
        />
      ) : null}
      {sub === 'adjust' ? <AdjustSheet exercise={exercise} name={p.name} onClose={closeSub} /> : null}
      {sub === 'machine' && stateId !== undefined ? (
        <MachineStepSheet
          name={p.name}
          stateId={stateId}
          stepG={context.machineStepG[exercise.id] ?? null}
          placeStepG={context.loadSettings.machineStepG}
          offline={p.offline}
          onClose={closeSub}
        />
      ) : null}
    </section>
  );
}
