import { type AgeBand, FORBIDDEN_TERMS, type ForbiddenTerm, HELP_PHONE_DIGITS } from '@rune/contracts';
import { SentenceBuffer } from './sentences';
import { type AllowedValues, findQuantities } from './values';

/*
 * Filtre de sortie du coach (spec brique 4 §11.3) : chaque phrase passe les règles dans l'ordre (téléphone, unités,
 * termes interdits) ; la première violation est rendue et fait régénérer la réponse.
 */

export type FilterRule = 'phone' | 'unit' | 'forbidden_term';

export interface FilterContext {
  audience: AgeBand;
  nutritionMode: 'none' | 'qualitative' | 'full';
  allowed: AllowedValues;
}

/** `detail` : chiffres du numéro, `<valeur> <unité>` ou le `term` interdit. */
export type FilterVerdict = { ok: true } | { ok: false; rule: FilterRule; detail: string };

// Caractères de format invisibles (trait d'union conditionnel, espace sans chasse…) : ils couperaient un mot ou un
// nombre sans se voir à l'écran.
const INVISIBLE = /\p{Cf}/gu;
// Apostrophe droite, apostrophes courbes U+2018 et U+2019, lettre apostrophe U+02BC.
const APOSTROPHES = /['‘’ʼ]/g;
// Trait d'union-moins, tirets U+2010 à U+2015 (insécable, demi-cadratin, cadratin…), signe moins U+2212.
const DASHES = /[-‐-―−]/g;

/** NFKC, minuscules, accents retirés, élisions séparées (`l'échec` → `l echec`), tirets en espaces. */
export function normalizeForTerms(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(APOSTROPHES, ' ')
    .replace(DASHES, ' ');
}

// Règle 1. Une suite de chiffres séparés par des espaces, des points ou des tirets (ceux de DASHES) est lue comme un
// seul numéro.
const DIGIT_RUN = /\d(?:[\s.\-‐-―−]*\d)*/g;
// Les mots du §11.3, normalisés, avec leurs autres personnes et pluriels (« si tu appelles le 119 »).
const CALL_WORDS = new Set([
  'appelle',
  'appelles',
  'appeler',
  'appelez',
  'compose',
  'composes',
  'composer',
  'composez',
  'numero',
  'numeros',
  'tel',
  'telephone',
  'telephones',
  'telephoner',
  'telephonez',
]);
const HELP_DIGITS = new Set(HELP_PHONE_DIGITS);

/** Un mot d'appel parmi les 3 mots (lettres seules, les nombres ne comptent pas) qui précèdent. */
function calledBefore(prefix: string): boolean {
  const before = normalizeForTerms(prefix).match(/\p{L}+/gu) ?? [];
  return before.slice(-3).some((word) => CALL_WORDS.has(word));
}

function phoneViolation(text: string): string | null {
  for (const match of text.matchAll(DIGIT_RUN)) {
    const digits = match[0].replace(/\D/g, '');
    if (HELP_DIGITS.has(digits)) continue;
    if (digits.length >= 8) return digits;
    if (digits.length >= 2 && calledBefore(text.slice(0, match.index))) return digits;
  }
  return null;
}

// Règle 2. Hors mode nutrition complet, la famille nutrition est vide.
function unitViolation(text: string, allowed: AllowedValues, nutritionOpen: boolean): string | null {
  for (const quantity of findQuantities(text)) {
    const open = quantity.family !== 'nutrition' || nutritionOpen;
    if (!open || !allowed[quantity.family].has(quantity.value)) return `${quantity.value} ${quantity.unit}`;
  }
  return null;
}

// Règle 3. Texte et formes réduits à leurs mots normalisés, séparés et entourés d'une espace : ` l echec `. Une
// forme se cherche alors aux limites de mots, sans regex.
const words = (text: string): string =>
  ` ${(normalizeForTerms(text).match(/\p{L}+|\p{N}+/gu) ?? []).join(' ')} `;

interface WordTerm {
  term: string;
  forms: readonly string[];
}

const toWords = (terms: readonly ForbiddenTerm[]): WordTerm[] =>
  terms.map(({ term, forms }) => ({ term, forms: forms.map(words) }));

const FOR_ALL = toWords(FORBIDDEN_TERMS.all);
const FOR_MINOR = [...FOR_ALL, ...toWords(FORBIDDEN_TERMS.minor)];
const ALLOWED_PHRASES = FORBIDDEN_TERMS.allowedForMinor.map(words);

/** Terme dont une forme apparaît le plus tôt ; à égalité, le premier de la liste. */
function termViolation(text: string, terms: readonly WordTerm[]): string | null {
  let haystack = words(text);
  // « Écoute Dopage », « produits dopants » : retirés avant la recherche, ils ne peuvent bloquer.
  for (const phrase of ALLOWED_PHRASES) {
    while (haystack.includes(phrase)) haystack = haystack.replace(phrase, ' | ');
  }
  let found: { at: number; term: string } | null = null;
  for (const { term, forms } of terms) {
    for (const form of forms) {
      const at = haystack.indexOf(form);
      if (at !== -1 && (found === null || at < found.at)) found = { at, term };
    }
  }
  return found?.term ?? null;
}

/**
 * Règles du §11.3 dans l'ordre, première violation rendue. Famille nutrition et termes levés seulement pour un adulte
 * en mode `full` ; un mineur a les listes `all` et `minor`.
 */
export function outputFilter(sentence: string, ctx: FilterContext): FilterVerdict {
  const text = sentence.normalize('NFKC').replace(INVISIBLE, '');
  const nutritionFull = ctx.audience === 'adult' && ctx.nutritionMode === 'full';

  const phone = phoneViolation(text);
  if (phone !== null) return { ok: false, rule: 'phone', detail: phone };

  const unit = unitViolation(text, ctx.allowed, nutritionFull);
  if (unit !== null) return { ok: false, rule: 'unit', detail: unit };

  if (!nutritionFull) {
    const term = termViolation(text, ctx.audience === 'minor' ? FOR_MINOR : FOR_ALL);
    if (term !== null) return { ok: false, rule: 'forbidden_term', detail: term };
  }
  return { ok: true };
}

/**
 * Texte de plus d'une phrase (motif d'une proposition, textes de l'appli, réponse entière) : découpé par
 * `SentenceBuffer` comme le flux, chaque phrase passée à `outputFilter`, première violation rendue. Tout texte de plus
 * d'une phrase passe par cette fonction, jamais directement par `outputFilter`, dont la règle des numéros lit les mots
 * qui précèdent un nombre jusque dans la phrase d'avant.
 */
export function outputFilterText(text: string, ctx: FilterContext): FilterVerdict {
  const buffer = new SentenceBuffer();
  for (const sentence of [...buffer.push(text), ...buffer.flush()]) {
    const verdict = outputFilter(sentence, ctx);
    if (!verdict.ok) return verdict;
  }
  return { ok: true };
}
