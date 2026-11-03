const MAX_UNBROKEN = 400;
const TERMINATORS = new Set(['.', '!', '?', '…']);
// Abréviations qui annoncent un numéro (tél., tel., num., no., n°.), en mot entier, sans casse ni accents. Couper
// après leur point séparerait le numéro du mot d'appel que lit le filtre (§11.3, règle 1).
const NUMBER_ABBREVIATION = /(?:^|[^\p{L}\p{N}])(?:tel|num|no|n°)\.$/u;

/** `head` finit-il par une abréviation de numéro ? Les 8 dernières unités suffisent (« tél. » décomposé en fait 5). */
function endsWithNumberAbbreviation(head: string): boolean {
  const tail = head.slice(-8).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return NUMBER_ABBREVIATION.test(tail);
}

/** Fin (exclue) de la première phrase complète du tampon, ou -1 si elle n'est pas finie. */
function findCut(text: string): number {
  const limit = Math.min(text.length, MAX_UNBROKEN);
  for (let i = 0; i < limit; i++) {
    const char = text[i] as string;
    if (char === '\n') return i + 1;
    if (!TERMINATORS.has(char)) continue;
    const next = text[i + 1];
    // Fin de tampon : on attend la suite (un « . » peut précéder un chiffre).
    if (next === undefined) return -1;
    if (next !== ' ') continue;
    if (char === '.' && endsWithNumberAbbreviation(text.slice(0, i + 1))) continue;
    return i + 2 <= MAX_UNBROKEN ? i + 2 : -1;
  }
  return -1;
}

/** Découpe un flux de texte en phrases, sans jamais couper dans un nombre. */
export class SentenceBuffer {
  private pending = '';

  push(delta: string): string[] {
    this.pending += delta;
    const out: string[] = [];
    for (;;) {
      const cut = findCut(this.pending);
      if (cut > 0) {
        out.push(this.pending.slice(0, cut));
        this.pending = this.pending.slice(cut);
      } else if (this.pending.length >= MAX_UNBROKEN) {
        // Ne jamais couper une paire de substitution UTF-16 en deux.
        const last = this.pending.charCodeAt(MAX_UNBROKEN - 1);
        const size = last >= 0xd800 && last <= 0xdbff ? MAX_UNBROKEN - 1 : MAX_UNBROKEN;
        out.push(this.pending.slice(0, size));
        this.pending = this.pending.slice(size);
      } else {
        return out;
      }
    }
  }

  flush(): string[] {
    const rest = this.pending;
    this.pending = '';
    return rest === '' ? [] : [rest];
  }
}
