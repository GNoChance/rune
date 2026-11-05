import type { CoachThreadResponse } from '@rune/contracts';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { ApiError } from '../../api/client';
import { useSyncState } from '../../app-services';
import { useProgramEditContext, useProgramView, useRepos } from '../../repos';
import { Banner, Button, errorMessage, Page } from '../../ui';
import { ProposalCard } from '../program/ProposalCard';
import { programNames } from '../program/program-model';
import { ChatBubble } from './ChatBubble';
import styles from './coach-page.module.css';
import { useCoachStore } from './coach-store';
import { dayLabel, THREAD_TEXTS } from './coach-texts';
import { ConfirmDeleteSheet } from './DeactivateSheet';
import { HelpCard } from './HelpCard';
import { ReportSheet } from './ReportSheet';

type Message = CoachThreadResponse['messages'][number];

/**
 * Un fil passé en lecture seule (spec brique 4 §16.3) : les bulles, avec leurs cartes d'aide et de proposition à
 * leur place (`display_extras`), « Signaler » sur les réponses du coach, « Supprimer cette conversation »
 * (confirmation, sans mot de passe) ; ni saisie ni envoi.
 */
export function ThreadPage() {
  const { id = '' } = useParams<{ id: string }>();
  const repos = useRepos();
  const { store } = useCoachStore();
  const [, navigate] = useLocation();
  const [thread, setThread] = useState<CoachThreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState<number | null>(null);
  const program = useProgramView();
  const ctx = useProgramEditContext();
  const { connection } = useSyncState();
  const close = useCallback(() => setConfirming(false), []);

  useEffect(() => {
    let live = true;
    repos.coach.thread(id).then(
      (t) => {
        if (live) setThread(t);
      },
      (e: unknown) => {
        if (live)
          setError(
            e instanceof ApiError && e.code === 'not_found' ? THREAD_TEXTS.unavailable : errorMessage(e),
          );
      },
    );
    return () => {
      live = false;
    };
  }, [repos, id]);

  const names = program && ctx ? programNames(program, ctx) : null;
  const minor = thread?.thread.audience === 'minor';

  async function remove() {
    await repos.coach.deleteThread(id);
    await store.load();
    navigate('/coach/threads');
  }

  /** Cartes d'une réponse : aide, puis propositions lues depuis le programme (celles qui n'y sont plus se taisent). */
  const cards = (m: Message) => {
    const rows = new Map([...(program?.proposals ?? []), ...(program?.changes ?? [])].map((c) => [c.id, c]));
    const shown = m.proposalIds.flatMap((pid) => {
      const proposal = rows.get(pid);
      return proposal ? [{ id: pid, proposal }] : [];
    });
    if (m.helpCards.length === 0 && shown.length === 0) return null;
    return (
      <div className={styles.cards}>
        {m.helpCards.map((resource) => (
          <HelpCard key={resource} resource={resource} minor={minor} />
        ))}
        {program && ctx && names
          ? shown.map(({ id: pid, proposal }) => (
              <ProposalCard
                key={pid}
                proposal={proposal}
                view={program}
                ctx={ctx}
                names={names}
                offline={connection === 'offline'}
                compact
              />
            ))
          : null}
      </div>
    );
  };

  return (
    <Page title={thread ? dayLabel(thread.thread.day) : THREAD_TEXTS.title} back="/coach/threads">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {thread ? (
        <>
          <div role="log" aria-label="Conversation passée avec le coach" className={styles.thread}>
            {thread.messages.map((m) =>
              m.role === 'user' ? (
                <ChatBubble key={m.seq} author="user" text={m.text} />
              ) : (
                <Fragment key={m.seq}>
                  <ChatBubble
                    author="assistant"
                    coach={thread.thread.persona}
                    text={m.text}
                    truncated={m.truncated}
                    onReport={() => setReport(m.seq)}
                  />
                  {cards(m)}
                </Fragment>
              ),
            )}
          </div>
          <Button variant="danger" block onClick={() => setConfirming(true)}>
            {THREAD_TEXTS.deleteOne}
          </Button>
          <ConfirmDeleteSheet
            open={confirming}
            title={THREAD_TEXTS.deleteOne}
            body={THREAD_TEXTS.deleteOneBody}
            onConfirm={remove}
            onClose={close}
          />
          {report !== null ? (
            <ReportSheet threadId={thread.thread.id} messageSeq={report} onClose={() => setReport(null)} />
          ) : null}
        </>
      ) : null}
    </Page>
  );
}
