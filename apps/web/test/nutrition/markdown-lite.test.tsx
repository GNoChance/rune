import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownLite } from '../../src/features/nutrition/markdown-lite';

const OK = 'https://example.org/a';

function html(source: string, allowedLinks: string[] = [OK]) {
  const { container } = render(<MarkdownLite source={source} allowedLinks={allowedLinks} />);
  return container;
}

describe('MarkdownLite', () => {
  it('titres, paragraphes, listes et gras', () => {
    const c = html('# Titre\n\nUn **mot** gras\nsur deux lignes.\n\n- un\n- deux\n\n1. premier\n2. second');
    expect(c.querySelector('h2')?.textContent).toBe('Titre');
    expect(c.querySelector('p strong')?.textContent).toBe('mot');
    expect(c.querySelector('p')?.textContent).toBe('Un mot gras sur deux lignes.');
    expect([...c.querySelectorAll('ul li')].map((l) => l.textContent)).toEqual(['un', 'deux']);
    expect([...c.querySelectorAll('ol li')].map((l) => l.textContent)).toEqual(['premier', 'second']);
  });

  it('un lien dans les sources devient un lien', () => {
    const a = html(`Voir [la source](${OK}).`).querySelector('a');
    expect(a?.getAttribute('href')).toBe(OK);
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  it('un lien hors sources reste du texte', () => {
    const c = html('Voir [ailleurs](https://evil.example/x) et [js](javascript:void0).');
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toBe('Voir ailleurs et js.');
  });

  it('un lien autorisé mais pas en http(s) reste du texte', () => {
    const c = html('Voir [js](javascript:void0).', ['javascript:void0']);
    expect(c.querySelector('a')).toBeNull();
  });

  it('une image est ignorée', () => {
    const c = html(`Avant ![logo](${OK}/i.png) après`);
    expect(c.querySelector('img')).toBeNull();
    expect(c.textContent).not.toContain('logo');
  });

  it('un tableau est ignoré', () => {
    const c = html('Texte\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nFin');
    expect(c.querySelector('table')).toBeNull();
    expect(c.textContent).toBe('TexteFin');
  });

  it('du HTML brut est ignoré', () => {
    const c = html('<script>alert(1)</script>\n\nUn <b>mot</b> <img src=x onerror=y> ici');
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelector('b')).toBeNull();
    expect(c.querySelector('img')).toBeNull();
    expect(c.textContent).not.toContain('alert');
    expect(c.textContent).toContain('Un mot');
  });

  it('du code reste du texte simple', () => {
    const c = html('Un `bout` de code\n\n```\nbloc\n```');
    expect(c.querySelector('code')).toBeNull();
    expect(c.textContent).toContain('Un bout de code');
    expect(c.textContent).not.toContain('bloc');
  });
});
