import { AI_COACH_CONSENT_TEXT } from '@rune/contracts';
import { ANYWHERE, buildCoachBrief, lastLoadsOf, replayInstance } from '@rune/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBriefInput, loadPlanContext, loadReplayInput } from '../../src/coach/brief-input';
import { openTodayThread } from '../../src/coach/threads';
import { grantConsent } from '../../src/privacy/consent';
import {
  createTestContext,
  createUserAndLogin,
  insertFixtureRow,
  makeOp,
  syncPush,
  type TestContext,
} from '../support';
import {
  dayAt,
  enroll,
  grantHealth,
  programTemplate,
  type SessionSpec,
  seedProgramCatalog,
  sessionOps,
} from '../support/program';

/*
 * Entrée du dossier du coach (spec brique 4 §9) rassemblée par le serveur : séances des 28 derniers jours, lieux
 * vivants, programme et son rejeu, propositions en attente, accords. La date de naissance n'y entre jamais
 * (R-AGE-3) : seuls `audience` et `ageBand`, calculés dans `age.ts`.
 */

type Member = Awaited<ReturnType<typeof createUserAndLogin>>;
type Row = Record<string, unknown>;

const NOW = '2026-11-05T10:00:00.000Z';
/** Date de naissance canari : elle ne doit jamais sortir de la table `user`. */
const BIRTH = '2001-07-13';
const TEMPLATE = programTemplate();
/** 8 octobre, 28 jours avant le 5 novembre ; le 7, 29 jours. */
const DAY_28 = 37;
const DAY_29 = 36;

let ctx: TestContext;
afterEach(() => ctx?.close());

/** Membre né le jour canari, profil d'entraînement complet. */
async function member(): Promise<Member> {
  const m = await createUserAndLogin(ctx, { birthDate: BIRTH });
  await insertFixtureRow(ctx.deps.db, 'training_profile', {
    ownerId: m.id,
    goal: 'muscle',
    experience: '6_to_24_months',
    daysPerWeek: 3,
    sessionMinutes: 45,
    coach: 'ombre',
  });
  return m;
}

async function setup(): Promise<Member> {
  ctx = await createTestContext({ now: NOW });
  await seedProgramCatalog(ctx, [TEMPLATE]);
  return member();
}

async function push(u: Member, spec: SessionSpec) {
  const s = sessionOps(u.id, spec);
  const res = await syncPush(ctx, u.cookie, s.ops);
  expect(res.status).toBe(200);
  expect(res.body.results.every((r: Row) => r.status === 'applied')).toBe(true);
  return s;
}

const grantCoach = (userId: string) =>
  grantConsent(ctx.deps.db, ctx.deps, userId, 'ai_coach', AI_COACH_CONSENT_TEXT.version, null);
const input = (userId: string) => loadBriefInput(ctx.deps.db, ctx.deps, userId, ctx.clock.now());

/** JSON d'une valeur, `Map` et `Set` compris. */
const dump = (value: unknown): string =>
  JSON.stringify(value, (_k, v) => (v instanceof Map || v instanceof Set ? [...v] : v));

describe('loadBriefInput', () => {
  it('le dossier stocké du fil est buildCoachBrief(loadBriefInput) au même instant', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    await push(u, { instanceId, startedAt: dayAt(DAY_28), exercises: [{}] });
    const now = ctx.clock.now();
    const thread = await openTodayThread(ctx.deps, u.id, now);
    expect(thread.brief).toBe(buildCoachBrief(await loadBriefInput(ctx.deps.db, ctx.deps, u.id, now)).json);
  });

  it("la date de naissance n'entre ni dans l'entrée ni dans le fil : audience et tranche seulement", async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    await push(u, { instanceId, startedAt: dayAt(DAY_28), exercises: [{}] });
    const loaded = await input(u.id);
    expect(loaded).toMatchObject({ today: '2026-11-05', audience: 'adult', ageBand: '18-29' });
    expect(dump(loaded)).not.toContain(BIRTH);
    const thread = await openTodayThread(ctx.deps, u.id, ctx.clock.now());
    expect(dump(thread)).not.toContain(BIRTH);
  });

  it('le jour des 18 ans : public et profil du moteur pris au même instant `now`, pas à l’horloge', async () => {
    ctx = await createTestContext({ now: '2026-11-03T10:00:00.000Z' });
    const u = await createUserAndLogin(ctx, { birthDate: '2008-11-04' });
    const birthday = new Date('2026-11-04T10:00:00.000Z');
    const adult = await loadBriefInput(ctx.deps.db, ctx.deps, u.id, birthday);
    expect(adult).toMatchObject({ audience: 'adult', ageBand: '18-29', profile: { engineProfile: 'adult' } });
    const thread = await openTodayThread(ctx.deps, u.id, birthday);
    expect(thread).toMatchObject({ day: '2026-11-04', audience: 'adult', promptVersion: 'coach-1/adult' });
    expect(JSON.parse(thread.brief ?? '')).toMatchObject({
      audience: 'adult',
      profile: { engine_profile: 'adult' },
    });

    ctx.clock.set('2026-11-04T10:00:00.000Z');
    const eve = await loadBriefInput(ctx.deps.db, ctx.deps, u.id, new Date('2026-11-03T10:00:00.000Z'));
    expect(eve).toMatchObject({
      audience: 'minor',
      ageBand: '16-17',
      profile: { engineProfile: 'cautious' },
    });
  });

  it("séances terminées des 28 derniers jours : celle d'il y a 29 jours, une en cours et une supprimée absentes", async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    const old = await push(u, { instanceId, startedAt: dayAt(DAY_29), exercises: [{}] });
    const kept = await push(u, { instanceId, startedAt: dayAt(DAY_28), exercises: [{}] });
    await push(u, { instanceId, startedAt: dayAt(DAY_28, 3), status: 'in_progress', endedAt: null });
    const gone = await push(u, { instanceId: null, workoutId: null, startedAt: dayAt(DAY_28, 5) });
    await syncPush(ctx, u.cookie, [
      makeOp({ userId: u.id, entity: 'workout_session', id: gone.sessionId, kind: 'delete' }),
    ]);

    const loaded = await input(u.id);
    expect(loaded.sessions.map((s) => s.endedAt)).toEqual([Date.parse(dayAt(DAY_28, 1))]);
    expect(loaded.sessions[0]).toMatchObject({
      workoutName: 'Séance A',
      placeId: null,
      note: null,
      exercises: [{ exerciseId: 'goblet-squat', painLevel: null, note: null }],
    });
    expect(loaded.sessions[0]?.exercises[0]?.sets).toHaveLength(3);
    expect(buildCoachBrief(loaded).brief.history.sessions).toHaveLength(1);

    // Les décisions de tout le rejeu ont leur fin de séance, la séance d'il y a 29 jours comprise.
    const ended = loaded.program?.decisionEndedAt;
    expect(ended?.get(old.exerciseIds[0] ?? '')).toBe(Date.parse(dayAt(DAY_29, 1)));
    expect(ended?.get(kept.exerciseIds[0] ?? '')).toBe(Date.parse(dayAt(DAY_28, 1)));
  });

  it('séance libre : sans nom de séance ; notes de séance et d’exercice reprises', async () => {
    const u = await setup();
    const free = await push(u, {
      instanceId: null,
      workoutId: null,
      startedAt: dayAt(DAY_28),
      exercises: [{ slotId: null }],
    });
    await syncPush(ctx, u.cookie, [
      makeOp({
        userId: u.id,
        entity: 'workout_session',
        id: free.sessionId,
        kind: 'patch',
        fields: { note: 'Bonne séance' },
      }),
      makeOp({
        userId: u.id,
        entity: 'performed_exercise',
        id: free.exerciseIds[0] ?? '',
        kind: 'patch',
        fields: { note: 'Dos droit' },
      }),
    ]);
    const loaded = await input(u.id);
    expect(loaded.sessions).toEqual([
      expect.objectContaining({
        workoutName: null,
        note: 'Bonne séance',
        exercises: [expect.objectContaining({ exerciseId: 'goblet-squat', note: 'Dos droit' })],
      }),
    ]);
    expect(loaded.program).toBeNull();
  });

  it('limitations et douleurs seulement avec l’accord santé et l’accord coach', async () => {
    const u = await setup();
    await insertFixtureRow(ctx.deps.db, 'limitation', { ownerId: u.id, note: 'Genou fragile' });
    await insertFixtureRow(ctx.deps.db, 'limitation', { ownerId: u.id, bodyArea: 'shoulder', active: 0 });
    expect((await input(u.id)).limitations).toEqual([]);

    await grantCoach(u.id);
    expect((await input(u.id)).consents).toEqual({ health: false, coach: true });
    expect((await input(u.id)).limitations).toEqual([]);

    const v = await member();
    await insertFixtureRow(ctx.deps.db, 'limitation', { ownerId: v.id, note: 'Genou fragile' });
    await insertFixtureRow(ctx.deps.db, 'limitation', { ownerId: v.id, bodyArea: 'shoulder', active: 0 });
    await insertFixtureRow(ctx.deps.db, 'limitation', {
      ownerId: v.id,
      bodyArea: 'hip',
      deletedAt: '2026-10-01T10:00:00.000Z',
    });
    await grantHealth(ctx, v.id);
    await push(v, { instanceId: null, startedAt: dayAt(DAY_28), exercises: [{ painLevel: 'discomfort' }] });
    const healthOnly = await input(v.id);
    expect(healthOnly.consents).toEqual({ health: true, coach: false });
    expect(healthOnly.limitations).toEqual([]);
    expect(healthOnly.sessions[0]?.exercises[0]?.painLevel).toBeNull();

    await grantCoach(v.id);
    const both = await input(v.id);
    expect(both.consents).toEqual({ health: true, coach: true });
    expect(both.limitations).toEqual([
      { area: 'knee', side: 'left', severity: 'mild', note: 'Genou fragile' },
    ]);
    expect(both.sessions[0]?.exercises[0]?.painLevel).toBe('discomfort');
  });

  it("accord coach d'une ancienne version : pas d'accord coach pour le dossier (C36)", async () => {
    const u = await setup();
    await grantHealth(ctx, u.id);
    await insertFixtureRow(ctx.deps.db, 'consent_event', {
      ownerId: u.id,
      type: 'ai_coach',
      action: 'grant',
      textVersion: '0.9',
      createdAt: '2026-11-01T10:00:00.000Z',
    });
    expect((await input(u.id)).consents).toEqual({ health: true, coach: false });
  });

  it('lieux : vivants seulement, triés par identifiant, avec leur matériel et leurs réglages', async () => {
    const u = await setup();
    const ids = ['place-c', 'place-a', 'place-b'];
    for (const id of ids) {
      await insertFixtureRow(ctx.deps.db, 'place', {
        id,
        ownerId: u.id,
        kind: 'home',
        name: `Chez ${id}`,
        isPrimary: id === 'place-c' ? 1 : 0,
        ...(id === 'place-b' ? { deletedAt: '2026-10-01T10:00:00.000Z' } : {}),
      });
    }
    for (const code of ['dumbbells', 'adjustable_bench']) {
      await insertFixtureRow(ctx.deps.db, 'home_equipment', {
        id: `place-a:${code}`,
        ownerId: u.id,
        placeId: 'place-a',
        equipmentCode: code,
      });
    }
    await insertFixtureRow(ctx.deps.db, 'home_equipment', {
      id: 'place-a:chair',
      ownerId: u.id,
      placeId: 'place-a',
      deletedAt: '2026-10-01T10:00:00.000Z',
    });
    const loaded = await input(u.id);
    const { places } = loaded;
    expect(places.map((p) => [p.id, p.primary])).toEqual([
      ['place-a', false],
      ['place-c', true],
    ]);
    // Codes déclarés et vivants, sans leurs implications (`flat_bench`) : le dossier les étend lui-même.
    expect(places[0]).toMatchObject({
      kind: 'home',
      name: 'Chez place-a',
      equipment: ['adjustable_bench', 'dumbbells'],
    });
    expect(places[0]?.loadSettings).toEqual(expect.objectContaining({ barG: expect.any(Number) }));
    expect(buildCoachBrief(loaded).brief.places[1]?.equipment).toEqual(['adjustable_bench', 'dumbbells']);
  });

  it('programme : celui du rejeu, propositions en attente seulement (ni périmées, ni d’une autre révision)', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    const change = (v: Row) =>
      insertFixtureRow(ctx.deps.db, 'instance_change', {
        ownerId: u.id,
        instanceId,
        author: 'engine',
        reasonCode: 'STALL',
        operations: JSON.stringify([{ op: 'lighten_exercise', slot: 'A1' }]),
        expiresAt: '2026-11-08T10:00:00.000Z',
        ...v,
      });
    await change({});
    await change({ expiresAt: '2026-11-05T09:00:00.000Z' });
    await change({ baseRevision: 1 });
    await change({ status: 'rejected' });
    await change({ deletedAt: '2026-11-01T10:00:00.000Z' });
    await insertFixtureRow(ctx.deps.db, 'instance_change', {
      ownerId: u.id,
      expiresAt: '2026-11-08T10:00:00.000Z',
    });

    const loaded = await input(u.id);
    const program = loaded.program;
    expect(program).not.toBeNull();
    expect(program?.program).toBe(program?.replay.program);
    expect(program).toMatchObject({ templateVersion: 1, revision: 0 });
    expect(program?.pending).toEqual([
      {
        author: 'engine',
        operations: [{ op: 'lighten_exercise', slot: 'A1' }],
        expiresAt: Date.parse('2026-11-08T10:00:00.000Z'),
      },
    ]);
    expect(program?.templates.map((t) => t.template.id)).toEqual([TEMPLATE.id]);
    expect(loaded.catalog.map((s) => s.id)).toContain('goblet-squat');
  });
});

describe('loadReplayInput', () => {
  it('replayInstance(loadReplayInput) rend les slot_state que replayInstanceInDb vient d’écrire, colonne par colonne', async () => {
    const u = await setup();
    // Accord santé : `pain_streak` est écrit tel que le rejeu le rend.
    await grantHealth(ctx, u.id);
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    await push(u, {
      instanceId,
      startedAt: dayAt(DAY_29),
      exercises: [{}, { exerciseId: 'dumbbell-romanian-deadlift' }],
    });
    await push(u, {
      instanceId,
      startedAt: dayAt(DAY_28),
      exercises: [{ sets: [{ reps: 12 }, { reps: 12 }, { reps: 12, effort: 'ok' }] }],
    });
    const replayInput = await loadReplayInput(ctx.deps.db, ctx.deps, u.id);
    if (replayInput === null) throw new Error('entrée du rejeu absente');
    const states = replayInstance(replayInput).slotStates;
    const stored = ctx.deps.sqlite
      .prepare('SELECT * FROM slot_state WHERE deleted_at IS NULL ORDER BY id')
      .all() as Row[];
    expect(stored.length).toBeGreaterThan(0);
    const expected = states.map((s) => ({
      id: s.id,
      owner_id: u.id,
      instance_id: s.instanceId,
      slot_id: s.slotId,
      exercise_id: s.exerciseId,
      mode: s.mode,
      load_g: s.loadG,
      target_reps: s.targetReps,
      variant_rank: s.variantRank,
      duration_s: s.durationS,
      calibration_left: s.calibrationLeft,
      no_progress_count: s.noProgressCount,
      stall_rank: s.stallRank,
      pain_streak: s.painStreak,
      suspended: s.suspended ? 1 : 0,
      last_session_id: s.lastSessionId,
      rules_version: s.rulesVersion,
      machine_step_g_override: null,
      deleted_at: null,
    }));
    // Toutes les colonnes de la table sauf l'estampille de synchro (rev, dates, auteur), écrite par le serveur.
    const stamp = ['rev', 'created_at', 'updated_at', 'updated_by'];
    const compared = stored.map((r) =>
      Object.fromEntries(Object.entries(r).filter(([k]) => !stamp.includes(k))),
    );
    expect(Object.keys(stored[0] ?? {}).sort()).toEqual([...Object.keys(expected[0] ?? {}), ...stamp].sort());
    expect(compared).toEqual(expected);
  });

  it('sans instance active : null, et pas de programme dans le dossier', async () => {
    const u = await setup();
    await enroll(ctx, u.id, TEMPLATE, { status: 'ended' });
    expect(await loadReplayInput(ctx.deps.db, ctx.deps, u.id)).toBeNull();
    expect((await input(u.id)).program).toBeNull();
  });
});

describe('loadPlanContext', () => {
  it('lieu principal, catalogue servi, profil, âge, contexte, jour de Paris, niveau et dernières charges', async () => {
    const u = await setup();
    const place = await insertFixtureRow(ctx.deps.db, 'place', { ownerId: u.id, isPrimary: 1 });
    await insertFixtureRow(ctx.deps.db, 'place', { ownerId: u.id, isPrimary: 0 });
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    await push(u, { instanceId, startedAt: dayAt(DAY_28), exercises: [{ sets: [{ loadG: 22_000 }] }] });
    // Une séance en cours compte aussi pour les dernières charges, comme sur le téléphone.
    await push(u, {
      instanceId: null,
      workoutId: null,
      startedAt: dayAt(DAY_28 + 2),
      status: 'in_progress',
      endedAt: null,
      exercises: [{ slotId: null, exerciseId: 'dumbbell-bench-press', sets: [{ loadG: 18_000 }] }],
    });

    await insertFixtureRow(ctx.deps.db, 'home_equipment', {
      id: `${place.id as string}:adjustable_bench`,
      ownerId: u.id,
      placeId: place.id,
      equipmentCode: 'adjustable_bench',
    });

    const plan = await loadPlanContext(ctx.deps.db, ctx.deps, u.id, ctx.clock.now());
    expect(plan.place.id).toBe(place.id);
    // Le contexte de `planWorkout` attend le matériel étendu (R-EQ-2).
    expect([...plan.place.equipment].sort()).toEqual(['adjustable_bench', 'flat_bench']);
    expect(plan).toMatchObject({
      profile: 'adult',
      ageBand: 'adult',
      context: 'gym',
      today: '2026-11-05',
      maxLevel: 2,
    });
    expect(plan.lastLoadByExercise).toEqual(
      new Map([
        ['goblet-squat', 22_000],
        ['dumbbell-bench-press', 18_000],
      ]),
    );
    expect(plan.catalog.map((s) => s.id)).toEqual(expect.arrayContaining(['goblet-squat', 'leg-press']));
    expect(dump(plan)).not.toContain(BIRTH);
  });

  it('mineur sans lieu ni programme : profil prudent, contexte du profil, tout le matériel', async () => {
    ctx = await createTestContext({ now: NOW });
    const u = await createUserAndLogin(ctx, { birthDate: '2009-01-01' });
    const plan = await loadPlanContext(ctx.deps.db, ctx.deps, u.id, ctx.clock.now());
    expect(plan).toMatchObject({ profile: 'cautious', ageBand: 'minor', context: 'gym', maxLevel: 2 });
    expect(plan.place).toBe(ANYWHERE);
    expect(plan.lastLoadByExercise).toEqual(lastLoadsOf([]));
  });
});
