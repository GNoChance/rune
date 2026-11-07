import { FORBIDDEN_TERMS, type NutritionMode } from '@rune/contracts';
import { normalizeForTerms, outputFilterText } from '@rune/domain';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CoachPage } from '../../src/features/coach/CoachPage';
import { NUTRITION_BUTTONS } from '../../src/features/coach/coach-texts';
import { HelpCard } from '../../src/features/coach/HelpCard';
import { setMeta } from '../../src/local-db/meta';
import { coachMessage, coachStatus, EMPTY_TODAY } from '../support/coach';
import { createFakeApi, type FakeApi } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { renderWithServices } from '../support/render';
import { until } from '../support/wait';

/* Bouton « Ouvrir mes réglages nutrition » (brique 5 §11.2), carte TCA (§11.3), puces de `full` (§11.6). */

const THREAD = {
  id: 't1',
  day: '2026-10-06',
  audience: 'adult',
  persona: 'skald',
  open: true,
  closedReason: null,
  userMessageCount: 1,
  createdAt: '2026-10-06T10:00:00.000Z',
};
const REPLY = 'Je te propose un réglage.';
const TODAY = {
  thread: THREAD,
  messages: [coachMessage(1, 'user', 'Je bouge plus'), coachMessage(2, 'assistant', REPLY)],
  inProgress: false,
};
const DONE = `event: done\ndata: ${JSON.stringify({
  threadId: 't1',
  userSeq: 1,
  assistantSeq: 2,
  truncated: false,
  replaced: false,
  proposalIds: [],
  remainingToday: 29,
})}\n\n`;
const frame = (type: string, data: object) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const sse = (...frames: string[]) => ({
  status: 200,
  headers: { 'Content-Type': 'text/event-stream' },
  body: frames.join(''),
});

async function open(events: string[], mode: NutritionMode = 'full') {
  const db = createTestLocalDb();
  await setMeta(db, 'nutritionEffectiveMode', mode);
  let sent = false;
  const api: FakeApi = createFakeApi()
    .on('GET', '/api/coach/status', { status: 200, body: coachStatus() })
    .on('GET', '/api/coach/today', () => ({ status: 200, body: sent ? TODAY : EMPTY_TODAY }))
    .on('POST', '/api/coach/messages', () => {
      sent = true;
      return sse(frame('text', { text: REPLY }), ...events, DONE);
    });
  const view = await renderWithServices(<CoachPage />, { path: '/coach', db, api });
  await screen.findByRole('log');
  return { ...view, api, db };
}

async function ask() {
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Je bouge plus' } });
  fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
  await until(() => screen.queryByText(REPLY) !== null);
}

const buttons = () => screen.queryAllByRole('link', { name: NUTRITION_BUTTONS.openSettings });

describe('bouton sous la bulle (événement nutrition_screen)', () => {
  it('mène aux réglages avec l’écran et la valeur à présélectionner, après la fin de la réponse', async () => {
    await open([frame('nutrition_screen', { screen: 'goal', suggestion: 'maintain' })]);
    await ask();
    await until(() => buttons().length === 1);
    expect(buttons()[0]?.getAttribute('href')).toBe('/nutrition/settings?focus=goal&suggest=maintain');
  });

  it('sans suggestion : seulement l’écran', async () => {
    await open([frame('nutrition_screen', { screen: 'activity' })]);
    await ask();
    await until(() => buttons().length === 1);
    expect(buttons()[0]?.getAttribute('href')).toBe('/nutrition/settings?focus=activity');
  });

  it('un seul bouton par message, le premier événement l’emporte', async () => {
    await open([
      frame('nutrition_screen', { screen: 'mode', suggestion: 'qualitative' }),
      frame('nutrition_screen', { screen: 'goal', suggestion: 'gain' }),
    ]);
    await ask();
    await until(() => buttons().length === 1);
    expect(buttons()[0]?.getAttribute('href')).toBe('/nutrition/settings?focus=mode&suggest=qualitative');
  });

  it('une réponse sans l’événement : aucun bouton ; un fil relu sans le flux non plus (rien n’est stocké)', async () => {
    await open([]);
    await ask();
    expect(buttons()).toHaveLength(0);
    const db = createTestLocalDb();
    const api = createFakeApi()
      .on('GET', '/api/coach/status', { status: 200, body: coachStatus() })
      .on('GET', '/api/coach/today', { status: 200, body: TODAY });
    await renderWithServices(<CoachPage />, { path: '/coach', db, api });
    await screen.findByText(REPLY);
    expect(buttons()).toHaveLength(0);
  });

  it('les libellés passent le filtre de sortie et les termes interdits', () => {
    for (const text of Object.values(NUTRITION_BUTTONS)) {
      for (const audience of ['adult', 'minor'] as const) {
        expect(
          outputFilterText(text, {
            audience,
            nutritionMode: 'none',
            allowed: { mass: new Set(), percent: new Set(), nutrition: new Set(), volume: new Set() },
          }),
        ).toEqual({ ok: true });
      }
      const haystack = ` ${normalizeForTerms(text)} `;
      for (const t of [...FORBIDDEN_TERMS.all, ...FORBIDDEN_TERMS.minor]) {
        for (const form of [t.term, ...t.forms]) {
          expect(haystack).not.toContain(` ${normalizeForTerms(form)} `);
        }
      }
    }
  });
});

describe('carte TCA', () => {
  const NO_NUMBERS = 'Passer en mode sans chiffres';

  async function card(
    mode: NutritionMode | null,
    resource: 'eating_disorder' | 'distress' = 'eating_disorder',
  ) {
    const db = createTestLocalDb();
    if (mode) await setMeta(db, 'nutritionEffectiveMode', mode);
    await renderWithServices(<HelpCard resource={resource} minor={false} />, { db });
  }

  it('en full : « Passer en mode sans chiffres » vers le mode, présélection « sans chiffres »', async () => {
    await card('full');
    const link = await screen.findByRole('link', { name: NO_NUMBERS });
    expect(link.getAttribute('href')).toBe('/nutrition/settings?focus=mode&suggest=qualitative');
  });

  it.each(['qualitative', 'disabled', null] as const)('mode %s : pas de bouton', async (mode) => {
    await card(mode);
    await screen.findByRole('link', { name: "Ouvrir l'aide" });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('link', { name: NO_NUMBERS })).toBeNull();
  });

  it('une autre ressource en full : pas de bouton', async () => {
    await card('full', 'distress');
    await screen.findByRole('link', { name: "Ouvrir l'aide" });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('link', { name: NO_NUMBERS })).toBeNull();
  });
});

describe('parcours Nutrition selon le mode de l’appareil', () => {
  const posts = (api: FakeApi) =>
    api.calls.filter((c) => c.method === 'POST' && c.path === '/api/coach/messages');

  it('en full : « Mes repères » et « Mon bilan de la semaine » ; le message part avec le parcours', async () => {
    const { api } = await open([], 'full');
    fireEvent.click(await screen.findByRole('button', { name: 'Nutrition' }));
    expect(await screen.findByRole('button', { name: 'Mon bilan de la semaine' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mes repères' }));
    await until(() => posts(api).length === 1);
    expect(posts(api)[0]?.body).toMatchObject({ guided: { flow: 'nutrition', choices: ['targets'] } });
  });

  it('en qualitative : les quatre repères habituels seulement', async () => {
    await open([], 'qualitative');
    fireEvent.click(await screen.findByRole('button', { name: 'Nutrition' }));
    expect(screen.getByRole('button', { name: 'Protéines' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mes repères' })).toBeNull();
  });
});
