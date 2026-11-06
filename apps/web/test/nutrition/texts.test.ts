import { FORBIDDEN_TERMS, HELP_RESOURCES } from '@rune/contracts';
import { forbiddenTermIn } from '@rune/domain';
import { describe, expect, it } from 'vitest';
import { ADULT_NOTICE_TEXT } from '../../src/features/home/HomePage';
import { NUTRITION_TEXTS } from '../../src/features/nutrition/nutrition-texts';

/** Toute chaîne d'un arbre de textes ; une fonction de texte est appelée avec des nombres d'exemple. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') return strings((value as (...a: number[]) => unknown)(2200, 2100, 3, 70));
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

const ALL = [...strings(NUTRITION_TEXTS), ADULT_NOTICE_TEXT];

describe('textes de la nutrition (07 §5.10, §11.5)', () => {
  it('il y a des textes, et la liste v2 « pour tous » est la liste lue', () => {
    expect(FORBIDDEN_TERMS.version).toBe('2');
    expect(ALL.length).toBeGreaterThan(60);
  });

  it.each(ALL.map((t) => [t]))('« %s » : aucun terme interdit « pour tous »', (text) => {
    expect(forbiddenTermIn(text, { notFull: false, minor: false })).toBeNull();
  });

  it('les textes vus hors mode complet et par un mineur passent aussi les autres listes', () => {
    const reduced = [
      ...strings(NUTRITION_TEXTS.disabled),
      ...strings(NUTRITION_TEXTS.qualitative),
      ...strings(NUTRITION_TEXTS.causes),
      ...strings(NUTRITION_TEXTS.footer),
      ...strings(NUTRITION_TEXTS.entry),
      ...strings(NUTRITION_TEXTS.help),
      ...strings(NUTRITION_TEXTS.helpEntry),
    ];
    for (const text of reduced) {
      expect(forbiddenTermIn(text, { notFull: true, minor: true }), text).toBeNull();
    }
  });

  it("l'IMC n'est jamais nommé", () => {
    for (const text of ALL) expect(text, text).not.toMatch(/\bIMC\b|masse corporelle/i);
  });

  it('aucun numéro de téléphone dans les textes : ils viennent de HELP_RESOURCES', () => {
    const ours = HELP_RESOURCES.flatMap((r) => (r.phone ? [r.phone] : []));
    for (const text of ALL) {
      expect(text, text).not.toMatch(/(?:\d[\s. ]?){9,}/);
      expect(text, text).not.toContain('0810');
      for (const phone of ours) expect(text, text).not.toContain(phone);
    }
  });

  it('français soigné : apostrophe droite, pas de point d’exclamation, tutoiement', () => {
    for (const text of ALL) {
      expect(text, text).not.toContain('’');
      expect(text, text).not.toContain('!');
      expect(text, text).not.toMatch(/\bvous\b|\bvotre\b|\bvos\b/i);
    }
  });

  it('les phrases du §13 sont toutes là', () => {
    const d = NUTRITION_TEXTS.decisions;
    expect(d.insufficient_data).toBe(
      'Pas assez de pesées cette semaine pour un bilan. À partir de 3 pesées, le bilan se fait.',
    );
    expect(d.non_representative_week).toBe('Semaine mise de côté. Le bilan reprend la semaine prochaine.');
    expect(d.in_band).toBe('Ta tendance est dans la fourchette visée. Rien à changer.');
    expect(d.out_of_band_pending.above).toBe(
      'Ta tendance est au-dessus de la fourchette visée. On attend une deuxième semaine avant de proposer quoi que ce soit.',
    );
    expect(d.out_of_band_pending.below).toBe(
      'Ta tendance est en dessous de la fourchette visée. On attend une deuxième semaine avant de proposer quoi que ce soit.',
    );
    expect(d.proposal(2200, 2100)).toBe("Proposition : ton repère d'énergie passe de 2 200 à 2 100 kcal.");
    expect(d.rapid_loss(2100, 2200)).toBe(
      "Ton poids baisse plus vite que prévu. Proposition : ton repère d'énergie passe de 2 100 à 2 200 kcal.",
    );
    expect(d.limit_reached.down).toBe('On ne descend pas plus. Un rythme plus lent est normal.');
    expect(d.limit_reached.up).toBe('On ne monte pas plus. Un rythme plus lent est normal.');
    expect(d.safety_pause.pause).toBe(
      "Pas de baisse proposée pour l'instant. Tu peux repasser les questions quand tu veux.",
    );
    expect(d.safety_pause.rule2).toBe('Ton objectif passe au maintien.');
  });
});
