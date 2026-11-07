import { type FormEvent, useCallback, useId, useState } from 'react';
import {
  type AdviceAction,
  type AdviceDetail,
  type AdviceIssue,
  type AdviceSummary,
  adviceIssuesOf,
  useRepos,
} from '../../repos';
import { Badge, Banner, Button, errorMessage, Field } from '../../ui';
import { MarkdownLite } from '../nutrition/markdown-lite';
import styles from './review.module.css';
import { LoadFailure, Loading, useReviewData } from './review-data';
import { STATUS_LABELS, STATUS_TONES, ADVICE_TEXTS as T } from './review-labels';

/*
 * Segment « Fiches conseils » de la relecture (spec brique 5 §10.2, D9), admin seul : la liste des fiches, puis une
 * fiche (texte rendu comme à l'écran, sources, « Modifier », « Marquer relue », « Publier », « Retirer »). Un refus
 * 422 `transition_blocked` rend les `issues` du serveur sous les boutons. Tout est lu et écrit en ligne.
 */

/** Étapes offertes selon le statut (`draft → reviewed → published → retired`). */
const NEXT: Record<AdviceDetail['status'], AdviceAction | null> = {
  draft: 'review',
  reviewed: 'publish',
  published: 'retire',
  retired: null,
};

function Issues({ issues }: { issues: readonly AdviceIssue[] }) {
  return (
    <Banner tone="error">
      <strong>{T.issuesTitle}</strong>
      <ul className={styles.issueList} aria-label={T.issuesTitle}>
        {issues.map((issue) => (
          <li
            key={`${issue.code}:${issue.detail}`}
          >{`${T.issueLabels[issue.code] ?? issue.code} : ${issue.detail}`}</li>
        ))}
      </ul>
    </Banner>
  );
}

function EditForm(p: { sheet: AdviceDetail; onSaved(sheet: AdviceDetail): void; onCancel(): void }) {
  const repos = useRepos();
  const [title, setTitle] = useState(p.sheet.title);
  const [body, setBody] = useState(p.sheet.body_md);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      p.onSaved(await repos.review.adviceSave(p.sheet.id, { title, body_md: body }));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={styles.adviceForm} onSubmit={(e) => void submit(e)}>
      <p className={styles.muted}>{T.editNote}</p>
      <Field label={T.titleField}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={T.bodyField}>
        <textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <div className={styles.adviceActions}>
        <Button type="submit" disabled={busy || title.trim() === '' || body.trim() === ''}>
          {T.save}
        </Button>
        <Button type="button" variant="secondary" onClick={p.onCancel}>
          {T.cancel}
        </Button>
      </div>
    </form>
  );
}

function AdviceSheet(p: { id: string; onBack(): void }) {
  const repos = useRepos();
  const load = useCallback(() => repos.review.adviceGet(p.id), [repos, p.id]);
  const { data, error, loading, reload, replace } = useReviewData(load);
  const [editing, setEditing] = useState(false);
  const [issues, setIssues] = useState<AdviceIssue[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();

  const run = async (action: AdviceAction) => {
    setBusy(true);
    setIssues(null);
    setFailure(null);
    try {
      replace(await repos.review.adviceTransition(p.id, action));
    } catch (e) {
      const refused = adviceIssuesOf(e);
      if (refused) setIssues(refused);
      else setFailure(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const next = data ? NEXT[data.status] : null;
  return (
    <section aria-labelledby={titleId} className={styles.section}>
      <Button variant="ghost" onClick={p.onBack}>
        {T.back}
      </Button>
      {loading ? <Loading /> : null}
      {error !== null ? <LoadFailure message={errorMessage(error)} onRetry={() => void reload()} /> : null}
      {data ? (
        <div className={styles.card}>
          <h2 id={titleId} className={styles.sectionTitle}>
            {data.title}
          </h2>
          <p className={styles.pillRow}>
            <Badge tone={STATUS_TONES[data.status]}>{STATUS_LABELS[data.status]}</Badge>
            <Badge tone="muted">{T.audiences[data.audience]}</Badge>
            <Badge tone="muted">{T.version(data.version)}</Badge>
          </p>
          {editing ? (
            <EditForm
              sheet={data}
              onSaved={(saved) => {
                replace(saved);
                setIssues(null);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <div className={styles.adviceBody}>
                <MarkdownLite source={data.body_md} allowedLinks={data.sources.map((s) => s.url)} />
              </div>
              {data.sources.length > 0 ? (
                <>
                  <h3>{T.sources}</h3>
                  <ul>
                    {data.sources.map((s) => (
                      <li key={s.url}>{s.title}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <div className={styles.adviceActions}>
                <Button variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
                  {T.edit}
                </Button>
                {next ? (
                  <Button disabled={busy} onClick={() => void run(next)}>
                    {T.actions[next]}
                  </Button>
                ) : null}
              </div>
            </>
          )}
          {issues ? <Issues issues={issues} /> : null}
          {failure ? <Banner tone="error">{failure}</Banner> : null}
        </div>
      ) : null}
    </section>
  );
}

function AdviceList(p: { onOpen(id: string): void }) {
  const repos = useRepos();
  const load = useCallback(() => repos.review.adviceList(), [repos]);
  const { data, error, loading, reload } = useReviewData(load);
  return (
    <>
      {loading ? <Loading /> : null}
      {error !== null ? <LoadFailure message={errorMessage(error)} onRetry={() => void reload()} /> : null}
      {data && data.length === 0 ? <p className={styles.muted}>{T.empty}</p> : null}
      {data && data.length > 0 ? (
        <ul aria-label={T.advice} className={styles.sheetList}>
          {data.map((sheet: AdviceSummary) => (
            <li key={sheet.id}>
              <button
                type="button"
                className={`${styles.sheetRow} ${styles.adviceRow}`}
                onClick={() => p.onOpen(sheet.id)}
              >
                <span className={styles.sheetRowText}>
                  <span className={styles.sheetName}>{sheet.title}</span>
                  <span className={styles.pillRow}>
                    <Badge tone={STATUS_TONES[sheet.status]}>{STATUS_LABELS[sheet.status]}</Badge>
                    <Badge tone="muted">{T.audiences[sheet.audience]}</Badge>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** Le segment : la liste, ou la fiche ouverte. */
export function AdviceReview() {
  const [open, setOpen] = useState<string | null>(null);
  return open === null ? (
    <AdviceList onOpen={setOpen} />
  ) : (
    <AdviceSheet key={open} id={open} onBack={() => setOpen(null)} />
  );
}
