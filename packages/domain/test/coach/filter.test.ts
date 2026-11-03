import { type AgeBand, FORBIDDEN_TERMS } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { type FilterContext, type FilterRule, normalizeForTerms, outputFilter } from '../../src/coach/filter';
import type { AllowedValues, UnitFamily } from '../../src/coach/values';

const values = (v: Partial<Record<UnitFamily, string[]>> = {}): AllowedValues => ({
  mass: new Set(v.mass ?? []),
  percent: new Set(v.percent ?? []),
  nutrition: new Set(v.nutrition ?? []),
});

const ctx = (audience: AgeBand, over: Partial<FilterContext> = {}): FilterContext => ({
  audience,
  nutritionMode: 'none',
  allowed: values(),
  ...over,
});

const blocked = (rule: FilterRule, detail: string) => ({ ok: false, rule, detail });

const AUDIENCES: AgeBand[] = ['adult', 'minor'];

describe('normalizeForTerms', () => {
  it('met en minuscules et retire les accents', () => {
    expect(normalizeForTerms('Évite le RÉGIME')).toBe('evite le regime');
  });

  it('applique NFKC (pleine chasse, ligatures)', () => {
    expect(normalizeForTerms('ＲÉＧＩＭＥ ﬁni')).toBe('regime fini');
  });

  it('sépare les élisions, apostrophe droite ou courbe', () => {
    expect(normalizeForTerms("l'échec d'un jour qu'il fait")).toBe('l echec d un jour qu il fait');
    expect(normalizeForTerms('l’échec')).toBe('l echec');
  });

  it('change les tirets en espaces', () => {
    expect(normalizeForTerms('brûle-les-graisses – vite')).toBe('brule les graisses   vite');
  });

  it('retire les caractères invisibles (trait d’union conditionnel, espace sans chasse)', () => {
    expect(normalizeForTerms('sè­che ré​gime')).toBe('seche regime');
  });
});

describe.each(AUDIENCES)('règle 1, téléphone (%s)', (audience) => {
  it.each([
    'Appelle le 15.',
    'Appelle le 3114.',
    'Compose le 09 69 325 900.',
    'Compose le 09 69 325 900.',
    '0 800 15 2000',
    'Appelle le 15 / 112.',
    'Compose le 3 114.',
    'Fais 118 pas.',
  ])('laisse passer « %s »', (sentence) => {
    expect(outputFilter(sentence, ctx(audience))).toEqual({ ok: true });
  });

  it.each([
    ['01 23 45 67 89', '0123456789'],
    ['01.23.45.67.89', '0123456789'],
    ['01-23-45-67-89', '0123456789'],
    ['tél. 0612345678', '0612345678'],
    ['Note-le : ０６１２３４５６７８.', '0612345678'],
    ['appeler le 118', '118'],
    ['Appelle le 01 23.', '0123'],
    ['Ton numéro : 3237.', '3237'],
    ['Si tu appelles le 119, dis-le.', '119'],
    ['Tu peux téléphoner au 17.', '17'],
    // Un nombre n'est pas un mot : « 18 » suit « appelle le ou ».
    ['Appelle le 15 ou 18.', '18'],
  ])('bloque « %s »', (sentence, digits) => {
    expect(outputFilter(sentence, ctx(audience))).toEqual(blocked('phone', digits));
  });
});

describe.each(AUDIENCES)('règle 2, unités (%s)', (audience) => {
  const withValues = ctx(audience, { allowed: values({ mass: ['62.5', '1000'], percent: ['10'] }) });

  it.each(['62,5 kg', '62.5kg', '1 000 kg', '10 %', 'Mets 62,5 kg, soit 10 % de plus.'])(
    'laisse passer « %s » (valeur autorisée)',
    (sentence) => {
      expect(outputFilter(sentence, withValues)).toEqual({ ok: true });
    },
  );

  it.each([
    ['65 kg', '65 kg'],
    ['15 pour cent', '15 pour cent'],
    ['5 kilos', '5 kilos'],
    ['Passe de 62,5 kg à 65 kg puis 70 kg.', '65 kg'],
  ])('bloque « %s » (première valeur non autorisée)', (sentence, detail) => {
    expect(outputFilter(sentence, withValues)).toEqual(blocked('unit', detail));
  });
});

describe('règle 2, unités nutritionnelles', () => {
  const declared = values({ nutrition: ['200'] });

  it.each([
    ['adulte, mode none', ctx('adult')],
    ['adulte, mode none, 200 déclaré', ctx('adult', { allowed: declared })],
    [
      'adulte, mode qualitative, 200 déclaré',
      ctx('adult', { nutritionMode: 'qualitative', allowed: declared }),
    ],
    ['mineur', ctx('minor')],
    ['mineur, mode full, 200 déclaré', ctx('minor', { nutritionMode: 'full', allowed: declared })],
  ])('bloque « 200 kcal » (%s)', (_name, context) => {
    expect(outputFilter('200 kcal', context)).toEqual(blocked('unit', '200 kcal'));
  });

  it('laisse passer « 200 kcal » pour un adulte en mode full, 200 déclaré', () => {
    expect(outputFilter('200 kcal', ctx('adult', { nutritionMode: 'full', allowed: declared }))).toEqual({
      ok: true,
    });
  });

  it('bloque en mode full une valeur non déclarée', () => {
    const context = ctx('adult', { nutritionMode: 'full', allowed: declared });
    expect(outputFilter('Vise 30 g de plus.', context)).toEqual(blocked('unit', '30 g'));
  });
});

describe('règle 3, termes interdits', () => {
  describe.each(AUDIENCES)('liste pour tous (%s)', (audience) => {
    it.each([
      ['Fais une sèche.', 'sèche'],
      ["C'est un échec.", 'échec'],
      ["l'échec", 'échec'],
      ['C’est l’ÉCHEC.', 'échec'],
      ['Évite les régimes.', 'régime'],
      ['Ne brûle-les-graisses pas.', 'brûler les graisses'],
      ['Ça se mérite.', 'se mériter'],
      ['Ce raté n’est pas un échec.', 'raté'],
    ])('bloque « %s »', (sentence, term) => {
      expect(outputFilter(sentence, ctx(audience))).toEqual(blocked('forbidden_term', term));
    });

    it.each(['La sécheresse de ta peau.', 'Tes reps ratissent large.'])(
      'laisse passer « %s » (pas de forme listée aux limites de mots)',
      (sentence) => {
        expect(outputFilter(sentence, ctx(audience))).toEqual({ ok: true });
      },
    );
  });

  it('bloque chaque forme de la liste pour tous, pour un adulte hors mode full', () => {
    for (const { term, forms } of FORBIDDEN_TERMS.all) {
      for (const form of forms) {
        expect(outputFilter(`Parle de ${form} ici.`, ctx('adult'))).toEqual(blocked('forbidden_term', term));
      }
    }
  });

  it('bloque chaque forme de la liste des mineurs, pour un mineur', () => {
    for (const { forms } of FORBIDDEN_TERMS.minor) {
      for (const form of forms) {
        expect(outputFilter(`Parle de ${form} ici.`, ctx('minor'))).toMatchObject({
          ok: false,
          rule: 'forbidden_term',
        });
      }
    }
  });

  it('bloque la créatine pour un mineur, pas pour un adulte', () => {
    expect(outputFilter('prends de la créatine', ctx('minor'))).toEqual(
      blocked('forbidden_term', 'créatine'),
    );
    expect(outputFilter('prends de la créatine', ctx('adult'))).toEqual({ ok: true });
  });

  it.each(['Appelle Écoute Dopage.', 'Refuse les produits dopants.', 'Le dopage est dangereux.'])(
    'laisse passer « %s » pour un mineur (allowedForMinor)',
    (sentence) => {
      expect(outputFilter(sentence, ctx('minor'))).toEqual({ ok: true });
    },
  );

  it('lève les termes pour un adulte en mode full seulement', () => {
    expect(outputFilter('Ta sèche avance.', ctx('adult', { nutritionMode: 'full' }))).toEqual({ ok: true });
    expect(outputFilter('Ta sèche avance.', ctx('adult', { nutritionMode: 'qualitative' }))).toEqual(
      blocked('forbidden_term', 'sèche'),
    );
    expect(outputFilter('Ta sèche avance.', ctx('minor', { nutritionMode: 'full' }))).toEqual(
      blocked('forbidden_term', 'sèche'),
    );
  });
});

describe('ordre des règles', () => {
  it('rend le téléphone avant les unités et les termes', () => {
    expect(outputFilter('Appelle le 0123456789 pour ta sèche de 3 kg', ctx('adult'))).toEqual(
      blocked('phone', '0123456789'),
    );
  });

  it('rend les unités avant les termes', () => {
    expect(outputFilter('Ta sèche de 3 kg', ctx('adult'))).toEqual(blocked('unit', '3 kg'));
    expect(outputFilter('200 kcal de créatine', ctx('minor'))).toEqual(blocked('unit', '200 kcal'));
  });

  it('laisse passer une phrase sans chiffre ni terme', () => {
    expect(outputFilter('Bonne séance, garde une marge sur la dernière série.', ctx('minor'))).toEqual({
      ok: true,
    });
  });
});
