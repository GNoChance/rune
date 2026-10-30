import type { IllustrationEntry } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { SvgError, sanitizeSvg, svgComments, svgCreditComment, svgIssues } from '../../svg/sanitize';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG piégé (04 §13, critère 11) : script, attributs d'événement, liens et ressources externes. */
const TRAPPED = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(document.cookie)</script>
  <script xlink:href="https://evil.example/x.js"/>
  <foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">piège</div></foreignObject>
  <a href="https://evil.example/"><rect width="1" height="1" onclick="steal()"/></a>
  <image href="https://evil.example/p.png" width="10" height="10"/>
  <use href="https://evil.example/s.svg#x"/>
  <use xlink:href="javascript:alert(1)"/>
  <animate attributeName="href" to="javascript:alert(1)"/>
  <defs><path id="shape" d="M0 0L1 1"/></defs>
  <use xlink:href="#shape"/>
  <path d="M0 0h1" fill="url(https://evil.example/f)" ONLOAD="x()"/>
  <circle cx="5" cy="5" r="1" style="fill:red;background:url(https://evil.example/b)"/>
  <style>@import url(https://evil.example/a.css); .a{fill:url(http://evil.example/x)} .b{fill:#000}</style>
</svg>
`;

describe('sanitizeSvg : SVG piégé (04 §13, critère 11)', () => {
  const clean = sanitizeSvg(TRAPPED);

  it('ressort sans script, sans attribut on*, sans foreignObject ni lien externe', () => {
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/\son[a-z]+=/i);
    expect(clean).not.toMatch(/foreignObject/i);
    expect(clean).not.toMatch(/evil\.example/);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toMatch(/<(a|image|animate)[\s/>]/);
    expect(clean).not.toMatch(/@import/);
  });

  it('garde le dessin : forme sortie du lien, référence interne, styles sûrs', () => {
    expect(clean).toContain('<rect width="1" height="1"/>');
    expect(clean).toContain('<defs><path id="shape" d="M0 0L1 1"/></defs><use xlink:href="#shape"/>');
    expect(clean).toContain('<path d="M0 0h1"/>');
    expect(clean).toContain('<circle cx="5" cy="5" r="1" style="fill:red"/>');
    expect(clean).toContain('<style>.a{fill:none} .b{fill:#000}</style>');
    expect(
      clean.startsWith(
        `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">`,
      ),
    ).toBe(true);
  });

  it("svgIssues nomme chaque retrait ; le résultat nettoyé n'en a plus aucun", () => {
    const issues = svgIssues(TRAPPED);
    for (const expected of [
      'élément <script> retiré',
      'élément <foreignObject> retiré',
      'élément <image> retiré',
      'élément <animate> retiré',
      'élément <a> retiré (contenu gardé)',
      'attribut onload retiré',
      'attribut onclick retiré',
      'attribut ONLOAD retiré',
      'lien https://evil.example/s.svg#x retiré',
      'lien javascript:alert(1) retiré',
      'déclaration DOCTYPE retirée',
    ]) {
      expect(issues, expected).toContain(expected);
    }
    expect(svgIssues(clean)).toEqual([]);
  });
});

describe('sanitizeSvg : forme du résultat', () => {
  it("un SVG déjà propre ressort à l'identique, prologue et blancs entre éléments retirés", () => {
    const svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 2 2"><g fill="#000"><rect x="0" y="0" width="1" height="1"/></g></svg>`;
    expect(sanitizeSvg(`<?xml version="1.0"?>\n${svg.replace('<g', '\n  <g')}\n`)).toBe(`${svg}\n`);
    expect(svgIssues(svg)).toEqual([]);
  });

  it('commentaire de crédit en tête de la racine ; « -- » neutralisé ; les autres commentaires partent', () => {
    const svg = `<svg xmlns="${SVG_NS}"><!-- calque 1 --><rect width="1" height="1"/></svg>`;
    const out = sanitizeSvg(svg, 'Illustration : Greg Priday -- CC BY-SA 4.0');
    expect(out).toBe(
      `<svg xmlns="${SVG_NS}"><!-- Illustration : Greg Priday - - CC BY-SA 4.0 --><rect width="1" height="1"/></svg>\n`,
    );
    expect(svgComments(out)).toEqual(['Illustration : Greg Priday - - CC BY-SA 4.0']);
  });

  it('idempotent : nettoyer deux fois ne change rien', () => {
    const once = sanitizeSvg(TRAPPED, 'Crédit');
    expect(sanitizeSvg(once, 'Crédit')).toBe(once);
  });

  it('texte : entités décodées puis réécrites, blancs gardés dans <text>', () => {
    const svg = `<svg xmlns="${SVG_NS}"><text x="1"> a &lt; b &amp; c &#233;&#x00E9; <tspan>d</tspan></text></svg>`;
    expect(sanitizeSvg(svg)).toBe(
      `<svg xmlns="${SVG_NS}"><text x="1"> a &lt; b &amp; c éé <tspan>d</tspan></text></svg>\n`,
    );
  });

  it("xmlns ajouté s'il manque ; xmlns:xlink ajouté pour un xlink:href gardé", () => {
    const out = sanitizeSvg('<svg><defs><path id="p" d="M0 0"/></defs><use xlink:href="#p"/></svg>');
    expect(out).toBe(
      `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><path id="p" d="M0 0"/></defs><use xlink:href="#p"/></svg>\n`,
    );
  });

  it('éditeurs : métadonnées, espaces de noms et attributs préfixés retirés, <switch> déballé', () => {
    const svg = `<svg xmlns="${SVG_NS}" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:i="ns_ai" data-name="Calque">
      <metadata><rdf:RDF/></metadata>
      <inkscape:grid/>
      <switch><foreignObject requiredExtensions="ns_ai"/><g i:extraneous="self" inkscape:label="corps"><path d="M0 0"/></g></switch>
    </svg>`;
    expect(sanitizeSvg(svg)).toBe(`<svg xmlns="${SVG_NS}"><g><path d="M0 0"/></g></svg>\n`);
  });

  it('références internes url(#…) gardées, url externe ou data: retirée', () => {
    const svg = `<svg xmlns="${SVG_NS}"><rect fill="url(#g)" stroke="url('#h')" mask="url(data:image/png;base64,AAAA)"/></svg>`;
    expect(sanitizeSvg(svg)).toBe(`<svg xmlns="${SVG_NS}"><rect fill="url(#g)" stroke="url('#h')"/></svg>\n`);
  });

  it('<style> avec une barre oblique inverse (échappement CSS) : retiré en entier', () => {
    const svg = `<svg xmlns="${SVG_NS}"><style>.a{background:u\\72l(https://evil.example)}</style><rect/></svg>`;
    expect(sanitizeSvg(svg)).toBe(`<svg xmlns="${SVG_NS}"><rect/></svg>\n`);
    expect(svgIssues(svg)).toContain('élément <style> retiré (CSS non sûr)');
  });
});

describe('sanitizeSvg : refus', () => {
  it.each([
    ['une racine autre que <svg>', '<html><body/></html>'],
    ['une balise non fermée', `<svg xmlns="${SVG_NS}"><g></svg>`],
    ['deux racines', `<svg xmlns="${SVG_NS}"/><svg xmlns="${SVG_NS}"/>`],
    ["une entité inconnue (DOCTYPE d'Illustrator)", `<svg xmlns="&ns_svg;"/>`],
    ['un & isolé', `<svg xmlns="${SVG_NS}"><text>a & b</text></svg>`],
    ['un attribut en double', `<svg xmlns="${SVG_NS}" width="1" width="2"/>`],
    ['du texte vide de balise', 'pas un SVG'],
    ['des octets de PNG lus comme du texte', '\u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR'],
  ])('%s : SvgError', (_, input) => {
    expect(() => sanitizeSvg(input)).toThrow(SvgError);
    expect(() => svgIssues(input)).toThrow(SvgError);
  });
});

describe('svgCreditComment (crédit et licence dans chaque SVG, 04 §12)', () => {
  const entry: Pick<
    IllustrationEntry,
    'creators' | 'license' | 'license_url' | 'source_url' | 'modifications'
  > = {
    creators: ['Greg Priday'],
    license: 'CC-BY-SA-4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    source_url: 'https://github.com/everkinetic/data/blob/0123456789abcdef0123456789abcdef01234567/svg/a.svg',
    modifications: 'Rune : nettoyage du SVG.',
  };

  it('ligne de crédit, licence, source figée et modifications', () => {
    expect(svgCreditComment(entry)).toBe(
      'Illustration : Greg Priday · CC BY-SA 4.0 · modifiée. Licence : https://creativecommons.org/licenses/by-sa/4.0/. ' +
        'Source : https://github.com/everkinetic/data/blob/0123456789abcdef0123456789abcdef01234567/svg/a.svg. ' +
        'Modifications : Rune : nettoyage du SVG.',
    );
  });

  it('sans modifications : ni « modifiée » ni ligne Modifications', () => {
    const { modifications: _, ...bare } = entry;
    expect(svgCreditComment(bare)).not.toMatch(/odifi/);
  });

  it("« -- » d'une URL neutralisé : le commentaire reste valide et se relit tel quel", () => {
    const text = svgCreditComment({ ...entry, source_url: 'https://example.org/a--b.svg' });
    expect(text).not.toContain('--');
    expect(svgComments(sanitizeSvg(`<svg xmlns="${SVG_NS}"/>`, text))).toEqual([text]);
  });
});
