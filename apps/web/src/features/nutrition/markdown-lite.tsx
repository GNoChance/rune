import type { ReactNode } from 'react';

/*
 * Markdown restreint des fiches conseils (spec brique 5 §10.2 à §10.5) : titres, paragraphes, listes et gras. Rien n'est
 * injecté comme HTML : de petits éléments React sortent d'un analyseur de quelques lignes. Une image, un tableau, du
 * HTML brut ou du code est écarté ; un lien dont l'adresse n'est pas dans `allowedLinks` (ou pas en http/https) n'est
 * plus qu'un texte.
 */

const INLINE = /!\[[^\]]*\]\([^)]*\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|`([^`]*)`|<\/?[a-zA-Z!][^>]*>/g;

/** Adresse web (http ou https) : seule forme qui devient un lien, ici comme dans les sources d'une fiche. */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function inline(text: string, allowed: ReadonlySet<string>, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const id = `${key}-${n++}`;
    if (m[1] !== undefined && m[2] !== undefined) {
      out.push(
        allowed.has(m[2]) && isWebUrl(m[2]) ? (
          <a key={id} href={m[2]} target="_blank" rel="noopener noreferrer">
            {m[1]}
          </a>
        ) : (
          m[1]
        ),
      );
    } else if (m[3] !== undefined) {
      out.push(<strong key={id}>{inline(m[3], allowed, id)}</strong>);
    } else if (m[4] !== undefined) {
      out.push(m[4]);
    }
    // Image et balise HTML : écartées.
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HTML_BLOCK = /^\s*<[/a-zA-Z!]/;
const TABLE_ROW = /^\s*\|/;
const FENCE = /^\s*(```|~~~)/;

type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: { id: number; text: string }[] };

function blocks(source: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let fenced = false;
  let nextId = 0;
  const flush = () => {
    if (para.length > 0) out.push({ kind: 'paragraph', text: para.join(' ') });
    para = [];
  };
  for (const line of source.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      flush();
      fenced = !fenced;
      continue;
    }
    if (fenced || HTML_BLOCK.test(line) || TABLE_ROW.test(line)) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      flush();
      out.push({ kind: 'heading', level: heading[1].length <= 2 ? 2 : 3, text: heading[2] });
    } else if (bullet || ordered) {
      flush();
      const isOrdered = !bullet;
      const text = (bullet ?? ordered)?.[1] ?? '';
      const prev = out[out.length - 1];
      if (prev?.kind === 'list' && prev.ordered === isOrdered) prev.items.push({ id: nextId++, text });
      else out.push({ kind: 'list', ordered: isOrdered, items: [{ id: nextId++, text }] });
    } else if (line.trim() === '') {
      flush();
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return out;
}

export function MarkdownLite(p: { source: string; allowedLinks: readonly string[] }) {
  const allowed = new Set(p.allowedLinks);
  return (
    <>
      {blocks(p.source).map((b, i) => {
        const key = `b${i}`;
        if (b.kind === 'heading') {
          const content = inline(b.text, allowed, key);
          return b.level === 2 ? <h2 key={key}>{content}</h2> : <h3 key={key}>{content}</h3>;
        }
        if (b.kind === 'list') {
          const items = b.items.map((item) => (
            <li key={item.id}>{inline(item.text, allowed, `${key}-${item.id}`)}</li>
          ));
          return b.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
        }
        const content = inline(b.text, allowed, key);
        // Un paragraphe réduit à rien (image seule, balise) n'est pas rendu.
        return content.length === 0 ? null : <p key={key}>{content}</p>;
      })}
    </>
  );
}
