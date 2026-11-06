import type { AdviceSheetFile } from '@rune/contracts';
import { forbiddenTermIn, prepare } from '../coach/filter';
import { findUnitNumbers } from '../coach/values';

/*
 * Contrôle des fiches conseils (spec brique 5 §10.3), appliqué au passage en `reviewed` et en `published` : au moins
 * une source ; aucun nombre avec unité dans une fiche visible en qualitatif ou d'audience `minors` ou `all` ; aucun
 * terme interdit selon l'audience et les modes ; Markdown limité aux titres, paragraphes, listes et gras, liens
 * seulement vers les URL des sources.
 */

export type SheetIssueCode =
  | 'no_source'
  | 'numbers_not_allowed'
  | 'forbidden_term'
  | 'markdown_not_allowed'
  | 'link_not_in_sources';

export interface SheetIssue {
  code: SheetIssueCode;
  detail: string;
}

export type SheetVerdict = { ok: true } | { ok: false; issues: SheetIssue[] };

// Lien Markdown `[texte](url)` (une image `![…](…)` est refusée à part) et adresse nue.
const LINK = /(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]*)>?[^)]*\)/g;
const BARE_URL = /\bhttps?:\/\/[^\s)<>\]]+/g;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/;
const IMAGE_ALL = new RegExp(IMAGE.source, 'g');
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/m;
const HTML = /<\/?[a-z][a-z0-9-]*(\s[^>]*)?\/?>/i;
const CODE = /`/;
const QUOTE = /^\s*>/m;

function markdownProblem(body: string): string | null {
  if (IMAGE.test(body)) return 'image';
  if (TABLE_SEPARATOR.test(body)) return 'tableau';
  if (HTML.test(body)) return 'HTML';
  if (CODE.test(body)) return 'code';
  if (QUOTE.test(body)) return 'citation';
  return null;
}

function linksOf(body: string): string[] {
  const inLinks = [...body.matchAll(LINK)].map((m) => m[1] as string);
  const withoutLinks = body.replace(IMAGE_ALL, ' ').replace(LINK, ' ');
  return [...inLinks, ...(withoutLinks.match(BARE_URL) ?? [])].map((url) => url.replace(/[.,;:!?]+$/, ''));
}

/** `phase` : les deux passages (`reviewed`, `published`) appliquent les mêmes contrôles. */
export function validateAdviceSheet(sheet: AdviceSheetFile, _phase: 'reviewed' | 'published'): SheetVerdict {
  const issues: SheetIssue[] = [];
  const text = prepare(`${sheet.title}\n${sheet.body_md}`);
  const qualitative = sheet.visible_modes.includes('qualitative');
  const minors = sheet.audience === 'minors' || sheet.audience === 'all';

  if (sheet.sources.length === 0) issues.push({ code: 'no_source', detail: 'aucune source' });

  if (qualitative || minors) {
    const seen = new Set<string>();
    for (const { value, unit } of findUnitNumbers(text)) {
      const detail = `${value} ${unit}`;
      if (seen.has(detail)) continue;
      seen.add(detail);
      issues.push({ code: 'numbers_not_allowed', detail });
    }
  }

  const term = forbiddenTermIn(text, { notFull: qualitative, minor: minors });
  if (term !== null) issues.push({ code: 'forbidden_term', detail: term });

  const markdown = markdownProblem(sheet.body_md);
  if (markdown !== null) issues.push({ code: 'markdown_not_allowed', detail: markdown });

  const allowed = new Set(sheet.sources.map((source) => source.url));
  for (const url of new Set(linksOf(sheet.body_md))) {
    if (!allowed.has(url)) issues.push({ code: 'link_not_in_sources', detail: url });
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
