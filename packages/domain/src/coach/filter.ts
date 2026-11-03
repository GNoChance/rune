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
  /** Derniers mots du morceau précédent, rendus par `trailingWords` : le contexte d'un numéro franchit les phrases. */
  precedingWords?: readonly string[];
}

/** `detail` : chiffres du numéro, `<valeur> <unité>` ou le `term` interdit. */
export type FilterVerdict = { ok: true } | { ok: false; rule: FilterRule; detail: string };

// Caractères de format invisibles (trait d'union conditionnel, espace sans chasse…) : ils couperaient un mot ou un
// nombre sans se voir à l'écran.
const INVISIBLE = /\p{Cf}/gu;
// Après NFKC, les marques qui restent ne s'attachent à aucune lettre composée : sélecteur de variante et cadre de
// touche des émojis chiffres (0️⃣), graphème combinant invisible U+034F… Retirées avec les invisibles.
const INVISIBLE_OR_MARK = /[\p{Cf}\p{Mn}\p{Me}]/gu;
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

// Signe numéro (n°, nº, №) réécrit en mot avant NFKC, qui ferait de « nº » et « № » un simple « no ».
const NUMERO_SIGN = /(?<![\p{L}\p{N}])n[°º]|№/giu;

/** Texte lu par les règles : signe numéro en mot, NFKC, invisibles et marques retirés. */
function prepare(sentence: string): string {
  return sentence.replace(NUMERO_SIGN, ' numero ').normalize('NFKC').replace(INVISIBLE_OR_MARK, '');
}

// Règle 1. Une suite de chiffres séparés par des espaces, des points, des tirets (ceux de DASHES), le point médian ou
// la puce est lue comme un seul numéro.
const DIGIT_RUN = /\d(?:[\s.·•\-‐-―−]*\d)*/g;
// Les mots du §11.3, normalisés, avec leurs autres personnes et pluriels (« si tu appelles le 119 »), et les verbes et
// noms voisins (rappeler, contacter, joindre, appel, SMS).
const CALL_WORDS = new Set([
  'appelle',
  'appelles',
  'appeler',
  'appelez',
  'rappelle',
  'rappelles',
  'rappelez',
  'rappeler',
  'appel',
  'appels',
  'compose',
  'composes',
  'composer',
  'composez',
  'contacte',
  'contactes',
  'contactez',
  'contacter',
  'joindre',
  'joins',
  'joignez',
  'sms',
  'numero',
  'numeros',
  'tel',
  'telephone',
  'telephones',
  'telephoner',
  'telephonez',
]);
// Un numéro lu (admis ou non) compte pour ce mot : il annonce la suite, « appelle le 15 ou le 3237 ».
const READ_NUMBER = 'numero';
const HELP_DIGITS = new Set(HELP_PHONE_DIGITS);
const WINDOW = 3;

// Particule élidée (c', l', qu', jusqu'…) : elle forme un seul mot avec le suivant, « c'est » compte pour un.
const ELIDED = /\p{L}+['‘’ʼ](?=\p{L})/gu;
// « num. » et « no. » en mot entier suivis d'un point, sur le texte normalisé.
const ABBREVIATED_NUMERO = /(?<![\p{L}\p{N}])(?:num|no)\./gu;

/** Mots en lettres d'un morceau de texte préparé, normalisés ; les nombres ne comptent pas. */
function callTokens(text: string): string[] {
  const normalized = normalizeForTerms(text.replace(ELIDED, '')).replace(
    ABBREVIATED_NUMERO,
    ` ${READ_NUMBER} `,
  );
  return normalized.match(/\p{L}+/gu) ?? [];
}

/**
 * Parcourt les nombres du texte préparé avec les 3 mots qui précèdent chacun, `preceding` compris. Un nombre est lu
 * comme un numéro s'il compte au moins 8 chiffres, ou au moins 2 avec un mot d'appel parmi ces 3 mots. Rend le premier
 * numéro hors `HELP_PHONE_DIGITS` et les 3 derniers mots du texte.
 */
function scanNumbers(
  text: string,
  preceding: readonly string[],
): { phone: string | null; trailing: string[] } {
  let window = preceding.slice(-WINDOW);
  const read = (words: readonly string[]) => {
    window = [...window, ...words].slice(-WINDOW);
  };
  let phone: string | null = null;
  let from = 0;
  for (const match of text.matchAll(DIGIT_RUN)) {
    read(callTokens(text.slice(from, match.index)));
    from = match.index + match[0].length;
    const digits = match[0].replace(/\D/g, '');
    const called = digits.length >= 2 && window.some((word) => CALL_WORDS.has(word));
    if (digits.length < 8 && !called) continue;
    if (!HELP_DIGITS.has(digits)) phone ??= digits;
    read([READ_NUMBER]);
  }
  read(callTokens(text.slice(from)));
  return { phone, trailing: window };
}

/**
 * Les 3 derniers mots en lettres, normalisés, d'une phrase (abréviations de numéro réécrites, un numéro lu comptant
 * pour « numero »), à passer en `precedingWords` à la phrase suivante. `preceding` : ceux de la phrase d'avant, qui
 * complètent une phrase courte (« - le 3114 ») et disent si un nombre en tête de phrase est un numéro.
 */
export function trailingWords(sentence: string, preceding: readonly string[] = []): string[] {
  return scanNumbers(prepare(sentence), preceding).trailing;
}

// Règle 2. Hors mode nutrition complet, la famille nutrition est vide.
function unitViolation(text: string, allowed: AllowedValues, nutritionOpen: boolean): string | null {
  for (const quantity of findQuantities(text)) {
    const open = quantity.family !== 'nutrition' || nutritionOpen;
    if (!open || !allowed[quantity.family].has(quantity.value)) return `${quantity.value} ${quantity.unit}`;
  }
  return null;
}

// Règle 3. Texte et formes réduits à leurs mots, séparés et entourés d'une espace : ` l echec `. Une forme se cherche
// alors aux limites de mots, sans regex.
const joinWords = (tokens: readonly string[] | null): string => ` ${(tokens ?? []).join(' ')} `;
const TOKEN = /\p{L}+|\p{N}+/gu;
/** Mots normalisés, sans accents. */
const plainWords = (text: string): string => joinWords(normalizeForTerms(text).match(TOKEN));
/** Mots en NFKC et minuscules, accents gardés. Mêmes coupes que `plainWords` sur un texte préparé. */
const accentedWords = (text: string): string =>
  joinWords(
    text
      .normalize('NFKC')
      .replace(INVISIBLE, '')
      .toLowerCase()
      .replace(APOSTROPHES, ' ')
      .replace(DASHES, ' ')
      .match(TOKEN),
  );

// Mots courants qu'une forme interdite devient sans ses accents (« jeûne » → « jeune ») : ces formes se cherchent
// avec leurs accents, pour que « Tu es jeune » passe.
const COMMON_WITHOUT_ACCENTS = new Set(['jeune', 'jeunes']);
const isCommonWithoutAccents = (form: string): boolean => COMMON_WITHOUT_ACCENTS.has(plainWords(form).trim());

interface WordTerm {
  term: string;
  /** Formes cherchées sans accents. */
  plain: readonly string[];
  /** Formes cherchées avec leurs accents. */
  accented: readonly string[];
}

const toWords = (terms: readonly ForbiddenTerm[]): WordTerm[] =>
  terms.map(({ term, forms }) => ({
    term,
    plain: forms.filter((form) => !isCommonWithoutAccents(form)).map(plainWords),
    accented: forms.filter(isCommonWithoutAccents).map(accentedWords),
  }));

const FOR_ALL = toWords(FORBIDDEN_TERMS.all);
const FOR_MINOR = [...FOR_ALL, ...toWords(FORBIDDEN_TERMS.minor)];
const ALLOWED_PHRASES = FORBIDDEN_TERMS.allowedForMinor.map(plainWords);

/** Rang du premier mot où commence l'une des formes (nombre d'espaces avant lui), ou l'infini. */
function firstWordIndex(haystack: string, forms: readonly string[]): number {
  let first = Number.POSITIVE_INFINITY;
  for (const form of forms) {
    const at = haystack.indexOf(form);
    if (at !== -1) first = Math.min(first, haystack.slice(0, at).split(' ').length - 1);
  }
  return first;
}

/** Terme dont une forme apparaît le plus tôt ; à égalité, le premier de la liste. */
function termViolation(text: string, terms: readonly WordTerm[]): string | null {
  let plain = plainWords(text);
  // « Écoute Dopage », « produits dopants » : remplacés mot pour mot par « | » avant la recherche, ils ne peuvent
  // bloquer, et les rangs des mots restent ceux du texte accentué.
  for (const phrase of ALLOWED_PHRASES) {
    const blank = phrase.replace(/[^ ]+/g, '|');
    while (plain.includes(phrase)) plain = plain.replace(phrase, blank);
  }
  const accented = accentedWords(text);
  let found: { index: number; term: string | null } = { index: Number.POSITIVE_INFINITY, term: null };
  for (const { term, plain: plainForms, accented: accentedForms } of terms) {
    const index = Math.min(firstWordIndex(plain, plainForms), firstWordIndex(accented, accentedForms));
    if (index < found.index) found = { index, term };
  }
  return found.term;
}

/**
 * Règles du §11.3 dans l'ordre, première violation rendue. Famille nutrition et termes levés seulement pour un adulte
 * en mode `full` ; tout autre public a les listes `all` et `minor` (côté fermé).
 */
export function outputFilter(sentence: string, ctx: FilterContext): FilterVerdict {
  const text = prepare(sentence);
  const nutritionFull = ctx.audience === 'adult' && ctx.nutritionMode === 'full';

  const { phone } = scanNumbers(text, ctx.precedingWords ?? []);
  if (phone !== null) return { ok: false, rule: 'phone', detail: phone };

  const unit = unitViolation(text, ctx.allowed, nutritionFull);
  if (unit !== null) return { ok: false, rule: 'unit', detail: unit };

  if (!nutritionFull) {
    const term = termViolation(text, ctx.audience === 'adult' ? FOR_ALL : FOR_MINOR);
    if (term !== null) return { ok: false, rule: 'forbidden_term', detail: term };
  }
  return { ok: true };
}

/**
 * Texte de plus d'une phrase (motif d'une proposition, textes de l'appli, réponse entière) : découpé par
 * `SentenceBuffer` comme le flux, chaque phrase passée à `outputFilter` avec les `precedingWords` de la précédente
 * (`trailingWords`), première violation rendue. Tout texte de plus d'une phrase passe par cette fonction, jamais
 * directement par `outputFilter` : même découpe, même ordre des violations et même contexte que le flux, qui transmet
 * lui aussi `precedingWords = trailingWords(phrase, precedingWords)` d'une phrase à la suivante (Task 20). Faux positif
 * accepté : « Appelle le 15. Fais 12 reps. » bloque « 12 ».
 */
export function outputFilterText(text: string, ctx: FilterContext): FilterVerdict {
  const buffer = new SentenceBuffer();
  let precedingWords: readonly string[] = ctx.precedingWords ?? [];
  for (const sentence of [...buffer.push(text), ...buffer.flush()]) {
    const verdict = outputFilter(sentence, { ...ctx, precedingWords });
    if (!verdict.ok) return verdict;
    precedingWords = trailingWords(sentence, precedingWords);
  }
  return { ok: true };
}
