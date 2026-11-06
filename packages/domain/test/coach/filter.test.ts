import { type AgeBand, FORBIDDEN_TERMS } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import {
  type FilterContext,
  type FilterRule,
  normalizeForTerms,
  outputFilter,
  outputFilterText,
  trailingWords,
} from '../../src/coach/filter';
import { SentenceBuffer } from '../../src/coach/sentences';
import type { AllowedValues, UnitFamily } from '../../src/coach/values';

const values = (v: Partial<Record<UnitFamily, string[]>> = {}): AllowedValues => ({
  mass: new Set(v.mass ?? []),
  percent: new Set(v.percent ?? []),
  nutrition: new Set(v.nutrition ?? []),
  duration: new Set(v.duration ?? []),
});

const ctx = (audience: AgeBand, over: Partial<FilterContext> = {}): FilterContext => ({
  audience,
  nutritionMode: 'none',
  allowed: values(),
  ...over,
});

const blocked = (rule: FilterRule, detail: string) => ({ ok: false, rule, detail });

const AUDIENCES: AgeBand[] = ['adult', 'minor'];

// Écrits par code : Biome remplacerait un échappement par le caractère invisible lui-même.
const CGJ = String.fromCharCode(0x034f); // graphème combinant invisible (Mn)
const keycaps = (digits: string) => [...digits].map((d) => d + String.fromCharCode(0xfe0f, 0x20e3)).join('');

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
    "Ce n'est pas 12 reps.",
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
    // Un numéro lu compte pour le mot « numero » : « 18 » suit « le 15 ou ».
    ['Appelle le 15 ou 18.', '18'],
    ['Appelle le 15. Ou le 3237.', '3237'],
    // « C'est » compte pour un mot.
    ["Le bon numéro ? C'est le 3237.", '3237'],
    ['+33 6 12 34 56 78', '33612345678'],
    ['⁰⁶ ¹² ³⁴ ⁵⁶ ⁷⁸', '0612345678'],
    ['06·12·34·56·78', '0612345678'],
    ['06•12•34•56•78', '0612345678'],
    [keycaps('0612345678'), '0612345678'],
    [`Appelle le ${keycaps('3237')}`, '3237'],
    [`06${CGJ}12${CGJ}34${CGJ}56${CGJ}78`, '0612345678'],
    ['Mon n° : 3237.', '3237'],
    ['N° 3237.', '3237'],
    ['Nº 3237.', '3237'],
    ['№ 3237.', '3237'],
    ['No. 3237.', '3237'],
    ['Mon num. 3237.', '3237'],
    ['Rappelle le 3237.', '3237'],
    ['Un appel au 119 suffit.', '119'],
    ['Envoie un SMS au 114.', '114'],
    ['Contacte le 119.', '119'],
    ['Tu peux joindre le 3237.', '3237'],
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
    ['65kg', '65 kg'],
    ['65 Kg', '65 Kg'],
    ['⁶⁵ kg', '65 kg'],
    // Deux nombres devant une unité : chacun est contrôlé.
    ['Mets 60 ou 62,5 kg.', '60 kg'],
    ['60/62,5 kg', '60 kg'],
    ['60−62,5 kg', '60 kg'],
  ])('bloque « %s » (première valeur non autorisée)', (sentence, detail) => {
    expect(outputFilter(sentence, withValues)).toEqual(blocked('unit', detail));
  });

  it('lit le nombre entier quand une marque combinante le coupe (masse {5} autorisée)', () => {
    const fiveAllowed = ctx(audience, { allowed: values({ mass: ['5'] }) });
    expect(outputFilter(`Mets 6${CGJ}5 kg.`, fiveAllowed)).toEqual(blocked('unit', '65 kg'));
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
      ['SECHE', 'sèche'],
      ["Ce n'est pas qu'échec.", 'échec'],
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

  it("applique la liste des mineurs à tout public qui n'est pas « adult » (côté fermé)", () => {
    const unknown = ctx('teen' as AgeBand);
    expect(outputFilter('prends de la créatine', unknown)).toEqual(blocked('forbidden_term', 'créatine'));
  });

  it.each(['Tu es jeune.', 'Les jeunes sportifs.'])(
    'laisse passer « %s » pour un mineur (jeûne cherché avec ses accents)',
    (sentence) => {
      expect(outputFilter(sentence, ctx('minor'))).toEqual({ ok: true });
    },
  );

  it.each([
    ['Fais un jeûne.', 'jeûne'],
    ['Si tu jeûnes, arrête.', 'jeûne'],
    ['Tu as jeûné ?', 'jeûner'],
    ['JEÛNE', 'jeûne'],
  ])('bloque « %s » pour un mineur', (sentence, term) => {
    expect(outputFilter(sentence, ctx('minor'))).toEqual(blocked('forbidden_term', term));
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

describe('trailingWords', () => {
  it('rend les 3 derniers mots en lettres, normalisés, abréviations réécrites', () => {
    expect(trailingWords('Si besoin, appelle :\n')).toEqual(['si', 'besoin', 'appelle']);
    expect(trailingWords('Mon N° ')).toEqual(['mon', 'numero']);
    expect(trailingWords('Tél.\n')).toEqual(['tel']);
    expect(trailingWords('Le bon numéro ? ')).toEqual(['le', 'bon', 'numero']);
  });

  it("compte « c'est » pour un mot", () => {
    expect(trailingWords("Oui, c'est le bon.")).toEqual(['est', 'le', 'bon']);
  });

  it('complète une phrase courte avec les mots qui la précèdent, un numéro lu comptant pour « numero »', () => {
    expect(trailingWords('- le 15\n', ['si', 'besoin', 'appelle'])).toEqual(['appelle', 'le', 'numero']);
    expect(trailingWords('- le 15\n')).toEqual(['le']);
  });
});

describe('outputFilter, mots de la phrase précédente', () => {
  it('lit precedingWords avant les mots de la phrase', () => {
    expect(outputFilter('- le 3237', ctx('adult', { precedingWords: ['appelle'] }))).toEqual(
      blocked('phone', '3237'),
    );
    expect(outputFilter('- le 3237', ctx('adult'))).toEqual({ ok: true });
  });
});

describe('outputFilterText, texte de plusieurs phrases', () => {
  // Faux positif accepté : le mot d'appel de la phrase d'avant compte, « 12 » suit « appelle le 15 fais ».
  it.each(AUDIENCES)('bloque « 12 » dans « Appelle le 15. Fais 12 reps. » (%s)', (audience) => {
    expect(outputFilterText('Appelle le 15. Fais 12 reps.', ctx(audience))).toEqual(blocked('phone', '12'));
  });

  it.each([
    ['Si besoin, appelle :\n- le 3237\n- le 3114', '3237'],
    ['Appelle :\n- le 15\n- le 112\n- le 3237', '3237'],
    ['Numéro utile :\n3237', '3237'],
    ['Tél.\n3237', '3237'],
    ["Le bon numéro ? C'est le 3237.", '3237'],
    ['Appelle le 15. Ou le 3237.', '3237'],
    ['Mon num. 3237. Fin.', '3237'],
  ])('transmet les mots d’une phrase à la suivante : « %s »', (text, digits) => {
    expect(outputFilterText(text, ctx('minor'))).toEqual(blocked('phone', digits));
  });

  it('laisse passer un numéro admis annoncé dans la phrase d’avant', () => {
    expect(outputFilterText('Si besoin, appelle :\n- le 15\n- le 3114', ctx('minor'))).toEqual({ ok: true });
  });

  it('rend la première violation, même dans une phrase suivante', () => {
    expect(outputFilterText('Fais 12 reps. Appelle le 0123456789.', ctx('adult'))).toEqual(
      blocked('phone', '0123456789'),
    );
    expect(outputFilterText('Bravo ! Ta sèche avance. Mets 65 kg.', ctx('adult'))).toEqual(
      blocked('forbidden_term', 'sèche'),
    );
  });

  it('laisse passer un texte vide', () => {
    expect(outputFilterText('', ctx('minor'))).toEqual({ ok: true });
  });
});

describe('flux découpé puis filtré phrase par phrase', () => {
  it('« tél. 119 » poussé en morceaux reste une phrase, bloquée par la règle des numéros', () => {
    const buffer = new SentenceBuffer();
    const sentences = ['Mon tél', '. ', '11', '9 si besoin. ', 'Bonne séance.'].flatMap((d) =>
      buffer.push(d),
    );
    sentences.push(...buffer.flush());
    expect(sentences).toEqual(['Mon tél. 119 si besoin. ', 'Bonne séance.']);
    const verdicts = sentences.map((s) => outputFilter(s, ctx('minor')));
    expect(verdicts.find((v) => !v.ok)).toEqual(blocked('phone', '119'));
  });
});

describe('durées en minutes', () => {
  const allowed = (minutes: string[]): AllowedValues => ({ ...values(), duration: new Set(minutes) });

  it.each(AUDIENCES)('bloque « 40 min » hors des valeurs autorisées (%s)', (audience) => {
    expect(outputFilter('Compte environ 40 min.', ctx(audience))).toEqual(blocked('unit', '40 min'));
  });

  it.each(AUDIENCES)('relaie « 40 min » quand la durée est autorisée (%s)', (audience) => {
    expect(outputFilter('Compte environ 40 min.', ctx(audience, { allowed: allowed(['40']) }))).toEqual({
      ok: true,
    });
    expect(outputFilter('Compte environ 60 min.', ctx(audience, { allowed: allowed(['40']) })).ok).toBe(
      false,
    );
  });
});
