import { type CoachProposalEvent, type InstanceChangeView, REASON_TEXTS } from '@rune/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProposalCard } from '../../src/features/program/ProposalCard';
import { programNames } from '../../src/features/program/program-model';
import { useProgramEditContext, useProgramView } from '../../src/repos';
import { NETWORK_REQUIRED_MESSAGE } from '../../src/ui';
import { createTestLocalDb } from '../support/local-db';
import { changeRow, seedCompletedSessions, seedProgram } from '../support/program';
import { renderWithServices } from '../support/render';
import { seedMirror } from '../support/seed';

const LAZY = { timeout: 10_000 };

const COACH_ROW = changeRow('c-coach', {
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

const ENGINE_ROW = changeRow('c-eng', {
  author: 'engine',
  operations: [{ op: 'replace_exercise', slot: 'A1', exercise: 'goblet-squat' }],
  reasonCode: 'ENGINE_STALL_REPLACE',
  status: 'proposed',
  baseRevision: 4,
  createdAt: '2026-10-05T08:00:00.000Z',
  expiresAt: '2026-10-12T08:00:00.000Z',
  decidedAt: null,
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

/** Comme CoachPage : la ligne du miroir quand elle est arrivée par le pull, sinon l'événement du flux. */
function Harness(p: { id: string; event?: CoachProposalEvent; compact?: boolean; offline?: boolean }) {
  const view = useProgramView();
  const ctx = useProgramEditContext();
  if (!view || !ctx) return null;
  const row: InstanceChangeView | undefined = [...view.proposals, ...view.changes].find((c) => c.id === p.id);
  const proposal = row ?? p.event;
  if (!proposal) return null;
  return (
    <ProposalCard
      proposal={proposal}
      view={view}
      ctx={ctx}
      names={programNames(view, ctx)}
      offline={p.offline ?? false}
      compact={p.compact}
    />
  );
}

async function open(
  rows: Record<string, unknown>[],
  props: Parameters<typeof Harness>[0],
  seed?: (db: ReturnType<typeof createTestLocalDb>) => Promise<void>,
) {
  const db = createTestLocalDb();
  await seedProgram(db);
  if (rows.length > 0) await seedMirror(db, 'instance_change', rows);
  await seed?.(db);
  const rendered = await renderWithServices(<Harness {...props} />, { db });
  return { ...rendered, db };
}

const card = () => screen.getByRole('article');
const accept = () => screen.getByRole('button', { name: 'Accepter' }) as HTMLButtonElement;

describe('ProposalCard : auteur coach', () => {
  it('badge « IA », attribut, mention, phrase puis motif, lien vers la conversation', async () => {
    await open([COACH_ROW], { id: 'c-coach' });
    await screen.findByRole('article', {}, LAZY);
    const c = card();
    expect(c.getAttribute('data-ai-generated')).toBe('true');
    expect(within(c).getByText('IA')).toBeTruthy();
    expect(within(c).getByText("Proposé par l'IA, vérifié par l'appli")).toBeTruthy();
    const phrase = within(c).getByText(REASON_TEXTS.COACH_PROPOSAL);
    const reason = within(c).getByText('Ton genou te gêne sur la barre.');
    expect(phrase.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(c).getByRole('link', { name: 'Voir la conversation' }).getAttribute('href')).toBe(
      '/coach/threads/t1',
    );
  });

  it('sans fil connu (coachThreadId nul) : pas de « Voir la conversation »', async () => {
    await open([{ ...COACH_ROW, coachThreadId: null }], { id: 'c-coach' });
    await screen.findByRole('article', {}, LAZY);
    expect(screen.queryByRole('link', { name: 'Voir la conversation' })).toBeNull();
  });

  it('sans accord santé (motif nul) : la phrase seule', async () => {
    await open([{ ...COACH_ROW, reason: null }], { id: 'c-coach' });
    await screen.findByRole('article', {}, LAZY);
    expect(within(card()).getByText(REASON_TEXTS.COACH_PROPOSAL)).toBeTruthy();
  });

  it('proposition du moteur : ni badge, ni attribut, ni mention', async () => {
    await open([ENGINE_ROW], { id: 'c-eng' });
    await screen.findByRole('article', {}, LAZY);
    const c = card();
    expect(c.getAttribute('data-ai-generated')).toBeNull();
    expect(within(c).queryByText('IA')).toBeNull();
    expect(within(c).queryByText("Proposé par l'IA, vérifié par l'appli")).toBeNull();
    expect(within(c).queryByRole('link', { name: 'Voir la conversation' })).toBeNull();
  });
});

describe('ProposalCard compacte', () => {
  it('« en préparation » tant que la ligne n’est pas arrivée, puis active, puis les statuts', async () => {
    const { db } = await open([], { id: 'c-coach', event: EVENT, compact: true });
    await screen.findByRole('article', {}, LAZY);
    expect(within(card()).getByText('en préparation')).toBeTruthy();
    expect(accept().disabled).toBe(true);
    expect(within(card()).getByText("Proposé par l'IA, vérifié par l'appli")).toBeTruthy();

    await act(async () => seedMirror(db, 'instance_change', [COACH_ROW]));
    await waitFor(() => expect(accept().disabled).toBe(false), LAZY);
    expect(screen.queryByText('en préparation')).toBeNull();
    expect(screen.getByRole('button', { name: 'Refuser' })).toBeTruthy();

    for (const [status, label] of [
      ['accepted', 'Acceptée'],
      ['rejected', 'Refusée'],
      ['expired', 'Expirée'],
    ] as const) {
      await act(async () =>
        seedMirror(db, 'instance_change', [{ ...COACH_ROW, status, decidedAt: '2026-10-06T08:00:00.000Z' }]),
      );
      await waitFor(() => expect(within(card()).getByText(label)).toBeTruthy(), LAZY);
      expect(screen.queryByRole('button', { name: 'Accepter' })).toBeNull();
    }
  });

  it('une proposition dont la date limite est passée se lit « Expirée »', async () => {
    await open([{ ...COACH_ROW, expiresAt: '2026-10-01T08:00:00.000Z' }], { id: 'c-coach', compact: true });
    await screen.findByRole('article', {}, LAZY);
    expect(within(card()).getByText('Expirée')).toBeTruthy();
  });

  it('hors ligne : « Accepter » grisé et « Nécessite le réseau »', async () => {
    await open([COACH_ROW], { id: 'c-coach', compact: true, offline: true });
    await screen.findByRole('article', {}, LAZY);
    expect(accept().disabled).toBe(true);
    expect(within(card()).getByText(NETWORK_REQUIRED_MESSAGE)).toBeTruthy();
  });
});

describe('ProposalCard : aperçu quand les règles sont inconnues (décision 1)', () => {
  it('une séance faite avec des règles que l’appli ne connaît pas : pas d’aperçu des charges, les lignes avant / après restent', async () => {
    await open([ENGINE_ROW], { id: 'c-eng' }, async (db) => {
      await seedCompletedSessions(db, 1);
      await seedMirror(db, 'workout_session', [
        {
          id: 's-1',
          ownerId: 'u-1',
          instanceId: 'i-1',
          workoutId: 'A',
          placeId: 'p-1',
          deviceId: 'dev-Z',
          startedAt: '2026-09-02T08:00:00.000Z',
          endedAt: '2026-09-02T09:00:00.000Z',
          status: 'completed',
          weekType: 'normal',
          templateVersion: 1,
          rulesVersion: '99',
          appVersion: 'dev',
          profile: 'adult',
          note: null,
        },
      ]);
    });
    await screen.findByRole('article', {}, LAZY);
    expect(within(card()).getByText('Squat barre · 3 × 6')).toBeTruthy();
    expect(within(card()).getByText('Squat goblet · 3 × 6')).toBeTruthy();
    expect(within(card()).queryByText(/Calibration|→/)).toBeNull();
  });
});
