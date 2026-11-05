import { HELP_RESOURCES } from '@rune/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { runTool } from '../../../src/coach/tools';
import { createTestContext, createUserAndLogin, type TestContext } from '../../support';
import { toolContext } from '../../support/coach';

/*
 * `refer_to_help` (spec brique 4 §10, §11.5, §16.4) : la carte d'aide affiche `HELP_RESOURCES`, jamais un texte du
 * modèle ; la ressource rejoint l'état de la tentative (compteur `help_<resource>` à l'enregistrement) ; rien en base.
 */

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup() {
  ctx = await createTestContext({ now: '2026-11-05T10:00:00.000Z' });
  const u = await createUserAndLogin(ctx);
  return toolContext(ctx, u.id);
}

const counter = () =>
  (ctx.deps.sqlite.prepare('SELECT sync_counter FROM server_meta').get() as { sync_counter: number })
    .sync_counter;
const counters = () => ctx.deps.sqlite.prepare('SELECT * FROM coach_safety_counter').all();

describe('refer_to_help', () => {
  it("eating_disorder : libellé et numéro de HELP_RESOURCES, ressource dans l'état, aucune écriture", async () => {
    const tc = await setup();
    const before = counter();
    const outcome = await runTool('refer_to_help', { resource: 'eating_disorder' }, tc);
    expect(outcome).toEqual({
      isError: false,
      result: {
        shown: true,
        resource: 'eating_disorder',
        label: 'Anorexie Boulimie Info Écoute (FFAB), appel non surtaxé',
        phone: '09 69 325 900',
      },
    });
    expect(tc.state.helpCards).toEqual(['eating_disorder']);
    expect(counter()).toBe(before);
    expect(counters()).toEqual([]);
  });

  it('chaque ressource : sa ligne de HELP_RESOURCES, numéro nul compris ; une carte par ressource', async () => {
    const tc = await setup();
    for (const r of HELP_RESOURCES) {
      expect((await runTool('refer_to_help', { resource: r.id }, tc)).result).toEqual({
        shown: true,
        resource: r.id,
        label: r.label,
        phone: r.phone,
      });
    }
    await runTool('refer_to_help', { resource: 'pain' }, tc);
    expect(tc.state.helpCards).toEqual(HELP_RESOURCES.map((r) => r.id));
  });

  it('ressource hors liste : invalid_input (runTool), aucune carte', async () => {
    const tc = await setup();
    const outcome = await runTool('refer_to_help', { resource: 'sos_amitie' }, tc);
    expect(outcome).toMatchObject({
      isError: true,
      result: { error: 'invalid_input', issues: [{ path: 'resource' }] },
    });
    // Un libellé ou un numéro venus du modèle ne passent pas non plus : l'entrée est stricte.
    const labelled = await runTool('refer_to_help', { resource: 'distress', phone: '0800 000 000' }, tc);
    expect(labelled).toMatchObject({ isError: true, result: { error: 'invalid_input' } });
    expect(tc.state.helpCards).toEqual([]);
    expect(tc.state.invalidProposals).toBe(0);
  });
});
