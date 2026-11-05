import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CoachProposalEvent, CoachTodayResponse } from '@rune/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachPage } from '../../src/features/coach/CoachPage';
import type { CoachState, CoachStore } from '../../src/features/coach/coach-store';
import {
  counterText,
  PARENT_LINE,
  STATE_TEXTS,
  SUGGESTIONS,
  TOOL_LABELS,
} from '../../src/features/coach/coach-texts';
import { declarationsOf, parseCssBlocks } from '../support/css-blocks';
import { createFakeApi, createFakeSyncEngine } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { changeRow, seedProgram } from '../support/program';
import { renderWithServices } from '../support/render';
import { seedMirror } from '../support/seed';

// Faux dépôt : le magasin est remplacé par un état que le test pilote.
const fake = vi.hoisted(() => ({
  state: null as unknown as CoachState,
  listeners: new Set<() => void>(),
}));

const spies = vi.hoisted(() => ({
  load: vi.fn(async () => {}),
  send: vi.fn(async () => {}),
  retry: vi.fn(async () => {}),
  pollInProgress: vi.fn(async () => {}),
  setDraft: vi.fn(),
}));

function set(patch: Partial<CoachState>) {
  act(() => {
    fake.state = { ...fake.state, ...patch };
    for (const fn of fake.listeners) fn();
  });
}

const fakeStore: CoachStore = {
  getState: () => fake.state,
  subscribe: () => () => {},
  load: spies.load,
  grant: async () => {},
  withdraw: async () => {},
  send: spies.send,
  retry: spies.retry,
  pollInProgress: spies.pollInProgress,
  setDraft: (text: string) => {
    spies.setDraft(text);
    set({ draft: text });
  },
};

vi.mock('../../src/features/coach/coach-store', () => ({
  useCoachStore: () => {
    const state = useSyncExternalStore(
      (fn) => {
        fake.listeners.add(fn);
        return () => fake.listeners.delete(fn);
      },
      () => fake.state,
    );
    return { state, store: fakeStore };
  },
}));

const STATUS = {
  available: true,
  unavailableReason: null,
  suspendedUntil: null,
  consent: { active: true, textVersion: 'v1', currentVersion: 'v1', needsRenewal: false },
  audience: 'adult',
  persona: 'skald',
  today: {
    threadId: 't1',
    open: true,
    closedReason: null,
    userMessageCount: 1,
    remaining: 20,
    inProgress: false,
  },
  budgetUsedPct: 10,
  devUnevaluated: false,
} as const;

const THREAD = {
  id: 't1',
  day: '2026-10-06',
  audience: 'adult',
  persona: 'skald',
  open: true,
  closedReason: null,
  userMessageCount: 1,
  createdAt: '2026-10-06T10:00:00.000Z',
} as const;

function message(seq: number, role: 'user' | 'assistant', text: string, extra: object = {}) {
  return {
    seq,
    role,
    text,
    createdAt: '2026-10-06T10:00:00.000Z',
    aiGenerated: role === 'assistant',
    model: null,
    truncated: false,
    replaced: false,
    helpCards: [],
    proposalIds: [],
    links: [],
    ...extra,
  };
}

const TODAY = {
  thread: THREAD,
  messages: [message(1, 'user', 'Salut'), message(2, 'assistant', 'Bonjour, voici ma réponse.')],
  inProgress: false,
} as CoachTodayResponse;

const EMPTY_TODAY = { thread: null, messages: [], inProgress: false } as CoachTodayResponse;

const status = (patch: Record<string, unknown> = {}, today: Record<string, unknown> = {}) =>
  ({ ...STATUS, ...patch, today: { ...STATUS.today, ...today } }) as CoachState['status'];

function init(patch: Partial<CoachState> = {}) {
  fake.state = {
    status: status(),
    today: TODAY,
    draft: '',
    pending: null,
    phase: 'idle',
    error: null,
    refusalMessage: null,
    ...patch,
  };
}

const PENDING = {
  clientMessageId: 'c1',
  text: 'Une question',
  bubble: '',
  tool: null,
  helpCards: [],
  proposals: [],
};

const renderPage = () => renderWithServices(<CoachPage />, { path: '/coach' });
const sendButton = () => screen.getByRole('button', { name: 'Envoyer' });
const field = () => screen.getByRole('textbox', { name: /message/i }) as HTMLTextAreaElement;

beforeEach(() => {
  fake.listeners.clear();
  for (const s of Object.values(spies)) s.mockClear();
  init();
});

describe('CoachPage : en-tête, bandeau, fil', () => {
  it('appelle load() à l’ouverture', async () => {
    await renderPage();
    expect(spies.load).toHaveBeenCalledTimes(1);
  });

  it('en-tête : « Coach IA », avatar, « Voix : le Skald », menu « ⋯ » et ses trois entrées', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Coach IA' })).toBeTruthy();
    expect(screen.getAllByRole('img', { name: 'Le Skald' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Voix : le Skald')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Menu du coach' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Ce que le coach voit' }).getAttribute('href')).toBe(
      '/coach/brief',
    );
    expect(within(dialog).getByRole('link', { name: 'Conversations précédentes' }).getAttribute('href')).toBe(
      '/coach/threads',
    );
    expect(within(dialog).getByRole('link', { name: 'Bien utiliser le coach' }).getAttribute('href')).toBe(
      '/help/coach',
    );
  });

  it('bandeau IA fixe, sans bouton pour le masquer', async () => {
    await renderPage();
    const banner = screen.getByText(/Tu échanges avec une intelligence artificielle/);
    const box = banner.closest('[role="status"]') as HTMLElement;
    expect(box.textContent).toContain("En cas d'urgence : 15 ou 112.");
    expect(within(box).queryByRole('button')).toBeNull();
  });

  it('fil vide : message d’accueil et 3 suggestions qui remplissent le champ sans envoyer', async () => {
    init({ today: EMPTY_TODAY, status: status({}, { threadId: null, open: false, userMessageCount: 0 }) });
    await renderPage();
    expect(screen.getByText("Message d'accueil")).toBeTruthy();
    expect(
      screen.getByText('Pose-moi une question sur ton programme, ta technique ou ta récupération.'),
    ).toBeTruthy();
    for (const name of [
      'Explique ma prochaine séance',
      'Pourquoi ma charge ne monte pas ?',
      'Ajuster mon programme',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Explique ma prochaine séance' }));
    expect(spies.setDraft).toHaveBeenCalledWith('Explique ma prochaine séance');
    expect(field().value).toBe('Explique ma prochaine séance');
    expect(spies.send).not.toHaveBeenCalled();
  });

  it('bulle du coach : badge « IA », data-ai-generated, « Signaler » ; bulle de la personne sans', async () => {
    await renderPage();
    const log = screen.getByRole('log');
    const coach = within(log)
      .getByText('Bonjour, voici ma réponse.')
      .closest('[data-ai-generated]') as HTMLElement;
    expect(coach.getAttribute('data-ai-generated')).toBe('true');
    expect(within(coach).getByText('IA')).toBeTruthy();
    expect(within(coach).getByRole('button', { name: 'Signaler' })).toBeTruthy();
    const mine = within(log).getByText('Salut').closest('[data-role]') as HTMLElement;
    expect(mine.getAttribute('data-ai-generated')).toBeNull();
    expect(within(mine).queryByText('IA')).toBeNull();
    expect(within(mine).queryByRole('button', { name: 'Signaler' })).toBeNull();
  });

  it('« Réponse coupée » si truncated', async () => {
    init({
      today: {
        ...TODAY,
        messages: [message(1, 'user', 'Q'), message(2, 'assistant', 'R', { truncated: true })],
      },
    });
    await renderPage();
    expect(screen.getByText('Réponse coupée')).toBeTruthy();
  });

  it('le fil a role="log" ; « Le coach a répondu » n’est annoncé qu’à done', async () => {
    init({ pending: { ...PENDING, bubble: 'Première phrase. ' }, phase: 'streaming' });
    await renderPage();
    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-busy')).toBe('true');
    expect(within(log).getByText('Première phrase.')).toBeTruthy();
    expect(screen.queryByText('Le coach a répondu')).toBeNull();
    set({ pending: { ...PENDING, bubble: 'Première phrase. Deuxième phrase.' } });
    expect(screen.queryByText('Le coach a répondu')).toBeNull();
    set({ pending: null, phase: 'idle' });
    expect(screen.getByText('Le coach a répondu')).toBeTruthy();
    expect(screen.getByRole('log').getAttribute('aria-busy')).toBe('false');
  });

  it('pas d’annonce quand l’échange finit en erreur', async () => {
    init({ pending: PENDING, phase: 'streaming' });
    await renderPage();
    set({ phase: 'error', error: 'internal' });
    expect(screen.queryByText('Le coach a répondu')).toBeNull();
  });

  it('libellé d’outil pendant tool_running', async () => {
    init({ pending: { ...PENDING, tool: 'read_training' }, phase: 'streaming' });
    await renderPage();
    expect(screen.getByText(TOOL_LABELS.read_training)).toBeTruthy();
  });

  it('cartes et propositions déjà arrivées : rien ne casse (rendu à la Task 26)', async () => {
    init({
      pending: {
        ...PENDING,
        bubble: 'Texte.',
        helpCards: ['urgences'] as never,
        proposals: [{ type: 'proposal', id: 'p1' } as never],
      },
      phase: 'streaming',
    });
    await renderPage();
    expect(screen.getByText('Texte.')).toBeTruthy();
  });

  it('mode dev : bannière au-dessus du fil', async () => {
    init({ status: status({ devUnevaluated: true }) });
    await renderPage();
    expect(screen.getByText('Mode dev : combinaison non évaluée')).toBeTruthy();
  });

  it('pas de bannière de mode dev en production', async () => {
    await renderPage();
    expect(screen.queryByText('Mode dev : combinaison non évaluée')).toBeNull();
  });
});

describe('CoachPage : états du §16.2', () => {
  it('accord absent : fenêtre du Système et « Activer le coach »', async () => {
    init({ status: status({ consent: { ...STATUS.consent, active: false, textVersion: null } }) });
    await renderPage();
    expect(screen.getByText(STATE_TEXTS.consentMissing)).toBeTruthy();
    expect(screen.getByText('SYSTÈME', { exact: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activer le coach' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it("accord retiré pendant l'échange (consent_withdrawn) : le panneau « Activer le coach », pas de bannière sans issue", async () => {
    init({
      status: status({ consent: { ...STATUS.consent, active: false, textVersion: null } }),
      pending: PENDING,
      draft: PENDING.text,
      phase: 'error',
      error: 'consent_withdrawn',
    });
    await renderPage();
    expect(screen.getByRole('button', { name: 'Activer le coach' })).toBeTruthy();
    expect(screen.getAllByText(STATE_TEXTS.consentMissing)).toHaveLength(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('nouveau texte d’accord : même fenêtre, texte « a changé »', async () => {
    init({ status: status({ consent: { ...STATUS.consent, needsRenewal: true } }) });
    await renderPage();
    expect(screen.getByText("Le texte de l'accord a changé.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activer le coach' })).toBeTruthy();
  });

  it('coupé ou non configuré', async () => {
    init({ status: status({ available: false, unavailableReason: 'disabled' }) });
    await renderPage();
    expect(screen.getByText('Le coach est en pause pour le cercle.')).toBeTruthy();
  });

  it('suspendu', async () => {
    init({ status: status({ available: false, unavailableReason: 'suspended' }) });
    await renderPage();
    expect(screen.getByText("Le coach est en pause pour tout le cercle jusqu'au 1er du mois.")).toBeTruthy();
  });

  it('limite du jour', async () => {
    init({ status: status({}, { remaining: 0 }) });
    await renderPage();
    expect(screen.getByText("Tu as envoyé 30 messages aujourd'hui. Le coach revient demain.")).toBeTruthy();
    expect(sendButton().hasAttribute('disabled')).toBe(true);
  });

  it('budget du mois', async () => {
    init({ status: status({ budgetUsedPct: 100 }) });
    await renderPage();
    expect(
      screen.getByText('Tu as atteint la limite du mois pour le coach. Il revient le 1er.'),
    ).toBeTruthy();
    expect(sendButton().hasAttribute('disabled')).toBe(true);
  });

  it('fil fermé : texte et lien « Conversations précédentes »', async () => {
    init({ status: status({}, { open: false, closedReason: 'day_over' }) });
    await renderPage();
    expect(screen.getByText('Ta conversation du jour est close. Reviens demain.')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'Conversations précédentes' });
    expect(links.some((l) => l.getAttribute('href') === '/coach/threads')).toBe(true);
  });

  it('fil fermé annoncé par le flux (thread_closed) : même texte', async () => {
    init({ phase: 'error', error: 'thread_closed', pending: PENDING, draft: 'Une question' });
    await renderPage();
    expect(screen.getByText('Ta conversation du jour est close. Reviens demain.')).toBeTruthy();
  });

  it('réponse en cours ailleurs : texte, sondage lancé, saisie inactive', async () => {
    init({ status: status({}, { inProgress: true }), today: { ...TODAY, inProgress: true } });
    await renderPage();
    expect(screen.getByText('Le coach termine une réponse…')).toBeTruthy();
    expect(spies.pollInProgress).toHaveBeenCalled();
    expect(sendButton().hasAttribute('disabled')).toBe(true);
  });

  it('hors ligne avec un fil chargé : bannière, fil visible, saisie inactive, texte gardé', async () => {
    init({ phase: 'error', error: 'offline', draft: 'Mon texte' });
    await renderWithServices(<CoachPage />, {
      path: '/coach',
      sync: createFakeSyncEngine({ connection: 'offline' }),
    });
    expect(screen.getByText('Hors ligne : le coach a besoin du réseau.')).toBeTruthy();
    expect(screen.getByText('Bonjour, voici ma réponse.')).toBeTruthy();
    expect(field().value).toBe('Mon texte');
    expect(field().disabled).toBe(true);
    expect(sendButton().hasAttribute('disabled')).toBe(true);
  });

  it('la saisie suit le réseau : coupée hors ligne, rendue au retour, même si l’erreur offline reste dans le magasin', async () => {
    init({ phase: 'idle' });
    const sync = createFakeSyncEngine({ connection: 'online' });
    await renderWithServices(<CoachPage />, { path: '/coach', sync });
    expect(field().disabled).toBe(false);
    act(() => sync.set({ connection: 'offline' }));
    expect(field().disabled).toBe(true);
    // L'échec `offline` d'un envoi reste en mémoire : il n'éteint plus la saisie quand le réseau revient.
    set({ phase: 'error', error: 'offline', draft: 'Mon texte' });
    act(() => sync.set({ connection: 'online' }));
    expect(field().disabled).toBe(false);
    fireEvent.change(field(), { target: { value: 'Mon texte' } });
    expect(sendButton().hasAttribute('disabled')).toBe(false);
  });

  it('hors ligne, fil vide : les suggestions sont inactives comme le champ', async () => {
    init({ today: EMPTY_TODAY, status: status({}, { threadId: null, userMessageCount: 0 }) });
    await renderWithServices(<CoachPage />, {
      path: '/coach',
      sync: createFakeSyncEngine({ connection: 'offline' }),
    });
    const suggestions = SUGGESTIONS.map((text) => screen.getByRole('button', { name: text }));
    expect(suggestions.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('fil fermé et vide : ni accueil ni suggestions, la saisie étant retirée', async () => {
    init({
      status: status({}, { open: false, closedReason: 'day' }),
      today: { ...EMPTY_TODAY, thread: { ...THREAD, open: false } } as CoachTodayResponse,
    });
    await renderPage();
    expect(screen.getByText(STATE_TEXTS.threadClosed)).toBeTruthy();
    expect(screen.queryByText("Message d'accueil")).toBeNull();
    expect(screen.queryByRole('button', { name: SUGGESTIONS[0] as string })).toBeNull();
  });

  it('hors ligne sans fil chargé', async () => {
    init({ status: null, today: null, phase: 'error', error: 'offline' });
    await renderPage();
    expect(screen.getByText('Hors ligne : le coach a besoin du réseau.')).toBeTruthy();
    expect(screen.getByText('Connecte-toi pour parler au coach.')).toBeTruthy();
  });

  it('erreur : texte et « Réessayer » qui relance retry() ; le texte est rendu au champ', async () => {
    init({ phase: 'error', error: 'api_unavailable', pending: PENDING, draft: 'Une question' });
    await renderPage();
    expect(screen.getByText('Coach indisponible, réessaie plus tard.')).toBeTruthy();
    expect(field().value).toBe('Une question');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(spies.retry).toHaveBeenCalledTimes(1);
  });

  it('erreur de chargement sans message à renvoyer : « Réessayer » relit', async () => {
    init({ status: null, today: null, phase: 'error', error: 'internal' });
    await renderPage();
    spies.load.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(spies.load).toHaveBeenCalledTimes(1);
    expect(spies.retry).not.toHaveBeenCalled();
  });

  it('refus : le message du serveur, tel quel', async () => {
    init({ phase: 'refused', refusalMessage: 'Message du serveur, neutre.', draft: 'Q' });
    await renderPage();
    expect(screen.getByText('Message du serveur, neutre.')).toBeTruthy();
    expect(screen.queryByText('Le coach ne peut pas répondre à cette demande.')).toBeNull();
  });

  it('refus sans message : le texte du §16.2', async () => {
    init({ phase: 'refused', refusalMessage: null, draft: 'Q' });
    await renderPage();
    expect(screen.getByText('Le coach ne peut pas répondre à cette demande.')).toBeTruthy();
  });
});

describe('CoachPage : saisie', () => {
  it('compteur dès 1 800 points de code, pas avant', async () => {
    await renderPage();
    fireEvent.change(field(), { target: { value: 'a'.repeat(1799) } });
    expect(screen.queryByText(/\/ 2 000/)).toBeNull();
    fireEvent.change(field(), { target: { value: 'a'.repeat(1800) } });
    expect(screen.getByText('1 800 / 2 000')).toBeTruthy();
  });

  it('1 950 « 💪 » comptent 1 950 points de code, pas 3 900 unités', async () => {
    await renderPage();
    fireEvent.change(field(), { target: { value: '💪'.repeat(1950) } });
    expect(screen.getByText(counterText(1950))).toBeTruthy();
    expect(counterText(1950)).toBe('1 950 / 2 000');
    expect(sendButton().hasAttribute('disabled')).toBe(false);
  });

  it('2 001 points de code : « Envoyer » inactif', async () => {
    await renderPage();
    fireEvent.change(field(), { target: { value: 'a'.repeat(2001) } });
    expect(screen.getByText('2 001 / 2 000')).toBeTruthy();
    expect(sendButton().hasAttribute('disabled')).toBe(true);
    fireEvent.change(field(), { target: { value: 'a'.repeat(2000) } });
    expect(sendButton().hasAttribute('disabled')).toBe(false);
  });

  it('« Envoyer » envoie ; inactif champ vide et pendant un échange', async () => {
    await renderPage();
    expect(sendButton().hasAttribute('disabled')).toBe(true);
    fireEvent.change(field(), { target: { value: 'Bonjour' } });
    fireEvent.click(sendButton());
    expect(spies.send).toHaveBeenCalledTimes(1);
    set({ phase: 'streaming', pending: PENDING });
    expect(sendButton().hasAttribute('disabled')).toBe(true);
  });

  it('« Il te reste N messages aujourd’hui » à 5, rien à 6', async () => {
    init({ status: status({}, { remaining: 6 }) });
    await renderPage();
    expect(screen.queryByText(/Il te reste/)).toBeNull();
    set({ status: status({}, { remaining: 5 }) });
    expect(screen.getByText("Il te reste 5 messages aujourd'hui")).toBeTruthy();
  });

  it('« Tu as utilisé N % de ton budget du mois » à 80, rien à 79', async () => {
    init({ status: status({ budgetUsedPct: 79 }) });
    await renderPage();
    expect(screen.queryByText(/Tu as utilisé/)).toBeNull();
    set({ status: status({ budgetUsedPct: 80 }) });
    expect(screen.getByText('Tu as utilisé 80 % de ton budget du mois')).toBeTruthy();
  });

  it('ni localStorage ni sessionStorage ne reçoivent le texte', async () => {
    await renderPage();
    fireEvent.change(field(), { target: { value: 'Mon texte secret' } });
    for (const area of [localStorage, sessionStorage]) {
      expect(JSON.stringify({ ...area })).not.toContain('secret');
    }
  });
});

describe('coach-page.module.css', () => {
  const css = readFileSync(
    resolve(import.meta.dirname, '../../src/features/coach/coach-page.module.css'),
    'utf8',
  );
  const blocks = parseCssBlocks(css);
  const REDUCE = '(prefers-reduced-motion: reduce)';

  it('champ en 16 px, « Envoyer », « ⋯ » et « Signaler » de 48 px', () => {
    expect(declarationsOf(blocks, '.field')?.get('font-size')).toBe('16px');
    for (const selector of ['.send', '.menuButton', '.report']) {
      expect(declarationsOf(blocks, selector)?.get('min-height'), selector).toBe('48px');
      expect(declarationsOf(blocks, selector)?.get('min-width'), selector).toBe('48px');
    }
  });

  it('liens des cartes, choix de catégorie : cibles de 48 px (la carte du programme comprise)', () => {
    for (const selector of ['.action', '.reportChoice']) {
      expect(declarationsOf(blocks, selector)?.get('min-height'), selector).toBe('48px');
    }
    expect(declarationsOf(blocks, '.action')?.get('min-width')).toBe('48px');
    const program = parseCssBlocks(
      readFileSync(resolve(import.meta.dirname, '../../src/features/program/program.module.css'), 'utf8'),
    );
    expect(declarationsOf(program, '.cardLink')?.get('min-height')).toBe('48px');
  });

  it('mouvement réduit : aucune animation des phrases ni des cartes', () => {
    const animated = blocks
      .filter((b) => b.media === null && b.declarations.has('animation'))
      .map((b) => b.selector);
    expect(animated.length).toBeGreaterThan(0);
    for (const selector of animated) {
      expect(declarationsOf(blocks, selector, REDUCE)?.get('animation'), selector).toBe('none');
    }
  });

  it('aucune couleur écrite en dur', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(/i);
  });
});

describe('CoachPage : cartes d’aide et de proposition, signalement', () => {
  const ROW = changeRow('c-coach', {
    author: 'coach',
    operations: [{ op: 'replace_exercise', slot: 'A1', exercise: 'goblet-squat' }],
    reasonCode: 'COACH_PROPOSAL',
    reason: 'Ton genou te gêne sur la barre.',
    status: 'proposed',
    baseRevision: 4,
    createdAt: '2026-10-05T08:00:00.000Z',
    expiresAt: '2026-10-12T08:00:00.000Z',
    decidedAt: null,
    aiGenerated: true,
    aiModel: 'claude-opus-5-5',
    coachThreadId: 't1',
  });
  const EVENT: CoachProposalEvent = {
    type: 'proposal',
    id: 'c-coach',
    baseRevision: 4,
    operations: [{ op: 'replace_exercise', slot: 'A1', exercise: 'goblet-squat' }],
    reasonCode: 'COACH_PROPOSAL',
    reason: 'Ton genou te gêne sur la barre.',
    expiresAt: '2026-10-12T08:00:00.000Z',
  };
  const URGENCE = 'Urgence vitale (SAMU 15, numéro européen 112)';
  const LAZY = { timeout: 10_000 };

  async function open(rows: Record<string, unknown>[] = []) {
    const db = createTestLocalDb();
    await seedProgram(db);
    if (rows.length > 0) await seedMirror(db, 'instance_change', rows);
    const api = createFakeApi();
    api.on('POST', '/api/coach/reports', { status: 201, body: { id: 'r-1' } });
    const rendered = await renderWithServices(<CoachPage />, { path: '/coach', db, api });
    return { ...rendered, db, api };
  }

  it('flux en cours : les cartes arrivent après le texte de la bulle, la proposition « en préparation »', async () => {
    init({
      phase: 'streaming',
      pending: {
        ...PENDING,
        bubble: 'Voici ce que je te propose.',
        helpCards: ['emergency'],
        proposals: [EVENT],
      },
    });
    await open();
    await screen.findByText('en préparation', {}, LAZY);
    const bubble = screen.getByText('Voici ce que je te propose.');
    const help = screen.getByRole('region', { name: URGENCE });
    const proposal = screen.getByRole('article');
    expect(bubble.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(help.compareDocumentPosition(proposal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((within(proposal).getByRole('button', { name: 'Accepter' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('la ligne arrivée par le pull (même id) rend la carte active, sans doublon', async () => {
    init({ phase: 'streaming', pending: { ...PENDING, bubble: 'Voici.', proposals: [EVENT] } });
    const { db } = await open();
    await screen.findByText('en préparation', {}, LAZY);
    await act(async () => seedMirror(db, 'instance_change', [ROW]));
    await waitFor(
      () =>
        expect((screen.getByRole('button', { name: 'Accepter' }) as HTMLButtonElement).disabled).toBe(false),
      LAZY,
    );
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('après done : les cartes relues depuis today remplacent celles du flux', async () => {
    init({
      today: {
        ...TODAY,
        messages: [
          message(1, 'user', 'Salut'),
          message(2, 'assistant', 'Bonjour.', { helpCards: ['distress'], proposalIds: ['c-coach'] }),
        ],
      } as CoachTodayResponse,
    });
    await open([ROW]);
    await screen.findByRole('article', {}, LAZY);
    expect(screen.getByRole('region', { name: 'Prévention du suicide' })).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getAllByRole('region', { name: /Urgence|Prévention/ })).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Accepter' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('après done, la ligne pas encore arrivée dans le miroir : la carte « en préparation » reste, puis devient active', async () => {
    init({
      today: {
        ...TODAY,
        messages: [
          message(1, 'user', 'Salut'),
          message(2, 'assistant', 'Voici.', { proposalIds: ['c-coach'] }),
        ],
      } as CoachTodayResponse,
    });
    const { db } = await open();
    await screen.findByText('en préparation', {}, LAZY);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    await act(async () => seedMirror(db, 'instance_change', [ROW]));
    await waitFor(
      () =>
        expect((screen.getByRole('button', { name: 'Accepter' }) as HTMLButtonElement).disabled).toBe(false),
      LAZY,
    );
    expect(screen.queryByText('en préparation')).toBeNull();
  });

  it('mineur : la carte d’aide porte la ligne « parle à un adulte »', async () => {
    init({
      status: status({ audience: 'minor' }),
      today: {
        ...TODAY,
        thread: { ...THREAD, audience: 'minor' },
        messages: [
          message(1, 'user', 'Salut'),
          message(2, 'assistant', 'Bonjour.', { helpCards: ['distress'] }),
        ],
      } as CoachTodayResponse,
    });
    await open();
    expect(await screen.findByText(PARENT_LINE)).toBeTruthy();
  });

  it('« Signaler » ouvre la feuille avec le fil et le numéro du message', async () => {
    const { api } = await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Signaler' }));
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Inexact' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Envoyer' }));
    await screen.findByText("Merci, l'admin le lira.");
    expect(api.calls.find((c) => c.path === '/api/coach/reports')?.body).toEqual({
      threadId: 't1',
      messageSeq: 2,
      category: 'inaccurate',
    });
  });
});
