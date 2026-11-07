import type { ReviewBatchProgress, ReviewListItem, ReviewListResponse } from '@rune/contracts';
import { CORE_BATCHES } from '@rune/domain';
import { useCallback, useId } from 'react';
import { Link, useSearchParams } from 'wouter';
import { useMe } from '../../app-services';
import { useRepos } from '../../repos';
import { Badge, Chips, EmptyState, errorMessage, Page, plural } from '../../ui';
import { AdminListTools } from './AdminListTools';
import { AdviceReview } from './AdviceReview';
import styles from './review.module.css';
import { LoadFailure, Loading, useReviewData } from './review-data';
import {
  ADVICE_TEXTS,
  type AdminFilters,
  adminFiltersOf,
  inAdminFilters,
  inFilter,
  LIST_FILTERS,
  type ListFilter,
  listFilterOf,
  NO_ADMIN_FILTERS,
  type Pill,
  reviewSheetPath,
  STATUS_LABELS,
  STATUS_TONES,
  sensitiveReasons,
} from './review-labels';
import { EMPTY_QUEUE } from './ValidateSheet';

/**
 * Pastilles d'une fiche de la liste (spec brique 2 §4.5), dans l'ordre : statut, « Sensible : <raisons> »,
 * commentaires ouverts, « Validée par toi », « À revalider », « Prête à publier ».
 */
export function itemPills(item: ReviewListItem): Pill[] {
  const pills: Pill[] = [{ text: STATUS_LABELS[item.status], tone: STATUS_TONES[item.status] }];
  if (item.sensitive) {
    pills.push({ text: `Sensible : ${sensitiveReasons(item).join(', ')}`, tone: 'warning' });
  }
  if (item.openComments > 0) {
    const n = item.openComments;
    pills.push({ text: `${n} ${plural(n, 'commentaire ouvert', 'commentaires ouverts')}`, tone: 'accent' });
  }
  if (item.validatedByMe) pills.push({ text: 'Validée par toi', tone: 'success' });
  if (item.queues.includes('revalidate')) pills.push({ text: 'À revalider', tone: 'warning' });
  if (item.queues.includes('ready_to_publish')) pills.push({ text: 'Prête à publier', tone: 'success' });
  return pills;
}

/**
 * Lignes d'avancement (spec brique 2 §3.8) : « Cœur » pour les lots A et B réunis, puis une ligne par lot
 * d'extension, dans l'ordre reçu.
 */
export function progressRows(
  progress: readonly ReviewBatchProgress[],
): { label: string; published: number; total: number }[] {
  const core: readonly string[] = CORE_BATCHES;
  const coreRows = progress.filter((p) => core.includes(p.batch));
  return [
    {
      label: 'Cœur',
      published: coreRows.reduce((n, p) => n + p.published, 0),
      total: coreRows.reduce((n, p) => n + p.total, 0),
    },
    ...progress
      .filter((p) => !core.includes(p.batch))
      .map((p) => ({ label: `Lot ${p.batch}`, published: p.published, total: p.total })),
  ];
}

/** Avancement par lot : « Cœur · n / m publiées », une barre décorative sous chaque ligne. */
function BatchProgress(p: { progress: readonly ReviewBatchProgress[] }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.card}>
      <h2 id={titleId} className={styles.sectionTitle}>
        Avancement
      </h2>
      <ul className={styles.progressList}>
        {progressRows(p.progress).map((row) => (
          <li key={row.label} className={styles.progressRow}>
            <span>{`${row.label} · ${row.published} / ${row.total} ${plural(row.total, 'publiée', 'publiées')}`}</span>
            <span className={styles.bar} aria-hidden="true">
              <span
                className={styles.barFill}
                style={{ width: `${row.total === 0 ? 0 : (row.published / row.total) * 100}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      className={styles.chevron}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** Une fiche de la liste : un lien nommé par la fiche, décrit par ses pastilles, vers sa page (filtres gardés). */
function ReviewRow(p: { item: ReviewListItem; filter: ListFilter; adminFilters: AdminFilters }) {
  const id = useId();
  const pills = itemPills(p.item);
  return (
    <li>
      <Link
        href={reviewSheetPath(p.item.id, p.filter, p.adminFilters)}
        className={styles.sheetRow}
        aria-labelledby={`${id}-name`}
        aria-describedby={pills.map((_, i) => `${id}-pill-${i}`).join(' ')}
      >
        <span className={styles.sheetRowText}>
          <span id={`${id}-name`} className={styles.sheetName}>
            {p.item.name}
          </span>
          <span className={styles.pillRow}>
            {pills.map((pill, i) => (
              <span key={pill.text} id={`${id}-pill-${i}`}>
                <Badge tone={pill.tone}>{pill.text}</Badge>
              </span>
            ))}
          </span>
        </span>
        <Chevron />
      </Link>
    </li>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * Filtres, avec le nombre de fiches de chacun (`counts` du serveur ; « Toutes » : toutes les lignes reçues). Avec
 * un filtre de l'admin, les nombres sont comptés sur les lignes qui le passent (la liste est lue en entier).
 */
function filterOptions(list: ReviewListResponse, adminFilters: AdminFilters) {
  const narrowed = adminFilters.pattern !== null || adminFilters.withoutIllustration;
  const items = list.items.filter((item) => inAdminFilters(item, adminFilters));
  return LIST_FILTERS.map((f) => {
    const n =
      f.id === 'all'
        ? items.length
        : narrowed
          ? items.filter((item) => item.queues.includes(f.id)).length
          : (list.counts[f.id] ?? 0);
    return { value: f.id, label: `${f.label} · ${n}` };
  });
}

/**
 * Liste de la relecture (`/review/exercises`, spec brique 2 §4.5), en ligne seulement : avancement par lot, filtres
 * avec compteurs (« À relire » par défaut, gardé dans `?queue=` par remplacement : Retour depuis une fiche le
 * retrouve), puis une ligne par fiche avec ses pastilles, ou « Ta file est vide. Merci ! ». La liste est lue une
 * seule fois, sans file, et filtrée sur place. L'admin (réponse avec `admin`) a sous les filtres ses outils
 * (`AdminListTools`) : filtres par type de mouvement et sans illustration (`?pattern=`, `?illustrations=none`,
 * gardés jusqu'aux fiches), compteurs « à exporter » et « à remplacer avant publication », « Exporter le catalogue ».
 */
export function ReviewList() {
  const repos = useRepos();
  // Segment « Fiches conseils » de la nutrition : l'admin seul (les relectrices d'exercices n'y ont pas accès).
  const isAdmin = useMe()?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const filter = listFilterOf(params.get('queue'));
  const load = useCallback(() => repos.review.list(), [repos]);
  const { data, error, loading, reload } = useReviewData(load);
  // Filtres de l'admin : seulement si le serveur a répondu en admin (une relectrice ne les a pas).
  const adminFilters = data?.admin ? adminFiltersOf(params) : NO_ADMIN_FILTERS;

  const choose = (next: string) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set('queue', listFilterOf(next));
        return out;
      },
      { replace: true },
    );

  const changeAdminFilters = (next: AdminFilters) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next.pattern) out.set('pattern', next.pattern);
        else out.delete('pattern');
        if (next.withoutIllustration) out.set('illustrations', 'none');
        else out.delete('illustrations');
        return out;
      },
      { replace: true },
    );

  const section = isAdmin && params.get('section') === 'advice' ? 'advice' : 'exercises';
  const chooseSection = (next: string) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === 'advice') out.set('section', 'advice');
        else out.delete('section');
        return out;
      },
      { replace: true },
    );

  const shown = data ? data.items.filter((item) => inFilter(item, filter, adminFilters)) : [];
  return (
    <Page title="Relecture" back="/profile">
      {isAdmin ? (
        <Chips
          name="review-section"
          legend={ADVICE_TEXTS.segmentLegend}
          options={[
            { value: 'exercises', label: ADVICE_TEXTS.exercises },
            { value: 'advice', label: ADVICE_TEXTS.advice },
          ]}
          value={section}
          onChange={chooseSection}
        />
      ) : null}
      {section === 'advice' ? <AdviceReview /> : null}
      {section === 'advice' ? null : loading ? <Loading /> : null}
      {section === 'exercises' && error !== null ? (
        <LoadFailure message={errorMessage(error)} onRetry={() => void reload()} />
      ) : null}
      {section === 'exercises' && data ? (
        <>
          <BatchProgress progress={data.progress} />
          <Chips
            name="review-filter"
            legend="Filtrer les fiches"
            options={filterOptions(data, adminFilters)}
            value={filter}
            onChange={choose}
          />
          {data.admin ? (
            <AdminListTools
              admin={data.admin}
              items={data.items}
              filters={adminFilters}
              onFilters={changeAdminFilters}
              reload={reload}
            />
          ) : null}
          {shown.length > 0 ? (
            <ul aria-label="Fiches" className={styles.sheetList}>
              {shown.map((item) => (
                <ReviewRow key={item.id} item={item} filter={filter} adminFilters={adminFilters} />
              ))}
            </ul>
          ) : filter === 'all' ? (
            <EmptyState
              icon={<CheckIcon />}
              title="Aucune fiche pour l'instant."
              text="Les fiches du catalogue apparaîtront ici."
            />
          ) : (
            <EmptyState
              icon={<CheckIcon />}
              title={EMPTY_QUEUE}
              text="Les autres filtres gardent le reste des fiches."
            />
          )}
        </>
      ) : null}
    </Page>
  );
}
