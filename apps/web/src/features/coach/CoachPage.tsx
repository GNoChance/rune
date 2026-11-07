import {
  type CoachId,
  type CoachMessageView,
  type CoachProposalEvent,
  type GuidedRequest,
  guidedFlowsFor,
  type HelpResourceId,
} from '@rune/contracts';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useMe, useSyncState } from '../../app-services';
import { useNutritionView, useProgramEditContext, useProgramView } from '../../repos';
import { Banner, BottomSheet, Button, CoachAvatar, Page, SystemPanel } from '../../ui';
import { PreparingCard, ProposalCard } from '../program/ProposalCard';
import { programNames } from '../program/program-model';
import { ChatBubble } from './ChatBubble';
import { Composer } from './Composer';
import styles from './coach-page.module.css';
import { type CoachState, type NutritionScreenOffer, useCoachStore } from './coach-store';
import {
  AI_BANNER,
  BUDGET_FROM_PCT,
  budgetText,
  DEV_BANNER,
  errorText,
  GUIDED_TEXTS,
  REMAINING_FROM,
  remainingText,
  STATE_TEXTS,
  TOOL_LABELS,
  VOICES,
  WELCOME,
} from './coach-texts';
import { guidedAudience, liveToday } from './coach-thread';
import { GuidedFlow } from './GuidedFlow';
import { programExercises } from './guided-exercises';
import { HelpCard } from './HelpCard';
import { NutritionScreenButton } from './NutritionScreenButton';
import { ReportSheet } from './ReportSheet';

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
 * n'est gardé sur l'appareil (C17). Les cartes d'aide et de proposition suivent le texte de la bulle : celles du flux
 * en cours (la proposition « en préparation » jusqu'à ce que sa ligne arrive par le pull, appariée par `id`), puis,
 * après `done`, celles que `today` relit, qui les remplacent. « Signaler » ouvre la feuille du message.
 */
export function CoachPage() {
  const { state, store } = useCoachStore();
  const [, navigate] = useLocation();
  const { status, draft, pending, phase, error, refusalMessage } = state;
  // Un fil fermé par un changement de coach ou de version n'est plus la conversation du jour (spec 4.1 §4.4).
  const today = liveToday(state.today);
  const [guidedOpen, setGuidedOpen] = useState(false);
  // Après la fermeture du panneau : le focus revient à « Parcours guidés », ou au champ (fil vide).
  const [refocus, setRefocus] = useState(0);
  const toggle = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const userId = useMe()?.id ?? null;
  const announced = useAnswerAnnounced(phase);
  const end = useRef<HTMLDivElement>(null);
  const [report, setReport] = useState<{ threadId: string; messageSeq: number } | null>(null);
  const program = useProgramView({ preparing: (pending?.proposals.length ?? 0) > 0 });
  const ctx = useProgramEditContext();
  const { connection } = useSyncState();

  useEffect(() => {
    void store.load();
  }, [store]);

  useEffect(() => {
    if (refocus > 0) (toggle.current ?? field.current)?.focus();
  }, [refocus]);

  // Un autre compte : le parcours en cours n'est pas à lui.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seul le changement d'utilisateur ferme le panneau
  useEffect(() => setGuidedOpen(false), [userId]);

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
  // Le réseau décide de la saisie et des textes « hors ligne » : l'erreur `offline` d'un envoi ne reste pas collée au retour du réseau.
  const noNetwork = connection === 'offline';
  const offline = error === 'offline' && noNetwork;
  const closed =
    error === 'thread_closed' || (status !== null && status.today.threadId !== null && !status.today.open);
  const dailyLimit = status !== null && status.today.remaining === 0;
  const monthlyLimit = status !== null && status.budgetUsedPct >= 100;
  const blocked = noNetwork || inProgress || dailyLimit || monthlyLimit;

  const names = useMemo(() => (program && ctx ? programNames(program, ctx) : null), [program, ctx]);
  const audience = guidedAudience(today, status);
  const minor = audience === 'minor';
  // « Mes repères » et « Mon bilan de la semaine » : adulte en mode `full` sur l'appareil ; le serveur le revérifie.
  const nutritionFull = useNutritionView()?.mode === 'full' && audience === 'adult';
  const flows = useMemo(() => guidedFlowsFor(audience, nutritionFull), [audience, nutritionFull]);
  // null tant que le programme se charge : « Mes charges » ne dit pas « pas de programme » trop tôt.
  const exercises = useMemo(
    () =>
      program === undefined ? null : program === null ? [] : ctx ? programExercises(program, ctx) : null,
    [program, ctx],
  );
  const exerciseName = (id: string) => exercises?.find((e) => e.id === id)?.name ?? null;
  const chooseGuided = (guided: GuidedRequest) => {
    setGuidedOpen(false);
    setRefocus((n) => n + 1);
    void store.sendGuided(guided, exerciseName, nutritionFull);
  };
  // Puces de suite : sous la dernière réponse, si elle est finie, d'un message venu d'un parcours, et seulement alors.
  const lastReply = messages.at(-1);
  const asked = messages.at(-2);
  const followUps =
    phase === 'idle' &&
    pending === null &&
    lastReply?.role === 'assistant' &&
    !lastReply.replaced &&
    asked?.role === 'user' &&
    asked.guided !== undefined
      ? (flows.find((f) => f.id === asked.guided?.flow)?.followUps ?? [])
      : [];
  const threadId = today?.thread?.id ?? null;

  /**
   * Cartes d'une réponse : aide, puis propositions. Une proposition dont la ligne est dans le miroir se lit depuis
   * elle ; sinon l'événement du flux, s'il y en a un, tient la place (« en préparation »).
   */
  const cardsOf = (
    helpCards: readonly HelpResourceId[],
    proposals: readonly { id: string; event?: CoachProposalEvent }[],
  ) => {
    const rows = new Map([...(program?.proposals ?? []), ...(program?.changes ?? [])].map((c) => [c.id, c]));
    // Sans ligne ni événement (la réponse est finie, le pull n'a pas encore apporté la ligne) : « en préparation ».
    const shown = proposals.map(({ id, event }) => ({ id, proposal: rows.get(id) ?? event ?? null }));
    if (helpCards.length === 0 && shown.length === 0) return null;
    return (
      <div className={styles.cards}>
        {helpCards.map((resource) => (
          <HelpCard key={resource} resource={resource} minor={minor} />
        ))}
        {program && ctx && names
          ? shown.map(({ id, proposal }) =>
              proposal === null ? (
                <PreparingCard key={id} />
              ) : (
                <ProposalCard
                  key={id}
                  proposal={proposal}
                  view={program}
                  ctx={ctx}
                  names={names}
                  offline={noNetwork}
                  compact
                />
              ),
            )
          : null}
      </div>
    );
  };

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
    phase === 'error' && error !== null && error !== 'thread_closed' && (error !== 'offline' || noNetwork) ? (
      <div className={styles.state}>
        <Banner tone={offline ? 'warning' : 'error'}>{errorText(error)}</Banner>
        {FINAL_ERRORS.has(error) || (error === 'validation' && pending?.guided !== undefined) ? null : (
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
    // Fil fermé : la saisie est retirée, l'accueil et les suggestions (qui la remplissent) le sont avec elle.
    const empty = messages.length === 0 && !showPending && !closed;
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
              <GuidedFlow
                key={userId}
                flows={flows}
                exercises={exercises}
                disabled={blocked}
                onChoose={chooseGuided}
              />
            </div>
          ) : null}
          {messages.map((m) =>
            m.role === 'user' ? (
              <ChatBubble key={m.seq} author="user" text={m.text} guided={m.guided !== undefined} />
            ) : (
              <Fragment key={m.seq}>
                <ChatBubble
                  author="assistant"
                  coach={coach}
                  text={m.text}
                  truncated={m.truncated}
                  onReport={threadId === null ? undefined : () => setReport({ threadId, messageSeq: m.seq })}
                />
                {cardsOf(
                  m.helpCards,
                  m.proposalIds.map((id) => ({ id })),
                )}
                {state.nutritionScreens[m.seq] ? (
                  <NutritionScreenButton offer={state.nutritionScreens[m.seq] as NutritionScreenOffer} />
                ) : null}
              </Fragment>
            ),
          )}
          {showPending && pending ? (
            <>
              <ChatBubble author="user" text={pending.text} guided={pending.guided !== undefined} />
              {pending.bubble !== '' || pending.tool !== null ? (
                <ChatBubble
                  author="assistant"
                  coach={coach}
                  text={pending.bubble}
                  streaming
                  toolLabel={pending.tool ? TOOL_LABELS[pending.tool] : null}
                />
              ) : null}
              {cardsOf(
                pending.helpCards,
                pending.proposals.map((event) => ({ id: event.id, event })),
              )}
              {pending.nutritionScreen ? <NutritionScreenButton offer={pending.nutritionScreen} /> : null}
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
            {followUps.length > 0 ? (
              <div className={styles.followUps}>
                <div className={styles.guidedChips}>
                  {followUps.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className={styles.guidedChip}
                      disabled={blocked}
                      onClick={() => void store.sendText(u.text)}
                    >
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {empty ? null : (
              <>
                <button
                  ref={toggle}
                  type="button"
                  className={styles.guidedToggle}
                  aria-expanded={guidedOpen}
                  onClick={() => setGuidedOpen((open) => !open)}
                >
                  {GUIDED_TEXTS.open}
                </button>
                {guidedOpen ? (
                  <GuidedFlow
                    key={userId}
                    flows={flows}
                    exercises={exercises}
                    disabled={blocked}
                    onChoose={chooseGuided}
                    onCancel={() => {
                      setGuidedOpen(false);
                      setRefocus((n) => n + 1);
                    }}
                  />
                ) : null}
              </>
            )}
            <Composer
              inputRef={field}
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
      {report ? <ReportSheet {...report} onClose={() => setReport(null)} /> : null}
      <p role="status" className={styles.srOnly}>
        {announced ? 'Le coach a répondu' : ''}
      </p>
    </Page>
  );
}
