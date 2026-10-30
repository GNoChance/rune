import type {
  CommentPart,
  DraftSheet,
  ReviewCommentView,
  ReviewQueue,
  ReviewSheetResponse,
} from '@rune/contracts';
import { JOINT_LABELS, MUSCLE_LABELS } from '@rune/contracts';
import { isHealthReviewer } from '@rune/domain';
import { type ReactNode, useCallback, useId, useState } from 'react';
import { Link, useSearchParams } from 'wouter';
import { ApiError } from '../../api/client';
import { useLive, useMeState } from '../../app-services';
import { commentDraft, sheetIllustrations, useRepos } from '../../repos';
import { Badge, Banner, Button, errorMessage, Page, plural } from '../../ui';
import { equipmentText, levelText } from '../exercises/exercise-labels';
import {
  SHEET_TABS,
  SheetIllustrations,
  SheetPart,
  SheetPills,
  type SheetTab,
  SheetTabs,
  sheetTabOf,
} from '../exercises/SheetContent';
import { AdminSheetTools, ValidationsSection } from './AdminSheetTools';
import { CommentSheet } from './CommentSheet';
import { EditSheetForm } from './EditSheetForm';
import { PartComments } from './PartComments';
import styles from './review.module.css';
import { LoadFailure, Loading, useReviewData } from './review-data';
import {
  type AdminFilters,
  adminFiltersOf,
  fieldLabel,
  fieldValueText,
  GREEN_LIGHT_LABELS,
  type ListFilter,
  listFilterOf,
  NO_ADMIN_FILTERS,
  type Pill,
  reviewListPath,
  reviewSheetPath,
  STATUS_LABELS,
  STATUS_TONES,
} from './review-labels';
import { useOnLostAccess } from './use-lost-access';
import { ValidateSheet } from './ValidateSheet';

/** Titre de la page tant que la fiche n'est pas lue, ou si elle est introuvable. */
const LOADING_TITLE = 'Fiche à relire';

/** Parties de chaque onglet, comptées dans son libellé ; Sécurité, en tête des trois, n'est comptée dans aucun. */
const TAB_PARTS: Record<SheetTab, readonly CommentPart[]> = {
  how: ['instructions', 'key_points', 'breathing', 'setup'],
  mistakes: ['mistakes'],
  variants: ['variants'],
};

/** On valide une fiche relue ou publiée (spec brique 2 §3.2) ; on commente tout sauf une fiche retirée (§3.3). */
const VALIDATABLE: readonly DraftSheet['status'][] = ['reviewed', 'published'];

/** « Comment faire · 2 commentaires », « Erreurs · 1 commentaire » ; sans commentaire ouvert, le libellé seul. */
export function tabLabelsOf(comments: readonly ReviewCommentView[]): Record<SheetTab, string> {
  const labels = {} as Record<SheetTab, string>;
  for (const tab of SHEET_TABS) {
    const n = comments.filter((c) => c.resolvedAt === null && TAB_PARTS[tab.id].includes(c.part)).length;
    labels[tab.id] = n === 0 ? tab.label : `${tab.label} · ${n} ${plural(n, 'commentaire', 'commentaires')}`;
  }
  return labels;
}

/** Pastilles de l'en-tête : statut, version, puis « Validée par toi », « À revalider », « Prête à publier ». */
function statePills(data: ReviewSheetResponse): Pill[] {
  const has = (q: ReviewQueue) => data.queues.includes(q);
  return [
    { text: STATUS_LABELS[data.sheet.status], tone: STATUS_TONES[data.sheet.status] },
    { text: `Version ${data.sheet.revision}`, tone: 'muted' },
    ...(data.validatedByMe ? [{ text: 'Validée par toi', tone: 'success' } as const] : []),
    ...(has('revalidate') ? [{ text: 'À revalider', tone: 'warning' } as const] : []),
    ...(has('ready_to_publish') ? [{ text: 'Prête à publier', tone: 'success' } as const] : []),
  ];
}

/** Liste lisible : `labels` jointes, « aucune » si vide, `missing` si le champ n'est pas encore rédigé. */
const listText = (labels: readonly string[] | undefined, none: string, missing: string) =>
  labels === undefined ? missing : labels.length === 0 ? none : labels.join(', ');

/** Une ligne de faits : sa ou ses valeurs en clair (`data-fact`), puis les commentaires de sa partie. */
function Fact(p: { lines: readonly string[]; action: ReactNode }) {
  return (
    <li className={styles.fact}>
      {p.lines.map((line) => (
        <p key={line} data-fact="" className={styles.factText}>
          {line}
        </p>
      ))}
      {p.action}
    </li>
  );
}

/** Section titrée de l'écran de relecture (titre de niveau 2). */
function Section(p: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.section}>
      <h2 id={titleId} className={styles.sectionTitle}>
        {p.title}
      </h2>
      {p.children}
    </section>
  );
}

/**
 * Ce qui a changé depuis la validation de l'appelant (spec brique 2 §3.2 ; pour l'admin, depuis le dernier feu
 * vert santé qui compte encore) : chaque clé de contenu changée, avant puis maintenant. Rien sans validation
 * (`diff` null) ni sans changement (`[]`).
 */
function Changes(p: { data: ReviewSheetResponse; admin: boolean }) {
  const { diff, diffBase, sheet } = p.data;
  if (!diff || diff.length === 0 || !diffBase) return null;
  const current = sheet as Record<string, unknown>;
  return (
    <Section title={p.admin ? 'Modifié depuis le dernier feu vert santé' : 'Modifié depuis ta validation'}>
      <p className={styles.muted}>
        {p.admin
          ? `Feu vert santé sur la version ${diffBase.revision}, version ${sheet.revision} affichée.`
          : `Version ${diffBase.revision} validée, version ${sheet.revision} affichée.`}
      </p>
      <ul className={styles.diffList}>
        {diff.map((key) => (
          <li key={key} className={styles.diffItem}>
            <p className={styles.diffKey}>{fieldLabel(key)}</p>
            <p className={styles.diffLine}>{`Avant : ${fieldValueText(key, diffBase.values[key])}`}</p>
            <p className={styles.diffLine}>{`Maintenant : ${fieldValueText(key, current[key])}`}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Variante plus facile ou plus dure de l'aperçu : le conseil, puis la fiche voisine de la chaîne (sa relecture). */
function VariantStep(p: {
  title: string;
  tip?: string;
  neighborId?: string;
  filter: ListFilter;
  adminFilters: AdminFilters;
}) {
  if (p.tip === undefined && p.neighborId === undefined) return null;
  return (
    <SheetPart title={p.title}>
      {() => (
        <>
          {p.tip !== undefined ? <p className={styles.partText}>{p.tip}</p> : null}
          {p.neighborId !== undefined ? (
            <Link href={reviewSheetPath(p.neighborId, p.filter, p.adminFilters)} className={styles.textLink}>
              {`Voir la fiche ${p.neighborId}`}
            </Link>
          ) : null}
        </>
      )}
    </SheetPart>
  );
}

/** Onglet Variantes de l'aperçu : conseils et voisins de chaîne de la fiche, puis les commentaires `variants`. */
function ReviewVariants(p: {
  sheet: DraftSheet;
  filter: ListFilter;
  adminFilters: AdminFilters;
  action: ReactNode;
}) {
  const { sheet } = p;
  const empty =
    sheet.easier_tip === undefined &&
    sheet.easier_id === undefined &&
    sheet.harder_tip === undefined &&
    sheet.harder_id === undefined;
  return (
    <>
      <VariantStep
        title="Plus facile"
        tip={sheet.easier_tip}
        neighborId={sheet.easier_id}
        filter={p.filter}
        adminFilters={p.adminFilters}
      />
      <VariantStep
        title="Plus difficile"
        tip={sheet.harder_tip}
        neighborId={sheet.harder_id}
        filter={p.filter}
        adminFilters={p.adminFilters}
      />
      {empty ? <p className={styles.partText}>Aucune variante pour l'instant.</p> : null}
      {p.action}
    </>
  );
}

/**
 * Fiche lue : en-tête d'état, bandeaux, différentiel, notes, aperçu de la vue membre (pastilles, illustrations,
 * onglets avec l'encadré Sécurité), valeurs de la sensibilité et caractéristiques en clair, « Commenter » sous
 * chaque partie, commentaires sur toute la fiche, puis la validation.
 */
function SheetScreen(p: {
  data: ReviewSheetResponse;
  meId: string;
  admin: boolean;
  health: boolean;
  filter: ListFilter;
  adminFilters: AdminFilters;
  reload(): Promise<void>;
  reloadError: unknown;
  /** Réponse d'une écriture de l'admin : elle devient la fiche affichée. */
  onUpdate(next: ReviewSheetResponse): void;
  /** Message d'une écriture réussie (« Version 5 enregistrée. »), affiché en tête. */
  notice: string | null;
  onNotice(text: string | null): void;
  onEdit(): void;
}) {
  const { data, filter, adminFilters } = p;
  const { sheet } = data;
  const repos = useRepos();
  const onLostAccess = useOnLostAccess();
  const [params, setParams] = useSearchParams();
  const tab = sheetTabOf(params.get('tab'));
  const [commenting, setCommenting] = useState<CommentPart | null>(null);
  const [validating, setValidating] = useState(false);
  /** Fiche changée entre-temps (409), pendant une validation ou un changement de statut de l'admin. */
  const [conflict, setConflict] = useState<'validate' | 'transition' | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draftPart, setDraftPart] = useState<CommentPart | null>(
    () => commentDraft.get(p.meId, sheet.id)?.part ?? null,
  );
  const illustrationIds = (sheet.illustrations ?? []).map((i) => i.illustration_id);
  const entries = useLive(
    () => repos.catalog.illustrationEntries(illustrationIds),
    [repos, illustrationIds.join()],
  );

  const canComment = sheet.status !== 'retired';
  const canValidate = VALIDATABLE.includes(sheet.status) && !data.validatedByMe;
  const validateLabel = p.health ? 'Sécurité vérifiée' : p.admin ? "J'ai relu" : "J'ai relu, rien à redire";

  const changeTab = (next: SheetTab) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set('tab', next);
        return out;
      },
      { replace: true },
    );

  async function resolve(comment: ReviewCommentView) {
    setResolving(comment.id);
    setActionError(null);
    try {
      await repos.review.resolve(comment.id);
      await p.reload();
    } catch (e) {
      if (onLostAccess(e)) return;
      setActionError(errorMessage(e));
    } finally {
      setResolving(null);
    }
  }

  const partAction = (part: CommentPart) => (
    <PartComments
      part={part}
      comments={data.comments.filter((c) => c.part === part)}
      canComment={canComment}
      hasDraft={draftPart === part}
      // Spec brique 2 §3.1 : la relectrice marque traités les siens, l'admin tous.
      canResolve={(c) => c.resolvedAt === null && (c.mine || p.admin)}
      resolving={resolving}
      onComment={setCommenting}
      onResolve={(c) => void resolve(c)}
    />
  );

  const sensitivity = sheet.stressed_joints?.map((j) => JOINT_LABELS[j]);
  const manifestIds = entries ? new Set(entries.keys()) : undefined;
  const generalComments = data.comments.filter((c) => c.part === 'general');

  return (
    <Page title={sheet.name} back={reviewListPath(filter, adminFilters)}>
      <ul aria-label="État de la fiche" className={styles.pillRow}>
        {statePills(data).map((pill) => (
          <li key={pill.text}>
            <Badge tone={pill.tone}>{pill.text}</Badge>
          </li>
        ))}
      </ul>
      {p.notice ? <Banner tone="info">{p.notice}</Banner> : null}
      {p.admin && data.queues.includes('revalidate') ? (
        // Spec brique 2 §3.6 : fiche publiée sensible dont le feu vert santé n'est plus à jour.
        <Banner tone="warning">Publiée, feu vert santé à refaire</Banner>
      ) : null}
      {conflict ? (
        <Banner tone="warning">
          <p className={styles.bannerText}>La fiche a changé depuis que tu l'as ouverte.</p>
          <p className={styles.bannerText}>
            {conflict === 'validate'
              ? `Version ${sheet.revision} affichée : relis-la avant de valider.`
              : `Version ${sheet.revision} affichée : relis-la avant de changer son statut.`}
          </p>
        </Banner>
      ) : null}
      {p.reloadError !== null ? (
        <LoadFailure message={errorMessage(p.reloadError)} onRetry={() => void p.reload()} />
      ) : null}
      {actionError ? <Banner tone="error">{actionError}</Banner> : null}
      <Changes data={data} admin={p.admin} />
      {sheet.review_notes !== undefined ? (
        <Section title="Notes pour la relecture">
          <p className={styles.notes}>{sheet.review_notes}</p>
        </Section>
      ) : null}
      <div className={styles.preview}>
        <SheetPills sheet={sheet} equipment={null} />
        <SheetIllustrations
          name={sheet.name}
          illustrations={sheetIllustrations(sheet.illustrations ?? [], entries ?? new Map())}
        />
      </div>
      <Section title="Sensibilité">
        <ul className={styles.factList}>
          <li className={styles.fact}>
            <p data-fact="" className={styles.factText}>
              {data.sensitive
                ? `Fiche sensible · Feu vert santé : ${GREEN_LIGHT_LABELS[data.greenLight]}`
                : 'Fiche non sensible'}
            </p>
          </li>
          <Fact lines={[levelText(sheet.level)]} action={partAction('level')} />
          <Fact
            lines={[`Déconseillé aux mineurs : ${sheet.not_for_minors ? 'oui' : 'non'}`]}
            action={partAction('not_for_minors')}
          />
          <Fact
            lines={[
              `Articulations sollicitées : ${listText(sensitivity, 'aucune', 'pas encore renseignées')}`,
            ]}
            action={partAction('stressed_joints')}
          />
        </ul>
      </Section>
      <Section title="Caractéristiques">
        <ul className={styles.factList}>
          <Fact lines={[`Nom : ${sheet.name}`]} action={partAction('name')} />
          <Fact
            lines={[
              `Muscles principaux : ${listText(
                sheet.primary_muscles?.map((m) => MUSCLE_LABELS[m]),
                'aucun',
                'pas encore renseignés',
              )}`,
              `Muscles secondaires : ${listText(
                sheet.secondary_muscles?.map((m) => MUSCLE_LABELS[m]),
                'aucun',
                'pas encore renseignés',
              )}`,
            ]}
            action={partAction('muscles')}
          />
          <Fact
            lines={[`Matériel : ${sheet.equipment_options.map(equipmentText).join(', ou ')}`]}
            action={partAction('equipment')}
          />
          <Fact
            lines={[
              `Illustrations : ${(() => {
                const n = sheet.illustrations?.length ?? 0;
                return n === 0 ? 'aucune' : `${n} ${plural(n, 'pose', 'poses')}`;
              })()}`,
            ]}
            action={partAction('illustrations')}
          />
        </ul>
      </Section>
      <SheetTabs
        sheet={sheet}
        tab={tab}
        onTabChange={changeTab}
        tabLabels={tabLabelsOf(data.comments)}
        partAction={partAction}
        variants={
          <ReviewVariants
            sheet={sheet}
            filter={filter}
            adminFilters={adminFilters}
            action={partAction('variants')}
          />
        }
      />
      {canComment || generalComments.length > 0 ? (
        <Section title="Toute la fiche">{partAction('general')}</Section>
      ) : null}
      {canValidate ? (
        <div className={styles.validate}>
          <Button
            block
            onClick={() => {
              setConflict(null);
              setValidating(true);
            }}
          >
            {validateLabel}
          </Button>
        </div>
      ) : null}
      {p.admin ? (
        <AdminSheetTools
          data={data}
          manifestIds={manifestIds}
          onEdit={p.onEdit}
          onDone={(next, to) => {
            setConflict(null);
            p.onUpdate(next);
            p.onNotice(`Statut enregistré : ${STATUS_LABELS[to]}.`);
          }}
          onConflict={() => {
            p.onNotice(null);
            setConflict('transition');
            void p.reload();
          }}
          reload={p.reload}
        />
      ) : null}
      {p.admin && data.validations ? <ValidationsSection validations={data.validations} /> : null}
      {commenting ? (
        <CommentSheet
          key={commenting}
          part={commenting}
          sheetId={sheet.id}
          accountId={p.meId}
          baseRevision={sheet.revision}
          onDraftChange={setDraftPart}
          onClose={() => setCommenting(null)}
          onSent={() => {
            setCommenting(null);
            setDraftPart(null);
            void p.reload();
          }}
        />
      ) : null}
      {validating ? (
        <ValidateSheet
          sheet={{ id: sheet.id, name: sheet.name, revision: sheet.revision }}
          label={validateLabel}
          health={p.health}
          filter={filter}
          adminFilters={adminFilters}
          onClose={(validated) => {
            setValidating(false);
            if (validated) void p.reload();
          }}
          onConflict={() => {
            setValidating(false);
            setConflict('validate');
            void p.reload();
          }}
        />
      ) : null}
    </Page>
  );
}

/**
 * Fiche de la relecture (`/review/exercises/:id`, spec brique 2 §4.5), lue en ligne : « Chargement… », échec avec
 * « Réessayer » (hors ligne : « Nécessite le réseau »), « Fiche introuvable. », accès perdu → Profil. Le filtre de
 * la liste suit dans `?queue=` (Retour, « Fiche suivante »), l'onglet dans `?tab=` par remplacement. Une clé par
 * fiche : d'une fiche à l'autre, feuilles et saisies repartent de zéro. L'admin a en plus (Task 17) « Modifier »
 * (formulaire à la place de la fiche, `?edit=1` par remplacement), « Publier » et les autres changements de
 * statut, la version exportée et les validations nominatives ; ses filtres de liste suivent dans l'adresse.
 */
export function ReviewSheet(p: { params: { id: string } }) {
  return <ReviewSheetPage key={p.params.id} id={p.params.id} />;
}

function ReviewSheetPage(p: { id: string }) {
  const repos = useRepos();
  const { me } = useMeState();
  const [params, setParams] = useSearchParams();
  const filter = listFilterOf(params.get('queue'));
  const admin = me?.role === 'admin';
  const adminFilters = admin ? adminFiltersOf(params) : NO_ADMIN_FILTERS;
  const editing = admin && params.get('edit') === '1';
  const load = useCallback(() => repos.review.get(p.id), [repos, p.id]);
  const { data, error, loading, reload, replace } = useReviewData(load);
  const [notice, setNotice] = useState<string | null>(null);
  // Le formulaire remplace l'adresse de la fiche (`?edit=1`) : Retour depuis la fiche ne le rouvre pas.
  const setEditing = (on: boolean) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (on) out.set('edit', '1');
        else out.delete('edit');
        return out;
      },
      { replace: true },
    );
  if (!me) return null;
  if (data && editing) {
    return (
      <EditSheetForm
        data={data}
        onCancel={() => setEditing(false)}
        onSaved={(next) => {
          replace(next);
          setNotice(`Version ${next.sheet.revision} enregistrée.`);
          setEditing(false);
        }}
      />
    );
  }
  if (data) {
    return (
      <SheetScreen
        data={data}
        meId={me.id}
        admin={admin}
        // Profil gardé par une version d'avant la brique 2 : drapeaux absents, donc faux.
        health={isHealthReviewer(me) === true}
        filter={filter}
        adminFilters={adminFilters}
        reload={reload}
        reloadError={error}
        onUpdate={replace}
        notice={notice}
        onNotice={setNotice}
        onEdit={() => {
          setNotice(null);
          setEditing(true);
        }}
      />
    );
  }
  const notFound = error instanceof ApiError && error.code === 'not_found';
  return (
    <Page title={LOADING_TITLE} back={reviewListPath(filter, adminFilters)}>
      {loading ? <Loading /> : null}
      {notFound ? <p>Fiche introuvable.</p> : null}
      {error !== null && !notFound ? (
        <LoadFailure message={errorMessage(error)} onRetry={() => void reload()} />
      ) : null}
    </Page>
  );
}
