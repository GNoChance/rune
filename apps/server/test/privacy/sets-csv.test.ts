import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  createUserAndLogin,
  grantConsent,
  insertFixtureRow,
  type TestContext,
} from '../support';
import { programTemplate } from '../support/program';

let ctx: TestContext;
afterEach(() => ctx?.close());

const HEADER =
  'date;heure;seance;lieu;exercice;exercice_id;position;cote;type;charge_kg;repetitions;duree_s;effort;cible_reps_min;cible_reps_max;cible_duree_s;cible_charge_kg;cible_rir';

type Member = Awaited<ReturnType<typeof createUserAndLogin>>;
const get = (u: Member, headers: Record<string, string> = {}) =>
  ctx.request('/api/me/export/sets.csv', { cookie: u.cookie, headers });

async function seed(u: Member) {
  const { db } = ctx.deps;
  await insertFixtureRow(db, 'exercise', { id: 'goblet-squat', name: 'Squat gobelet' });
  await insertFixtureRow(db, 'exercise', { id: 'retired-row', name: 'Rowing; ancien', status: 'retired' });
  const place = await insertFixtureRow(db, 'place', { ownerId: u.id, name: 'Salle "Nord"' });
  const tpl = programTemplate();
  const instance = await insertFixtureRow(db, 'program_instance', {
    ownerId: u.id,
    templateId: tpl.id,
    templateVersion: 1,
    snapshot: JSON.stringify(tpl),
    startedAt: '2026-07-01T10:00:00.000Z',
  });
  return { place, instance };
}

async function addSession(
  u: Member,
  o: { instanceId?: string | null; workoutId?: string | null; placeId?: string | null; startedAt: string },
) {
  const session = await insertFixtureRow(ctx.deps.db, 'workout_session', {
    ownerId: u.id,
    instanceId: o.instanceId ?? null,
    workoutId: o.workoutId ?? null,
    placeId: o.placeId ?? null,
    startedAt: o.startedAt,
  });
  return session.id as string;
}

async function addExercise(u: Member, sessionId: string, exerciseId: string, extra = {}) {
  return (
    await insertFixtureRow(ctx.deps.db, 'performed_exercise', {
      ownerId: u.id,
      sessionId,
      exerciseId,
      ...extra,
    })
  ).id as string;
}

const addSet = (u: Member, exId: string, v: Record<string, unknown>) =>
  insertFixtureRow(ctx.deps.db, 'performed_set', { ownerId: u.id, performedExerciseId: exId, ...v });

describe('GET /api/me/export/sets.csv (spec brique 3 §5.6)', () => {
  it('en-tête exact, BOM, fins de ligne CRLF, virgule décimale, fuseau de Paris', async () => {
    ctx = await createTestContext();
    const u = await createUserAndLogin(ctx, { username: 'lea' });
    const { place, instance } = await seed(u);
    const s1 = await addSession(u, {
      instanceId: instance.id as string,
      workoutId: 'A',
      placeId: place.id as string,
      startedAt: '2026-10-05T22:30:00.000Z',
    });
    const e1 = await addExercise(u, s1, 'goblet-squat');
    await addSet(u, e1, {
      position: 1,
      loadG: 62_500,
      reps: 8,
      effort: 'ok',
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetLoadG: 60_000,
      targetRir: 2,
      loggedAt: '2026-10-05T22:30:00.000Z',
    });
    await addSet(u, e1, { position: 2, loadG: 60_000, reps: 7, loggedAt: '2026-10-05T22:40:00.000Z' });

    const res = await get(u);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="rune-series-2026-10-06.csv"');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder().decode(bytes.slice(3)).split('\r\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe(
      '2026-10-06;00:30;Séance A;"Salle ""Nord""";Squat gobelet;goblet-squat;1;;travail;62,5;8;;correct;8;12;;60;2',
    );
    expect(lines[2]).toBe(
      '2026-10-06;00:40;Séance A;"Salle ""Nord""";Squat gobelet;goblet-squat;2;;travail;60;7;;;;;;;',
    );
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('');
  });

  it('séries faites seulement, séance libre, lieu inconnu, fiche retirée, deux côtés, séance supprimée exclue', async () => {
    ctx = await createTestContext();
    const u = await createUserAndLogin(ctx, { username: 'lea' });
    await seed(u);
    const s = await addSession(u, { startedAt: '2026-10-05T10:00:00.000Z' });
    const e = await addExercise(u, s, 'retired-row');
    await addSet(u, e, {
      position: 1,
      side: 'left',
      loadG: 10_000,
      reps: 10,
      loggedAt: '2026-10-05T10:05:00.000Z',
    });
    await addSet(u, e, {
      position: 1,
      side: 'right',
      loadG: 10_000,
      reps: 9,
      loggedAt: '2026-10-05T10:06:00.000Z',
    });
    await addSet(u, e, { position: 2, loadG: 10_000, reps: 9, loggedAt: null });
    await addSet(u, e, {
      position: 3,
      kind: 'warmup',
      loadG: 0,
      reps: null,
      durationS: 30,
      effort: 'failed',
      loggedAt: '2026-10-05T10:07:00.000Z',
    });
    const gone = await addSession(u, { startedAt: '2026-10-04T10:00:00.000Z' });
    const ge = await addExercise(u, gone, 'goblet-squat');
    await addSet(u, ge, { loggedAt: '2026-10-04T10:05:00.000Z' });
    await sql`update workout_session set deleted_at = '2026-10-04T12:00:00.000Z' where id = ${gone}`.execute(
      ctx.deps.db,
    );

    const text = await (await get(u)).text();
    const lines = text.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(
      ';Séance libre;Lieu inconnu;"Rowing; ancien";retired-row;1;gauche;travail;10;10;',
    );
    expect(lines[2]).toContain(';droite;');
    expect(lines[3]).toContain(';echauffement;0;;30;echec;');
    expect(text).not.toContain('Squat gobelet');
  });

  it('rien d un autre membre ; colonne douleur seulement avec le consentement santé', async () => {
    ctx = await createTestContext();
    const u = await createUserAndLogin(ctx, { username: 'lea' });
    const other = await createUserAndLogin(ctx, { username: 'tom' });
    await seed(u);
    const mine = await addExercise(
      u,
      await addSession(u, { startedAt: '2026-10-05T10:00:00.000Z' }),
      'goblet-squat',
      { painLevel: 'discomfort' },
    );
    await addSet(u, mine, { reps: 5, loadG: 1_000, loggedAt: '2026-10-05T10:05:00.000Z' });
    const theirs = await addExercise(
      other,
      await addSession(other, { startedAt: '2026-10-05T10:00:00.000Z' }),
      'goblet-squat',
    );
    await addSet(other, theirs, { reps: 99, loadG: 99_000, loggedAt: '2026-10-05T10:05:00.000Z' });

    const without = await (await get(u)).text();
    expect(without.split('\r\n')[0]).toBe(HEADER);
    expect(without.split('\r\n').filter(Boolean)).toHaveLength(2);
    expect(without).not.toContain('99');

    await grantConsent(ctx.deps.db, ctx.deps, u.id, 'health', '1.0', null);
    const withHealth = (await (await get(u)).text()).split('\r\n');
    expect(withHealth[0]).toBe(`${HEADER};douleur`);
    expect(withHealth[1]?.endsWith(';gene')).toBe(true);
  });

  it('Sec-Fetch-Site étranger : 403 origin_mismatch ; page ou adresse tapée : 200 ; sans session : 401', async () => {
    ctx = await createTestContext();
    const u = await createUserAndLogin(ctx, { username: 'lea' });
    for (const site of ['cross-site', 'same-site']) {
      const res = await get(u, { 'Sec-Fetch-Site': site });
      expect(res.status, site).toBe(403);
      expect(await res.json(), site).toEqual({ error: 'origin_mismatch' });
    }
    for (const site of ['same-origin', 'none']) {
      expect((await get(u, { 'Sec-Fetch-Site': site })).status, site).toBe(200);
    }
    expect((await ctx.request('/api/me/export/sets.csv')).status).toBe(401);
  });

  it('journalise data_exported sans contenu', async () => {
    ctx = await createTestContext();
    const u = await createUserAndLogin(ctx, { username: 'lea' });
    await get(u);
    const events = await ctx.deps.db
      .selectFrom('securityEvent')
      .selectAll()
      .where('type', '=', 'data_exported')
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: u.id, targetId: u.id, outcome: 'success' });
    expect(JSON.parse(events[0]?.details ?? '{}')).toEqual({ format: 'sets_csv' });
  });

  it('neutralise les formules de tableur dans les noms', async () => {
    ctx = await createTestContext();
    const u = await createUserAndLogin(ctx, { username: 'lea' });
    await seed(u);
    const place = await insertFixtureRow(ctx.deps.db, 'place', { ownerId: u.id, name: '=HYPERLINK(1)' });
    const e = await addExercise(
      u,
      await addSession(u, { placeId: place.id as string, startedAt: '2026-10-05T10:00:00.000Z' }),
      'goblet-squat',
    );
    await addSet(u, e, { loggedAt: '2026-10-05T10:05:00.000Z' });
    expect(await (await get(u)).text()).toContain(";'=HYPERLINK(1);");
  });
});
