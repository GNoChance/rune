import {
  type DraftSheet,
  EQUIPMENT_LABELS,
  EXERCISE_LEVELS,
  EXERCISE_NAME_MAX,
  ILLUSTRATION_ROLE_LABELS,
  ILLUSTRATION_ROLES,
  ILLUSTRATION_SOURCE_LABELS,
  ILLUSTRATION_SOURCES,
  type IllustrationEntry,
  type IllustrationRole,
  type IllustrationSource,
  JOINT_LABELS,
  JOINTS,
  LOAD_MODES,
  MEASURES,
  MECHANICS,
  MOVEMENT_PATTERN_LABELS,
  MOVEMENT_PATTERNS,
  MUSCLE_LABELS,
  MUSCLES,
  type ReviewSheetResponse,
  SAFETY_ENTRY_MAX,
} from '@rune/contracts';
import { type FormEvent, type ReactElement, type ReactNode, useId, useMemo, useRef, useState } from 'react';
import { useLive } from '../../app-services';
import { revisionConflictOf, transitionBlockersOf, useRepos } from '../../repos';
import { Banner, Button, errorMessage, Field, Page } from '../../ui';
import { levelText } from '../exercises/exercise-labels';
import styles from './review.module.css';
import { Loading } from './review-data';
import {
  blockerMessage,
  LOAD_MODE_LABELS,
  MEASURE_LABELS,
  MECHANICS_LABELS,
  STATUS_LABELS,
} from './review-labels';
import {
  adoptCurrent,
  conflictingKeys,
  currentValueText,
  EQUIPMENT_CHOICES,
  EQUIPMENT_OPTIONS,
  EQUIPMENT_PER_OPTION,
  type FormErrors,
  type FormKey,
  formErrors,
  formKeyLabel,
  formOf,
  type SheetForm,
  sheetOf,
} from './sheet-form';
import { useOnLostAccess } from './use-lost-access';

/** Saisie refusée par la validation côté client (spec brique 2 §4.5). */
export const INVALID_FORM_MESSAGE = 'La fiche ne passe pas la validation : corrige les champs signalés.';

/** Bornes des textes (04 §4), reprises par `maxLength` pour qu'une saisie trop longue ne parte pas. */
const MAX = {
  alias: 60,
  step: 160,
  keyPoint: 120,
  mistake: 160,
  breathing: 160,
  setup: 240,
  tip: 160,
  slug: 60,
};
const REVIEW_NOTES_MAX = 2000;

/** Positions des options de matériel et de leurs choix (cases fixes, jamais réordonnées). */
const OPTION_NUMBERS = Array.from({ length: EQUIPMENT_OPTIONS }, (_, i) => i);
const CHOICE_NUMBERS = Array.from({ length: EQUIPMENT_PER_OPTION }, (_, i) => i);

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('fr') + text.slice(1);

/** Ce qui accompagne un champ : son erreur, et après un 409 sa valeur courante à reprendre. */
type FieldState = { error?: string; note?: { text: string; label: string; onAdopt(): void } };

/** « Version courante : … » et « Reprendre », sous un champ dont la saisie diffère de la version courante. */
function CurrentNote(p: { id: string; text: string; label: string; onAdopt(): void }) {
  return (
    <div className={styles.currentNote}>
      <p id={p.id} className={styles.currentText}>{`Version courante : ${p.text}`}</p>
      <button
        type="button"
        className={styles.smallButton}
        aria-label={`Reprendre la version courante : ${p.label}`}
        onClick={p.onAdopt}
      >
        Reprendre
      </button>
    </div>
  );
}

/**
 * Champ simple (`Field`) : la note de version courante est son aide, donc sa description ; le champ est alors
 * marqué d'un trait (le texte dit seul ce qui se passe).
 */
function Single(p: FieldState & { label: string; help?: string; children: ReactElement }) {
  return (
    <div className={styles.formField} data-conflict={p.note ? '' : undefined}>
      <Field label={p.label} error={p.error} help={p.note ? `Version courante : ${p.note.text}` : p.help}>
        {p.children}
      </Field>
      {p.note ? (
        <button
          type="button"
          className={`${styles.smallButton} ${styles.adopt}`}
          aria-label={`Reprendre la version courante : ${p.note.label}`}
          onClick={p.note.onAdopt}
        >
          Reprendre
        </button>
      ) : null}
    </div>
  );
}

/** Groupe de champs (`fieldset`) : légende, aide, erreur, puis les champs ; la note de version courante en dernier. */
function Group(p: FieldState & { legend: string; help?: string; children: ReactNode }) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const noteId = `${id}-note`;
  const describedBy = [p.help ? helpId : null, p.error ? errorId : null, p.note ? noteId : null]
    .filter(Boolean)
    .join(' ');
  return (
    <fieldset className={styles.formGroup} aria-describedby={describedBy || undefined}>
      <legend className={styles.formLegend}>{p.legend}</legend>
      {p.help ? (
        <p id={helpId} className={styles.formHelp}>
          {p.help}
        </p>
      ) : null}
      {p.error ? (
        <p id={errorId} className={styles.formError}>
          {p.error}
        </p>
      ) : null}
      {p.children}
      {p.note ? <CurrentNote id={noteId} {...p.note} /> : null}
    </fieldset>
  );
}

/** Case à cocher libellée, cible de 44 px. */
function Check(p: { label: string; checked: boolean; onChange(checked: boolean): void }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
      <span>{p.label}</span>
    </label>
  );
}

/** Case à cocher seule (oui ou non), avec son erreur et sa note de version courante. */
function CheckField(p: FieldState & { label: string; checked: boolean; onChange(checked: boolean): void }) {
  const id = useId();
  const errorId = `${id}-error`;
  const noteId = `${id}-note`;
  const describedBy = [p.error ? errorId : null, p.note ? noteId : null].filter(Boolean).join(' ');
  return (
    <div className={styles.formField}>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={p.checked}
          aria-describedby={describedBy || undefined}
          aria-invalid={p.error ? true : undefined}
          onChange={(e) => p.onChange(e.target.checked)}
        />
        <span>{p.label}</span>
      </label>
      {p.error ? (
        <p id={errorId} className={styles.formError}>
          {p.error}
        </p>
      ) : null}
      {p.note ? <CurrentNote id={noteId} {...p.note} /> : null}
    </div>
  );
}

/** Cases à cocher d'une liste de codes : cocher ajoute à la fin, décocher retire (l'ordre de la fiche reste). */
function Checks<T extends string>(
  p: FieldState & {
    legend: string;
    codes: readonly T[];
    labels: Record<T, string>;
    values: readonly T[];
    onChange(values: T[]): void;
  },
) {
  return (
    <Group legend={p.legend} error={p.error} note={p.note}>
      <div className={styles.checkGrid}>
        {p.codes.map((code) => (
          <Check
            key={code}
            label={p.labels[code]}
            checked={p.values.includes(code)}
            onChange={(checked) =>
              p.onChange(checked ? [...p.values, code] : p.values.filter((value) => value !== code))
            }
          />
        ))}
      </div>
    </Group>
  );
}

/** Cases de texte d'une liste (étapes, points clés…), une par entrée ; une case vide est ignorée. */
function Slots(
  p: FieldState & {
    legend: string;
    slotLabel(index: number): string;
    values: readonly string[];
    maxLength: number;
    multiline?: boolean;
    onChange(values: string[]): void;
  },
) {
  const change = (index: number, value: string) =>
    p.onChange(p.values.map((current, i) => (i === index ? value : current)));
  return (
    <Group legend={p.legend} error={p.error} note={p.note}>
      {p.values.map((value, index) => (
        // Cases fixes : l'index est leur identité.
        // biome-ignore lint/suspicious/noArrayIndexKey: une case par position, jamais réordonnée
        <Field key={index} label={p.slotLabel(index)}>
          {p.multiline ? (
            <textarea
              rows={2}
              maxLength={p.maxLength}
              value={value}
              onChange={(e) => change(index, e.target.value)}
            />
          ) : (
            <input
              type="text"
              maxLength={p.maxLength}
              value={value}
              onChange={(e) => change(index, e.target.value)}
            />
          )}
        </Field>
      ))}
    </Group>
  );
}

const optionsOf = <T extends string>(codes: readonly T[], labels: Record<T, string>) =>
  codes.map((code) => (
    <option key={code} value={code}>
      {labels[code]}
    </option>
  ));

/**
 * Illustrations (04 §12, règle 4 : une seule source par fiche) : la source d'abord, puis un fichier par pose parmi
 * ceux de cette source dans le manifeste du catalogue local. Changer de source vide les poses. Un fichier de la
 * fiche absent du manifeste local reste proposé, signalé, jusqu'à ce qu'on le change.
 */
function IllustrationsField(
  p: FieldState & {
    value: SheetForm['illustrations'];
    manifest: readonly IllustrationEntry[];
    onChange(value: SheetForm['illustrations']): void;
  },
) {
  const known = new Map(p.manifest.map((entry) => [entry.id, entry]));
  const sources = ILLUSTRATION_SOURCES.filter(
    (source) => source === p.value.source || p.manifest.some((entry) => entry.source === source),
  );
  const files = p.manifest
    .filter((entry) => entry.source === p.value.source)
    .map((entry) => entry.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const changeSource = (source: IllustrationSource | '') => {
    const next = { ...p.value, source };
    for (const role of ILLUSTRATION_ROLES) {
      if (known.get(next[role])?.source !== source) next[role] = '';
    }
    p.onChange(next);
  };
  return (
    <Group
      legend="Illustrations"
      help="Une seule source par fiche : changer de source vide les poses."
      error={p.error}
      note={p.note}
    >
      <Field label="Source des illustrations">
        <select
          value={p.value.source}
          onChange={(e) => changeSource(e.target.value as IllustrationSource | '')}
        >
          <option value="">Aucune illustration</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {ILLUSTRATION_SOURCE_LABELS[source]}
            </option>
          ))}
        </select>
      </Field>
      {ILLUSTRATION_ROLES.map((role: IllustrationRole) => {
        const current = p.value[role];
        const unknown = current !== '' && !known.has(current);
        return (
          <Field key={role} label={capitalize(ILLUSTRATION_ROLE_LABELS[role])}>
            <select
              value={current}
              disabled={p.value.source === '' && current === ''}
              onChange={(e) => p.onChange({ ...p.value, [role]: e.target.value })}
            >
              <option value="">Aucune</option>
              {unknown ? <option value={current}>{`${current} (absente du manifeste)`}</option> : null}
              {files.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
        );
      })}
    </Group>
  );
}

/**
 * Matériel (04 §4) : jusqu'à 4 options, chacune jusqu'à 3 matériels à réunir ; l'option 1 sans matériel choisi
 * vaut « sans matériel » (`[[]]`), une option suivante vide est ignorée.
 */
function EquipmentField(
  p: FieldState & {
    value: SheetForm['equipment_options'];
    onChange(value: SheetForm['equipment_options']): void;
  },
) {
  const change = (option: number, slot: number, code: string) =>
    p.onChange(
      p.value.map((codes, i) =>
        i === option
          ? codes.map((current, j) => (j === slot ? (code as (typeof codes)[number]) : current))
          : codes,
      ),
    );
  return (
    <Group
      legend="Matériel"
      help="Chaque option liste le matériel à réunir ; la fiche est faisable avec l'une des options. Option 1 sans matériel choisi : exercice sans matériel."
      error={p.error}
      note={p.note}
    >
      {OPTION_NUMBERS.map((option) => (
        <div key={option} className={styles.equipmentOption}>
          {CHOICE_NUMBERS.map((slot) => (
            <Field key={slot} label={`Option ${option + 1}, matériel ${slot + 1}`}>
              <select
                value={p.value[option]?.[slot] ?? ''}
                onChange={(e) => change(option, slot, e.target.value)}
              >
                <option value="">Aucun</option>
                {optionsOf(EQUIPMENT_CHOICES, EQUIPMENT_LABELS)}
              </select>
            </Field>
          ))}
        </div>
      ))}
    </Group>
  );
}

/** Erreurs (04 §4) : jusqu'à 4 paires « Erreur n » et « Correction n » ; une paire vide est ignorée. */
function MistakesField(
  p: FieldState & { value: SheetForm['mistakes']; onChange(value: SheetForm['mistakes']): void },
) {
  const change = (index: number, part: 'mistake' | 'fix', text: string) =>
    p.onChange(p.value.map((m, i) => (i === index ? { ...m, [part]: text } : m)));
  return (
    <Group legend="Erreurs" error={p.error} note={p.note}>
      {p.value.map((m, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: une paire par position, jamais réordonnée
        <div key={index} className={styles.mistakePair}>
          <Field label={`Erreur ${index + 1}`}>
            <textarea
              rows={2}
              maxLength={MAX.mistake}
              value={m.mistake}
              onChange={(e) => change(index, 'mistake', e.target.value)}
            />
          </Field>
          <Field label={`Correction ${index + 1}`}>
            <textarea
              rows={2}
              maxLength={MAX.mistake}
              value={m.fix}
              onChange={(e) => change(index, 'fix', e.target.value)}
            />
          </Field>
        </div>
      ))}
    </Group>
  );
}

/**
 * Le formulaire, une fois le manifeste local lu. `base` : la version dont part l'enregistrement (révision envoyée,
 * champs système) ; après un 409, la version courante, et la saisie reste.
 */
function SheetEditor(p: {
  data: ReviewSheetResponse;
  manifest: readonly IllustrationEntry[];
  onSaved(next: ReviewSheetResponse): void;
  onCancel(): void;
}) {
  const repos = useRepos();
  const onLostAccess = useOnLostAccess();
  const manifestById = useMemo(() => new Map(p.manifest.map((entry) => [entry.id, entry])), [p.manifest]);
  const [base, setBase] = useState<DraftSheet>(p.data.sheet);
  const [form, setForm] = useState<SheetForm>(() => formOf(p.data.sheet, manifestById));
  const [errors, setErrors] = useState<FormErrors>({});
  const [conflict, setConflict] = useState<DraftSheet | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const formId = useId();

  const differing = conflict ? conflictingKeys(form, conflict) : [];
  const set = <K extends FormKey>(key: K, value: SheetForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  /** Erreur et note de version courante du champ `key`. */
  const state = (key: FormKey): FieldState => ({
    error: errors[key],
    note:
      conflict && differing.includes(key)
        ? {
            text: currentValueText(key, conflict),
            label: formKeyLabel(key),
            onAdopt: () => setForm((f) => adoptCurrent(f, key, conflict, manifestById)),
          }
        : undefined,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending.current) return;
    const found = formErrors(form, base);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFailure(INVALID_FORM_MESSAGE);
      return;
    }
    sending.current = true;
    setPending(true);
    setFailure(null);
    try {
      const next = await repos.review.save(base.id, {
        sheet: sheetOf(form, base),
        baseRevision: base.revision,
      });
      p.onSaved(next);
    } catch (err) {
      sending.current = false;
      setPending(false);
      if (onLostAccess(err)) return;
      const current = revisionConflictOf(err);
      if (current) {
        // Spec brique 2 §3.5 : la saisie reste, la version courante est écrite sous chaque champ qui diffère ;
        // le prochain enregistrement part d'elle.
        setConflict(current);
        setBase(current);
        return;
      }
      const blockers = transitionBlockersOf(err);
      setFailure(blockers ? blockers.map((b) => blockerMessage(b, 0)).join(' ') : errorMessage(err));
    }
  }

  return (
    <Page title={`Modifier « ${p.data.sheet.name} »`} back={p.onCancel}>
      <p className={styles.muted}>{`Version ${base.revision} · ${STATUS_LABELS[base.status]}`}</p>
      {base.status === 'published' ? (
        <p className={styles.muted}>
          Fiche publiée : les membres recevront la nouvelle version à leur prochaine synchronisation.
        </p>
      ) : null}
      {conflict ? (
        <Banner tone="warning">
          <p className={styles.bannerText}>La fiche a changé depuis que tu l'as ouverte.</p>
          <p className={styles.bannerText}>
            {`Version ${conflict.revision} enregistrée entre-temps. Ta saisie est gardée : compare-la à la version courante, écrite sous chaque champ qui diffère, puis enregistre.`}
          </p>
          {differing.length > 0 ? (
            <p className={styles.bannerText}>
              {`Champs qui diffèrent : ${differing.map(formKeyLabel).join(', ')}.`}
            </p>
          ) : null}
        </Banner>
      ) : null}
      <form id={formId} className={styles.editForm} noValidate onSubmit={(e) => void submit(e)}>
        <Single label="Nom" {...state('name')}>
          <input
            type="text"
            maxLength={EXERCISE_NAME_MAX}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </Single>
        <Single label="Lot" help="A, B, ou E1 à E99." {...state('batch')}>
          <input
            type="text"
            maxLength={3}
            autoCapitalize="characters"
            spellCheck={false}
            value={form.batch}
            onChange={(e) => set('batch', e.target.value)}
          />
        </Single>
        <Slots
          legend="Autres noms"
          slotLabel={(i) => `Autre nom ${i + 1}`}
          values={form.aliases}
          maxLength={MAX.alias}
          onChange={(v) => set('aliases', v)}
          {...state('aliases')}
        />
        <Single label="Type de mouvement" {...state('movement_pattern')}>
          <select
            value={form.movement_pattern}
            onChange={(e) => set('movement_pattern', e.target.value as SheetForm['movement_pattern'])}
          >
            {optionsOf(MOVEMENT_PATTERNS, MOVEMENT_PATTERN_LABELS)}
          </select>
        </Single>
        <Single label="Mécanique" {...state('mechanics')}>
          <select
            value={form.mechanics}
            onChange={(e) => set('mechanics', e.target.value as SheetForm['mechanics'])}
          >
            {optionsOf(MECHANICS, MECHANICS_LABELS)}
          </select>
        </Single>
        <CheckField
          label="Un côté à la fois"
          checked={form.unilateral}
          onChange={(v) => set('unilateral', v)}
          {...state('unilateral')}
        />
        <Single label="Mesure" {...state('measure')}>
          <select
            value={form.measure}
            onChange={(e) => set('measure', e.target.value as SheetForm['measure'])}
          >
            {optionsOf(MEASURES, MEASURE_LABELS)}
          </select>
        </Single>
        <Single label="Mode de charge" {...state('load_mode')}>
          <select
            value={form.load_mode}
            onChange={(e) => set('load_mode', e.target.value as SheetForm['load_mode'])}
          >
            {optionsOf(LOAD_MODES, LOAD_MODE_LABELS)}
          </select>
        </Single>
        <Checks
          legend="Muscles principaux"
          codes={MUSCLES}
          labels={MUSCLE_LABELS}
          values={form.primary_muscles}
          onChange={(v) => set('primary_muscles', v)}
          {...state('primary_muscles')}
        />
        <Checks
          legend="Muscles secondaires"
          codes={MUSCLES}
          labels={MUSCLE_LABELS}
          values={form.secondary_muscles}
          onChange={(v) => set('secondary_muscles', v)}
          {...state('secondary_muscles')}
        />
        <EquipmentField
          value={form.equipment_options}
          onChange={(v) => set('equipment_options', v)}
          {...state('equipment_options')}
        />
        <Single label="Niveau" {...state('level')}>
          <select
            value={String(form.level)}
            onChange={(e) => set('level', Number(e.target.value) as SheetForm['level'])}
          >
            {EXERCISE_LEVELS.map((level) => (
              <option key={level} value={String(level)}>
                {levelText(level)}
              </option>
            ))}
          </select>
        </Single>
        <CheckField
          label="Déconseillé aux mineurs"
          checked={form.not_for_minors}
          onChange={(v) => set('not_for_minors', v)}
          {...state('not_for_minors')}
        />
        <Checks
          legend="Articulations sollicitées"
          codes={JOINTS}
          labels={JOINT_LABELS}
          values={form.stressed_joints}
          onChange={(v) => set('stressed_joints', v)}
          {...state('stressed_joints')}
        />
        <Slots
          legend="Étapes"
          slotLabel={(i) => `Étape ${i + 1}`}
          values={form.instructions}
          maxLength={MAX.step}
          multiline
          onChange={(v) => set('instructions', v)}
          {...state('instructions')}
        />
        <Slots
          legend="Points clés"
          slotLabel={(i) => `Point clé ${i + 1}`}
          values={form.key_points}
          maxLength={MAX.keyPoint}
          multiline
          onChange={(v) => set('key_points', v)}
          {...state('key_points')}
        />
        <MistakesField value={form.mistakes} onChange={(v) => set('mistakes', v)} {...state('mistakes')} />
        <Slots
          legend="Sécurité"
          slotLabel={(i) => `Consigne de sécurité ${i + 1}`}
          values={form.safety}
          maxLength={SAFETY_ENTRY_MAX}
          multiline
          onChange={(v) => set('safety', v)}
          {...state('safety')}
        />
        <Single label="Respiration" {...state('breathing')}>
          <textarea
            rows={2}
            maxLength={MAX.breathing}
            value={form.breathing}
            onChange={(e) => set('breathing', e.target.value)}
          />
        </Single>
        <Single label="Réglage" {...state('setup')}>
          <textarea
            rows={3}
            maxLength={MAX.setup}
            value={form.setup}
            onChange={(e) => set('setup', e.target.value)}
          />
        </Single>
        {(['chain_id', 'easier_id', 'harder_id'] as const).map((key) => (
          <Single key={key} label={formKeyLabel(key)} {...state(key)}>
            <input
              type="text"
              maxLength={MAX.slug}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={form[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </Single>
        ))}
        {(['easier_tip', 'harder_tip'] as const).map((key) => (
          <Single key={key} label={formKeyLabel(key)} {...state(key)}>
            <textarea
              rows={2}
              maxLength={MAX.tip}
              value={form[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </Single>
        ))}
        <IllustrationsField
          value={form.illustrations}
          manifest={p.manifest}
          onChange={(v) => set('illustrations', v)}
          {...state('illustrations')}
        />
        <Single
          label="Notes pour la relecture"
          help="Doutes de la rédaction, jamais montrés aux membres."
          {...state('review_notes')}
        >
          <textarea
            rows={4}
            maxLength={REVIEW_NOTES_MAX}
            value={form.review_notes}
            onChange={(e) => set('review_notes', e.target.value)}
          />
        </Single>
        {failure ? <Banner tone="error">{failure}</Banner> : null}
        <div className={styles.formActions}>
          <Button type="submit" block disabled={pending}>
            Enregistrer
          </Button>
          <Button variant="secondary" block onClick={p.onCancel} disabled={pending}>
            Annuler
          </Button>
        </div>
      </form>
    </Page>
  );
}

/**
 * Formulaire d'édition de l'admin (spec brique 2 §4.5, 04 §8 : « formulaire champ par champ », choix des
 * illustrations limité à une source), sur la fiche lue par l'écran de relecture :
 * - champs de 04 §4 hors champs système, préremplis ; listes en cases fixes (le maximum de 04 §4) ;
 * - « Enregistrer » : validation côté client par le schéma du statut, un message sous chaque champ refusé ; puis
 *   `PUT` de la fiche entière (champs vidés omis, jamais `null`) avec la révision affichée ; la réponse devient la
 *   fiche de l'écran (`onSaved`) ;
 * - 409 : « La fiche a changé depuis que tu l'as ouverte. », saisie gardée, version courante sous chaque champ qui
 *   diffère (« Reprendre » la recopie), prochain envoi depuis elle (Review Focus 3) ;
 * - 422 `invalid_sheet` (règles entre fiches) : message du §3.6 ; hors ligne : « Nécessite le réseau ».
 */
export function EditSheetForm(p: {
  data: ReviewSheetResponse;
  onSaved(next: ReviewSheetResponse): void;
  onCancel(): void;
}) {
  const repos = useRepos();
  const manifest = useLive(() => repos.review.illustrationManifest(), [repos]);
  if (manifest === undefined) {
    return (
      <Page title={`Modifier « ${p.data.sheet.name} »`} back={p.onCancel}>
        <Loading />
      </Page>
    );
  }
  return <SheetEditor data={p.data} manifest={manifest} onSaved={p.onSaved} onCancel={p.onCancel} />;
}
