import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP_PHONE_DIGITS, HELP_RESOURCE_IDS, HELP_RESOURCES, helpPhones } from '../src/help-resources';

const REPO = resolve(import.meta.dirname, '../../..');
const SKIPPED = new Set(['node_modules', 'dist', '.e2e-data', '.superpowers']);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

describe('HELP_RESOURCES', () => {
  it("liste les ressources dans l'ordre", () => {
    expect(HELP_RESOURCES.map((r) => r.id)).toEqual([
      'emergency',
      'pain',
      'eating_disorder',
      'doping',
      'pregnancy',
      'distress',
    ]);
  });

  it('porte les numéros vérifiés, seule la détresse a des horaires', () => {
    const phone = Object.fromEntries(HELP_RESOURCES.map((r) => [r.id, r.phone]));
    expect(phone).toEqual({
      emergency: '15 / 112',
      pain: null,
      eating_disorder: '09 69 325 900',
      doping: '0 800 15 2000',
      pregnancy: null,
      distress: '3114',
    });
    for (const r of HELP_RESOURCES) expect(r.verifiedOn).toBe('2026-10-06');
    expect(HELP_RESOURCES.filter((r) => r.hours !== null).map((r) => r.id)).toEqual(['distress']);
  });

  it("HELP_RESOURCE_IDS suit l'ordre de HELP_RESOURCES", () => {
    expect(HELP_RESOURCE_IDS).toEqual(HELP_RESOURCES.map((r) => r.id));
  });

  it('numéros à appeler : un par numéro, libellé tel quel, chiffres seuls', () => {
    const byId = (id: string) => {
      const r = HELP_RESOURCES.find((h) => h.id === id);
      if (r === undefined) throw new Error(`ressource ${id} absente`);
      return r;
    };
    expect(helpPhones(byId('emergency'))).toEqual([
      { label: '15', digits: '15' },
      { label: '112', digits: '112' },
    ]);
    expect(helpPhones(byId('eating_disorder'))).toEqual([{ label: '09 69 325 900', digits: '0969325900' }]);
    expect(helpPhones(byId('doping'))).toEqual([{ label: '0 800 15 2000', digits: '0800152000' }]);
    expect(helpPhones(byId('distress'))).toEqual([{ label: '3114', digits: '3114' }]);
    expect(helpPhones(byId('pain'))).toEqual([]);
  });

  it('HELP_PHONE_DIGITS : les numéros admis par le filtre du coach (§11.3)', () => {
    expect([...HELP_PHONE_DIGITS].sort()).toEqual(['0800152000', '0969325900', '112', '15', '3114']);
  });

  it("l'ancien numéro TCA n'apparaît dans aucun fichier de apps/, packages/, data/", () => {
    // Chiffres seuls, sans espaces, points ni tirets : attrape aussi les formes collées et `tel:`.
    const old = ['0810', '037', '037'].join('');
    const hits: string[] = [];
    for (const top of ['apps', 'packages', 'data']) {
      for (const file of walk(join(REPO, top))) {
        const compact = readFileSync(file)
          .toString('utf8')
          .replace(/[\s.\- ]/g, '');
        if (compact.includes(old)) hits.push(file);
      }
    }
    expect(hits).toEqual([]);
  });
});
