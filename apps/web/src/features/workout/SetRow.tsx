import { currentRules, type LoadGrid, platesPerSide } from '@rune/domain';
import { type RefObject, useId, useRef, useState } from 'react';
import type { SetInput, WorkoutSetView } from '../../repos';
import { formatKgValue } from '../../ui';
import { DurationTimer } from './DurationTimer';
import { EFFORT_SHORT } from './EffortSheet';
import styles from './live.module.css';
import { parseCount, parseKg, stepLoad } from './number-input';

/*
 * Une ligne de série (spec brique 3 §7.3) : Série · Préc. · kg · Reps (ou Secondes) · ✓. Les champs partent de la
 * valeur saisie, sinon de la cible ; « Préc. » recopie la série de même position de la dernière fois ; la ligne en
 * cours porte − / + au pas réalisable du lieu (ou le chronomètre d'un exercice en durée) et les disques par côté.
 * Rien n'est écrit tant que la saisie n'est pas valable (Review Focus 4) : le message reste sous la ligne, attaché au
 * champ (`aria-describedby`).
 */

export const KG_ERRORS = {
  empty: 'Indique une charge',
  invalid: 'Charge invalide',
  too_high: 'Charge trop élevée',
} as const;

export const COUNT_ERRORS = {
  empty: 'Indique un nombre',
  invalid: 'Nombre invalide',
  too_high: 'Nombre trop élevé',
} as const;

const NOT_SAVED = "La série n'a pas été enregistrée.";

const SIDE_NAMES = { left: 'gauche', right: 'droite' } as const;
const SIDE_LABELS = { left: 'Gauche', right: 'Droite' } as const;

/** « série 1 », « série 1 gauche », « échauffement 1 » : nom d'une ligne dans les noms accessibles. */
export function lineName(line: Pick<WorkoutSetView, 'kind' | 'position' | 'side'>): string {
  const base = `${line.kind === 'warmup' ? 'échauffement' : 'série'} ${line.position}`;
  return line.side === null ? base : `${base} ${SIDE_NAMES[line.side]}`;
}

/** « la série 1 », « l'échauffement 1 ». */
export const theLine = (line: Pick<WorkoutSetView, 'kind' | 'position' | 'side'>): string =>
  line.kind === 'warmup' ? `l'${lineName(line)}` : `la ${lineName(line)}`;

/** Charge à montrer : rien pour un poids du corps sans charge ajoutée. */
const loadOf = (set: WorkoutSetView): number | null =>
  set.loadG === null || (set.loadMode === 'bodyweight' && set.loadG === 0) ? null : set.loadG;

/** « 57,5 × 7 », « 12 », « 30 s », « 20 · 30 s » ; `unit` : « 57,5 kg × 7 » pour les noms accessibles. */
export function setValueText(set: WorkoutSetView, unit = false): string | null {
  const g = loadOf(set);
  const load = g === null ? null : `${formatKgValue(g)}${unit ? ' kg' : ''}`;
  if (set.reps !== null) return load === null ? `${set.reps}` : `${load} × ${set.reps}`;
  if (set.durationS !== null) return load === null ? `${set.durationS} s` : `${load} · ${set.durationS} s`;
  return load;
}

interface Draft {
  kg: string;
  reps: string;
  secs: string;
}

const show = (n: number | null): string => (n === null ? '' : String(n));

/** Valeurs saisies, sinon la cible (le bas de la fourchette de répétitions). */
const initialDraft = (line: WorkoutSetView): Draft => {
  const load = line.loadG ?? line.targetLoadG;
  return {
    kg: load === null ? '' : formatKgValue(load),
    reps: show(line.reps ?? line.targetRepsMin ?? line.targetRepsMax),
    secs: show(line.durationS ?? line.targetDurationS),
  };
};

/** « Par côté : 20 + 1,25 », « Barre seule » ; null hors barre ou charge irréalisable. */
function platesText(grid: LoadGrid, kg: string): string | null {
  if (grid.kind !== 'barbell') return null;
  const parsed = parseKg(kg);
  if (!parsed.ok) return null;
  const plates = platesPerSide(parsed.g, grid.barG, grid.plateStepG / 2);
  if (plates === null) return null;
  return plates.length === 0 ? 'Barre seule' : `Par côté : ${plates.map(formatKgValue).join(' + ')}`;
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}

export interface SetRowProps {
  line: WorkoutSetView;
  /** Série de même position (type, position, côté) de la dernière séance de cet exercice. */
  previous: WorkoutSetView | null;
  /** Charges réalisables au lieu de la séance. */
  grid: LoadGrid;
  measure: 'reps' | 'duration';
  /** Ligne en cours : elle porte − / +, le chronomètre et les disques par côté. */
  active: boolean;
  /** Séance tenue par un autre appareil : valeurs seulement. */
  readOnly: boolean;
  /** Pastille « Effort » sous une série de travail faite (la dernière ligne de la paire en unilatéral). */
  effortChip: boolean;
  /** Valeurs contrôlées ; la ligne devient faite quand la promesse est tenue. */
  onLog(values: SetInput): Promise<void>;
  onReopen(): Promise<void>;
  onEffort(): void;
  /** La ligne prend la main (champ touché) : − / + passent sous elle. */
  onActivate(): void;
}

export function SetRow(p: SetRowProps) {
  const { line } = p;
  const id = useId();
  const [draft, setDraft] = useState(() => initialDraft(line));
  const [errors, setErrors] = useState<{ kg?: string; value?: string; save?: string }>({});
  const [pending, setPending] = useState(false);
  const kgInput = useRef<HTMLInputElement>(null);
  const valueInput = useRef<HTMLInputElement>(null);
  // Ligne rouverte : les champs repartent des valeurs enregistrées.
  const [seen, setSeen] = useState(line.loggedAt);
  if (seen !== line.loggedAt) {
    setSeen(line.loggedAt);
    if (line.loggedAt === null) setDraft(initialDraft(line));
  }

  const done = line.loggedAt !== null;
  const showLoad = line.loadMode !== 'bodyweight';
  const name = lineName(line);
  const the = theLine(line);
  const { setBounds } = currentRules();
  const maxReps = setBounds.reps[1];
  const maxSecs = setBounds.durationS[1];
  const kgErrorId = `${id}-kg`;
  const valueErrorId = `${id}-value`;
  const saveErrorId = `${id}-save`;

  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) => ({
      ...e,
      ...('kg' in patch ? { kg: undefined } : {}),
      ...('reps' in patch || 'secs' in patch ? { value: undefined } : {}),
      save: undefined,
    }));
  };

  const copyPrevious = () => {
    const prev = p.previous;
    if (!prev) return;
    edit({
      ...(showLoad && prev.loadG !== null ? { kg: formatKgValue(prev.loadG) } : {}),
      ...(prev.reps !== null ? { reps: String(prev.reps) } : {}),
      ...(prev.durationS !== null ? { secs: String(prev.durationS) } : {}),
    });
  };

  const stepKg = (direction: 1 | -1) => {
    const parsed = parseKg(draft.kg);
    if (!parsed.ok && parsed.error !== 'empty') return;
    const value = stepLoad(p.grid, parsed.ok ? parsed.g : null, direction);
    if (value !== null) edit({ kg: formatKgValue(value) });
  };

  const stepReps = (direction: 1 | -1) => {
    const parsed = parseCount(draft.reps, maxReps);
    if (!parsed.ok && parsed.error !== 'empty') return;
    const current = parsed.ok ? parsed.n : null;
    if (current === null && direction === -1) return;
    const value = current === null ? 1 : Math.min(maxReps, Math.max(0, current + direction));
    edit({ reps: String(value) });
  };

  const validate = async () => {
    const values: SetInput = {};
    const found: { kg?: string; value?: string } = {};
    if (showLoad) {
      const kg = parseKg(draft.kg);
      if (kg.ok) values.loadG = kg.g;
      else found.kg = KG_ERRORS[kg.error];
    }
    const count =
      p.measure === 'duration' ? parseCount(draft.secs, maxSecs) : parseCount(draft.reps, maxReps);
    if (!count.ok) found.value = COUNT_ERRORS[count.error];
    else if (p.measure === 'duration') values.durationS = count.n;
    else values.reps = count.n;
    if (found.kg || found.value) {
      setErrors(found);
      // Le premier champ fautif prend le focus : son message (aria-describedby) est lu avec lui.
      (found.kg ? kgInput : valueInput).current?.focus();
      return;
    }
    setPending(true);
    try {
      await p.onLog(values);
    } catch {
      setErrors({ save: NOT_SAVED });
    } finally {
      setPending(false);
    }
  };

  const reopen = async () => {
    setPending(true);
    try {
      await p.onReopen();
    } catch {
      setErrors({ save: NOT_SAVED });
    } finally {
      setPending(false);
    }
  };

  const editable = !p.readOnly && !done;
  const previousText = p.previous ? setValueText(p.previous) : null;
  const previousCell =
    previousText === null || p.previous === null ? (
      <span className={styles.muted} aria-hidden="true">
        —
      </span>
    ) : editable ? (
      <button
        type="button"
        className={styles.prev}
        aria-label={`Recopier ${setValueText(p.previous, true)} dans ${the}`}
        onClick={copyPrevious}
      >
        {previousText}
      </button>
    ) : (
      <span className={styles.muted}>{previousText}</span>
    );

  const field = (o: {
    key: keyof Draft;
    label: string;
    mode: 'decimal' | 'numeric';
    error: string | undefined;
    errorId: string;
    ref: RefObject<HTMLInputElement | null>;
  }) => (
    <input
      ref={o.ref}
      className={styles.input}
      type="text"
      inputMode={o.mode}
      autoComplete="off"
      enterKeyHint="done"
      aria-label={`${o.label}, ${name}`}
      aria-invalid={o.error ? true : undefined}
      aria-describedby={o.error ? o.errorId : undefined}
      value={draft[o.key]}
      onChange={(e) => edit({ [o.key]: e.currentTarget.value })}
      onFocus={p.onActivate}
    />
  );

  const shown = (value: string | null) => <span className={styles.value}>{value ?? '—'}</span>;
  const storedLoad = loadOf(line);
  const loadCell = !showLoad ? (
    <span />
  ) : editable ? (
    field({
      key: 'kg',
      label: 'Charge en kg',
      mode: 'decimal',
      error: errors.kg,
      errorId: kgErrorId,
      ref: kgInput,
    })
  ) : (
    shown(storedLoad === null ? null : formatKgValue(storedLoad))
  );
  const valueCell = editable
    ? p.measure === 'duration'
      ? field({
          key: 'secs',
          label: 'Secondes',
          mode: 'numeric',
          error: errors.value,
          errorId: valueErrorId,
          ref: valueInput,
        })
      : field({
          key: 'reps',
          label: 'Répétitions',
          mode: 'numeric',
          error: errors.value,
          errorId: valueErrorId,
          ref: valueInput,
        })
    : shown(p.measure === 'duration' ? show(line.durationS) || null : show(line.reps) || null);

  const plates = editable && p.active && showLoad ? platesText(p.grid, draft.kg) : null;
  const loadSteps = editable && p.active && showLoad && p.grid.kind !== 'none';
  const parsedKg = parseKg(draft.kg);
  const kgValue = parsedKg.ok ? parsedKg.g : null;
  const canStep = (direction: 1 | -1) =>
    (parsedKg.ok || parsedKg.error === 'empty') && stepLoad(p.grid, kgValue, direction) !== null;

  return (
    <li className={styles.line} data-done={done ? '' : undefined} data-kind={line.kind}>
      <div className={styles.main}>
        <span className={styles.label}>
          <span>{line.kind === 'warmup' ? `É${line.position}` : line.position}</span>
          {line.side !== null ? <span className={styles.side}>{SIDE_LABELS[line.side]}</span> : null}
        </span>
        <span className={styles.prevCell}>{previousCell}</span>
        {loadCell}
        {valueCell}
        <span className={styles.checkCell}>
          {p.readOnly ? (
            done ? (
              <span className={styles.checkStatic} role="img" aria-label="Faite">
                <CheckIcon />
              </span>
            ) : null
          ) : (
            <button
              type="button"
              className={styles.check}
              aria-label={done ? `Rouvrir ${the}` : `Valider ${the}`}
              aria-describedby={errors.save ? saveErrorId : undefined}
              disabled={pending}
              onClick={() => void (done ? reopen() : validate())}
            >
              <CheckIcon />
            </button>
          )}
        </span>
        {errors.kg ? (
          <p id={kgErrorId} className={styles.error}>
            {errors.kg}
          </p>
        ) : null}
        {errors.value ? (
          <p id={valueErrorId} className={styles.error}>
            {errors.value}
          </p>
        ) : null}
        {errors.save ? (
          <p id={saveErrorId} className={styles.saveError} role="alert">
            {errors.save}
          </p>
        ) : null}
      </div>
      {editable && p.active ? (
        <fieldset className={styles.tools}>
          <legend className={styles.srOnly}>{`Ajuster ${the}`}</legend>
          {loadSteps ? (
            <div className={styles.stepper}>
              <button
                type="button"
                className={styles.step}
                aria-label="Baisser la charge"
                disabled={!canStep(-1)}
                onClick={() => stepKg(-1)}
              >
                −
              </button>
              <span className={styles.stepCaption} aria-hidden="true">
                Charge
              </span>
              <button
                type="button"
                className={styles.step}
                aria-label="Monter la charge"
                disabled={!canStep(1)}
                onClick={() => stepKg(1)}
              >
                +
              </button>
            </div>
          ) : null}
          {p.measure === 'duration' ? (
            <DurationTimer onStop={(seconds) => edit({ secs: String(Math.min(seconds, maxSecs)) })} />
          ) : (
            <div className={styles.stepper}>
              <button
                type="button"
                className={styles.step}
                aria-label="Une répétition de moins"
                onClick={() => stepReps(-1)}
              >
                −
              </button>
              <span className={styles.stepCaption} aria-hidden="true">
                Répétitions
              </span>
              <button
                type="button"
                className={styles.step}
                aria-label="Une répétition de plus"
                onClick={() => stepReps(1)}
              >
                +
              </button>
            </div>
          )}
          {plates ? <p className={styles.plates}>{plates}</p> : null}
        </fieldset>
      ) : null}
      {p.effortChip && done && !p.readOnly ? (
        <div className={styles.effortLine}>
          <button
            type="button"
            className={styles.effortChip}
            aria-label={
              line.effort === null
                ? `Noter l'effort de ${the}`
                : `Effort de ${the} : ${EFFORT_SHORT[line.effort]}`
            }
            onClick={p.onEffort}
          >
            {line.effort === null ? 'Effort' : EFFORT_SHORT[line.effort]}
          </button>
        </div>
      ) : null}
    </li>
  );
}
