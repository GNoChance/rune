import { useId, useMemo, useState } from 'react';
import { type ProgramEditContext, type ProgramView, useRepos } from '../../repos';
import { BottomSheet, Button, Chips, ChoiceList } from '../../ui';
import { ActionError, OfflineNotice } from './ActionError';
import { daysOptions } from './EnrollSheet';
import styles from './program.module.css';
import { DELOAD_TEXT } from './program-labels';
import { addableExercises, changeCheck, checkMessage } from './program-model';
import { useProgramAction } from './use-change';

interface SheetProps {
  view: ProgramView;
  ctx: ProgramEditContext;
  offline: boolean;
  onClose(): void;
}

/** « Jours par semaine » (`set_days_per_week`) : les jours en vigueur, ceux du programme effectif (ruling R35). */
export function DaysSheet(p: SheetProps) {
  const { view, ctx } = p;
  const repos = useRepos();
  const action = useProgramAction();
  const current = view.program.daysPerWeek;
  const [days, setDays] = useState(String(current));
  const check = useMemo(() => changeCheck(view, ctx), [view, ctx]);
  const value = Number(days);
  const refused = checkMessage(check([{ op: 'set_days_per_week', days: value }]));
  const save = async () => {
    const ok = await action.run('days', () =>
      repos.program.change([{ op: 'set_days_per_week', days: value }], view.instance.revision),
    );
    if (ok) p.onClose();
  };
  return (
    <BottomSheet
      open
      title="Jours par semaine"
      onClose={p.onClose}
      actions={
        <>
          <Button
            block
            disabled={p.offline || action.pending || value === current || refused !== null}
            onClick={() => void save()}
          >
            Enregistrer
          </Button>
          <ActionError message={action.errorOf('days')} />
          <Button variant="secondary" block onClick={p.onClose}>
            Annuler
          </Button>
        </>
      }
    >
      <OfflineNotice offline={p.offline} />
      <Chips
        name="program-days"
        legend="Séances par semaine"
        value={days}
        onChange={setDays}
        options={daysOptions(view.program.template).map((d) => ({ value: String(d), label: String(d) }))}
      />
      {refused ? <p className={styles.hint}>{refused}</p> : null}
    </BottomSheet>
  );
}

/** « Commencer une semaine allégée » (`start_deload`), après confirmation. */
export function DeloadSheet(p: SheetProps) {
  const repos = useRepos();
  const action = useProgramAction();
  const textId = useId();
  const start = async () => {
    const ok = await action.run('deload', () =>
      repos.program.change([{ op: 'start_deload' }], p.view.instance.revision),
    );
    if (ok) p.onClose();
  };
  return (
    <BottomSheet
      open
      title="Commencer une semaine allégée"
      onClose={p.onClose}
      describedBy={textId}
      actions={
        <>
          <Button block disabled={p.offline || action.pending} onClick={() => void start()}>
            Commencer la semaine allégée
          </Button>
          <ActionError message={action.errorOf('deload')} />
          <Button variant="secondary" block onClick={p.onClose}>
            Annuler
          </Button>
        </>
      }
    >
      <OfflineNotice offline={p.offline} />
      <p id={textId}>{DELOAD_TEXT}</p>
    </BottomSheet>
  );
}

/** « Ajouter un exercice » à une séance (`add_slot`, accessoire en progression par répétitions). */
export function AddSlotSheet(p: SheetProps & { workoutId: string }) {
  const { view, ctx } = p;
  const repos = useRepos();
  const action = useProgramAction();
  const [choice, setChoice] = useState<string | null>(null);
  const check = useMemo(() => changeCheck(view, ctx), [view, ctx]);
  const options = useMemo(
    () => addableExercises(p.workoutId, view, ctx, check),
    [p.workoutId, view, ctx, check],
  );
  const workout = view.program.template.workouts.find((w) => w.id === p.workoutId);
  if (workout === undefined) return null;
  const chosen = options.find((s) => s.id === choice);
  const add = async () => {
    if (chosen === undefined) return;
    const ok = await action.run('add', () =>
      repos.program.change(
        [
          {
            op: 'add_slot',
            workout: workout.id,
            movementPattern: chosen.movement_pattern,
            exercises: [chosen.id],
          },
        ],
        view.instance.revision,
      ),
    );
    if (ok) p.onClose();
  };
  return (
    <BottomSheet
      open
      title={`Ajouter un exercice à ${workout.name}`}
      onClose={p.onClose}
      actions={
        <>
          <Button
            block
            disabled={p.offline || action.pending || chosen === undefined}
            onClick={() => void add()}
          >
            Ajouter
          </Button>
          <ActionError message={action.errorOf('add')} />
          <Button variant="secondary" block onClick={p.onClose}>
            Annuler
          </Button>
        </>
      }
    >
      <OfflineNotice offline={p.offline} />
      {options.length > 0 ? (
        <ChoiceList<string>
          name={`add-${workout.id}`}
          legend="Exercice"
          value={choice}
          onChange={setChoice}
          options={options.map((s) => ({ value: s.id, label: s.name }))}
        />
      ) : (
        <p className={styles.muted}>Aucun exercice ne peut être ajouté à cette séance pour l'instant.</p>
      )}
    </BottomSheet>
  );
}
