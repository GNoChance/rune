import type { ProgramInstanceView } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  createUser,
  createUserAndLogin,
  insertFixtureRow,
  login,
  type TestContext,
} from '../support';
import { programTemplate, seedProgramCatalog } from '../support/program';
import { fillPath, listRoutes } from '../support/routes';

/*
 * Cloisonnement des routes du programme (spec brique 3 §5.6 et §6 ; 05 §17.8 ; P-AUT-4, P-ADM-2) : session exigée,
 * `Origin` contrôlée, 404 sur les lignes d'un autre membre, y compris pour une session admin.
 */

type Row = Record<string, unknown>;

const NOW = '2026-10-06T10:00:00.000Z';
const MIN_PROGRAM_ROUTES = 5;

let ctx: TestContext;
afterEach(() => ctx?.close());

const programRoutes = () => listRoutes(ctx.app).filter((r) => r.path.startsWith('/api/program/'));

/** Membre inscrit avec un changement accepté, une proposition en attente et un pas de machine ; admin à part. */
async function setup() {
  ctx = await createTestContext({ now: NOW });
  await seedProgramCatalog(ctx, [programTemplate('test-program')]);
  const admin = await createUser(ctx, { username: 'porteur', role: 'admin', password: 'quatorze carac' });
  const adminCookie = await login(ctx, 'porteur', admin.password);
  await insertFixtureRow(ctx.deps.db, 'consent_event', {
    ownerId: admin.id,
    type: 'health',
    action: 'grant',
  });
  const b = await createUserAndLogin(ctx);

  const enrolled = await ctx.request('/api/program/enroll', {
    method: 'POST',
    cookie: b.cookie,
    json: { templateId: 'test-program', daysPerWeek: 3 },
  });
  const instanceId = ((await enrolled.json()) as { instance: ProgramInstanceView }).instance.id;
  const change = await ctx.request('/api/program/changes', {
    method: 'POST',
    cookie: b.cookie,
    json: { baseRevision: 0, operations: [{ op: 'set_rest', slot: 'A1', seconds: 150 }] },
  });
  const changeId = ((await change.json()) as { change: { id: string } }).change.id;
  const proposal = await insertFixtureRow(ctx.deps.db, 'instance_change', {
    ownerId: b.id,
    instanceId,
    author: 'engine',
    operations: '[{"op":"start_deload"}]',
    reasonCode: 'ENGINE_REACTIVE_DELOAD',
    status: 'proposed',
    expiresAt: '2026-10-10T10:00:00.000Z',
    baseRevision: 1,
  });
  const slotStateId = `${instanceId}:A4:seated-cable-row`;
  const step = await ctx.request(`/api/program/slot-states/${slotStateId}/machine-step`, {
    method: 'PUT',
    cookie: b.cookie,
    json: { stepG: 2500 },
  });
  expect(step.status).toBe(200);
  return {
    adminCookie,
    b,
    instanceId,
    ids: [instanceId, changeId, proposal.id as string, slotStateId],
    proposalId: proposal.id as string,
    changeId,
    slotStateId,
  };
}

const dump = () =>
  ['program_instance', 'instance_change', 'slot_state'].map((t) =>
    ctx.deps.sqlite.prepare(`SELECT * FROM ${t} ORDER BY id`).all(),
  );

describe('cloisonnement de /api/program', () => {
  it('une session admin reçoit 404 sur les changements et les états d’un membre, sans rien modifier', async () => {
    const { adminCookie, proposalId, changeId, slotStateId } = await setup();
    const before = dump();
    for (const id of [proposalId, changeId]) {
      for (const action of ['accept', 'reject']) {
        const res = await ctx.request(`/api/program/changes/${id}/${action}`, {
          method: 'POST',
          cookie: adminCookie,
          json: action === 'accept' ? { baseRevision: 1 } : {},
        });
        expect(res.status, `${action} ${id}`).toBe(404);
        expect(await res.json()).toEqual({ error: 'not_found' });
      }
    }
    const step = await ctx.request(`/api/program/slot-states/${slotStateId}/machine-step`, {
      method: 'PUT',
      cookie: adminCookie,
      json: { stepG: 5000 },
    });
    expect(step.status).toBe(404);
    // Sans instance active à lui, l'admin ne change rien : jamais l'instance d'un autre.
    const change = await ctx.request('/api/program/changes', {
      method: 'POST',
      cookie: adminCookie,
      json: { baseRevision: 1, operations: [{ op: 'start_deload' }] },
    });
    expect(change.status).toBe(404);
    expect(dump()).toEqual(before);
  });

  it('chaque route à :id répond 404 pour les lignes d’un autre membre, avant tout contrôle du corps', async () => {
    const { adminCookie, ids } = await setup();
    const routes = programRoutes().filter((r) => r.path.includes(':id'));
    expect(routes.length).toBeGreaterThanOrEqual(3);
    for (const r of routes) {
      for (const id of ids) {
        const res = await ctx.request(fillPath(r.path, id), {
          method: r.method,
          cookie: adminCookie,
          json: {},
        });
        expect(res.status, `${r.method} ${r.path} ${id}`).toBe(404);
        expect(await res.json()).toEqual({ error: 'not_found' });
      }
    }
  });

  it('Origin étrangère → 403 origin_mismatch ; sans session → 401, sur chaque route', async () => {
    const { b, ids } = await setup();
    const routes = programRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(MIN_PROGRAM_ROUTES);
    const before = dump();
    for (const r of routes) {
      const path = fillPath(r.path, ids[1] ?? '');
      const foreign = await ctx.request(path, {
        method: r.method,
        cookie: b.cookie,
        origin: 'https://evil.example',
        json: {},
      });
      expect(foreign.status, `${r.method} ${r.path}`).toBe(403);
      expect(((await foreign.json()) as Row).error).toBe('origin_mismatch');
      const anonymous = await ctx.request(path, { method: r.method, json: {} });
      expect(anonymous.status, `${r.method} ${r.path}`).toBe(401);
    }
    expect(dump()).toEqual(before);
  });
});
