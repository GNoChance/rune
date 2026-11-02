import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProgramTemplate } from '@rune/contracts';
import type { PlannedExercise, PlannedWorkout } from '@rune/domain';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppServices, ServicesProvider } from '../../src/app-services';
import { RestTimer } from '../../src/features/workout/RestTimer';
import { playRestSound } from '../../src/features/workout/rest-sound';
import { REST_STORAGE_KEY, useRestTimer } from '../../src/features/workout/rest-timer';
import type { AppDb } from '../../src/local-db/db';
import { reposFor, type StartInput } from '../../src/repos';
import { writeDeviceSettings } from '../../src/repos/device-settings';
import { parseCssBlocks } from '../support/css-blocks';
import { changeRow } from '../support/program';
import { createTestServices, DEFAULT_NOW, renderApp } from '../support/render';
import { seedMirror } from '../support/seed';
import { LUNGE, SQUAT } from '../support/workout';
import { seedBase, slot, TEMPLATE } from './seed';

// Minuteur de repos (spec brique 3 §7.3, D14, Review Focus 1) : heure de fin absolue, gardée dans `sessionStorage`,
// recalculée au retour au premier plan ; « Repos terminé » annoncé et son court au premier plan seulement.

vi.mock('../../src/features/workout/rest-sound', () => ({
  playRestSound: vi.fn(),
  unlockRestSound: vi.fn(),
}));

let visibility: DocumentVisibilityState = 'visible';
const setVisibility = (v: DocumentVisibilityState) => {
  visibility = v;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

beforeEach(() => {
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(playRestSound).mockClear();
  sessionStorage.clear();
  localStorage.clear();
});

const T0 = Date.parse('2026-10-06T12:00:00.000Z');

/** Écran minimal : un bouton qui lance 2 min de repos, et la barre du minuteur. */
function Harness(p: { sessionId: string }) {
  const rest = useRestTimer(p.sessionId);
  return (
    <>
      <button type="button" onClick={() => rest.start(120)}>
        Lancer
      </button>
      <RestTimer rest={rest} />
    </>
  );
}

/** Horloge des services : celle des faux minuteurs (`Date`). */
const services = { now: () => Date.now() } as unknown as AppServices;
const mount = (sessionId = 's-1') =>
  render(
    <ServicesProvider services={services}>
      <Harness sessionId={sessionId} />
    </ServicesProvider>,
  );
const bar = () => screen.queryByRole('group', { name: 'Minuteur de repos' });
const shown = () => screen.getByRole('timer').textContent;
const announced = () => screen.getByRole('status').textContent;

describe('minuteur de repos : décompte et réglages', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(T0);
  });

  it('lancé à 2:00, il décompte ; −15 s, +15 s, « Passer » le retire', () => {
    mount();
    expect(bar()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lancer' }));
    expect(shown()).toBe('Repos 2:00');
    act(() => vi.advanceTimersByTime(1000));
    expect(shown()).toBe('Repos 1:59');
    fireEvent.click(screen.getByRole('button', { name: '−15 s' }));
    expect(shown()).toBe('Repos 1:44');
    fireEvent.click(screen.getByRole('button', { name: '+15 s' }));
    fireEvent.click(screen.getByRole('button', { name: '+15 s' }));
    expect(shown()).toBe('Repos 2:14');
    fireEvent.click(screen.getByRole('button', { name: 'Passer' }));
    expect(bar()).toBeNull();
    expect(sessionStorage.getItem(REST_STORAGE_KEY)).toBeNull();
    expect(announced()).toBe('');
  });

  it('heure de fin absolue dans sessionStorage ; −15 s ne passe pas sous zéro', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Lancer' }));
    expect(JSON.parse(sessionStorage.getItem(REST_STORAGE_KEY) ?? 'null')).toMatchObject({
      sessionId: 's-1',
      endsAt: T0 + 120_000,
    });
    act(() => vi.advanceTimersByTime(110_000));
    expect(shown()).toBe('Repos 0:10');
    fireEvent.click(screen.getByRole('button', { name: '−15 s' }));
    expect(JSON.parse(sessionStorage.getItem(REST_STORAGE_KEY) ?? 'null').endsAt).toBe(T0 + 110_000);
    expect(announced()).toBe('Repos terminé');
  });

  it('arrière-plan (minuteurs gelés, Review Focus 1) : le temps est juste dès le retour au premier plan', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Lancer' }));
    setVisibility('hidden');
    // L'iPhone gèle la page : l'heure avance, aucun minuteur ne tourne.
    vi.setSystemTime(T0 + 61_000);
    setVisibility('visible');
    expect(shown()).toBe('Repos 0:59');
  });

  it('rechargement (appli déchargée, Review Focus 1) : il reprend à son heure de fin', () => {
    const first = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Lancer' }));
    first.unmount();
    vi.setSystemTime(T0 + 30_500);
    mount();
    expect(shown()).toBe('Repos 1:30');
    act(() => vi.advanceTimersByTime(500));
    expect(shown()).toBe('Repos 1:29');
  });

  it('le minuteur d’une autre séance ne s’affiche pas', () => {
    const first = mount('s-1');
    fireEvent.click(screen.getByRole('button', { name: 'Lancer' }));
    first.unmount();
    mount('s-2');
    expect(bar()).toBeNull();
  });
});

describe('minuteur de repos : fin', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(T0);
  });

  it('à zéro : « Repos terminé » dans une région aria-live, son joué une fois, « Fermer » retire la barre', () => {
    mount();
    expect(screen.getByRole('status').getAttribute('aria-live') ?? 'polite').toBe('polite');
    expect(announced()).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Lancer' }));
    act(() => vi.advanceTimersByTime(119_000));
    expect(announced()).toBe('');
    expect(playRestSound).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(announced()).toBe('Repos terminé');
    expect(screen.queryByRole('timer')).toBeNull();
    expect(within(bar() as HTMLElement).getByText('Repos terminé')).toBeTruthy();
    expect(playRestSound).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(10_000));
    expect(playRestSound).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(bar()).toBeNull();
    expect(announced()).toBe('');
  });

  it('son coupé dans les réglages : annoncé, sans son', () => {
    writeDeviceSettings({ restSound: false });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Lancer' }));
    act(() => vi.advanceTimersByTime(120_000));
    expect(announced()).toBe('Repos terminé');
    expect(playRestSound).not.toHaveBeenCalled();
  });

  it('fin pendant que l’appli est cachée : ni son ni annonce, puis les deux au retour, une fois', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Lancer' }));
    setVisibility('hidden');
    vi.setSystemTime(T0 + 300_000);
    act(() => vi.advanceTimersByTime(1000));
    expect(playRestSound).not.toHaveBeenCalled();
    expect(announced()).toBe('');
    setVisibility('visible');
    expect(announced()).toBe('Repos terminé');
    expect(playRestSound).toHaveBeenCalledTimes(1);
  });

  it('fin passée pendant que l’appli était déchargée : annoncée au rechargement, puis plus jamais', () => {
    const first = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Lancer' }));
    first.unmount();
    vi.setSystemTime(T0 + 600_000);
    const second = mount();
    expect(announced()).toBe('Repos terminé');
    expect(playRestSound).toHaveBeenCalledTimes(1);
    second.unmount();
    mount();
    expect(playRestSound).toHaveBeenCalledTimes(1);
  });
});

// ——— Sur l'écran de séance ———

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

/** Squat barre (slot A1, repos 120 s du modèle) et fente aux haltères unilatérale (slot A2, repos 90 s). */
const REST_TEMPLATE: ProgramTemplate = {
  ...TEMPLATE,
  workouts: [
    {
      id: 'A',
      name: 'Séance A',
      slots: [
        slot('A1', 'back-squat', 'squat'),
        slot('A2', 'dumbbell-lunge', 'lunge', { restS: 90, count: 2 }),
      ],
    },
    ...TEMPLATE.workouts.slice(1),
  ],
};

const plan = (...exercises: PlannedExercise[]): PlannedWorkout => ({
  workoutId: 'A',
  weekType: 'normal',
  rulesVersion: '1',
  notices: [],
  exercises,
});

const START: StartInput = {
  plan: plan(SQUAT, LUNGE),
  placeId: 'p-1',
  instanceId: 'i-1',
  workoutId: 'A',
  profile: 'adult',
  templateVersion: 1,
};

async function started(o: { start?: Partial<StartInput>; before?(db: AppDb): Promise<void> } = {}) {
  const db = await seedBase({ template: REST_TEMPLATE });
  opened.push(db);
  await o.before?.(db);
  const { services } = await createTestServices({ db });
  const id = await reposFor(services).workouts.start({ ...START, ...o.start });
  return { db, id };
}

async function open(s: { db: AppDb; id: string }, now = DEFAULT_NOW) {
  const view = await renderApp({ path: `/workout/${s.id}`, db: s.db, now });
  await screen.findByRole('heading', { level: 1, name: 'Séance A' });
  return view;
}

const card = (name: string) => screen.getByRole('region', { name });
const validate = async (name: string, line: string) => {
  fireEvent.click(within(card(name)).getByRole('button', { name: `Valider ${line}` }));
  await within(card(name)).findByRole('button', { name: `Corriger ${line}` });
};

describe('minuteur sur l’écran de séance', () => {
  it('pas après un échauffement ; lancé avec le repos du slot après une série de travail', async () => {
    await open(await started());
    await validate('Squat barre', "l'échauffement 1");
    expect(bar()).toBeNull();
    await validate('Squat barre', 'la série 1');
    expect((await screen.findByRole('timer')).textContent).toBe('Repos 2:00');
  });

  it('une correction ne le relance pas', async () => {
    await open(await started());
    await validate('Squat barre', 'la série 1');
    await screen.findByRole('timer');
    fireEvent.click(screen.getByRole('button', { name: 'Passer' }));
    const squat = card('Squat barre');
    const corriger = within(squat).getByRole('button', { name: 'Corriger la série 1' });
    await waitFor(() => expect(corriger.getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(corriger);
    fireEvent.change(within(squat).getByRole('textbox', { name: 'Charge en kg, série 1' }), {
      target: { value: '65' },
    });
    fireEvent.click(within(squat).getByRole('button', { name: 'Valider la série 1' }));
    await within(squat).findByRole('button', { name: 'Corriger la série 1' });
    expect(bar()).toBeNull();
  });

  it('unilatéral : après le second côté seulement', async () => {
    await open(await started({ start: { plan: plan(LUNGE) } }));
    await validate('Fente aux haltères', 'la série 1 gauche');
    expect(bar()).toBeNull();
    await validate('Fente aux haltères', 'la série 1 droite');
    expect((await screen.findByRole('timer')).textContent).toBe('Repos 1:30');
  });

  it('repos changé dans le programme (`set_rest` accepté) : le minuteur le suit', async () => {
    await open(
      await started({
        before: (db) =>
          seedMirror(db, 'instance_change', [
            changeRow('c-rest', { operations: [{ op: 'set_rest', slot: 'A1', seconds: 60 }] }),
          ]),
      }),
    );
    await validate('Squat barre', 'la série 1');
    expect((await screen.findByRole('timer')).textContent).toBe('Repos 1:00');
  });

  it('rechargement de la page (Review Focus 1) : le minuteur reprend à son heure de fin', async () => {
    const s = await started();
    const view = await open(s);
    await validate('Squat barre', 'la série 1');
    await screen.findByRole('timer');
    view.unmount();
    await open(s, DEFAULT_NOW + 100_000);
    expect((await screen.findByRole('timer')).textContent).toBe('Repos 0:20');
  });

  it('avec la feuille d’effort ouverte : il continue, et sa fin reste annoncée', async () => {
    const view = await open(
      await started({ start: { plan: plan({ ...SQUAT, sets: SQUAT.sets.slice(1, 2) }) } }),
    );
    fireEvent.click(within(card('Squat barre')).getByRole('button', { name: 'Valider la série 1' }));
    const sheet = await screen.findByRole('dialog', { name: 'Effort' });
    expect(screen.getByRole('timer', { hidden: true }).textContent).toBe('Repos 2:00');
    view.services.now = () => DEFAULT_NOW + 120_000;
    setVisibility('visible');
    const status = await screen.findByText('Repos terminé', { selector: '[role="status"]' });
    expect(status.closest('[inert]')).toBeNull();
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
    // La feuille garde le focus.
    expect(sheet.contains(document.activeElement)).toBe(true);
  });
});

describe('live.module.css : barre du minuteur', () => {
  const css = readFileSync(
    resolve(import.meta.dirname, '../../src/features/workout/live.module.css'),
    'utf8',
  );
  const rule = (selector: string, media: string | null = null) =>
    new Map(
      parseCssBlocks(css)
        .filter((b) => b.media === media && b.selector.split(', ').includes(selector))
        .flatMap((b) => [...b.declarations]),
    );

  it('−15 s, +15 s, « Passer », « Fermer » : 48 × 48 px au moins (actions du bas)', () => {
    expect(Number.parseFloat(rule('.restButton').get('min-width') ?? '0')).toBeGreaterThanOrEqual(48);
    expect(Number.parseFloat(rule('.restButton').get('min-height') ?? '0')).toBeGreaterThanOrEqual(48);
  });

  it('focus jamais caché sous la barre et « Terminer » (WCAG 2.4.11), sur téléphone comme sur PC', () => {
    expect(rule(':global(html):has(.rest)').get('scroll-padding-bottom')).toContain('7.5rem');
    expect(rule(':global(html):has(.rest)', '(min-width: 900px)').get('scroll-padding-bottom')).toContain(
      '7.5rem',
    );
  });
});
