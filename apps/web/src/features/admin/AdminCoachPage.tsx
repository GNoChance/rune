import {
  COACH_COUNTER_KINDS,
  type CoachAdminView,
  type CoachReportDetail,
  type CoachReportSummary,
} from '@rune/contracts';
import { useCallback, useId, useState } from 'react';
import { useRepos } from '../../repos';
import { Badge, Banner, Button, formatDateTime, Switch } from '../../ui';
import { coachStateLine, REPORT_TEXTS, COACH_ADMIN_TEXTS as T } from '../coach/coach-texts';
import { AdminPage } from './AdminPage';
import styles from './admin.module.css';
import { ActionDialog, adminErrorMessage, LoadFailure, Loading, useServerData } from './admin-ui';

/** Les 12 derniers mois de Paris, du plus ancien au courant (`month` compris), en `AAAA-MM`. */
function lastTwelveMonths(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => {
    const index = y * 12 + (m - 1) - (11 - i);
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
}

type Confirm = { kind: 'cut' } | { kind: 'classify'; id: string };

/**
 * Admin › Coach (spec brique 4 §17.1) : l'état et l'interrupteur du coach pour le cercle, les coûts du mois, les
 * signalements et les compteurs anonymes. Les signalements sont la seule donnée de conversation que l'admin lit :
 * ni autre contenu, ni nombre de messages par personne. Couper le coach pour tous et Classer sont des actions
 * dangereuses : elles passent par une confirmation.
 */
export function AdminCoachPage() {
  const repos = useRepos();
  const loadView = useCallback(() => repos.admin.coach(), [repos]);
  const loadReports = useCallback(() => repos.admin.coachReports(), [repos]);
  const view = useServerData(loadView);
  const reports = useServerData(loadReports);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadAll = useCallback(async () => {
    await Promise.all([view.reload(), reports.reload()]);
  }, [view, reports]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await view.reload();
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const failure = view.error ?? reports.error;
  return (
    <AdminPage>
      {view.loading ? <Loading /> : null}
      {failure && !view.data ? <LoadFailure message={failure} onRetry={() => void reloadAll()} /> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {view.data ? (
        <>
          <StateSection
            state={view.data.state}
            busy={busy}
            onEnable={() => void run(() => repos.admin.setCoachEnabled(true))}
            onCut={() => setConfirm({ kind: 'cut' })}
            onResume={() => void run(() => repos.admin.resumeCoach())}
          />
          <CostsSection view={view.data} />
          <ReportsSection
            reports={reports.data}
            selected={selected}
            onSelect={setSelected}
            onClassify={(id) => setConfirm({ kind: 'classify', id })}
            onCut={() => setConfirm({ kind: 'cut' })}
          />
          <CountersSection view={view.data} />
        </>
      ) : null}
      {confirm?.kind === 'cut' ? (
        <ActionDialog
          title={T.cutAll}
          confirmLabel={T.cutAll}
          danger
          reload={reloadAll}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await repos.admin.setCoachEnabled(false);
            await view.reload();
          }}
        >
          <p>{T.cutAllWarning}</p>
        </ActionDialog>
      ) : null}
      {confirm?.kind === 'classify' ? (
        <ActionDialog
          title={T.classifyTitle}
          confirmLabel={T.classify}
          danger
          reload={reloadAll}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await repos.admin.classifyCoachReport(confirm.id);
            setSelected(null);
            await reloadAll();
          }}
        >
          <p>{T.classifyWarning}</p>
          <p>{T.anthropicReminder}</p>
        </ActionDialog>
      ) : null}
    </AdminPage>
  );
}

function StateSection(p: {
  state: CoachAdminView['state'];
  busy: boolean;
  onEnable(): void;
  onCut(): void;
  onResume(): void;
}) {
  const id = useId();
  const switchId = useId();
  const { state } = p;
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h2 id={id}>{T.stateTitle}</h2>
      <div className={`${styles.card} ${styles.coachCard}`}>
        <Switch
          id={switchId}
          label={T.switchLabel}
          checked={state.enabled}
          disabled={p.busy}
          onChange={(on) => (on ? p.onEnable() : p.onCut())}
        />
        <p>{coachStateLine(state)}</p>
        {state.catalogChanged ? <Banner tone="warning">{T.catalogChanged}</Banner> : null}
        {state.suspendedUntil !== null ? (
          <>
            <Button variant="secondary" disabled={p.busy} onClick={p.onResume}>
              {T.resume}
            </Button>
            <p className={styles.meta}>{T.resumeHelp}</p>
          </>
        ) : null}
      </div>
    </section>
  );
}

function CostsSection(p: { view: CoachAdminView }) {
  const id = useId();
  const { view } = p;
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h2 id={id}>{T.costsTitle}</h2>
      <div className={`${styles.card} ${styles.coachCard}`}>
        <p>{T.total(view.totalUsd)}</p>
        <p className={styles.meta}>{T.limit(view.workspaceLimitUsd)}</p>
        <ul className={styles.coachList}>
          {view.members.map((m) => (
            <li key={m.username} className={styles.coachRow}>
              <span>{m.username}</span> <span>{T.memberCost(m.costUsd, m.budgetUsd)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ReportsSection(p: {
  reports: CoachReportSummary[] | null;
  selected: string | null;
  onSelect(id: string | null): void;
  onClassify(id: string): void;
  onCut(): void;
}) {
  const id = useId();
  return (
    <>
      <section aria-labelledby={id} className={styles.section}>
        <h2 id={id}>{T.reportsTitle}</h2>
        {p.reports && p.reports.length === 0 ? <p>{T.noReports}</p> : null}
        {p.reports && p.reports.length > 0 ? (
          <ul className={`${styles.card} ${styles.coachCard} ${styles.coachList}`}>
            {p.reports.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={styles.reportButton}
                  aria-expanded={p.selected === r.id}
                  onClick={() => p.onSelect(p.selected === r.id ? null : r.id)}
                >
                  <span>{formatDateTime(r.createdAt)}</span>{' '}
                  <span>{REPORT_TEXTS.categories[r.category]}</span> <span>{r.username}</span>{' '}
                  {r.minor ? <Badge tone="warning">{T.minor}</Badge> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {p.selected !== null ? (
        <ReportDetail key={p.selected} id={p.selected} onClassify={p.onClassify} onCut={p.onCut} />
      ) : null}
    </>
  );
}

function ReportDetail(p: { id: string; onClassify(id: string): void; onCut(): void }) {
  const repos = useRepos();
  const load = useCallback((): Promise<CoachReportDetail> => repos.admin.coachReport(p.id), [repos, p.id]);
  const { data, error, loading, reload } = useServerData(load);
  const id = useId();
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h2 id={id}>{T.detailTitle}</h2>
      {loading ? <Loading /> : null}
      {error ? <LoadFailure message={error} onRetry={() => void reload()} /> : null}
      {data ? (
        <div className={`${styles.card} ${styles.coachCard}`}>
          <p className={styles.meta}>
            {formatDateTime(data.createdAt)} · {REPORT_TEXTS.categories[data.category]} · {data.username}
          </p>
          <h3>{T.exchange}</h3>
          <p className={styles.exchange}>{data.exchangeText}</p>
          {data.comment ? (
            <>
              <h3>{T.comment}</h3>
              <p>{data.comment}</p>
            </>
          ) : null}
          <p>{T.anthropicReminder}</p>
          <Button variant="danger" onClick={() => p.onClassify(data.id)}>
            {T.classify}
          </Button>
          <Button variant="danger" onClick={p.onCut}>
            {T.cutAll}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function CountersSection(p: { view: CoachAdminView }) {
  const id = useId();
  const { view } = p;
  const months = lastTwelveMonths(view.month);
  const count = (month: string, kind: string) =>
    view.counters.find((c) => c.month === month && c.kind === kind)?.count ?? 0;
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h2 id={id}>{T.countersTitle}</h2>
      <div className={`${styles.card} ${styles.coachCard} ${styles.tableWrap}`}>
        <table className={styles.counters}>
          <thead>
            <tr>
              <th scope="col">{T.month}</th>
              {COACH_COUNTER_KINDS.map((k) => (
                <th key={k} scope="col">
                  {T.kinds[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m}>
                <th scope="row">{`${m.slice(5)}/${m.slice(0, 4)}`}</th>
                {COACH_COUNTER_KINDS.map((k) => (
                  <td key={k}>{count(m, k)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
