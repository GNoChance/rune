import { describe, expect, it } from 'vitest';
import { allowedValues, findQuantities, normalizeNumber } from '../../src/coach/values';

const NO_SOURCES = { brief: {}, toolResults: [], constants: [], nutritionFull: false };

describe('normalizeNumber', () => {
  it('unifie la virgule et le point décimal, retire les zéros de fin', () => {
    expect(normalizeNumber('62,50')).toBe('62.5');
    expect(normalizeNumber('60.0')).toBe('60');
  });

  it.each([
    ['espace', '1 000'],
    ['insécable', '1 000'],
    ['fine insécable', '1 000'],
    ['fine', '1 000'],
  ])("retire l'espace de milliers (%s)", (_name, raw) => {
    expect(normalizeNumber(raw)).toBe('1000');
  });
});

describe('findQuantities', () => {
  it('trouve nombre et unité, avec ou sans espace', () => {
    const found = findQuantities('Mets 62,5kg puis 10 % et 200 kcal');
    expect(found.map((q) => [q.value, q.family])).toEqual([
      ['62.5', 'mass'],
      ['10', 'percent'],
      ['200', 'nutrition'],
    ]);
    expect(found[0]?.index).toBe(5);
  });

  it('reconnaît kilos, gr et pour cent', () => {
    expect(findQuantities('5 kilos')[0]?.family).toBe('mass');
    expect(findQuantities('3 gr')[0]?.family).toBe('nutrition');
    expect(findQuantities('15 pour cent')[0]?.family).toBe('percent');
  });

  it("n'accepte une unité qu'en fin de mot", () => {
    expect(findQuantities('10 grenouilles')).toEqual([]);
    expect(findQuantities('10 kgs')).toEqual([]);
  });

  it('lit un nombre à milliers', () => {
    expect(findQuantities('1 200 kcal')[0]?.value).toBe('1200');
  });
});

describe('allowedValues', () => {
  it('range un nombre sous une clé _kg dans la masse', () => {
    const allowed = allowedValues({ ...NO_SOURCES, brief: { engine: { load_kg: 62.5 } } });
    expect(allowed.mass.has('62.5')).toBe(true);
  });

  it('laisse sans famille un nombre sans suffixe', () => {
    const allowed = allowedValues({ ...NO_SOURCES, brief: { rest_s: 90 } });
    expect(allowed.mass.size + allowed.percent.size + allowed.nutrition.size).toBe(0);
  });

  it("lit les nombres des chaînes des résultats d'outils", () => {
    const allowed = allowedValues({
      ...NO_SOURCES,
      toolResults: [{ key_points: ['Garde 90 % de ta course'] }],
    });
    expect(allowed.percent.has('90')).toBe(true);
  });

  it('range les constantes dans les pourcentages', () => {
    const allowed = allowedValues({ ...NO_SOURCES, constants: [10, 20] });
    expect(allowed.percent.has('10')).toBe(true);
    expect(allowed.percent.has('20')).toBe(true);
  });

  it('range _pct dans les pourcentages', () => {
    const allowed = allowedValues({ ...NO_SOURCES, brief: { drop_pct: 5 } });
    expect(allowed.percent.has('5')).toBe(true);
  });

  it('laisse la nutrition vide hors mode complet', () => {
    const allowed = allowedValues({
      ...NO_SOURCES,
      brief: { target_kcal: 2000, note: 'environ 150 g de riz' },
    });
    expect(allowed.nutrition.size).toBe(0);
  });

  it('remplit la nutrition en mode complet (_kcal, _g, chaînes)', () => {
    const allowed = allowedValues({
      ...NO_SOURCES,
      nutritionFull: true,
      brief: { target_kcal: 2000, protein_g: 140, note: 'environ 150 g de riz' },
    });
    expect([...allowed.nutrition].sort()).toEqual(['140', '150', '2000']);
  });

  it("donne la position 0 d'un tuple de série à la masse, pas les répétitions", () => {
    const allowed = allowedValues({
      ...NO_SOURCES,
      brief: { history: { sessions: [{ exercises: [{ sets: [[57.5, 8, null, 'ok']] }] }] } },
    });
    expect(allowed.mass.has('57.5')).toBe(true);
    expect(allowed.mass.has('8')).toBe(false);
    expect(allowed.percent.has('8')).toBe(false);
    expect(allowed.nutrition.has('8')).toBe(false);
  });

  it('ignore un tuple sans charge', () => {
    const allowed = allowedValues({
      ...NO_SOURCES,
      brief: { sets: [[null, 10, null, null]] },
    });
    expect(allowed.mass.size).toBe(0);
  });
});
