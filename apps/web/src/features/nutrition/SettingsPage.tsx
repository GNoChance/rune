import {
  ACTIVITY_LEVELS,
  type ActivityLevel,
  NUTRITION_GOALS,
  type NutritionGoal,
  type NutritionMode,
  type NutritionTargets,
  SEX_FOR_CALC,
  type SettingsChanges,
  type SexForCalc,
} from '@rune/contracts';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'wouter';
import { ApiError } from '../../api/client';
import { useMe, useServices } from '../../app-services';
import { type NutritionView, useNutritionView, useRepos } from '../../repos';
import { BottomSheet, Button, ChoiceList, errorMessage, Field, Page, useAction } from '../../ui';
import styles from './nutrition.module.css';
import { NUTRITION_TEXTS } from './nutrition-texts';
import { WeighInSheet } from './WeighInSheet';

const T = NUTRITION_TEXTS.settings;
const SETUP = NUTRITION_TEXTS.start.setup;
const TARGETS = NUTRITION_TEXTS.full.targets;
const FLUSH_MS = 4000;
const RESCREEN = '/nutrition/start?screen=1';

/** Lance un appel ; sur `409 weigh_in_required`, passe par la feuille de pesée puis relance une seule fois. */
type Guard = <R>(fn: () => Promise<R>) => Promise<R | undefined>;

/**
 * Pesée exigée (§12.5) : la feuille s'ouvre, la pesée part (`flushBefore`), l'appel est relancé une fois ; un second
 * refus sort tel quel en erreur. Fermer la feuille sans peser abandonne l'appel (résultat `undefined`).
 */
function useWeighInGate(): { guard: Guard; sheet: ReactNode } {
  const services = useServices();
  const [open, setOpen] = useState(false);
  const waiting = useRef<((saved: boolean) => void) | null>(null);
  const saved = useRef(false);

  const guard = useCallback<Guard>(
    async (fn) => {
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'weigh_in_required')) throw e;
      }
      saved.current = false;
      const weighed = await new Promise<boolean>((resolve) => {
        waiting.current = resolve;
        setOpen(true);
      });
      if (!weighed) return undefined;
      await services.sync.flushBefore(FLUSH_MS).catch(() => {});
      return fn();
    },
    [services],
  );

  const sheet = (
    <>
      {open ? <p role="status">{T.weighNote}</p> : null}
      <WeighInSheet
        open={open}
        onSaved={() => {
          saved.current = true;
        }}
        onClose={() => {
          setOpen(false);
          waiting.current?.(saved.current);
          waiting.current = null;
        }}
      />
    </>
  );
  return { guard, sheet };
}

/** Section repliable d'un réglage : aperçu de la nouvelle cible avant « Enregistrer ». */
function SettingEditor(p: {
  title: string;
  current: string | null;
  open: boolean;
  suggested: boolean;
  /** Le changement à prévisualiser ; `null` : rien à changer. */
  changes: SettingsChanges | null;
  requestedGoal: NutritionGoal | null;
  guard: Guard;
  children: ReactNode;
}) {
  const repos = useRepos();
  const [open, setOpen] = useState(p.open);
  const [preview, setPreview] = useState<NutritionTargets | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const latest = useRef({ guard: p.guard, repos });
  latest.current = { guard: p.guard, repos };
  const key = JSON.stringify(p.changes);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    setDone(false);
    const changes = JSON.parse(key) as SettingsChanges | null;
    if (!changes) {
      setPreviewing(false);
      return;
    }
    let live = true;
    setPreviewing(true);
    const { guard, repos: r } = latest.current;
    guard(() => r.nutrition.preview(changes)).then(
      (target) => {
        if (!live) return;
        setPreview(target ?? null);
        setPreviewing(false);
      },
      (e) => {
        if (!live) return;
        setPreviewError(errorMessage(e));
        setPreviewing(false);
      },
    );
    return () => {
      live = false;
    };
  }, [key]);

  const save = useAction(async () => {
    const changes = p.changes;
    if (!changes) return;
    const state = await p.guard(() => repos.nutrition.saveSettings(changes));
    if (state) setDone(true);
  });

  return (
    <details className={styles.setting} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={styles.settingSummary}>
        <span>{p.title}</span>
        {p.current ? <span className={styles.muted}>{p.current}</span> : null}
      </summary>
      <div className={styles.settingBody}>
        {p.suggested ? <p className={styles.suggestion}>{T.suggestion}</p> : null}
        {p.children}
        {previewing ? (
          <p role="status" className={styles.muted}>
            {T.previewing}
          </p>
        ) : null}
        {preview ? (
          <div className={styles.previewBox} role="status">
            <strong>{T.preview}</strong>
            <span>{TARGETS.energyRange(preview.kcal_min, preview.kcal_max)}</span>
            <span className={styles.muted}>{TARGETS.energyCentre(preview.kcal_target)}</span>
            {p.requestedGoal === 'lose' && preview.effective_goal === 'maintain' ? (
              <span>{TARGETS.goalOnMaintenance}</span>
            ) : null}
          </div>
        ) : null}
        {previewError ? (
          <p role="alert" className={styles.error}>
            {previewError}
          </p>
        ) : null}
        {save.error ? (
          <p role="alert" className={styles.error}>
            {save.error}
          </p>
        ) : null}
        {done ? <p role="status">{T.saved}</p> : null}
        <Button disabled={!preview || previewing || save.pending} onClick={() => void save.run()}>
          {T.save}
        </Button>
      </div>
    </details>
  );
}

/** Réglage à choix unique ; `suggestion` présélectionne la valeur du coach. */
function ChoiceSetting<V extends string | number>(p: {
  title: string;
  name: string;
  options: readonly { value: V; label: string }[];
  current: V | null;
  suggestion: V | null;
  focused: boolean;
  build(v: V): SettingsChanges;
  requestedGoal: NutritionGoal | null;
  guard: Guard;
}) {
  const [draft, setDraft] = useState<V | null>(p.suggestion);
  const value = draft ?? p.current;
  const label = (v: V | null) => p.options.find((o) => o.value === v)?.label ?? null;
  return (
    <SettingEditor
      title={p.title}
      current={label(p.current)}
      open={p.focused}
      suggested={p.suggestion !== null && draft === p.suggestion}
      changes={value !== null && value !== p.current ? p.build(value) : null}
      requestedGoal={p.requestedGoal}
      guard={p.guard}
    >
      <ChoiceList<V> name={p.name} legend={p.title} value={value} onChange={setDraft} options={p.options} />
    </SettingEditor>
  );
}

function HeightSetting(p: {
  current: number | null;
  focused: boolean;
  suggestion: number | null;
  requestedGoal: NutritionGoal | null;
  guard: Guard;
}) {
  const [text, setText] = useState(String(p.suggestion ?? p.current ?? ''));
  const typed = /^\d{3}$/.test(text.trim()) ? Number(text.trim()) : null;
  const valid = typed !== null && typed >= 120 && typed <= 220;
  const error = text.trim() !== '' && !valid ? SETUP.heightError : null;
  return (
    <SettingEditor
      title={SETUP.height}
      current={p.current === null ? null : `${p.current} cm`}
      open={p.focused}
      suggested={p.suggestion !== null && typed === p.suggestion}
      changes={valid && typed !== p.current ? { height_cm: typed } : null}
      requestedGoal={p.requestedGoal}
      guard={p.guard}
    >
      <Field label={T.heightLabel} error={error}>
        <input
          inputMode="numeric"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
    </SettingEditor>
  );
}

/** Mode (§12.5) : la descente est un geste, hors ligne comprise ; la montée passe par l'écran de sécurité. */
function ModeSection(p: { view: NutritionView; minor: boolean; suggestion: NutritionMode | null }) {
  const repos = useRepos();
  const { mode } = p.view;
  const change = useAction((to: 'qualitative' | 'disabled') => repos.nutrition.setMode(to));
  const suggestedLabel =
    p.suggestion === 'qualitative'
      ? T.mode.toQualitative
      : p.suggestion === 'disabled'
        ? T.mode.toDisabled
        : null;
  return (
    <section className={styles.section} aria-labelledby="settings-mode">
      <h2 id="settings-mode">{T.mode.title}</h2>
      <p>{T.mode.current(NUTRITION_TEXTS.entry[mode])}</p>
      {p.view.descentPending ? <p className={styles.muted}>{T.mode.pending}</p> : null}
      {suggestedLabel ? <p className={styles.suggestion}>{T.suggestedMode(suggestedLabel)}</p> : null}
      {mode === 'full' ? (
        <Button variant="secondary" disabled={change.pending} onClick={() => void change.run('qualitative')}>
          {T.mode.toQualitative}
        </Button>
      ) : null}
      {mode !== 'disabled' ? (
        <Button variant="secondary" disabled={change.pending} onClick={() => void change.run('disabled')}>
          {T.mode.toDisabled}
        </Button>
      ) : p.minor ? (
        <Button disabled={change.pending} onClick={() => void change.run('qualitative')}>
          {NUTRITION_TEXTS.disabled.activateMinor}
        </Button>
      ) : (
        <Link href="/nutrition/start" className={styles.action}>
          {T.mode.activate}
        </Link>
      )}
      {!p.minor && mode === 'qualitative' ? (
        <>
          <p className={styles.muted}>{T.mode.rescreenUp}</p>
          <Link href={RESCREEN} className={styles.textLink}>
            {T.mode.rescreen}
          </Link>
        </>
      ) : null}
      {!p.minor && mode === 'full' && p.view.safetyPause ? (
        <>
          <p className={styles.muted}>{T.mode.rescreenPause}</p>
          <Link href={RESCREEN} className={styles.textLink}>
            {T.mode.rescreen}
          </Link>
        </>
      ) : null}
      {change.error ? (
        <p role="alert" className={styles.error}>
          {change.error}
        </p>
      ) : null}
    </section>
  );
}

/** « Supprimer mes données nutrition » : toujours là, confirmé dans une feuille du bas. */
function DeleteSection() {
  const repos = useRepos();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const remove = useAction(async () => {
    await repos.nutrition.deleteData();
    setOpen(false);
    navigate('/nutrition');
  });
  const close = () => {
    remove.reset();
    setOpen(false);
  };
  return (
    <section className={styles.section}>
      <Button variant="danger" onClick={() => setOpen(true)}>
        {T.delete.open}
      </Button>
      <BottomSheet
        open={open}
        onClose={close}
        title={T.delete.title}
        actions={
          <>
            <Button variant="danger" block disabled={remove.pending} onClick={() => void remove.run()}>
              {T.delete.confirm}
            </Button>
            <Button variant="secondary" block onClick={close}>
              {T.delete.cancel}
            </Button>
          </>
        }
      >
        <p>{T.delete.body}</p>
        {remove.error ? <p role="alert">{remove.error}</p> : null}
      </BottomSheet>
    </section>
  );
}

const asOption = <V,>(values: readonly V[], raw: string | null): V | null =>
  values.find((v) => String(v) === raw) ?? null;

/**
 * Réglages de la nutrition (spec brique 5 §12.5). Le mode et la suppression sont toujours là ; en mode complet,
 * objectif, niveau d'activité, sexe pour le calcul et taille, chacun avec l'aperçu de la nouvelle cible avant
 * « Enregistrer ». `?focus=goal|activity|sex|height|mode&suggest=…` (le coach) ouvre la section avec la valeur
 * présélectionnée et une ligne « Suggestion du coach ». Pendant une pause de sécurité, « perte » n'est pas proposé.
 */
export function SettingsPage() {
  const me = useMe();
  const view = useNutritionView();
  const [params] = useSearchParams();
  const { guard, sheet } = useWeighInGate();
  if (view === undefined) return null;
  const focus = params.get('focus');
  const suggest = params.get('suggest');
  const requestedGoal = view.settings?.goal ?? null;
  const goals = NUTRITION_GOALS.filter((g) => !(g === 'lose' && view.safetyPause));
  const goalSuggestion = focus === 'goal' ? asOption(goals, suggest) : null;
  const activitySuggestion = focus === 'activity' ? asOption<ActivityLevel>(ACTIVITY_LEVELS, suggest) : null;
  const sexSuggestion = focus === 'sex' ? asOption<SexForCalc>(SEX_FOR_CALC, suggest) : null;
  const heightSuggestion = focus === 'height' && /^\d{3}$/.test(suggest ?? '') ? Number(suggest) : null;
  const modeSuggestion =
    focus === 'mode' ? asOption<NutritionMode>(['qualitative', 'disabled'], suggest) : null;

  return (
    <Page title={T.title} back="/nutrition">
      <div className={`${styles.stack} stagger`}>
        <ModeSection view={view} minor={me?.ageBand === 'minor'} suggestion={modeSuggestion} />
        {view.mode === 'full' ? (
          <>
            <ChoiceSetting<NutritionGoal>
              title={SETUP.goalLegend}
              name="settings-goal"
              options={goals.map((g) => ({ value: g, label: SETUP.goals[g] }))}
              current={requestedGoal}
              suggestion={goalSuggestion}
              focused={focus === 'goal'}
              build={(goal) => ({ goal })}
              requestedGoal={requestedGoal}
              guard={guard}
            />
            <ChoiceSetting<ActivityLevel>
              title={SETUP.activityLegend}
              name="settings-activity"
              options={ACTIVITY_LEVELS.map((level) => ({ value: level, label: SETUP.activity[level] }))}
              current={view.settings?.activityLevel ?? null}
              suggestion={activitySuggestion}
              focused={focus === 'activity'}
              build={(activity_level) => ({ activity_level })}
              requestedGoal={requestedGoal}
              guard={guard}
            />
            <ChoiceSetting<SexForCalc>
              title={SETUP.sexLegend}
              name="settings-sex"
              options={[
                { value: 'male', label: SETUP.male },
                { value: 'female', label: SETUP.female },
                { value: 'unspecified', label: SETUP.unspecified },
              ]}
              current={view.settings?.sexForCalc ?? null}
              suggestion={sexSuggestion}
              focused={focus === 'sex'}
              build={(sex_for_calc) => ({ sex_for_calc })}
              requestedGoal={requestedGoal}
              guard={guard}
            />
            <HeightSetting
              current={view.settings?.heightCm ?? null}
              focused={focus === 'height'}
              suggestion={heightSuggestion}
              requestedGoal={requestedGoal}
              guard={guard}
            />
          </>
        ) : null}
        <DeleteSection />
      </div>
      {sheet}
    </Page>
  );
}
