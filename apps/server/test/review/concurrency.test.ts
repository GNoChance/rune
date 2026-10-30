import type { DraftSheet, RevisionConflictBody } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, createUser, login, type TestContext } from '../support';
import { sheetFixture, skeletonFixture } from '../support/catalog';
import { postTransition, putSheet, rebuild, seedSheet } from '../support/review';

let ctx: TestContext;
afterEach(() => ctx?.close());

const NOW = '2026-10-30T09:00:00.000Z';

async function setup() {
  ctx = await createTestContext();
  const published = await seedSheet(ctx, sheetFixture('goblet-squat')); // publiée, révision 4
  const draft = await seedSheet(ctx, skeletonFixture('brouillon'));
  await rebuild(ctx);
  const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
  // Deux onglets de l'admin : deux sessions.
  const tabs = [
    await login(ctx, 'porteur', admin.password),
    await login(ctx, 'porteur', admin.password),
  ] as const;
  ctx.clock.set(NOW);
  return { tabs, published, draft };
}

const stored = (id: string) =>
  ctx.deps.db.selectFrom('exercise').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const revisionRows = (id: string) =>
  ctx.deps.db.selectFrom('exerciseRevision').select('revision').where('exerciseId', '=', id).execute();

/** Réponses de deux requêtes lancées ensemble, rangées 200 puis 409, avec leur indice de départ. */
async function race(requests: readonly [Promise<Response>, Promise<Response>]) {
  const responses = await Promise.all(requests);
  const statuses = responses.map((r) => r.status);
  expect([...statuses].sort()).toEqual([200, 409]);
  const winner = statuses.indexOf(200);
  const loser = 1 - winner;
  return {
    winner,
    loser,
    conflict: (await (responses[loser] as Response).json()) as RevisionConflictBody,
  };
}

describe('écritures simultanées (spec brique 2 §3.5, Review Focus 3)', () => {
  it('deux PUT depuis la même révision : un 200, un 409 avec la fiche courante ; seule la première saisie reste', async () => {
    const { tabs, published } = await setup();
    const inputs = [
      { ...published, breathing: 'Saisie du premier onglet.' },
      { ...published, breathing: 'Saisie du second onglet.' },
    ];
    const { winner, conflict } = await race([
      putSheet(ctx, tabs[0], 'goblet-squat', inputs[0] as DraftSheet, 4),
      putSheet(ctx, tabs[1], 'goblet-squat', inputs[1] as DraftSheet, 4),
    ]);
    const kept = (inputs[winner] as DraftSheet).breathing;
    expect(conflict.error).toBe('revision_conflict');
    // L'admin voit toute la fiche courante, champs éditoriaux compris, pour y reporter sa saisie.
    expect(conflict.current).toMatchObject({ id: 'goblet-squat', revision: 5, breathing: kept });
    expect(conflict.current).toHaveProperty('review_notes');
    expect(conflict).not.toHaveProperty('blockers');
    const row = await stored('goblet-squat');
    expect(row.revision).toBe(5);
    expect(JSON.parse(row.content)).toMatchObject({ breathing: kept });
    expect(await revisionRows('goblet-squat')).toHaveLength(2);
  });

  it('deux transitions, ou un PUT et une transition, depuis la même révision : un 200, un 409', async () => {
    const { tabs, published } = await setup();
    const { winner } = await race([
      postTransition(ctx, tabs[0], 'goblet-squat', { to: 'retired', baseRevision: 4 }),
      putSheet(ctx, tabs[1], 'goblet-squat', { ...published, breathing: 'Souffle.' }, 4),
    ]);
    const row = await stored('goblet-squat');
    expect(row.revision).toBe(5);
    expect(row.status).toBe(winner === 0 ? 'retired' : 'published');

    // Réactivation (retired → reviewed) avec ses deux cases cochées, ou retrait.
    const next = {
      to: winner === 0 ? 'reviewed' : 'retired',
      baseRevision: 5,
      reviewChecked: true,
      minorsConfirmed: true,
    } as const;
    const again = await race([
      postTransition(ctx, tabs[0], 'goblet-squat', next),
      postTransition(ctx, tabs[1], 'goblet-squat', next),
    ]);
    expect(again.conflict.current).toMatchObject({ revision: 6 });
    expect(await revisionRows('goblet-squat')).toHaveLength(3);
  });

  it('base périmée (ou future) et blocages : 409 avec la fiche courante, sans liste de blocages', async () => {
    const { tabs, draft, published } = await setup();
    await putSheet(ctx, tabs[0], 'brouillon', { ...draft, name: 'Squat sumo' }, 1);
    // Squelette incomplet, cases non cochées : bloqué si la révision était la bonne.
    for (const baseRevision of [1, 3]) {
      const res = await postTransition(ctx, tabs[1], 'brouillon', { to: 'reviewed', baseRevision });
      expect(res.status).toBe(409);
      const body = (await res.json()) as RevisionConflictBody;
      expect(body).toEqual({ error: 'revision_conflict', current: expect.objectContaining({ revision: 2 }) });
    }
    // Fiche publiée invalide envoyée depuis une base périmée : 409, pas 422.
    await putSheet(ctx, tabs[0], 'goblet-squat', { ...published, breathing: 'Souffle.' }, 4);
    const invalid = await putSheet(ctx, tabs[1], 'goblet-squat', { ...published, safety: [] }, 4);
    expect(invalid.status).toBe(409);
    expect(await invalid.json()).toEqual({
      error: 'revision_conflict',
      current: expect.objectContaining({ revision: 5, breathing: 'Souffle.' }),
    });
    // Transition hors circuit depuis une base périmée : 409 aussi.
    const outside = await postTransition(ctx, tabs[1], 'goblet-squat', { to: 'draft', baseRevision: 4 });
    expect(outside.status).toBe(409);
  });
});
