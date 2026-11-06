import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CoachPage } from '../../src/features/coach/CoachPage';
import { coachStatus, EMPTY_TODAY } from '../support/coach';
import { createFakeApi } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { seedProgram } from '../support/program';
import { renderWithServices } from '../support/render';

// Les lectures du programme se chargent chacune à leur tour : tant qu'une manque, « Mes charges » est grisé et ne
// dit pas « Choisis d'abord un programme » (le programme existe peut-être). Les crochets sont tenus en attente à la main.
const hold = vi.hoisted(() => ({ view: false, context: false }));

vi.mock('../../src/repos', async (original) => {
  const actual = await original<typeof import('../../src/repos')>();
  return {
    ...actual,
    useProgramView: (...args: Parameters<typeof actual.useProgramView>) => {
      const view = actual.useProgramView(...args);
      return hold.view ? undefined : view;
    },
    useProgramEditContext: () => {
      const context = actual.useProgramEditContext();
      return hold.context ? undefined : context;
    },
  };
});

async function open() {
  const db = createTestLocalDb();
  await seedProgram(db);
  const api = createFakeApi()
    .on('GET', '/api/coach/status', { status: 200, body: coachStatus() })
    .on('GET', '/api/coach/today', { status: 200, body: EMPTY_TODAY });
  await renderWithServices(<CoachPage />, { path: '/coach', db, api });
  await screen.findByRole('log');
  return screen.getByRole('button', { name: 'Mes charges' }) as HTMLButtonElement;
}

describe('CoachPage : parcours guidés pendant le chargement du programme', () => {
  it('vue du programme en cours de chargement : « Mes charges » grisé, sans « Choisis d’abord un programme »', async () => {
    hold.view = true;
    hold.context = false;
    const loads = await open();
    expect(loads.disabled).toBe(true);
    expect(screen.queryByText("Choisis d'abord un programme")).toBeNull();
    expect(loads.getAttribute('aria-describedby')).toBeNull();
  });

  it('contexte du programme pas encore arrivé alors que le programme est chargé : même attente, sans faux message', async () => {
    hold.view = false;
    hold.context = true;
    const loads = await open();
    expect(loads.disabled).toBe(true);
    expect(screen.queryByText("Choisis d'abord un programme")).toBeNull();
  });

  it('une fois lus, le programme et son contexte activent « Mes charges »', async () => {
    hold.view = false;
    hold.context = false;
    const loads = await open();
    await vi.waitFor(() => expect(loads.disabled).toBe(false));
    expect(screen.queryByText("Choisis d'abord un programme")).toBeNull();
  });
});
