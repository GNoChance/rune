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
