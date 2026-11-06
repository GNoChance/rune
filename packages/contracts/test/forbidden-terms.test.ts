import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS } from '../src/forbidden-terms';

/* Termes interdits v2 (spec brique 4 §11.4, brique 5 §11.5) : listes telles quelles, dans l'ordre, et formes fléchies. */

const ALL = [
  'régime',
  'prescription',
  'prescrire',
  'ordonnance',
  'traitement',
  'soigner',
  'guérir',
  'poids idéal',
  'échec',
  'raté',
  'objectif manqué',
  'sèche',
  'brûler les graisses',
  'détox',
  'bon aliment',
  'mauvais aliment',
  'aliment interdit',
  'triche',
  'cheat meal',
  'se mériter',
  'culpabiliser',
];

const NOT_FULL = ['déficit', 'déficitaire', 'jeûne', 'jeûner', 'sécher'];

const MINOR = [
  'perte de poids',
  'perdre du poids',
  'maigrir',
  'mincir',
  'déficit',
  'sécher',
  'jeûne',
  'jeûner',
  'calories',
  'kcal',
  'complément alimentaire',
  'créatine',
  'whey',
  'protéine en poudre',
  'brûleur de graisse',
  'stéroïde',
  'anabolisant',
  'SARM',
  'hormone de croissance',
];

/** Comparaison sans casse ni accents : « Écoute Dopage » et « ecoute dopage » sont la même forme. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const formsOf = (term: string) =>
  [...FORBIDDEN_TERMS.all, ...FORBIDDEN_TERMS.notFull, ...FORBIDDEN_TERMS.minor].find((t) => t.term === term)
    ?.forms ?? [];

describe('FORBIDDEN_TERMS (§11.4)', () => {
  it("version 2, listes pour tous, hors mode complet et en plus pour un mineur, dans l'ordre de la spec", () => {
    expect(FORBIDDEN_TERMS.version).toBe('2');
    expect(FORBIDDEN_TERMS.all.map((t) => t.term)).toEqual(ALL);
    expect(FORBIDDEN_TERMS.notFull.map((t) => t.term)).toEqual(NOT_FULL);
    expect(FORBIDDEN_TERMS.minor.map((t) => t.term)).toEqual(MINOR);
  });

  it('chaque entrée liste son terme parmi ses formes, sans doublon', () => {
    for (const t of [...FORBIDDEN_TERMS.all, ...FORBIDDEN_TERMS.notFull, ...FORBIDDEN_TERMS.minor]) {
      expect(t.forms, t.term).toContain(t.term);
      expect(new Set(t.forms).size, t.term).toBe(t.forms.length);
      for (const f of t.forms) expect(f, t.term).toBe(f.trim());
    }
  });

  it('« dopage », « produits dopants » et « Écoute Dopage » restent permis : aucune forme listée', () => {
    expect(FORBIDDEN_TERMS.allowedForMinor).toEqual(['dopage', 'produits dopants', 'Écoute Dopage']);
    const listed = new Set(
      [...FORBIDDEN_TERMS.all, ...FORBIDDEN_TERMS.notFull, ...FORBIDDEN_TERMS.minor].flatMap((t) =>
        t.forms.map(fold),
      ),
    );
    for (const allowed of FORBIDDEN_TERMS.allowedForMinor)
      expect(listed.has(fold(allowed)), allowed).toBe(false);
  });

  it('verbes : infinitif, présent, participes et futur (exemple de la spec : sécher)', () => {
    expect(formsOf('sécher')).toEqual(
      expect.arrayContaining([
        'sécher',
        'sèche',
        'sèches',
        'sèchent',
        'séchons',
        'séchez',
        'séché',
        'séchée',
        'séchés',
        'séchées',
        'séchant',
        'sécherai',
        'sécheras',
        'séchera',
        'sécherons',
        'sécherez',
        'sécheront',
      ]),
    );
    expect(formsOf('guérir')).toEqual(expect.arrayContaining(['guéris', 'guérissent', 'guérie', 'guérira']));
    expect(formsOf('prescrire')).toEqual(expect.arrayContaining(['prescrivent', 'prescrite', 'prescrira']));
    expect(formsOf('perdre du poids')).toEqual(expect.arrayContaining(['perd du poids', 'perdu du poids']));
    expect(formsOf('se mériter')).toEqual(expect.arrayContaining(['se mérite', 'se méritent']));
  });

  it('noms et adjectifs : pluriel et féminin', () => {
    expect(formsOf('régime')).toEqual(['régime', 'régimes']);
    expect(formsOf('échec')).toEqual(['échec', 'échecs']);
    expect(formsOf('raté')).toEqual(['raté', 'ratée', 'ratés', 'ratées']);
    expect(formsOf('poids idéal')).toEqual(['poids idéal', 'poids idéaux']);
    expect(formsOf('calories')).toEqual(['calories', 'calorie']);
    expect(formsOf('anabolisant')).toEqual(['anabolisant', 'anabolisante', 'anabolisants', 'anabolisantes']);
  });

  it('hors mode complet : déficit, déficitaire, jeûne, jeûner, sécher et formes fléchies', () => {
    expect(formsOf('déficit')).toEqual(['déficit', 'déficits']);
    expect(formsOf('déficitaire')).toEqual(['déficitaire', 'déficitaires']);
    expect(formsOf('jeûne')).toEqual(['jeûne', 'jeûnes']);
    expect(formsOf('jeûner')).toEqual(expect.arrayContaining(['jeûnes', 'jeûné', 'jeûnera']));
    expect(formsOf('sécher')).toEqual(expect.arrayContaining(['sèche', 'séché', 'séchera']));
  });
});
