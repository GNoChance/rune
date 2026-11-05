import { defaultLoadSettings, type EquipmentCode } from '@rune/contracts';
import { allowedValues } from '@rune/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { runTool } from '../../../src/coach/tools';
import { PROPOSAL_ERROR_MESSAGES } from '../../../src/coach/tools/propose-program-change';
import type { ToolContext } from '../../../src/coach/tools/types';
import {
  createLogger,
  createTestContext,
  createUserAndLogin,
  insertFixtureRow,
  syncPush,
  type TestContext,
} from '../../support';
import { pressThenGoblet, toolContext } from '../../support/coach';
import {
  enroll,
  programTemplate,
  type SessionSpec,
  seedProgramCatalog,
  sessionOps,
} from '../../support/program';

/*
 * `propose_program_change` (spec brique 4 §10, §12.2, choix C3 à C7) : étapes 2 à 7 du gestionnaire dans l'ordre,
 * première erreur rendue `{errors: [{op, code, message}]}`, un seul compteur des refus (schéma compris) jusqu'à
 * `corrections_exhausted`, références de slot retraduites par la table figée du fil, garde de hausse dans tous les
 * lieux vivants, suspensions levées. Rien n'est écrit en base pendant la tentative.
 */

type Member = Awaited<ReturnType<typeof createUserAndLogin>>;
type Row = Record<string, unknown>;
type Refusal = { errors: { op: number; code: string; message: string }[] };

const NOW = '2026-11-05T10:00:00.000Z';
const TEMPLATE = programTemplate();
const FIRST_ADD = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a01';
const SECOND_ADD = '019a4b2c-3d4e-7f60-8a1b-2c3d4e5f6a02';
const REST: Row = { op: 'set_rest', slot: 'A1', seconds: 90 };
const TO_PRESS: Row = { op: 'replace_exercise', slot: 'A1', exercise: 'leg-press' };
const REASON = 'Un repos plus court garde ta séance dans ton temps.';

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup(lines?: string[]): Promise<Member> {
  ctx = await createTestContext({
    now: NOW,
    ...(lines === undefined ? {} : { deps: { logger: createLogger((l) => lines.push(l)) } }),
  });
  await seedProgramCatalog(ctx, [TEMPLATE]);
  return createUserAndLogin(ctx);
}

async function push(u: Member, specs: SessionSpec[]): Promise<void> {
  const ops = specs.flatMap((spec) => sessionOps(u.id, spec).ops);
  const res = await syncPush(ctx, u.cookie, ops);
  expect(res.status).toBe(200);
  expect(res.body.results.every((r: Row) => r.status === 'applied')).toBe(true);
}

const input = (operations: Row[], o: { base?: number; reason?: string } = {}) => ({
  base_revision: o.base ?? 0,
  operations,
  reason: o.reason ?? REASON,
});

const propose = (tc: ToolContext, raw: unknown) => runTool('propose_program_change', raw, tc);

/** Refus du validateur : `isError`, et les codes rendus. */
async function refused(tc: ToolContext, raw: unknown): Promise<Refusal['errors']> {
  const outcome = await propose(tc, raw);
  expect(outcome.isError).toBe(true);
  return (outcome.result as Refusal).errors;
}

const codes = (errors: Refusal['errors']) => errors.map((e) => [e.op, e.code]);

const counter = () =>
  (ctx.deps.sqlite.prepare('SELECT sync_counter FROM server_meta').get() as { sync_counter: number })
    .sync_counter;
const changeRows = () => ctx.deps.sqlite.prepare('SELECT * FROM instance_change').all() as Row[];

/** Lieu maison vivant de `u` avec son matériel, haltères de 2 à 40 kg et machines au pas de 5 kg. */
async function place(u: Member, id: string, primary: boolean, equipment: readonly EquipmentCode[]) {
  await insertFixtureRow(ctx.deps.db, 'place', {
    id,
    ownerId: u.id,
    kind: 'home',
    name: `Chez ${id}`,
    isPrimary: primary ? 1 : 0,
    loadSettings: JSON.stringify(defaultLoadSettings('gym')),
  });
  for (const code of equipment) {
    await insertFixtureRow(ctx.deps.db, 'home_equipment', {
      id: `${id}:${code}`,
      ownerId: u.id,
      placeId: id,
      equipmentCode: code,
    });
  }
}

/** Changement accepté de l'utilisateur sur l'instance, décidé à `decidedAt`. */
function accepted(ownerId: string, instanceId: string, operations: Row[], decidedAt: string, id?: string) {
  return insertFixtureRow(ctx.deps.db, 'instance_change', {
    ...(id === undefined ? {} : { id }),
    ownerId,
    instanceId,
    status: 'accepted',
    author: 'user',
    reasonCode: 'USER_CHANGE',
    operations: JSON.stringify(operations),
    decidedAt,
  });
}

const addSlot = (ownerId: string, instanceId: string, id: string, decidedAt: string) =>
  accepted(
    ownerId,
    instanceId,
    [{ op: 'add_slot', workout: 'A', movementPattern: 'squat', exercises: ['leg-press'] }],
    decidedAt,
    id,
  );

describe('propose_program_change : succès', () => {
  it("valide : ok, change_id, expires_in_days 7, proposition dans l'état, rien en base", async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    const tc = toolContext(ctx, u.id);
    const before = counter();

    const outcome = await propose(tc, input([REST]));
    expect(outcome).toEqual({
      isError: false,
      result: { ok: true, change_id: expect.any(String), expires_in_days: 7 },
    });
    const { change_id } = outcome.result as { change_id: string };
    expect(tc.state.proposals).toEqual([
      { id: change_id, instanceId, baseRevision: 0, operations: [REST], reason: REASON, model: null },
    ]);
    expect(tc.state.invalidProposals).toBe(0);
    expect(changeRows()).toEqual([]);
    expect(counter()).toBe(before);
  });

  it('seconde proposition valide dans la tentative : one_proposal_per_message, comptée', async () => {
    const u = await setup();
    await enroll(ctx, u.id, TEMPLATE);
    const tc = toolContext(ctx, u.id);
    expect((await propose(tc, input([REST]))).isError).toBe(false);
    expect(codes(await refused(tc, input([{ op: 'set_rest', slot: 'A2', seconds: 90 }])))).toEqual([
      [-1, 'one_proposal_per_message'],
    ]);
    expect(tc.state.proposals).toHaveLength(1);
    expect(tc.state.invalidProposals).toBe(1);
  });

  it('motif « Ta charge reste à 40 kg. » avec 40 kg dans les valeurs autorisées (dossier) : ok', async () => {
    const u = await setup();
    await enroll(ctx, u.id, TEMPLATE);
    const brief = { program: { workouts: [{ slots: [{ engine: { load_kg: 40 } }] }] } };
    const tc: ToolContext = {
      ...toolContext(ctx, u.id),
      allowed: allowedValues({ brief, toolResults: [], constants: [], nutritionFull: false }),
    };
    expect(tc.allowed.mass.has('40')).toBe(true);
    const outcome = await propose(tc, input([REST], { reason: 'Ta charge reste à 40 kg.' }));
    expect(outcome.isError).toBe(false);
    // Témoin : sans cette valeur, le même motif est bloqué.
    const without = await propose(
      toolContext(ctx, u.id),
      input([REST], { reason: 'Ta charge reste à 40 kg.' }),
    );
    expect(codes((without.result as Refusal).errors)).toEqual([[-1, 'reason_blocked']]);
  });
});

describe("propose_program_change : refus, dans l'ordre du §12.2", () => {
  it('sans instance active (Review Focus 4) : no_active_program', async () => {
    const u = await setup();
    await enroll(ctx, u.id, TEMPLATE, { status: 'ended' });
    const tc = toolContext(ctx, u.id);
    const errors = await refused(tc, input([REST]));
    expect(codes(errors)).toEqual([[-1, 'no_active_program']]);
    expect(errors[0]?.message).toBe(PROPOSAL_ERROR_MESSAGES.no_active_program);
    expect(tc.state.invalidProposals).toBe(1);
  });

  it('base_revision périmée : stale_revision, la révision courante dans le message', async () => {
    const u = await setup();
    await enroll(ctx, u.id, TEMPLATE, { revision: 3 });
    const tc = toolContext(ctx, u.id);
    const errors = await refused(tc, input([REST], { base: 2 }));
    expect(codes(errors)).toEqual([[-1, 'stale_revision']]);
    expect(errors[0]?.message).toContain('base_revision 3');
    expect(errors[0]?.message).not.toContain('{revision}');
  });

  it('resume_slot : refusé par le schéma (invalid_input, issues), compté', async () => {
    const u = await setup();
    await enroll(ctx, u.id, TEMPLATE);
    const tc = toolContext(ctx, u.id);
    const outcome = await propose(tc, input([{ op: 'resume_slot', slot: 'A1' }]));
    expect(outcome).toMatchObject({
      isError: true,
      result: { error: 'invalid_input', issues: [{ path: 'operations.0.op' }] },
    });
    expect(tc.state.invalidProposals).toBe(1);
  });

  it("add_slot pour un profil prudent : forbidden_cautious (validateur, op de l'opération)", async () => {
    const u = await setup();
    await insertFixtureRow(ctx.deps.db, 'training_profile', { ownerId: u.id, cautiousMode: 1 });
    await enroll(ctx, u.id, TEMPLATE);
    const tc = toolContext(ctx, u.id);
    const add = { op: 'add_slot', workout: 'A', movementPattern: 'squat', exercises: ['leg-press'] };
    const errors = await refused(tc, input([REST, add]));
    expect(codes(errors)).toEqual([[1, 'forbidden_cautious']]);
    expect(errors[0]?.message).toBe(PROPOSAL_ERROR_MESSAGES.forbidden_cautious);
    expect(tc.state.proposals).toEqual([]);
  });

  it('remplacement vers une fiche faite à 60 kg, la courante à 40 kg : coach_load_increase', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    await push(u, pressThenGoblet(instanceId));
    const tc = toolContext(ctx, u.id);
    const before = counter();
    const errors = await refused(tc, input([TO_PRESS]));
    expect(codes(errors)).toEqual([[-1, 'coach_load_increase']]);
    expect(errors[0]?.message).toContain('A1');
    expect(tc.state.invalidProposals).toBe(1);
    expect(counter()).toBe(before);
  });

  it('sans la séance à 60 kg, le même remplacement se calibre : ok (témoin)', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    await push(u, pressThenGoblet(instanceId).slice(1));
    const outcome = await propose(toolContext(ctx, u.id), input([TO_PRESS]));
    expect(outcome.isError).toBe(false);
  });

  it('hausse visible seulement dans un lieu secondaire : coach_load_increase', async () => {
    const u = await setup();
    // Principal : haltères seulement, la presse s'y remplace par le goblet squat (40 → 40 kg). Secondaire :
    // haltères et presse, où A1 passerait de 40 à 60 kg.
    await place(u, 'place-home', true, ['dumbbells']);
    await place(u, 'place-gym', false, ['dumbbells', 'leg_press']);
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    await push(u, pressThenGoblet(instanceId));
    expect(codes(await refused(toolContext(ctx, u.id), input([TO_PRESS])))).toEqual([
      [-1, 'coach_load_increase'],
    ]);
  });

  it('remplacement sur un slot suspendu qui monterait la charge à la reprise : coach_load_increase', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE, { revision: 1 });
    await push(u, pressThenGoblet(instanceId));
    await accepted(u.id, instanceId, [{ op: 'suspend_slot', slot: 'A1' }], '2026-11-04T10:00:00.000Z');
    expect(codes(await refused(toolContext(ctx, u.id), input([TO_PRESS], { base: 1 })))).toEqual([
      [-1, 'coach_load_increase'],
    ]);
  });

  it('motif « Fais une sèche. » : reason_blocked, sans le terme dans le résultat', async () => {
    const u = await setup();
    await enroll(ctx, u.id, TEMPLATE);
    const tc = toolContext(ctx, u.id);
    const outcome = await propose(tc, input([REST], { reason: 'Fais une sèche.' }));
    expect(outcome.isError).toBe(true);
    expect(codes((outcome.result as Refusal).errors)).toEqual([[-1, 'reason_blocked']]);
    expect(JSON.stringify(outcome.result)).not.toMatch(/sèche/i);
    expect(tc.state.proposals).toEqual([]);
  });

  it('motif de plusieurs phrases : la seconde est filtrée aussi (outputFilterText)', async () => {
    const u = await setup();
    await enroll(ctx, u.id, TEMPLATE);
    const tc = toolContext(ctx, u.id);
    const reason = 'Ton repos raccourcit. Passe à 25 kg la prochaine fois.';
    expect(codes(await refused(tc, input([REST], { reason })))).toEqual([[-1, 'reason_blocked']]);
  });
});

describe('propose_program_change : corrections', () => {
  it('3 appels invalides (dont un au schéma) puis un valide : corrections_exhausted, schéma compris', async () => {
    const u = await setup();
    await enroll(ctx, u.id, TEMPLATE);
    const tc = toolContext(ctx, u.id);
    await propose(tc, input([{ op: 'resume_slot', slot: 'A1' }]));
    await propose(tc, input([REST], { base: 5 }));
    await propose(tc, input([{ op: 'set_rest', slot: 'Z9', seconds: 90 }]));
    expect(tc.state.invalidProposals).toBe(3);

    const errors = await refused(tc, input([REST]));
    expect(codes(errors)).toEqual([[-1, 'corrections_exhausted']]);
    expect(errors[0]?.message).toBe(PROPOSAL_ERROR_MESSAGES.corrections_exhausted);
    // Tout appel, même invalide au schéma.
    expect(codes(await refused(tc, input([{ op: 'resume_slot', slot: 'A1' }])))).toEqual([
      [-1, 'corrections_exhausted'],
    ]);
    expect(tc.state.proposals).toEqual([]);
  });

  it('2 appels invalides puis un valide : ok', async () => {
    const u = await setup();
    await enroll(ctx, u.id, TEMPLATE);
    const tc = toolContext(ctx, u.id);
    await propose(tc, input([{ op: 'resume_slot', slot: 'A1' }]));
    await propose(tc, input([REST], { reason: 'Fais une sèche.' }));
    expect(tc.state.invalidProposals).toBe(2);
    expect((await propose(tc, input([REST]))).isError).toBe(false);
    expect(tc.state.proposals).toHaveLength(1);
  });

  it("aucun message d'erreur n'ajoute de valeur autorisée au filtre (résultats d'outils du fil, C8)", () => {
    const results = Object.values(PROPOSAL_ERROR_MESSAGES).map((message) => ({
      errors: [{ op: -1, code: 'x', message: message.replace('{revision}', '3').replace('{slots}', 'A1') }],
    }));
    expect(allowedValues({ brief: {}, toolResults: results, constants: [], nutritionFull: false })).toEqual({
      mass: new Set(),
      percent: new Set(),
      nutrition: new Set(),
    });
  });

  it('journaux : ni motif, ni opération, ni identifiant de personne (P-LOG-2)', async () => {
    const lines: string[] = [];
    const u = await setup(lines);
    const instanceId = await enroll(ctx, u.id, TEMPLATE);
    await push(u, pressThenGoblet(instanceId));
    lines.length = 0;
    const tc = toolContext(ctx, u.id);
    await propose(tc, input([TO_PRESS], { reason: 'Motif témoin des journaux.' }));
    await propose(tc, input([REST], { reason: 'Fais une sèche.' }));
    await propose(tc, input([REST], { reason: 'Motif témoin des journaux.' }));
    expect(tc.state.proposals).toHaveLength(1);
    const logged = lines.join('\n');
    for (const secret of ['Motif témoin', 'sèche', 'leg-press', 'set_rest', u.id, instanceId]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe('propose_program_change : références de slot', () => {
  it('slot ajouté : A-x1 retraduit en identifiant réel ; alias inconnu gardé, refusé par le validateur', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE, { revision: 1 });
    await addSlot(u.id, instanceId, FIRST_ADD, '2026-11-01T10:00:00.000Z');

    const unknown = toolContext(ctx, u.id);
    const errors = await refused(
      unknown,
      input([{ op: 'set_rest', slot: 'A-x9', seconds: 90 }], { base: 1 }),
    );
    expect(codes(errors)).toEqual([[0, 'slot_unknown']]);

    const tc = toolContext(ctx, u.id);
    expect(
      (await propose(tc, input([{ op: 'set_rest', slot: 'A-x1', seconds: 90 }], { base: 1 }))).isError,
    ).toBe(false);
    expect(tc.state.proposals[0]?.operations).toEqual([
      { op: 'set_rest', slot: `A-${FIRST_ADD}`, seconds: 90 },
    ]);
  });

  it('table figée du fil étendue au programme courant : A-x3 figé, A-x4 ajouté après le gel', async () => {
    const u = await setup();
    const instanceId = await enroll(ctx, u.id, TEMPLATE, { revision: 2 });
    await addSlot(u.id, instanceId, FIRST_ADD, '2026-11-01T10:00:00.000Z');
    await addSlot(u.id, instanceId, SECOND_ADD, '2026-11-05T09:00:00.000Z');
    const thread = await insertFixtureRow(ctx.deps.db, 'coach_thread', {
      userId: u.id,
      day: '2026-11-05',
      slotAliases: JSON.stringify({ 'A-x3': `A-${FIRST_ADD}` }),
    });
    const tc = toolContext(ctx, u.id, { thread: { id: thread.id as string } });
    const operations = [
      { op: 'set_rest', slot: 'A-x3', seconds: 90 },
      { op: 'set_rest', slot: 'A-x4', seconds: 90 },
    ];
    expect((await propose(tc, input(operations, { base: 2 }))).isError).toBe(false);
    expect(tc.state.proposals[0]?.operations).toEqual([
      { op: 'set_rest', slot: `A-${FIRST_ADD}`, seconds: 90 },
      { op: 'set_rest', slot: `A-${SECOND_ADD}`, seconds: 90 },
    ]);
    // Sans le fil, ni A-x3 ni A-x4 ne sont des alias : les slots ajoutés y sont A-x1 et A-x2.
    expect(codes(await refused(toolContext(ctx, u.id), input(operations, { base: 2 })))).toEqual([
      [0, 'slot_unknown'],
      [1, 'slot_unknown'],
    ]);
  });
});
