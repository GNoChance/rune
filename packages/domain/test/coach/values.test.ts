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

describe('findQuantities, fourchettes et variantes', () => {
  const pairs = (text: string) => findQuantities(text).map((q) => [q.value, q.family]);

  it.each([
    [
      'de 8 à 10 kg',
      [
        ['8', 'mass'],
        ['10', 'mass'],
      ],
    ],
    [
      '8 à 10 kg',
      [
        ['8', 'mass'],
        ['10', 'mass'],
      ],
    ],
    [
      '10-15 %',
      [
        ['10', 'percent'],
        ['15', 'percent'],
      ],
    ],
    [
      '10–15 %',
      [
        ['10', 'percent'],
        ['15', 'percent'],
      ],
    ],
    [
      'entre 8 et 10 kg',
      [
        ['8', 'mass'],
        ['10', 'mass'],
      ],
    ],
    [
      'entre 100 et 150 g',
      [
        ['100', 'nutrition'],
        ['150', 'nutrition'],
      ],
    ],
  ])('rend les deux nombres de « %s »', (text, expected) => {
    expect(pairs(text)).toEqual(expected);
  });

  it.each(['Mets 60 ou 62,5 kg', '60/62,5 kg', '60 / 62,5 kg', '60−62,5 kg'])(
    'rend les deux nombres de « %s » (ou, barre oblique, signe moins)',
    (text) => {
      expect(pairs(text)).toEqual([
        ['60', 'mass'],
        ['62.5', 'mass'],
      ]);
    },
  );

  it("donne l'index de chaque nombre de la fourchette", () => {
    const found = findQuantities('de 8 à 10 kg');
    expect(found.map((q) => q.index)).toEqual([3, 7]);
  });

  it('reconnaît « pourcent » en un mot', () => {
    expect(pairs('12 pourcent')).toEqual([['12', 'percent']]);
    expect(pairs('12 pour cent')).toEqual([['12', 'percent']]);
  });

  it.each([' ', ' ', ' ', ' ', '     '])(
    "admet une suite d'espaces entre le nombre et l'unité (%j)",
    (spaces) => {
      expect(pairs(`Mets 80${spaces}kg`)).toEqual([['80', 'mass']]);
    },
  );

  it("ne lit qu'un nombre pour « 62,5 kg » mais contrôle « poids,62 kg »", () => {
    expect(pairs('62,5 kg')).toEqual([['62.5', 'mass']]);
    expect(pairs('poids,62 kg')).toEqual([['62', 'mass']]);
  });

  it('ignore le signe', () => {
    expect(pairs('tu as pris -2,5 kg')).toEqual([['2.5', 'mass']]);
  });
});

describe('allowedValues, signe, arrondi et chaînes numériques', () => {
  it('stocke la valeur absolue (le signe est ignoré des deux côtés)', () => {
    const allowed = allowedValues({ ...NO_SOURCES, brief: { delta_kg: -2.5 } });
    expect(allowed.mass.has('2.5')).toBe(true);
    expect(allowed.mass.has('-2.5')).toBe(false);
    const sets = allowedValues({ ...NO_SOURCES, brief: { sets: [[-10, 5, null, null]] } });
    expect(sets.mass.has('10')).toBe(true);
  });

  it('arrondit à 3 décimales avant de normaliser', () => {
    const allowed = allowedValues({ ...NO_SOURCES, brief: { total_kg: 0.1 + 0.2 } });
    expect(allowed.mass.has('0.3')).toBe(true);
  });

  it('compte une chaîne numérique sous une clé à unité comme le nombre', () => {
    const allowed = allowedValues({
      ...NO_SOURCES,
      nutritionFull: true,
      brief: { y_kg: '62.5', z_pct: '15', w_kcal: '2 000', v_g: '-3,5' },
    });
    expect(allowed.mass.has('62.5')).toBe(true);
    expect(allowed.percent.has('15')).toBe(true);
    expect(allowed.nutrition.has('2000')).toBe(true);
    expect(allowed.nutrition.has('3.5')).toBe(true);
  });

  it('laisse une chaîne numérique sans clé à unité sans famille', () => {
    const allowed = allowedValues({ ...NO_SOURCES, brief: { reps: '8' } });
    expect(allowed.mass.size + allowed.percent.size + allowed.nutrition.size).toBe(0);
  });

  it('autorise « 2,5 kg » quand le dossier porte -2.5 (pas de faux positif)', () => {
    const allowed = allowedValues({ ...NO_SOURCES, brief: { delta_kg: -2.5 } });
    const [quantity] = findQuantities('tu as pris 2,5 kg');
    expect(allowed[quantity?.family ?? 'mass'].has(quantity?.value ?? '')).toBe(true);
  });
});

describe('durées en minutes', () => {
  it('reconnaît min, mn et minutes comme une famille de durée', () => {
    expect(findQuantities('40 min').map((q) => [q.value, q.family])).toEqual([['40', 'duration']]);
    expect(findQuantities('20 minutes')[0]?.family).toBe('duration');
    expect(findQuantities('une minute de pause')).toEqual([]);
    expect(findQuantities('10 minimum')).toEqual([]);
  });

  it('autorise les durées de la source `durationsMin` et des clés *_min', () => {
    const allowed = allowedValues({
      ...NO_SOURCES,
      durationsMin: [20, 40],
      brief: { x: { duration_min: 45 } },
    });
    expect([...allowed.duration].sort()).toEqual(['20', '40', '45']);
    expect(allowedValues(NO_SOURCES).duration.size).toBe(0);
  });
});
