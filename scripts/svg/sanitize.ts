/**
 * Nettoyage des SVG des illustrations (04 §12, « Import et service » ; §13, critère 11), sans dépendance : un
 * petit analyseur XML, puis une liste blanche d'éléments et d'attributs.
 *
 * - Retirés avec leur contenu : `script`, `foreignObject`, `image`, les animations, les métadonnées et tout
 *   élément hors liste (ou préfixé, comme `inkscape:grid`). `a` et `switch` sont déballés : leur dessin reste.
 * - Attributs : liste blanche de géométrie et de présentation ; jamais `on*`. `href` et `xlink:href` ne restent
 *   que sur `use`, les dégradés et `pattern`, vers un id interne (`#id`). Une valeur qui cite une URL externe
 *   (`url(https://…)`, `data:`, `javascript:`) est retirée.
 * - CSS (`style`) : règles `@import` retirées, `url()` externe remplacée par `none`, déclaration douteuse retirée ;
 *   une feuille avec une barre oblique inverse (échappement CSS qui pourrait cacher `url(`) part en entier.
 * - Prologue, DOCTYPE, commentaires et blancs entre éléments retirés (optimisation) ; le commentaire de crédit et
 *   de licence est ajouté en tête de la racine.
 *
 * Une entrée qui n'est pas un SVG bien formé lève `SvgError` : rien n'est deviné.
 */
import type { IllustrationEntry } from '@rune/contracts';
import { illustrationCreditLine } from '@rune/domain';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Entrée refusée : XML mal formé, racine autre que `<svg>`, entité inconnue. */
export class SvgError extends Error {}

const fail = (message: string): never => {
  throw new SvgError(message);
};

type SvgText = { kind: 'text'; value: string };
type SvgComment = { kind: 'comment'; value: string };
type SvgElement = { kind: 'element'; name: string; attrs: [string, string][]; children: SvgNode[] };
type SvgNode = SvgElement | SvgText | SvgComment;

/** Éléments du dessin : rien qui charge, exécute ou injecte. */
const ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'style',
]);

/** Enveloppes retirées, leur contenu gardé (lien autour d'un dessin, `switch` d'Illustrator). */
const UNWRAPPED: ReadonlySet<string> = new Set(['a', 'switch']);

/** Éléments où un `href` interne (`#id`) a un sens. */
const HREF_ELEMENTS: ReadonlySet<string> = new Set(['use', 'linearGradient', 'radialGradient', 'pattern']);

/** Éléments dont les blancs comptent. */
const TEXT_ELEMENTS: ReadonlySet<string> = new Set(['text', 'tspan', 'title', 'desc']);

/** Attributs de géométrie, de structure et de présentation ; tout le reste part. */
const ATTRIBUTES: ReadonlySet<string> = new Set([
  'id',
  'class',
  'style',
  'type',
  'lang',
  'xml:lang',
  'xml:space',
  'version',
  'viewBox',
  'preserveAspectRatio',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'fr',
  'd',
  'points',
  'pathLength',
  'transform',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'color',
  'display',
  'visibility',
  'overflow',
  'clip-path',
  'clip-rule',
  'clipPathUnits',
  'mask',
  'maskUnits',
  'maskContentUnits',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'patternUnits',
  'patternContentUnits',
  'patternTransform',
  'marker-start',
  'marker-mid',
  'marker-end',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'refX',
  'refY',
  'orient',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'dx',
  'dy',
  'rotate',
  'textLength',
  'lengthAdjust',
  'vector-effect',
  'shape-rendering',
  'paint-order',
  'enable-background',
]);

// ---------- Analyse ----------

const NAME = /[A-Za-z_:][\w.:-]*/y;
const NAMED_ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const validCodePoint = (n: number) =>
  n === 0x9 ||
  n === 0xa ||
  n === 0xd ||
  (n >= 0x20 && n <= 0xd7ff) ||
  (n >= 0xe000 && n <= 0xfffd) ||
  (n >= 0x10000 && n <= 0x10ffff);

/** Texte ou valeur d'attribut, entités décodées ; `&` isolé ou entité inconnue refusés. */
function decode(raw: string): string {
  return raw.replace(/&([^;&\s<]*)(;?)/g, (whole, body: string, semi: string) => {
    if (semi === '') fail(`« & » isolé : ${whole}`);
    const named = NAMED_ENTITIES[body];
    if (named !== undefined) return named;
    const numeric = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(body);
    if (numeric === null) return fail(`entité inconnue : &${body};`);
    const code = numeric[1] !== undefined ? Number.parseInt(numeric[1], 16) : Number(numeric[2]);
    if (!validCodePoint(code)) fail(`caractère interdit : &${body};`);
    return String.fromCodePoint(code);
  });
}

type Parsed = { root: SvgElement; comments: string[]; doctype: boolean };

/** Arbre du document ; une seule racine `<svg>`, sans préfixe. */
function parse(input: string): Parsed {
  const s = input.startsWith('\uFEFF') ? input.slice(1) : input;
  const comments: string[] = [];
  const top: SvgElement[] = [];
  const stack: SvgElement[] = [];
  let doctype = false;
  let i = 0;

  const name = (): string => {
    NAME.lastIndex = i;
    const match = NAME.exec(s);
    if (match === null) return fail(`nom attendu à la position ${i}`);
    i += match[0].length;
    return match[0];
  };
  const blanks = () => {
    while (i < s.length && /\s/.test(s[i] ?? '')) i += 1;
  };
  const until = (end: string, what: string): string => {
    const at = s.indexOf(end, i);
    if (at < 0) fail(`${what} non fermé`);
    const body = s.slice(i, at);
    i = at + end.length;
    return body;
  };
  const append = (node: SvgNode) => {
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else if (node.kind === 'element') top.push(node);
    else if (node.kind === 'text' && node.value.trim() !== '') fail('texte hors de la racine');
  };

  while (i < s.length) {
    if (s.startsWith('<!--', i)) {
      i += 4;
      comments.push(until('-->', 'commentaire').trim());
    } else if (s.startsWith('<![CDATA[', i)) {
      i += 9;
      const value = until(']]>', 'CDATA');
      if (stack.length === 0) fail('CDATA hors de la racine');
      append({ kind: 'text', value });
    } else if (s.startsWith('<!DOCTYPE', i)) {
      doctype = true;
      const bracket = s.indexOf('[', i);
      const close = s.indexOf('>', i);
      if (bracket >= 0 && (close < 0 || bracket < close)) {
        i = bracket;
        until(']', 'DOCTYPE');
      }
      until('>', 'DOCTYPE');
    } else if (s.startsWith('<?', i)) {
      i += 2;
      until('?>', 'instruction');
    } else if (s.startsWith('</', i)) {
      i += 2;
      const closing = name();
      blanks();
      if (s[i] !== '>') fail(`</${closing}> mal formé`);
      i += 1;
      const open = stack.pop();
      if (open?.name !== closing) fail(`</${closing}> ne ferme pas <${open?.name ?? ''}>`);
    } else if (s[i] === '<') {
      i += 1;
      const element: SvgElement = { kind: 'element', name: name(), attrs: [], children: [] };
      for (;;) {
        const before = i;
        blanks();
        if (s.startsWith('/>', i) || s[i] === '>') break;
        if (i === before) fail(`attribut mal séparé dans <${element.name}>`);
        const attr = name();
        blanks();
        if (s[i] !== '=') fail(`valeur attendue pour ${attr}`);
        i += 1;
        blanks();
        const quote = s[i];
        if (quote !== '"' && quote !== "'") return fail(`guillemet attendu pour ${attr}`);
        i += 1;
        const raw = until(quote, `valeur de ${attr}`);
        if (raw.includes('<')) fail(`« < » dans la valeur de ${attr}`);
        if (element.attrs.some(([k]) => k === attr)) fail(`attribut ${attr} en double`);
        element.attrs.push([attr, decode(raw)]);
      }
      if (stack.length === 0 && top.length > 0) fail('plusieurs racines');
      append(element);
      if (s.startsWith('/>', i)) i += 2;
      else {
        i += 1;
        stack.push(element);
      }
    } else {
      const next = s.indexOf('<', i);
      const end = next < 0 ? s.length : next;
      append({ kind: 'text', value: decode(s.slice(i, end)) });
      i = end;
    }
  }
  const open = stack.at(-1);
  if (open) fail(`<${open.name}> non fermé`);
  const [root] = top;
  if (root === undefined) return fail('aucun élément racine');
  if (root.name !== 'svg') fail(`racine <${root.name}> : <svg> attendu`);
  return { root, comments, doctype };
}

// ---------- Nettoyage ----------

const INTERNAL_REF = /^#[A-Za-z_][\w.:-]*$/;
const SCHEMES = /(?:javascript|vbscript|data)\s*:/i;
const URL_CALL = /url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;

/** Vrai si chaque `url(…)` de la valeur vise un id interne, et qu'aucun schéma dangereux n'y figure. */
function safeValue(value: string): boolean {
  if (SCHEMES.test(value)) return false;
  const calls = [...value.matchAll(URL_CALL)];
  const opened = value.match(/url\s*\(/gi)?.length ?? 0;
  return calls.length === opened && calls.every((m) => (m[2] ?? '').trim().startsWith('#'));
}

/** Déclaration CSS douteuse : échappement, règle @, expression, liaison, URL non interne. */
const unsafeCss = (decl: string) =>
  /[\\@<]|expression\s*\(|behavior\s*:|-moz-binding/i.test(decl) || !safeValue(decl);

/** Attribut `style` : seules les déclarations sûres restent. */
function cleanStyleAttribute(value: string): string {
  return value
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => decl !== '' && !unsafeCss(decl))
    .join(';');
}

/** Feuille `<style>` : null si elle doit partir en entier. */
function cleanStyleSheet(css: string, issues: string[]): string | null {
  if (/[\\<]|expression\s*\(|behavior\s*:|-moz-binding|(?:javascript|vbscript)\s*:/i.test(css)) return null;
  let out = css.replace(/@import[^;]*;?/gi, () => {
    issues.push('règle @import retirée');
    return '';
  });
  out = out.replace(URL_CALL, (call, _q: string, target: string) => {
    if (target.trim().startsWith('#')) return call;
    issues.push(`url externe retirée du style : ${target.trim()}`);
    return 'none';
  });
  if (/url\s*\(|data\s*:/i.test(out.replace(URL_CALL, ''))) return null;
  return out.trim();
}

function cleanAttributes(element: SvgElement, isRoot: boolean, issues: string[]): [string, string][] {
  const kept: [string, string][] = [];
  for (const [name, value] of element.attrs) {
    if (/^on/i.test(name)) {
      issues.push(`attribut ${name} retiré`);
    } else if (name === 'href' || name === 'xlink:href') {
      if (HREF_ELEMENTS.has(element.name) && INTERNAL_REF.test(value.trim())) kept.push([name, value.trim()]);
      else issues.push(`lien ${value} retiré`);
    } else if (isRoot && name === 'xmlns') {
      if (value === SVG_NS) kept.push([name, value]);
      else issues.push(`espace de noms ${value} retiré`);
    } else if (isRoot && name === 'xmlns:xlink' && value === XLINK_NS) {
      kept.push([name, value]);
    } else if (name === 'style') {
      const clean = cleanStyleAttribute(value);
      if (clean !== value.trim()) issues.push(`style « ${value} » nettoyé`);
      if (clean !== '') kept.push([name, clean]);
    } else if (!ATTRIBUTES.has(name)) {
      issues.push(`attribut ${name} retiré`);
    } else if (!safeValue(value)) {
      issues.push(`attribut ${name}="${value}" retiré`);
    } else {
      kept.push([name, value]);
    }
  }
  return kept;
}

/** Enfants nettoyés de `parent` ; les enveloppes déballées versent leur contenu à sa place. */
function cleanChildren(parent: SvgElement, children: readonly SvgNode[], issues: string[]): SvgNode[] {
  const out: SvgNode[] = [];
  for (const child of children) {
    if (child.kind === 'comment') continue;
    if (child.kind === 'text') {
      if (child.value.trim() !== '' || TEXT_ELEMENTS.has(parent.name)) out.push(child);
      continue;
    }
    if (UNWRAPPED.has(child.name)) {
      issues.push(`élément <${child.name}> retiré (contenu gardé)`);
      out.push(...cleanChildren(parent, child.children, issues));
    } else if (!ELEMENTS.has(child.name)) {
      issues.push(`élément <${child.name}> retiré`);
    } else {
      const element = cleanElement(child, false, issues);
      if (element !== null) out.push(element);
    }
  }
  return out;
}

function cleanElement(element: SvgElement, isRoot: boolean, issues: string[]): SvgElement | null {
  const attrs = cleanAttributes(element, isRoot, issues);
  if (element.name === 'style') {
    if (element.children.some((c) => c.kind === 'element')) {
      issues.push('élément <style> retiré (contenu inattendu)');
      return null;
    }
    const css = element.children.map((c) => (c.kind === 'text' ? c.value : '')).join('');
    const clean = cleanStyleSheet(css, issues);
    if (clean === null) {
      issues.push('élément <style> retiré (CSS non sûr)');
      return null;
    }
    if (clean === '') return null;
    return { kind: 'element', name: 'style', attrs, children: [{ kind: 'text', value: clean }] };
  }
  return {
    kind: 'element',
    name: element.name,
    attrs,
    children: cleanChildren(element, element.children, issues),
  };
}

const usesXlink = (node: SvgNode): boolean =>
  node.kind === 'element' && (node.attrs.some(([k]) => k === 'xlink:href') || node.children.some(usesXlink));

/** Racine nettoyée, avec ses espaces de noms : `xmlns` toujours, `xmlns:xlink` si un `xlink:href` reste. */
function cleanTree(parsed: Parsed, issues: string[]): SvgElement {
  if (parsed.doctype) issues.push('déclaration DOCTYPE retirée');
  const root = cleanElement(parsed.root, true, issues) ?? fail('racine retirée');
  if (!root.attrs.some(([k]) => k === 'xmlns')) {
    issues.push('xmlns ajouté');
    root.attrs.unshift(['xmlns', SVG_NS]);
  }
  if (usesXlink(root) && !root.attrs.some(([k]) => k === 'xmlns:xlink')) {
    issues.push('xmlns:xlink ajouté');
    root.attrs.splice(1, 0, ['xmlns:xlink', XLINK_NS]);
  }
  return root;
}

// ---------- Écriture ----------

const escapeText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttribute = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

/** Texte sûr dans un commentaire XML : jamais « -- ». */
const commentSafe = (text: string) => text.replace(/-(?=-)/g, '- ').trim();

function serialize(node: SvgNode): string {
  if (node.kind === 'text') return escapeText(node.value);
  if (node.kind === 'comment') return `<!-- ${node.value} -->`;
  const attrs = node.attrs.map(([k, v]) => ` ${k}="${escapeAttribute(v)}"`).join('');
  if (node.children.length === 0) return `<${node.name}${attrs}/>`;
  return `<${node.name}${attrs}>${node.children.map(serialize).join('')}</${node.name}>`;
}

// ---------- API ----------

/**
 * SVG nettoyé (voir l'en-tête du module), suivi d'un saut de ligne. `comment` : crédit et licence, écrit en
 * premier enfant de la racine (`svgCreditComment`). Idempotent : nettoyer deux fois ne change rien.
 */
export function sanitizeSvg(input: string, comment?: string): string {
  const root = cleanTree(parse(input), []);
  if (comment !== undefined && commentSafe(comment) !== '') {
    root.children.unshift({ kind: 'comment', value: commentSafe(comment) });
  }
  return `${serialize(root)}\n`;
}

/** Ce que `sanitizeSvg` retirerait ou changerait ; vide pour un fichier déjà nettoyé (`svg:check`). */
export function svgIssues(input: string): string[] {
  const issues: string[] = [];
  cleanTree(parse(input), issues);
  return issues;
}

/** Commentaires du document, texte sans les blancs du bord. */
export function svgComments(input: string): string[] {
  return parse(input).comments;
}

/**
 * Commentaire de crédit et de licence d'un SVG (04 §12, « Chaque SVG contient un commentaire avec son crédit et
 * sa licence ») : ligne de crédit, adresse de la licence, source figée, modifications. Déjà sûr dans un
 * commentaire XML (« -- » neutralisé).
 */
export function svgCreditComment(
  entry: Pick<IllustrationEntry, 'creators' | 'license' | 'license_url' | 'source_url' | 'modifications'>,
): string {
  const parts = [
    `${illustrationCreditLine(entry)}.`,
    `Licence : ${entry.license_url}.`,
    `Source : ${entry.source_url}.`,
  ];
  if (entry.modifications !== undefined) parts.push(`Modifications : ${entry.modifications}`);
  return commentSafe(parts.join(' '));
}
