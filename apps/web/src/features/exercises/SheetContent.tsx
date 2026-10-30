import {
  type CommentPart,
  type DraftSheet,
  type EquipmentCode,
  type ExerciseLevel,
  ILLUSTRATION_ROLE_LABELS,
  MUSCLE_LABELS,
} from '@rune/contracts';
import { illustrationCreditLine } from '@rune/domain';
import { type ReactNode, useId, useState } from 'react';
import { Link } from 'wouter';
import type { SheetIllustration } from '../../repos';
import { Tabs } from '../../ui';
import { equipmentText, levelText, shownEquipmentOption } from './exercise-labels';
import styles from './exercises.module.css';

/*
 * Rendu d'une fiche d'exercice (spec brique 2 §4.2), commun à la fiche du membre et à l'aperçu de la relecture
 * (spec brique 2 §4.5) : pastilles, illustrations et crédits, onglets Comment faire · Erreurs · Variantes, encadré
 * Sécurité. Les composants lisent une fiche servie comme un brouillon de relecture, dont les champs IA peuvent
 * manquer. `partAction` (relecture seulement) pose un contenu sous chaque partie ; sans elle, rien ne change.
 */

/** Onglets de la fiche, dans l'ordre ; leur code est la valeur de `?tab=`. */
export const SHEET_TABS = [
  { id: 'how', label: 'Comment faire' },
  { id: 'mistakes', label: 'Erreurs' },
  { id: 'variants', label: 'Variantes' },
] as const;

export type SheetTab = (typeof SHEET_TABS)[number]['id'];

/** Onglet de `?tab=` : `how`, `mistakes` ou `variants` ; absent ou inconnu → Comment faire. */
export function sheetTabOf(value: string | null | undefined): SheetTab {
  return SHEET_TABS.find((t) => t.id === value)?.id ?? 'how';
}

/**
 * Contenu posé sous une partie de la fiche (aperçu de relecture : ses commentaires et « Commenter »), ou rien
 * (`null`). Absente (fiche du membre), le rendu reste exactement celui de la vue membre.
 */
export type PartAction = (part: CommentPart) => ReactNode;

/** Ce que le rendu lit d'une fiche : une `ServedSheet` convient, un `DraftSheet` de la relecture aussi. */
export type SheetFields = Pick<
  DraftSheet,
  | 'name'
  | 'level'
  | 'primary_muscles'
  | 'equipment_options'
  | 'instructions'
  | 'key_points'
  | 'mistakes'
  | 'safety'
  | 'breathing'
  | 'setup'
>;

function Icon(p: { size?: number; children: ReactNode }) {
  const size = p.size ?? 20;
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {p.children}
    </svg>
  );
}

/** Bouclier marqué d'un point d'exclamation : l'icône de l'encadré Sécurité (le titre le nomme). */
function ShieldIcon() {
  return (
    <Icon>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6z" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </Icon>
  );
}

function CrossIcon() {
  return (
    <Icon size={18}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

function CheckIcon() {
  return (
    <Icon size={18}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}

/** Trois barres, autant de pleines que le niveau ; décoratives (le texte du niveau les accompagne). */
export function LevelBars(p: { level: ExerciseLevel }) {
  return (
    <span className={styles.levelBars} aria-hidden="true">
      {[1, 2, 3].map((n) => (
        <span key={n} className={styles.levelBar} data-filled={n <= p.level ? '' : undefined} />
      ))}
    </span>
  );
}

/**
 * Pastilles de l'en-tête (spec brique 2 §4.2) : niveau (« Niveau 1 sur 3, débutant »), muscles principaux, puis le
 * matériel de la première option faisable au lieu principal (`equipment`, déjà étendu ; null sans lieu).
 */
export function SheetPills(p: {
  sheet: Pick<DraftSheet, 'level' | 'primary_muscles' | 'equipment_options'>;
  equipment: ReadonlySet<EquipmentCode> | null;
}) {
  const option = shownEquipmentOption(p.sheet.equipment_options, p.equipment);
  return (
    <ul aria-label="Caractéristiques de l'exercice" className={styles.pills}>
      <li className={styles.pill}>
        <LevelBars level={p.sheet.level} />
        {levelText(p.sheet.level)}
      </li>
      {(p.sheet.primary_muscles ?? []).map((muscle) => (
        <li key={muscle} className={styles.pill}>
          {MUSCLE_LABELS[muscle]}
        </li>
      ))}
      <li className={styles.pill}>{equipmentText(option)}</li>
    </ul>
  );
}

/**
 * Illustrations de la fiche (04 §12) : les poses côte à côte sur une carte claire, même en sombre, chacune par
 * `<img>` avec « <nom> : position de départ » (de milieu, de fin) en texte alternatif ; puis la ligne de crédit de
 * chaque source affichée et le lien vers Crédits. Sans illustration : rien (ni carte ni crédit). Une pose dont
 * l'entrée manque en local, ou dont l'image ne se charge pas (pas encore en cache, hors ligne), laisse la place à
 * « Illustration disponible après synchronisation ».
 */
export function SheetIllustrations(p: { name: string; illustrations: readonly SheetIllustration[] }) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  if (p.illustrations.length === 0) return null;
  const shown = (i: SheetIllustration) => i.entry !== null && !failed.has(i.illustration_id);
  // Une source par fiche (04 §12, règle 4) : une ligne par crédit distinct, souvent une seule.
  const credits = [
    ...new Set(
      p.illustrations.flatMap((i) => (i.entry && shown(i) ? [illustrationCreditLine(i.entry)] : [])),
    ),
  ];
  return (
    <div className={styles.illustrations}>
      <div className={styles.illustrationCard}>
        {p.illustrations.map((i) =>
          i.entry && shown(i) ? (
            <img
              key={i.illustration_id}
              src={`/illustrations/${i.entry.file}`}
              alt={`${p.name} : ${ILLUSTRATION_ROLE_LABELS[i.role]}`}
              decoding="async"
              className={styles.illustration}
              onError={() => setFailed((prev) => new Set(prev).add(i.illustration_id))}
            />
          ) : (
            <p key={i.illustration_id} className={styles.illustrationPending}>
              Illustration disponible après synchronisation
            </p>
          ),
        )}
      </div>
      {credits.length > 0 ? (
        <div className={styles.credits}>
          {credits.map((line) => (
            <p key={line} className={styles.creditLine}>
              {line}
            </p>
          ))}
          <Link href="/credits" className={styles.creditsLink}>
            Crédits des illustrations
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Encadré « Sécurité » (spec brique 2 §4.2) : titre et icône (jamais la couleur seule), puis chaque entrée de
 * `safety`. Placé en tête de chaque onglet, juste sous la barre d'onglets.
 */
export function SafetyBox(p: { safety: readonly string[] | undefined }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.safety}>
      <h2 id={titleId} className={styles.safetyTitle}>
        <ShieldIcon />
        Sécurité
      </h2>
      <ul className={styles.safetyList}>
        {(p.safety ?? []).map((entry, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: textes sans identifiant (un brouillon peut en répéter un), lus dans l'ordre de la fiche
          <li key={i}>{entry}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Section titrée d'un onglet (titre de niveau 2 sous le nom de la fiche), puis `action` s'il y en a une
 * (relecture : les commentaires de la partie et « Commenter »).
 */
export function SheetPart(p: { title: string; action?: ReactNode; children(titleId: string): ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.part}>
      <h2 id={titleId} className={styles.partTitle}>
        {p.title}
      </h2>
      {p.children(titleId)}
      {p.action}
    </section>
  );
}

/**
 * Comment faire (spec brique 2 §4.2) : étapes numérotées, points clés, respiration, puis le réglage s'il existe ;
 * `partAction` sous chacune de ces parties (`instructions`, `key_points`, `breathing`, `setup`).
 */
export function HowToPanel(p: {
  sheet: Pick<DraftSheet, 'instructions' | 'key_points' | 'breathing' | 'setup'>;
  partAction?: PartAction;
}) {
  const { sheet, partAction } = p;
  return (
    <>
      <SheetPart title="Étapes" action={partAction?.('instructions')}>
        {(id) => (
          <ol aria-labelledby={id} className={styles.steps}>
            {(sheet.instructions ?? []).map((step, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: étapes sans identifiant, dans l'ordre de la fiche
              <li key={i}>{step}</li>
            ))}
          </ol>
        )}
      </SheetPart>
      <SheetPart title="Points clés" action={partAction?.('key_points')}>
        {(id) => (
          <ul aria-labelledby={id} className={styles.keyPoints}>
            {(sheet.key_points ?? []).map((point, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: points sans identifiant, dans l'ordre de la fiche
              <li key={i}>{point}</li>
            ))}
          </ul>
        )}
      </SheetPart>
      {sheet.breathing !== undefined ? (
        <SheetPart title="Respiration" action={partAction?.('breathing')}>
          {() => <p className={styles.partText}>{sheet.breathing}</p>}
        </SheetPart>
      ) : null}
      {sheet.setup !== undefined ? (
        <SheetPart title="Réglage" action={partAction?.('setup')}>
          {() => <p className={styles.partText}>{sheet.setup}</p>}
        </SheetPart>
      ) : null}
    </>
  );
}

/**
 * Erreurs (spec brique 2 §4.2) : chaque erreur (✕) puis sa correction (✓), dessinées et tues ; les lecteurs
 * d'écran entendent à la place les préfixes « Erreur : » et « Correction : ».
 */
export function MistakesPanel(p: { mistakes: DraftSheet['mistakes'] }) {
  return (
    <ul aria-label="Erreurs et corrections" className={styles.mistakes}>
      {(p.mistakes ?? []).map((m, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: erreurs sans identifiant, dans l'ordre de la fiche
        <li key={i} className={styles.mistake}>
          <p className={styles.mistakeLine}>
            <span className={styles.mistakeIcon}>
              <CrossIcon />
            </span>
            <span>
              <span className={styles.srOnly}>Erreur : </span>
              {m.mistake}
            </span>
          </p>{' '}
          <p className={styles.fixLine}>
            <span className={styles.fixIcon}>
              <CheckIcon />
            </span>
            <span>
              <span className={styles.srOnly}>Correction : </span>
              {m.fix}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Onglets de la fiche (motif de l'ARIA APG, `Tabs`) : l'encadré Sécurité en tête de chaque panneau, puis Comment
 * faire, Erreurs, ou `variants` (les variantes du membre, ou celles de l'aperçu de relecture). `tabLabels`
 * remplace un libellé (« Erreurs · 1 commentaire » en relecture). `partAction` (relecture) : contenu posé sous
 * l'encadré Sécurité (`safety`), sous chaque partie de Comment faire et sous les erreurs (`mistakes`) ; celui des
 * variantes (`variants`) revient à l'appelant, dans `variants`.
 */
export function SheetTabs(p: {
  sheet: SheetFields;
  tab: SheetTab;
  onTabChange(tab: SheetTab): void;
  variants: ReactNode;
  tabLabels?: Partial<Record<SheetTab, string>>;
  partAction?: PartAction;
}) {
  const tabs = SHEET_TABS.map((t) => ({ id: t.id, label: p.tabLabels?.[t.id] ?? t.label }));
  return (
    <Tabs
      label="Contenu de la fiche"
      tabs={tabs}
      value={p.tab}
      onChange={(id) => p.onTabChange(sheetTabOf(id))}
    >
      {(id) => (
        <div className={styles.panel}>
          <SafetyBox safety={p.sheet.safety} />
          {p.partAction?.('safety')}
          {id === 'how' ? <HowToPanel sheet={p.sheet} partAction={p.partAction} /> : null}
          {id === 'mistakes' ? (
            <>
              <MistakesPanel mistakes={p.sheet.mistakes} />
              {p.partAction?.('mistakes')}
            </>
          ) : null}
          {id === 'variants' ? p.variants : null}
        </div>
      )}
    </Tabs>
  );
}
