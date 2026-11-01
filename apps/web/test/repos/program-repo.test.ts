import { ServedProgramTemplateSchema } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { NetworkRequiredError } from '../../src/api/client';
import { createRepos } from '../../src/repos';
import { changeErrorsOf, isExpired, isStaleRevision } from '../../src/repos/program-repo';
import { dumpLocalDb } from '../support/local-db';
import { createTestServices, makeMe } from '../support/render';
import { seedMirror } from '../support/seed';

const slot = (id: string) => ({
  id,
  movementPattern: 'squat',
  role: 'main',
  chain: 'bodyweight-squat',
  sets: [{ kind: 'work', count: 2, reps: { min: 8, max: 12 }, targetRir: 2, restS: 150 }],
  progression: { type: 'chain' },
});

function template(
  id: string,
  context: 'gym' | 'home',
  level: 'beginner' | 'intermediate',
  min: number,
  max: number,
) {
  return {
    schemaVersion: 1,
    id,
    version: 1,
    name: id,
    description: id,
    context,
    level,
    daysPerWeek: { min, max, default: min },
    estimatedMinutes: 45,
    block: { mode: 'reactive' },
    workouts: [{ id: 'w1', name: 'A', slots: [slot('s1')] }],
  };
}

async function setup(opts: { profile?: boolean; placeKind?: 'gym' | 'home' } = {}) {
  const t = await createTestServices({ me: makeMe() });
  const { db } = t;
  if (opts.profile !== false) {
    await seedMirror(db, 'training_profile', [
      {
        id: 'u-1',
        ownerId: 'u-1',
        goal: 'muscle',
        experience: 'none',
        daysPerWeek: 3,
        sessionMinutes: 45,
        sportCode: null,
        sportOtherLabel: null,
        cautiousMode: false,
        coach: 'skald',
      },
    ]);
  }
  await seedMirror(db, 'place', [
    {
      id: 'p-1',
      ownerId: 'u-1',
      kind: opts.placeKind ?? 'home',
      gymId: null,
      name: 'Maison',
      isPrimary: true,
      visibleAtGym: null,
      loadSettings: null,
    },
  ]);
  const served = [
    { template: template('home-beginner', 'home', 'beginner', 2, 3), available: true },
    { template: template('gym-beginner', 'gym', 'beginner', 2, 4), available: false },
  ].map((x) => ServedProgramTemplateSchema.parse(x));
  await db.table('programTemplates').bulkPut(served.map((x) => ({ id: x.template.id, ...x })));
  return { ...t, repos: createRepos(t.services), served };
}

const INSTANCE = {
  id: 'i-1',
  templateId: 'home-beginner',
  templateVersion: 1,
  daysPerWeek: 3,
  status: 'active',
  revision: 0,
  startedAt: '2026-11-01T10:00:00.000Z',
  endedAt: null,
};

const CHANGE = {
  id: 'c-1',
  instanceId: 'i-1',
  baseRevision: 2,
  author: 'user',
  operations: [{ op: 'start_deload' }],
  reasonCode: 'USER_CHANGE',
  reason: null,
  status: 'proposed',
  createdAt: '2026-11-01T10:00:00.000Z',
  expiresAt: null,
  decidedAt: null,
};

const SLOT_STATE = {
  id: 'ss-1',
  instanceId: 'i-1',
  slotId: 's1',
  exerciseId: 'goblet-squat',
  mode: 'linear',
  loadG: null,
  targetReps: null,
  variantRank: null,
  durationS: null,
  machineStepGOverride: 2500,
  calibrationLeft: 0,
  noProgressCount: 0,
  stallRank: 0,
  suspended: false,
};

describe('repos.program', () => {
  it('templates() rend les modèles servis stockés', async () => {
    const { repos, served } = await setup();
    const list = await repos.program.templates();
    expect(list).toHaveLength(2);
    expect(list).toEqual(expect.arrayContaining(served));
  });

  it('recommendation() tient compte de available et du lieu principal', async () => {
    const { repos } = await setup({ placeKind: 'home' });
    expect((await repos.program.recommendation())?.templateId).toBe('home-beginner');
    const g = await setup({ placeKind: 'gym' });
    // le seul modèle de salle n'est pas disponible : aucun modèle recommandé
    expect((await g.repos.program.recommendation())?.templateId).toBeNull();
  });

  it('recommendation() rend null sans profil', async () => {
    const { repos } = await setup({ profile: false });
    expect(await repos.program.recommendation()).toBeNull();
  });

  it('enroll envoie le corps exact puis tire', async () => {
    const { repos, api, sync } = await setup();
    api.on('POST', '/api/program/enroll', { status: 201, body: { instance: INSTANCE } });
    const instance = await repos.program.enroll('home-beginner', 3);
    expect(instance.id).toBe('i-1');
    const call = api.calls.find((c) => c.path === '/api/program/enroll');
    expect(call?.body).toEqual({ templateId: 'home-beginner', daysPerWeek: 3 });
    expect(sync.pullCount).toBe(1);
  });

  it('change, accept, reject, setMachineStep : corps exacts et pull', async () => {
    const { repos, api, sync } = await setup();
    api.on('POST', '/api/program/changes', { status: 201, body: { change: CHANGE, instance: INSTANCE } });
    api.on('POST', '/api/program/changes/:id/accept', {
      status: 200,
      body: { change: CHANGE, instance: INSTANCE },
    });
    api.on('POST', '/api/program/changes/:id/reject', { status: 200, body: { change: CHANGE } });
    api.on('PUT', '/api/program/slot-states/:id/machine-step', {
      status: 200,
      body: { slotState: SLOT_STATE },
    });
    await repos.program.change([{ op: 'start_deload' }], 2);
    await repos.program.accept('c-1', 2);
    await repos.program.reject('c-1');
    await repos.program.setMachineStep('ss-1', 2500);
    await repos.program.setMachineStep('ss-1', null);
    expect(api.calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/api/program/changes', { baseRevision: 2, operations: [{ op: 'start_deload' }] }],
      ['POST', '/api/program/changes/c-1/accept', { baseRevision: 2 }],
      ['POST', '/api/program/changes/c-1/reject', {}],
      ['PUT', '/api/program/slot-states/ss-1/machine-step', { stepG: 2500 }],
      ['PUT', '/api/program/slot-states/ss-1/machine-step', { stepG: null }],
    ]);
    expect(sync.pullCount).toBe(5);
  });

  it('409 et 422 sont traduits par les utilitaires', async () => {
    const { repos, api, sync } = await setup();
    api.on('POST', '/api/program/changes', {
      status: 422,
      body: { error: 'invalid_change', errors: [{ op: 1, code: 'coverage_lost' }] },
    });
    api.on('POST', '/api/program/changes/:id/accept', { status: 409, body: { error: 'stale_revision' } });
    api.on('POST', '/api/program/changes/:id/reject', { status: 409, body: { error: 'expired' } });
    const e1 = await repos.program.change([{ op: 'start_deload' }], 0).catch((e: unknown) => e);
    expect(changeErrorsOf(e1)).toEqual([{ op: 1, code: 'coverage_lost' }]);
    expect(isStaleRevision(e1)).toBe(false);
    const e2 = await repos.program.accept('c-1', 0).catch((e: unknown) => e);
    expect(isStaleRevision(e2)).toBe(true);
    expect(isExpired(e2)).toBe(false);
    expect(changeErrorsOf(e2)).toBeNull();
    const e3 = await repos.program.reject('c-1').catch((e: unknown) => e);
    expect(isExpired(e3)).toBe(true);
    expect(changeErrorsOf(new Error('x'))).toBeNull();
    expect(sync.pullCount).toBe(0);
  });

  it('hors ligne : « Nécessite le réseau », aucune écriture locale', async () => {
    const { repos, api, db, sync } = await setup();
    const before = await dumpLocalDb(db);
    api.setOffline('reject');
    const writes = [
      () => repos.program.enroll('home-beginner', 3),
      () => repos.program.change([{ op: 'start_deload' }], 0),
      () => repos.program.accept('c-1', 0),
      () => repos.program.reject('c-1'),
      () => repos.program.setMachineStep('ss-1', 2500),
    ];
    for (const write of writes) {
      const error = await write().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NetworkRequiredError);
    }
    expect(await dumpLocalDb(db)).toBe(before);
    expect(await db.outbox.count()).toBe(0);
    expect(sync.pullCount).toBe(0);
  });
});
