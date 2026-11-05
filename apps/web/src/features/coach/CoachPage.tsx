import type { CoachId, CoachMessageView } from '@rune/contracts';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Banner, BottomSheet, Button, CoachAvatar, Page, SystemPanel } from '../../ui';
import { ChatBubble } from './ChatBubble';
import { Composer } from './Composer';
import styles from './coach-page.module.css';
import { type CoachState, useCoachStore } from './coach-store';
import {
  AI_BANNER,
  BUDGET_FROM_PCT,
  budgetText,
  DEV_BANNER,
  errorText,
  REMAINING_FROM,
  remainingText,
  STATE_TEXTS,
  SUGGESTIONS,
  TOOL_LABELS,
  WELCOME,
} from './coach-texts';

/** « Voix : le Skald » (spec §16.2). */
const VOICES: Readonly<Record<CoachId, string>> = {
  ombre: "l'Ombre",
  skald: 'le Skald',
  scribe: 'le Scribe',
};

/** Erreurs qu'un second essai ne change pas : pas de « Réessayer ». */
const FINAL_ERRORS: ReadonlySet<string> = new Set([
  'thread_closed',
  'monthly_budget_reached',
  'daily_limit_reached',
  'spend_limit',
  'consent_withdrawn',
  'consent_required',
  'coach_unavailable',
]);

function DotsIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

/** Menu « ⋯ » : Ce que le coach voit, Conversations précédentes, Bien utiliser le coach. */
function CoachMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.menuButton}
        aria-label="Menu du coach"
        onClick={() => setOpen(true)}
      >
        <DotsIcon />
      </button>
      <BottomSheet open={open} title="Le coach" onClose={() => setOpen(false)}>
        <ul className={styles.menuList}>
          <li>
            <Link href="/coach/brief" className={styles.menuLink}>
              Ce que le coach voit
            </Link>
          </li>
          <li>
            <Link href="/coach/threads" className={styles.menuLink}>
              {STATE_TEXTS.previousThreads}
            </Link>
          </li>
          <li>
            <Link href="/help/coach" className={styles.menuLink}>
              Bien utiliser le coach
            </Link>
          </li>
        </ul>
      </BottomSheet>
    </>
  );
}

/** « Le coach a répondu », annoncé une fois à `done` : le fil, lui, attend la fin du flux (`aria-busy`). */
function useAnswerAnnounced(phase: CoachState['phase']): boolean {
  const [announced, setAnnounced] = useState(false);
  const previous = useRef(phase);
  useEffect(() => {
    if (previous.current === 'streaming' && phase === 'idle') setAnnounced(true);
    else if (phase === 'streaming') setAnnounced(false);
    previous.current = phase;
  }, [phase]);
  return announced;
}

/**
 * Conversation avec le coach (spec brique 4 §16.2) : en-tête, bandeau IA fixe, fil, saisie, et les états (accord,
 * pause, limites, fil fermé, réponse ailleurs, hors ligne, erreur, refus). Tout vient du magasin en mémoire : rien
 * n'est gardé sur l'appareil (C17). Les cartes d'aide et de proposition arrivent avec la Task 26.
 */
export function CoachPage() {
  const { state, store } = useCoachStore();
  const [, navigate] = useLocation();
  const { status, today, draft, pending, phase, error, refusalMessage } = state;
  const announced = useAnswerAnnounced(phase);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void store.load();
  }, [store]);

  const inProgress =
    phase !== 'streaming' && (status?.today.inProgress === true || today?.inProgress === true);
  useEffect(() => {
    if (inProgress) void store.pollInProgress();
  }, [store, inProgress]);

  const messages: readonly CoachMessageView[] = today?.messages ?? [];
  const showPending = pending !== null && (phase === 'streaming' || pending.bubble !== '');
  const pendingLength = pending?.bubble.length ?? 0;
  // Le fil descend avec le flux ; jsdom n'a pas scrollIntoView.
  // biome-ignore lint/correctness/useExhaustiveDependencies: la longueur du fil et de la bulle en cours déclenchent le défilement
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, pendingLength, pending?.tool]);

  const persona = today?.thread?.persona ?? status?.persona ?? null;
  // Un fil ou un message sans coach connu n'existe pas : le repli ne sert qu'au typage.
  const coach: CoachId = persona ?? 'ombre';
  const offline = error === 'offline';
  const closed =
    error === 'thread_closed' || (status !== null && status.today.threadId !== null && !status.today.open);
  const dailyLimit = status !== null && status.today.remaining === 0;
  const monthlyLimit = status !== null && status.budgetUsedPct >= 100;
  const blocked = offline || inProgress || dailyLimit || monthlyLimit;

  const retry = () => void (pending !== null ? store.retry() : store.load());

  // Fenêtre qui remplace le fil : coach coupé ou suspendu, accord absent ou à renouveler.
  let gate: 'paused' | 'suspended' | 'consentMissing' | 'consentChanged' | null = null;
  if (status !== null) {
    if (!status.available) gate = status.unavailableReason === 'suspended' ? 'suspended' : 'paused';
    else if (!status.consent.active) gate = 'consentMissing';
    else if (status.consent.needsRenewal) gate = 'consentChanged';
  }

  const header = persona ? (
    <div className={styles.coachHead}>
      <CoachAvatar coach={persona} size={44} />
      <p className={styles.coachInfo}>Voix : {VOICES[persona]}</p>
      <CoachMenu />
    </div>
  ) : null;

  const errorBanner =
    phase === 'error' && error !== null && error !== 'thread_closed' ? (
      <div className={styles.state}>
        <Banner tone={offline ? 'warning' : 'error'}>{errorText(error)}</Banner>
        {FINAL_ERRORS.has(error) ? null : (
          <Button variant="secondary" onClick={retry}>
            {STATE_TEXTS.retry}
          </Button>
        )}
      </div>
    ) : null;

  const body = (() => {
    if (status === null) {
      if (phase === 'loading' || error === null) return null;
      return (
        <>
          {errorBanner}
          {offline ? <p>{STATE_TEXTS.offlineEmpty}</p> : null}
        </>
      );
    }
    if (gate === 'paused' || gate === 'suspended') return <Banner tone="info">{STATE_TEXTS[gate]}</Banner>;
    if (gate !== null) {
      return (
        <SystemPanel
          title={gate === 'consentMissing' ? STATE_TEXTS.consentMissing : STATE_TEXTS.consentChanged}
        >
          <Button block onClick={() => navigate('/coach/consent')}>
            {STATE_TEXTS.consentActivate}
          </Button>
        </SystemPanel>
      );
    }
    const empty = messages.length === 0 && !showPending;
    return (
      <>
        {status.devUnevaluated ? <Banner tone="warning">{DEV_BANNER}</Banner> : null}
        {/* aria-busy : le lecteur d'écran attend la fin du flux, « Le coach a répondu » parle pour lui. */}
        <div
          role="log"
          aria-label="Conversation avec le coach"
          aria-busy={phase === 'streaming'}
          className={styles.thread}
        >
          {empty ? (
            <div className={styles.welcome}>
              <p className={styles.welcomeTitle}>Message d'accueil</p>
              <ChatBubble author="assistant" coach={coach} text={WELCOME} streaming />
              <div className={styles.suggestions}>
                {SUGGESTIONS.map((text) => (
                  <button
                    key={text}
                    type="button"
                    className={styles.suggestion}
                    onClick={() => store.setDraft(text)}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((m) =>
            m.role === 'user' ? (
              <ChatBubble key={m.seq} author="user" text={m.text} />
            ) : (
              <ChatBubble
                key={m.seq}
                author="assistant"
                coach={coach}
                text={m.text}
                truncated={m.truncated}
              />
            ),
          )}
          {showPending && pending ? (
            <>
              <ChatBubble author="user" text={pending.text} />
              {pending.bubble !== '' || pending.tool !== null ? (
                <ChatBubble
                  author="assistant"
                  coach={coach}
                  text={pending.bubble}
                  streaming
                  toolLabel={pending.tool ? TOOL_LABELS[pending.tool] : null}
                />
              ) : null}
            </>
          ) : null}
          <div ref={end} />
        </div>
        {errorBanner}
        {phase === 'refused' ? <Banner tone="info">{refusalMessage ?? STATE_TEXTS.refusal}</Banner> : null}
        {inProgress ? <Banner tone="info">{STATE_TEXTS.inProgress}</Banner> : null}
        {closed ? (
          <div className={styles.state}>
            <Banner tone="info">{STATE_TEXTS.threadClosed}</Banner>
            <Link href="/coach/threads" className={styles.link}>
              {STATE_TEXTS.previousThreads}
            </Link>
          </div>
        ) : (
          <>
            {dailyLimit ? <Banner tone="info">{STATE_TEXTS.dailyLimit}</Banner> : null}
            {monthlyLimit ? <Banner tone="info">{STATE_TEXTS.monthlyBudget}</Banner> : null}
            {!dailyLimit && status.today.remaining <= REMAINING_FROM ? (
              <p className={styles.note}>{remainingText(status.today.remaining)}</p>
            ) : null}
            {status.budgetUsedPct >= BUDGET_FROM_PCT && !monthlyLimit ? (
              <p className={styles.note}>{budgetText(status.budgetUsedPct)}</p>
            ) : null}
            <Composer
              value={draft}
              onChange={store.setDraft}
              onSend={() => void store.send()}
              disabled={blocked}
              busy={phase === 'streaming'}
            />
          </>
        )}
      </>
    );
  })();

  return (
    <Page title="Coach IA" back="/">
      {header}
      <Banner tone="info">{AI_BANNER}</Banner>
      {body}
      <p role="status" className={styles.srOnly}>
        {announced ? 'Le coach a répondu' : ''}
      </p>
    </Page>
  );
}
