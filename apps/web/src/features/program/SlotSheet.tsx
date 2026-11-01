import type { InstanceChangeOperation } from '@rune/contracts';
import { currentRules, findSlot } from '@rune/domain';
import { useId, useMemo, useState } from 'react';
import { type ProgramEditContext, type ProgramView, useRepos } from '../../repos';
import { Badge, BottomSheet, Button, Chips, ChoiceList, Field } from '../../ui';
import { ActionError, OfflineNotice } from './ActionError';
import styles from './program.module.css';
import { REMOVE_TEXT, workSet } from './program-labels';
import {
  type ChangeCheck,
  changeCheck,
  checkMessage,
  measureOf,
  replacementCandidates,
  slotDisplay,
} from './program-model';
import { useProgramAction } from './use-change';

type Mode = 'main' | 'replace' | 'replace_resume' | 'remove';

/** Nombre entier saisi (« 12 »), null sinon. */
const integer = (text: string): number | null => (/^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : null);

const NOT_A_NUMBER = 'Indique un nombre entier.';

/**
 * Bouton d'un changement : grisé (avec la raison) si le validateur le refuse déjà sur le téléphone, ou hors ligne ;
 * l'erreur du serveur s'affiche dessous.
 */
function ChangeButton(p: {
  label: string;
  ops: InstanceChangeOperation[];
  check: ChangeCheck;
  disabled: boolean;
  error: string | null;
  variant?: 'primary' | 'secondary' | 'danger';
  onPress(): void;
}) {
  const hintId = useId();
  const refused = checkMessage(p.check(p.ops));
  return (
    <div className={styles.action}>
      <Button
        variant={p.variant ?? 'secondary'}
        block
        disabled={p.disabled || refused !== null}
        aria-describedby={refused ? hintId : undefined}
        onClick={p.onPress}
      >
        {p.label}
      </Button>
      {refused ? (
        <p id={hintId} className={styles.hint}>
          {refused}
        </p>
      ) : null}
      <ActionError message={p.error} />
    </div>
  );
}

/**
 * Feuille d'un slot (spec §7.7, 05 §15) : les changements ouverts à l'utilisateur, chacun envoyé seul au serveur
 * (`POST /api/program/changes`, auteur `user`) : remplacer l'exercice, séries −1 / +1, fourchette de répétitions,
 * repos, effort visé (sous « Réglages avancés »), alléger la prochaine fois, suspendre, retirer de la séance. Un
 * slot suspendu offre « Reprendre », ou « Remplacer et reprendre » en un seul changement (ruling R23). En profil
 * prudent, les bornes prudentes s'appliquent et les hausses n'apparaissent pas (ni série de plus, ni marge plus
 * courte). Le validateur du domaine grise d'avance ce que le serveur refuserait ; hors ligne, tout est grisé. La
 * feuille se ferme quand le changement est accepté.
 */
export function SlotSheet(p: {
  slotId: string;
  view: ProgramView;
  ctx: ProgramEditContext;
  offline: boolean;
  onClose(): void;
}) {
  const { view, ctx, offline } = p;
  const repos = useRepos();
  const action = useProgramAction();
  const [mode, setMode] = useState<Mode>('main');
  const [choice, setChoice] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const advancedId = useId();
  const repsHintId = useId();
  const removeTextId = useId();
  const check = useMemo(() => changeCheck(view, ctx), [view, ctx]);
  const found = findSlot(view.program.template, p.slotId);
  const set = found ? workSet(found.slot) : undefined;
  const [min, setMin] = useState(String(set?.reps?.min ?? ''));
  const [max, setMax] = useState(String(set?.reps?.max ?? ''));
  const [rest, setRest] = useState(String(set?.restS ?? ''));
  const [rir, setRir] = useState<string | null>(set?.targetRir === undefined ? null : String(set.targetRir));
  if (found === undefined) return null;

  const { slot } = found;
  const display = slotDisplay(slot, view, ctx);
  const cautious = ctx.profile === 'cautious';
  const rules = currentRules();
  const busy = offline || action.pending;
  const send = async (key: string, ops: InstanceChangeOperation[]) => {
    const ok = await action.run(key, () => repos.program.change(ops, view.instance.revision));
    if (ok) p.onClose();
  };
  const button = (label: string, ops: InstanceChangeOperation[], variant?: 'primary' | 'secondary') => (
    <ChangeButton
      label={label}
      ops={ops}
      check={check}
      disabled={busy}
      error={action.errorOf(label)}
      variant={variant}
      onPress={() => void send(label, ops)}
    />
  );

  const offlineNotice = <OfflineNotice offline={offline} />;
  const cancel = (
    <Button variant="secondary" block onClick={() => setMode('main')}>
      Annuler
    </Button>
  );

  if (mode === 'replace' || mode === 'replace_resume') {
    const resume = mode === 'replace_resume';
    const opsFor = (exercise: string): InstanceChangeOperation[] =>
      resume
        ? [
            { op: 'replace_exercise', slot: slot.id, exercise },
            { op: 'resume_slot', slot: slot.id },
          ]
        : [{ op: 'replace_exercise', slot: slot.id, exercise }];
    const candidates = replacementCandidates(display, ctx, check, opsFor);
    const label = resume ? 'Remplacer et reprendre' : 'Remplacer';
    return (
      <BottomSheet
        open
        title={display.name}
        onClose={p.onClose}
        actions={
          <>
            <Button
              block
              disabled={busy || choice === null}
              onClick={() => (choice ? void send(label, opsFor(choice)) : undefined)}
            >
              {label}
            </Button>
            <ActionError message={action.errorOf(label)} />
            {cancel}
          </>
        }
      >
        {offlineNotice}
        {candidates.length > 0 ? (
          <ChoiceList<string>
            name={`replace-${slot.id}`}
            legend="Remplacer par"
            value={choice}
            onChange={setChoice}
            options={candidates.map((s) => ({ value: s.id, label: s.name }))}
          />
        ) : (
          <p className={styles.muted}>Aucun autre exercice ne convient pour l'instant.</p>
        )}
      </BottomSheet>
    );
  }

  if (mode === 'remove') {
    return (
      <BottomSheet
        open
        title={display.name}
        onClose={p.onClose}
        describedBy={removeTextId}
        actions={
          <>
            <Button
              variant="danger"
              block
              disabled={busy}
              onClick={() => void send('Retirer', [{ op: 'remove_slot', slot: slot.id }])}
            >
              Retirer
            </Button>
            <ActionError message={action.errorOf('Retirer')} />
            {cancel}
          </>
        }
      >
        {offlineNotice}
        <p id={removeTextId}>{REMOVE_TEXT}</p>
      </BottomSheet>
    );
  }

  const reps = measureOf(slot) === 'reps' && set?.reps !== undefined;
  const [repsLow, repsHigh] = cautious
    ? [rules.cautious.repsMin, rules.cautious.repsMax]
    : rules.programBounds.reps;
  const gap = cautious ? rules.cautious.minRepsGap : rules.programBounds.minRepsGap;
  const minValue = integer(min);
  const maxValue = integer(max);
  const repsChanged = minValue !== set?.reps?.min || maxValue !== set?.reps?.max;
  const repsRefused =
    minValue === null || maxValue === null
      ? NOT_A_NUMBER
      : checkMessage(check([{ op: 'set_rep_range', slot: slot.id, min: minValue, max: maxValue }]));
  // Erreur attachée au champ fautif ; une fourchette refusée dans son ensemble, au maximum.
  const minError = repsChanged && minValue === null ? NOT_A_NUMBER : null;
  const maxError = repsChanged && minValue !== null && repsRefused !== null ? repsRefused : null;
  const restValue = integer(rest);
  const restRefused =
    restValue === null
      ? NOT_A_NUMBER
      : checkMessage(check([{ op: 'set_rest', slot: slot.id, seconds: restValue }]));
  const currentRir = set?.targetRir;
  const rirOptions = [1, 2, 3, 4].filter(
    (v) => v === currentRir || check([{ op: 'set_target_rir', slot: slot.id, value: v }]).ok,
  );
  const removeRefused = checkMessage(check([{ op: 'remove_slot', slot: slot.id }]));

  return (
    <BottomSheet open title={display.name} onClose={p.onClose}>
      <div className={styles.sheetFacts}>
        <p>{display.target ? `${display.summary} · ${display.target}` : display.summary}</p>
        {display.suspended ? <Badge tone="warning">Suspendu</Badge> : null}
      </div>
      {offlineNotice}
      {display.suspended ? (
        <div className={styles.actions}>
          {button('Reprendre', [{ op: 'resume_slot', slot: slot.id }], 'primary')}
          <Button variant="secondary" block disabled={busy} onClick={() => setMode('replace_resume')}>
            Remplacer et reprendre
          </Button>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button variant="secondary" block disabled={busy} onClick={() => setMode('replace')}>
            Remplacer l'exercice
          </Button>
          <div className={styles.pair}>
            {button('Retirer une série', [{ op: 'change_sets', slot: slot.id, delta: -1 }])}
            {cautious ? null : button('Ajouter une série', [{ op: 'change_sets', slot: slot.id, delta: 1 }])}
          </div>
          {reps ? (
            <fieldset className={styles.group} aria-describedby={repsHintId}>
              <legend className={styles.groupTitle}>Répétitions</legend>
              <div className={styles.pair}>
                <Field label="Minimum" error={minError}>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={min}
                    onChange={(e) => setMin(e.target.value)}
                  />
                </Field>
                <Field label="Maximum" error={maxError}>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={max}
                    onChange={(e) => setMax(e.target.value)}
                  />
                </Field>
              </div>
              <p id={repsHintId} className={styles.hint}>
                {`De ${repsLow} à ${repsHigh} répétitions, écart de ${gap} au moins.`}
              </p>
              <Button
                variant="secondary"
                block
                disabled={busy || !repsChanged || repsRefused !== null}
                onClick={() =>
                  minValue !== null && maxValue !== null
                    ? void send('reps', [
                        { op: 'set_rep_range', slot: slot.id, min: minValue, max: maxValue },
                      ])
                    : undefined
                }
              >
                Enregistrer les répétitions
              </Button>
              <ActionError message={action.errorOf('reps')} />
            </fieldset>
          ) : null}
          <div className={styles.group}>
            <Field
              label="Repos (secondes)"
              help={`De ${rules.restS[0]} à ${rules.restS[1]} secondes.`}
              error={restValue !== set?.restS ? restRefused : null}
            >
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={rest}
                onChange={(e) => setRest(e.target.value)}
              />
            </Field>
            <Button
              variant="secondary"
              block
              disabled={busy || restValue === set?.restS || restRefused !== null}
              onClick={() =>
                restValue !== null
                  ? void send('rest', [{ op: 'set_rest', slot: slot.id, seconds: restValue }])
                  : undefined
              }
            >
              Enregistrer le repos
            </Button>
            <ActionError message={action.errorOf('rest')} />
          </div>
          <div className={styles.group}>
            <Button
              variant="ghost"
              block
              aria-expanded={advanced}
              aria-controls={advanced ? advancedId : undefined}
              onClick={() => setAdvanced((v) => !v)}
            >
              Réglages avancés
            </Button>
            {advanced ? (
              <div id={advancedId} className={styles.group}>
                <Chips
                  name={`rir-${slot.id}`}
                  legend="Effort visé (répétitions en réserve)"
                  value={rir}
                  onChange={setRir}
                  options={rirOptions.map((v) => ({ value: String(v), label: String(v) }))}
                />
                <Button
                  variant="secondary"
                  block
                  disabled={busy || rir === null || Number(rir) === currentRir}
                  onClick={() =>
                    rir !== null
                      ? void send('rir', [{ op: 'set_target_rir', slot: slot.id, value: Number(rir) }])
                      : undefined
                  }
                >
                  Enregistrer l'effort visé
                </Button>
                <ActionError message={action.errorOf('rir')} />
              </div>
            ) : null}
          </div>
          {button('Alléger la prochaine fois', [{ op: 'lighten_exercise', slot: slot.id }])}
          {button('Suspendre', [{ op: 'suspend_slot', slot: slot.id }])}
          <div className={styles.dangerZone}>
            <Button
              variant="danger"
              block
              disabled={busy || removeRefused !== null}
              onClick={() => setMode('remove')}
            >
              Retirer de la séance
            </Button>
            {removeRefused ? <p className={styles.hint}>{removeRefused}</p> : null}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
