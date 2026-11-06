import { COACH_TOOL_NAMES } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { TOOLS_2, toolDefinitions } from '../../../src/coach/tools';

/*
 * Limites du mode strict sur toute une requête (spec brique 4 §5.3) : les 4 outils de `tools-1` ensemble, au plus 24
 * propriétés facultatives et 16 unions ; aucun `type` en tableau (`["string", "null"]`), que l'API compte comme une
 * union.
 */

interface Census {
  optional: number;
  unions: number;
  /** Chemins des `type` donnés en tableau. */
  typeArrays: string[];
}

/** Recensement d'un schéma JSON : propriétés hors `required`, nœuds `anyOf`, `type` en tableau. */
function census(schemas: readonly unknown[]): Census {
  const out: Census = { optional: 0, unions: 0, typeArrays: [] };
  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const [i, n] of node.entries()) walk(n, `${path}[${i}]`);
      return;
    }
    const schema = node as Record<string, unknown>;
    if (Array.isArray(schema.type)) out.typeArrays.push(path);
    if (Array.isArray(schema.anyOf)) out.unions += 1;
    const properties = schema.properties;
    if (properties !== null && typeof properties === 'object' && !Array.isArray(properties)) {
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      for (const [name, prop] of Object.entries(properties)) {
        if (!required.has(name)) out.optional += 1;
        walk(prop, `${path}.${name}`);
      }
    }
    for (const key of ['items', 'anyOf', 'allOf', 'oneOf']) walk(schema[key], `${path}.${key}`);
    for (const key of ['$defs', 'definitions']) {
      const defs = schema[key];
      if (defs !== null && typeof defs === 'object') {
        for (const [name, def] of Object.entries(defs)) walk(def, `${path}.${key}.${name}`);
      }
    }
  };
  for (const [i, s] of schemas.entries()) walk(s, `#${i}`);
  return out;
}

describe('tools-1 : limites du mode strict', () => {
  it('les 5 noms de COACH_TOOL_NAMES, triés', () => {
    const names = TOOLS_2.map((t) => t.name);
    expect(names).toEqual([...COACH_TOOL_NAMES]);
    expect(names).toEqual([...names].sort());
  });

  it('au plus 24 propriétés facultatives et 16 unions sur les 5 outils, aucun type en tableau', () => {
    const counted = census(toolDefinitions(TOOLS_2).map((d) => d.inputSchema));
    expect(counted.optional).toBeLessThanOrEqual(24);
    expect(counted.unions).toBeLessThanOrEqual(16);
    expect(counted.typeArrays).toEqual([]);
    // Relevé de `tools-2` : read_training 1 (exercise_id), search_exercises 4, propose_program_change 1
    // (switch_template.daysPerWeek), open_nutrition_screen 1 (suggestion) ; unions : les variantes d'opérations,
    // `change_sets.delta` et la suggestion de open_nutrition_screen (la union et celle des niveaux 1 à 4).
    expect(counted).toEqual({ optional: 7, unions: 4, typeArrays: [] });
  });

  it('le recensement voit un type en tableau, une union imbriquée et une propriété facultative', () => {
    expect(
      census([
        {
          type: 'object',
          properties: {
            a: { type: ['string', 'null'] },
            b: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'integer' }] } },
          },
          required: ['b'],
          additionalProperties: false,
        },
      ]),
    ).toEqual({ optional: 1, unions: 1, typeArrays: ['#0.a'] });
  });
});
