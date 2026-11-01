import {
  DUMBBELL_CHOICES_G,
  defaultLoadSettings,
  type GymDetail,
  type LoadSettings,
  LoadSettingsSchema,
} from '@rune/contracts';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { ApiError } from '../../api/client';
import { useLive } from '../../app-services';
import { useRepos } from '../../repos';
import {
  Banner,
  Button,
  Chips,
  errorMessage,
  Field,
  formatKg,
  formatKgValue,
  Page,
  plural,
  useAction,
} from '../../ui';
import { useFocusAboveDraftBar } from './EquipmentDraft';
import { GYM_DELETED_TEXT, GYM_RIGHTS_TEXT, OFFLINE_GYM_TEXT } from './GymPage';
import { CheckIcon, PlusIcon } from './icons';
import styles from './places.module.css';

/** Bornes de 02 §10.3, en grammes ; le message dit la même chose en kg. */
const BOUNDS = {
  barG: { min: 5000, max: 25000 },
  smallestPlateG: { min: 250, max: 5000 },
  machineStepG: { min: 500, max: 10000 },
} as const;

type NumericKey = keyof typeof BOUNDS;

const FIELDS: readonly { key: NumericKey; label: string; help: string }[] = [
  { key: 'barG', label: 'Barre (kg)', help: 'Le poids de la barre, sans disques.' },
  {
    key: 'smallestPlateG',
    label: 'Plus petit disque (kg)',
    help: "Le disque le plus léger que tu as, d'un seul côté.",
  },
  { key: 'machineStepG', label: 'Pas des machines (kg)', help: "L'écart entre deux crans de la pile." },
];

const rangeMessage = (key: NumericKey) =>
  `Entre ${formatKgValue(BOUNDS[key].min)} et ${formatKgValue(BOUNDS[key].max)} kg.`;

/** Grammes entiers d'une saisie en kg (virgule ou point, trois décimales au plus) ; null si illisible ou hors bornes. */
export function parseKg(text: string, key: NumericKey): number | null {
  const t = text.trim();
  if (!/^\d+([.,]\d{1,3})?$/.test(t)) return null;
  const grams = Math.round(Number(t.replace(',', '.')) * 1000);
  const { min, max } = BOUNDS[key];
  return grams >= min && grams <= max ? grams : null;
}

const EVEN_PRESET: readonly number[] = Array.from({ length: 20 }, (_, i) => 2000 * (i + 1));
const PRESETS = [
  { value: 'none', label: 'Aucun', grams: [] as readonly number[] },
  { value: 'even', label: '2 à 40 kg par 2 kg', grams: EVEN_PRESET },
] as const;

const sameList = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const sorted = (set: ReadonlySet<number>) => [...set].sort((a, b) => a - b);

type Texts = Record<NumericKey, string>;

const textsOf = (s: LoadSettings): Texts => ({
  barG: formatKgValue(s.barG),
  smallestPlateG: formatKgValue(s.smallestPlateG),
  machineStepG: formatKgValue(s.machineStepG),
});

/** Valeurs proposées à la coche : les choix courants et, s'il y en a, les haltères déjà notés hors de la liste. */
const choicesFor = (initial: readonly number[]) => sorted(new Set([...DUMBBELL_CHOICES_G, ...initial]));

function LoadForm(p: {
  initial: LoadSettings;
  editable: boolean;
  note: string | null;
  save(settings: LoadSettings): Promise<void>;
  onSaved(): void;
}) {
  const { initial } = p;
  const [texts, setTexts] = useState<Texts>(() => textsOf(initial));
  const [dumbbells, setDumbbells] = useState<ReadonlySet<number>>(() => new Set(initial.dumbbellsG));
  const [errors, setErrors] = useState<Partial<Record<NumericKey, string>>>({});
  const [choices] = useState(() => choicesFor(initial.dumbbellsG));
  const barRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const dumbbellsId = useId();

  const save = useAction(async () => {
    const next: Partial<LoadSettings> = { dumbbellsG: sorted(dumbbells) };
    const found: Partial<Record<NumericKey, string>> = {};
    for (const { key } of FIELDS) {
      const grams = parseKg(texts[key], key);
      if (grams === null) found[key] = rangeMessage(key);
      else next[key] = grams;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const parsed = LoadSettingsSchema.safeParse(next);
    if (!parsed.success) return;
    await p.save(parsed.data);
    p.onSaved();
  });

  const textChanges = FIELDS.filter(({ key }) => parseKg(texts[key], key) !== initial[key]).length;
  const initialSet = new Set(initial.dumbbellsG);
  const dumbbellChanges =
    [...dumbbells].filter((g) => !initialSet.has(g)).length +
    initial.dumbbellsG.filter((g) => !dumbbells.has(g)).length;
  const total = textChanges + dumbbellChanges;
  useFocusAboveDraftBar(barRef, total > 0);

  const current = sorted(dumbbells);
  const preset = PRESETS.find((x) => sameList(x.grams, current))?.value ?? null;

  function setText(key: NumericKey, value: string) {
    save.reset();
    setTexts((t) => ({ ...t, [key]: value }));
  }

  function toggle(grams: number) {
    save.reset();
    setDumbbells((s) => {
      const next = new Set(s);
      if (next.has(grams)) next.delete(grams);
      else next.add(grams);
      return next;
    });
  }

  function choose(value: string) {
    save.reset();
    const found = PRESETS.find((x) => x.value === value);
    if (found) setDumbbells(new Set(found.grams));
  }

  return (
    <div ref={formRef} className={`stagger ${styles.stack}`}>
      {p.note ? <p className={styles.hint}>{p.note}</p> : null}
      <section aria-labelledby={titleId} className={`${styles.card} ${styles.form}`}>
        <h2 id={titleId} className={styles.cardTitle}>
          Barre, disques et machines
        </h2>
        {FIELDS.map(({ key, label, help }) => (
          <Field key={key} label={label} help={help} error={errors[key] ?? null}>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={texts[key]}
              disabled={!p.editable || save.pending}
              onChange={(e) => setText(key, e.target.value)}
            />
          </Field>
        ))}
      </section>
      <section aria-labelledby={dumbbellsId} className={styles.card}>
        <h2 id={dumbbellsId} className={styles.cardTitle}>
          Haltères
        </h2>
        <p className={styles.hint}>Coche les paires que tu as sous la main.</p>
        <Chips
          name="dumbbell-preset"
          legend="Préréglage"
          options={PRESETS.map(({ value, label }) => ({
            value,
            label,
            disabled: !p.editable || save.pending,
          }))}
          value={preset}
          onChange={choose}
        />
        <fieldset className={styles.loadChips}>
          <legend className={styles.srOnly}>Haltères disponibles</legend>
          {choices.map((grams) => {
            const checked = dumbbells.has(grams);
            return (
              <label
                key={grams}
                className={styles.toggleChip}
                data-dirty={checked !== initialSet.has(grams) ? '' : undefined}
              >
                <input
                  type="checkbox"
                  className={styles.toggleChipInput}
                  checked={checked}
                  disabled={!p.editable || save.pending}
                  onChange={() => toggle(grams)}
                />
                <span className={styles.toggleChipGlyph} aria-hidden="true">
                  {checked ? <CheckIcon /> : <PlusIcon size={15} />}
                </span>
                {formatKg(grams)}
              </label>
            );
          })}
        </fieldset>
      </section>
      {p.editable && total > 0 ? (
        <section ref={barRef} aria-label="Changements à enregistrer" className={styles.draftBar}>
          {save.error ? <Banner tone="error">{save.error}</Banner> : null}
          <p role="status" className={styles.draftSummary}>
            <span className={styles.draftDot} aria-hidden="true" />
            <span>
              <strong
                className={styles.draftTotal}
              >{`${total} ${plural(total, 'changement', 'changements')}`}</strong>
            </span>
          </p>
          <div className={styles.draftActions}>
            <Button
              variant="secondary"
              disabled={save.pending}
              onClick={() => {
                save.reset();
                setErrors({});
                setTexts(textsOf(initial));
                setDumbbells(new Set(initial.dumbbellsG));
                formRef.current?.querySelector('input')?.focus();
              }}
            >
              Annuler
            </Button>
            <Button disabled={save.pending} onClick={() => void save.run()}>
              Enregistrer
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Screen(p: { subtitle?: string; back: string; children: React.ReactNode }) {
  return (
    <Page title="Réglages de charge" back={p.back}>
      {p.subtitle ? <p className={styles.subtitle}>{p.subtitle}</p> : null}
      {p.children}
    </Page>
  );
}

/**
 * Réglages de charge d'une maison (`/places/:id/load`) : barre, plus petit disque, pas des machines et haltères,
 * en brouillon (« Enregistrer » / « Annuler », refonte §10.3). Un lieu de type salle n'a pas de réglages à lui
 * (R-CHG-3) : on passe à ceux de sa salle. Écrire demande le réseau.
 */
export function PlaceLoadSettings(p: { params: { id: string } }) {
  const repos = useRepos();
  const [, navigate] = useLocation();
  const id = p.params.id;
  const places = useLive(() => repos.places.list(), [repos]);
  if (places === undefined) return null;
  const place = places.find((pl) => pl.id === id);
  if (place?.kind === 'gym' && place.gymId) return <Redirect to={`/gyms/${place.gymId}/load`} replace />;
  if (place?.kind !== 'home') {
    return (
      <Page title="Lieu" back="/places">
        <p>Lieu introuvable.</p>
      </Page>
    );
  }
  const back = `/places/${place.id}`;
  return (
    <Screen subtitle={place.name} back={back}>
      <LoadForm
        initial={place.loadSettings ?? defaultLoadSettings('home')}
        editable
        note={null}
        save={(loadSettings) => repos.places.update(place.id, { loadSettings })}
        onSaved={() => navigate(back, { replace: true })}
      />
    </Screen>
  );
}

/**
 * Réglages de charge d'une salle (`/gyms/:id/load`), partagés avec son cercle : mêmes champs, enregistrés sur la
 * salle (l'historique note « Réglages de charge modifiés »). Modifiables par les membres qui l'ont parmi leurs
 * lieux et les admins (R-SAL-4), en ligne ; sinon en lecture seule.
 */
export function GymLoadSettings(p: { params: { id: string } }) {
  const repos = useRepos();
  const [, navigate] = useLocation();
  const id = p.params.id;
  const [state, setState] = useState<{
    loaded: { detail: GymDetail; offline: boolean } | null;
    error: string | null;
    retry: boolean;
  }>({
    loaded: null,
    error: null,
    retry: false,
  });
  const reads = useRef(0);

  const load = useCallback(async () => {
    const read = ++reads.current;
    try {
      const loaded = await repos.gyms.detail(id);
      if (read === reads.current) setState({ loaded, error: null, retry: false });
    } catch (error) {
      if (read !== reads.current) return;
      const retry = !(error instanceof ApiError && error.code === 'not_found');
      setState((s) => ({ ...s, error: errorMessage(error, { not_found: 'Salle introuvable.' }), retry }));
    }
  }, [repos, id]);

  useEffect(() => {
    void load();
    return () => {
      reads.current += 1;
    };
  }, [load]);

  const back = `/gyms/${id}`;
  if (!state.loaded) {
    return state.error ? (
      <Page title="Réglages de charge" back="/places">
        <Banner tone="error">{state.error}</Banner>
        {state.retry ? (
          <Button variant="secondary" onClick={() => void load()}>
            Réessayer
          </Button>
        ) : null}
      </Page>
    ) : null;
  }
  const { detail, offline } = state.loaded;
  const deleted = detail.deletedAt !== null;
  const editable = detail.canEdit && !offline && !deleted;
  const note = deleted
    ? GYM_DELETED_TEXT
    : offline
      ? OFFLINE_GYM_TEXT
      : detail.canEdit
        ? null
        : GYM_RIGHTS_TEXT;
  return (
    <Screen subtitle={detail.name} back={back}>
      <LoadForm
        initial={detail.loadSettings}
        editable={editable}
        note={note}
        save={(loadSettings) => repos.gyms.update(id, { loadSettings })}
        onSaved={() => navigate(back, { replace: true })}
      />
    </Screen>
  );
}
