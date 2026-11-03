import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SentenceBuffer } from '../../src/coach/sentences';

function feed(text: string): string[] {
  const buffer = new SentenceBuffer();
  const out: string[] = [];
  for (const char of text) out.push(...buffer.push(char));
  out.push(...buffer.flush());
  return out;
}

describe('SentenceBuffer', () => {
  it("coupe après le point suivi d'une espace, gardée avec la phrase", () => {
    expect(feed('Bonjour. Ta charge est de 62.5 kg.')).toEqual(['Bonjour. ', 'Ta charge est de 62.5 kg.']);
  });

  it('ne coupe pas dans un nombre à virgule coupé entre deux morceaux', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('62,')).toEqual([]);
    expect(buffer.push('5 kg.')).toEqual([]);
    expect(buffer.flush()).toEqual(['62,5 kg.']);
  });

  it('ne coupe pas dans un nombre à point coupé entre deux morceaux', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('Mets 62.')).toEqual([]);
    expect(buffer.push('5 kg. Puis ')).toEqual(['Mets 62.5 kg. ']);
    expect(buffer.flush()).toEqual(['Puis ']);
  });

  it('coupe après « … »', () => {
    expect(feed('Et ensuite… voilà')).toEqual(['Et ensuite… ', 'voilà']);
  });

  it('coupe après « ! » et « ? »', () => {
    expect(feed('Bravo ! Prêt ? Allons-y')).toEqual(['Bravo ! ', 'Prêt ? ', 'Allons-y']);
  });

  it('coupe après chaque retour à la ligne, gardé', () => {
    expect(feed('- un\n- deux\n')).toEqual(['- un\n', '- deux\n']);
  });

  it('rend 400 caractères sans fin de phrase tels quels, le reste au flush', () => {
    const buffer = new SentenceBuffer();
    const out = buffer.push('a'.repeat(450));
    expect(out).toEqual(['a'.repeat(400)]);
    expect(buffer.flush()).toEqual(['a'.repeat(50)]);
  });

  it('rend « 3. » en fin de flux au flush', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('3.')).toEqual([]);
    expect(buffer.flush()).toEqual(['3.']);
  });

  it("ne rend rien au flush d'un tampon vide, et se vide après", () => {
    const buffer = new SentenceBuffer();
    expect(buffer.flush()).toEqual([]);
    buffer.push('Salut');
    expect(buffer.flush()).toEqual(['Salut']);
    expect(buffer.flush()).toEqual([]);
  });
});

describe('SentenceBuffer, abréviations qui annoncent un numéro', () => {
  it('ne coupe pas après « tél. » : « Mon tél. 0612345678 ! » poussé caractère par caractère', () => {
    expect(feed('Mon tél. 0612345678 !')).toEqual(['Mon tél. 0612345678 !']);
  });

  it.each(['tél.', 'tel.', 'TÉL.', 'Tél.', 'num.', 'Num.', 'no.', 'NO.', 'n°.', 'N°.', 'Nº.'])(
    'ne coupe pas après « %s »',
    (abbreviation) => {
      expect(feed(`Mon ${abbreviation} 3114. Fin`)).toEqual([`Mon ${abbreviation} 3114. `, 'Fin']);
    },
  );

  it("ne retient l'abréviation qu'en mot entier", () => {
    expect(feed("Rentre à l'hôtel. Repose-toi.")).toEqual(["Rentre à l'hôtel. ", 'Repose-toi.']);
    expect(feed('Joue du piano. Puis étire-toi.')).toEqual(['Joue du piano. ', 'Puis étire-toi.']);
  });

  it('laisse la découpe ordinaire inchangée', () => {
    expect(feed('Bonjour. Ça va ?')).toEqual(['Bonjour. ', 'Ça va ?']);
  });
});

describe('SentenceBuffer, limite de 400 et paires de substitution', () => {
  it('ne coupe pas un émoji au seuil de 400', () => {
    const buffer = new SentenceBuffer();
    const text = `${'a'.repeat(399)}💪${'b'.repeat(10)}`;
    const out = buffer.push(text);
    expect(out).toEqual(['a'.repeat(399)]);
    expect(buffer.flush()).toEqual([`💪${'b'.repeat(10)}`]);
  });

  it('garde un émoji entier quand il tient dans les 400', () => {
    const buffer = new SentenceBuffer();
    const out = buffer.push(`${'a'.repeat(398)}💪${'b'.repeat(10)}`);
    expect(out).toEqual([`${'a'.repeat(398)}💪`]);
  });
});

describe('SentenceBuffer, invariance au découpage du flux', () => {
  const piece = fc.constantFrom(
    'a',
    'b',
    ' ',
    ' ',
    '.',
    '!',
    '?',
    '…',
    '\n',
    '1',
    '2',
    ',',
    '💪',
    '🏋️',
    'é',
    'tél',
    'no',
    'n°',
  );
  const textArb = fc.array(piece, { maxLength: 900 }).map((parts) => parts.join(''));

  it('même texte et mêmes phrases quel que soit le découpage en unités UTF-16', () => {
    fc.assert(
      fc.property(textArb, fc.array(fc.nat(1800), { maxLength: 40 }), (text, rawCuts) => {
        const cuts = [...new Set(rawCuts.map((c) => Math.min(c, text.length)))].sort((a, b) => a - b);
        const chunked = new SentenceBuffer();
        const sentences: string[] = [];
        let from = 0;
        for (const cut of [...cuts, text.length]) {
          sentences.push(...chunked.push(text.slice(from, cut)));
          from = cut;
        }
        sentences.push(...chunked.flush());

        const whole = new SentenceBuffer();
        const expected = [...whole.push(text), ...whole.flush()];
        expect(sentences.join('')).toBe(text);
        expect(sentences).toEqual(expected);
      }),
    );
  });
});
