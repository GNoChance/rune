import {
  COACH_TOOL_NAMES,
  MOVEMENT_PATTERNS,
  MUSCLES,
  ProposeProgramChangeInput,
  ReadTrainingInput,
} from '@rune/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toStructuredSchema } from '../../../src/ai';
import { runTool, TOOLS_1, toolDefinitions } from '../../../src/coach/tools';
import type { CoachTool } from '../../../src/coach/tools/types';
import { createTestContext, createUserAndLogin, type TestContext } from '../../support';
import { toolContext } from '../../support/coach';

/*
 * Registre des outils du coach (spec brique 4 §10, `tools-1`, P10) : revalidation par le schéma Zod complet avant le
 * gestionnaire, forme de l'erreur rendue au modèle, compteur des refus de `propose_program_change`, définitions
 * envoyées en `strict: true`.
 */

let ctx: TestContext;
afterEach(() => ctx?.close());

async function setup() {
  ctx = await createTestContext({ now: '2026-11-05T10:00:00.000Z' });
  const u = await createUserAndLogin(ctx);
  return toolContext(ctx, u.id);
}

/** `propose_program_change` factice : le vrai gestionnaire arrive avec la tâche 18. */
function fakePropose(): { tool: CoachTool; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => ({ isError: false, result: { ok: true } }));
  return {
    run,
    tool: { name: 'propose_program_change', description: 'Factice.', input: ProposeProgramChangeInput, run },
  };
}

describe('runTool', () => {
  it("since_days '7' : invalid_input, une entrée par problème, path joint par des points, message du schéma", async () => {
    const tc = await setup();
    const expected = ReadTrainingInput.safeParse({ since_days: '7' }).error?.issues[0]?.message;
    expect(expected).toEqual(expect.any(String));
    expect(await runTool('read_training', { since_days: '7' }, tc)).toEqual({
      isError: true,
      result: { error: 'invalid_input', issues: [{ path: 'since_days', message: expected }] },
    });
    const two = await runTool('read_training', { since_days: 0, exercise_id: 'Pas Un Id' }, tc);
    expect((two.result as { issues: { path: string }[] }).issues.map((i) => i.path)).toEqual([
      'since_days',
      'exercise_id',
    ]);
    // Clé inconnue (schéma strict) : problème à la racine, chemin vide.
    expect(await runTool('read_training', { since_days: 7, sinceDays: 7 }, tc)).toMatchObject({
      isError: true,
      result: { error: 'invalid_input', issues: [{ path: '' }] },
    });
    expect(tc.state.invalidProposals).toBe(0);
  });

  it('propose_program_change invalide au schéma : invalid_input, invalidProposals 1, gestionnaire non appelé', async () => {
    const tc = await setup();
    const { tool, run } = fakePropose();
    const bad = { base_revision: 0, operations: [{ op: 'resume_slot', slot: 'A1' }], reason: 'Repos.' };
    const outcome = await runTool('propose_program_change', bad, tc, [tool]);
    expect(outcome).toMatchObject({ isError: true, result: { error: 'invalid_input' } });
    expect((outcome.result as { issues: { path: string }[] }).issues[0]?.path).toBe('operations.0.op');
    expect(tc.state.invalidProposals).toBe(1);
    expect(run).not.toHaveBeenCalled();

    await runTool('propose_program_change', { base_revision: -1, operations: [], reason: '' }, tc, [tool]);
    expect(tc.state.invalidProposals).toBe(2);

    // Une entrée valide va au gestionnaire, qui tient seul le compte de ses refus (tâche 18).
    const good = {
      base_revision: 0,
      operations: [{ op: 'set_rest', slot: 'A1', seconds: 90 }],
      reason: 'Repos.',
    };
    expect(await runTool('propose_program_change', good, tc, [tool])).toEqual({
      isError: false,
      result: { ok: true },
    });
    expect(run).toHaveBeenCalledWith(good, tc);
    expect(tc.state.invalidProposals).toBe(2);
  });

  it("nom inconnu : unknown_tool ; un outil absent de la liste passée l'est aussi", async () => {
    const tc = await setup();
    expect(await runTool('x', {}, tc)).toEqual({ isError: true, result: { error: 'unknown_tool' } });
    expect(await runTool('read_training', { since_days: 7 }, tc, [fakePropose().tool])).toEqual({
      isError: true,
      result: { error: 'unknown_tool' },
    });
    expect(tc.state.invalidProposals).toBe(0);
  });
});

describe('TOOLS_1 et définitions', () => {
  it('noms triés, tous dans COACH_TOOL_NAMES', () => {
    const names = TOOLS_1.map((t) => t.name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(['read_training', 'search_exercises']);
    expect(names.every((n) => (COACH_TOOL_NAMES as readonly string[]).includes(n))).toBe(true);
  });

  it('forme rendue figée : JSON Schema strict, bornes et motif dans la description', () => {
    expect(toolDefinitions(TOOLS_1)).toEqual([
      {
        name: 'read_training',
        description: expect.stringContaining('28 jours au plus'),
        inputSchema: {
          type: 'object',
          properties: {
            since_days: { type: 'integer', description: '{minimum: 1, maximum: 28}' },
            exercise_id: {
              type: 'string',
              description: '{maxLength: 60, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"}',
            },
          },
          required: ['since_days'],
          additionalProperties: false,
        },
      },
      {
        name: 'search_exercises',
        description: expect.stringContaining('10 fiches au plus'),
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '{maxLength: 80}' },
            muscle: { type: 'string', enum: [...MUSCLES] },
            movement_pattern: { type: 'string', enum: [...MOVEMENT_PATTERNS] },
            available_equipment_only: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    ]);
  });

  it('mots-clés du mode strict seulement, et forme stable : chat() la repasse par toStructuredSchema', () => {
    const allowed = new Set([
      'type',
      'properties',
      'required',
      'additionalProperties',
      'enum',
      'const',
      'anyOf',
      'allOf',
      '$ref',
      '$defs',
      'items',
      'minItems',
      'format',
      'description',
    ]);
    const keys = (node: unknown, parent = ''): string[] => {
      if (node === null || typeof node !== 'object') return [];
      if (Array.isArray(node)) return node.flatMap((n) => keys(n, parent));
      return Object.entries(node).flatMap(([k, v]) =>
        // Sous `properties`, les clés sont des noms de champs, pas des mots-clés.
        parent === 'properties' ? keys(v) : [k, ...(k === 'enum' || k === 'required' ? [] : keys(v, k))],
      );
    };
    for (const def of toolDefinitions(TOOLS_1)) {
      expect(
        keys(def.inputSchema).filter((k) => !allowed.has(k)),
        def.name,
      ).toEqual([]);
      expect(toStructuredSchema(def.inputSchema)).toEqual(def.inputSchema);
    }
  });
});
