import {
  type AgeBand,
  COACH_IDS,
  COACH_TOOL_NAMES,
  DECISION_RESULTS,
  FORBIDDEN_TERMS,
  HELP_RESOURCE_IDS,
  HELP_RESOURCES,
  helpPhones,
  MAX_CHANGE_OPERATIONS,
  REASON_TEXTS,
} from '@rune/contracts';
import {
  COACH_CONFIG,
  currentRules,
  type FilterRule,
  normalizeForTerms,
  outputFilterText,
  promptVariant,
} from '@rune/domain';
import { describe, expect, it } from 'vitest';
import {
  PROMPTS,
  REFUSAL_MESSAGE,
  regenerationNote,
  STANDARD_REPLY,
  STYLES,
  systemBlocks,
} from '../../src/coach/prompts';
import {
  CODES,
  DATA,
  FORM,
  IDENTITY,
  INSTRUCTIONS,
  INTRO,
  SAFETY,
  SCOPE,
  TOOLS,
} from '../../src/coach/prompts/coach-1-adult';

/*
 * Prompts `coach-1` (spec brique 4 §13) : deux variantes figées, trois voix, textes fixes de l'appli. Le prompt
 * système liste les termes interdits : il n'est jamais filtré, et aucun test ne le passe au filtre (seules les
 * réponses du coach et les textes de l'appli le sont).
 */

const VARIANTS = ['coach-1/adult', 'coach-1/minor'] as const;
const AUDIENCES: readonly AgeBand[] = ['adult', 'minor'];
const RULES: readonly FilterRule[] = ['phone', 'unit', 'forbidden_term'];
const NOTHING_ALLOWED = { mass: new Set<string>(), percent: new Set<string>(), nutrition: new Set<string>() };

/** Texte de l'appli passé au filtre du flux, phrase par phrase, sans aucune valeur autorisée. */
const filtered = (text: string, audience: AgeBand) =>
  outputFilterText(text, { audience, nutritionMode: 'none', allowed: NOTHING_ALLOWED });

describe('systemBlocks', () => {
  it('deux blocs mis en cache : le prompt de la variante, puis la voix et le dossier', () => {
    expect(systemBlocks('coach-1/minor', 'skald', '{}')).toEqual([
      { text: PROMPTS['coach-1/minor'], cache: true },
      { text: `${STYLES.skald}\n\n<dossier>\n{}\n</dossier>`, cache: true },
    ]);
  });

  it("bloc 1 commun à toutes les voix d'une variante, bloc 2 propre à la voix", () => {
    const skald = systemBlocks('coach-1/adult', 'skald', '{"a":1}');
    const ombre = systemBlocks('coach-1/adult', 'ombre', '{"a":1}');
    expect(ombre[0]).toEqual(skald[0]);
    expect(ombre[1]).not.toEqual(skald[1]);
  });

  it('une variante par public, celle que le fil enregistre (promptVariant)', () => {
    expect(Object.keys(PROMPTS).sort()).toEqual([...VARIANTS]);
    expect(PROMPTS[promptVariant('adult')]).toBe(PROMPTS['coach-1/adult']);
    expect(PROMPTS[promptVariant('minor')]).toBe(PROMPTS['coach-1/minor']);
    expect(PROMPTS['coach-1/minor']).not.toBe(PROMPTS['coach-1/adult']);
  });
});

describe.each(VARIANTS)('prompt %s', (variant) => {
  const prompt = PROMPTS[variant];

  it('identité, limite des 28 jours et les 4 outils', () => {
    for (const s of ['Coach IA', 'Claude', 'Anthropic', '28 jours', 'adulte de confiance']) {
      expect(prompt).toContain(s);
    }
    for (const tool of COACH_TOOL_NAMES) expect(prompt).toContain(tool);
  });

  it('chaque terme interdit pour tous, avec les tournures à préférer', () => {
    for (const { term } of FORBIDDEN_TERMS.all) expect(prompt).toContain(`« ${term} »`);
    expect(prompt).toContain('« série à la limite »');
    expect(prompt).toContain("« avis d'un professionnel »");
  });

  it('la table des codes du moteur, générée depuis REASON_TEXTS', () => {
    for (const [code, text] of Object.entries(REASON_TEXTS)) expect(prompt).toContain(`- ${code} : ${text}`);
    for (const result of DECISION_RESULTS) expect(prompt).toContain(`${result} (`);
  });

  it("une ressource d'aide pour chaque situation du tableau de sécurité", () => {
    for (const id of HELP_RESOURCE_IDS) expect(prompt).toContain(`refer_to_help(${id})`);
  });

  it('les références du dossier et des outils, et la fin des corrections', () => {
    for (const s of ['A-x1', 'R-x1', 'P-1', 'lieu_1', 'corrections_exhausted', 'stale_revision']) {
      expect(prompt).toContain(s);
    }
  });

  it('les limites citées suivent la configuration et les règles', () => {
    const limits = COACH_CONFIG.limits;
    expect(prompt).toContain(`${limits.readTrainingMaxDays} jours au plus`);
    expect(prompt).toContain(`de 1 à ${MAX_CHANGE_OPERATIONS} opérations`);
    expect(prompt).toContain(`${limits.reasonChars} caractères au plus`);
    expect(prompt).toContain(`${limits.maxPatchCorrections + 1} refus dans le même message`);
    expect(prompt).toContain(`au plus ${limits.maxToolRounds} tours d'outils par message`);
    expect(prompt).toContain(`fiches publiées, ${limits.searchLimit} au plus`);
    expect(prompt).toContain(`expire au bout de ${currentRules().proposalValidDays} jours`);
    expect(limits.maxProposalsPerMessage).toBe(1);
    expect(prompt).toContain('Une seule proposition par message');
  });

  it("aucun numéro de HELP_RESOURCES dans le prompt : la carte d'aide les affiche", () => {
    for (const { label } of HELP_RESOURCES.flatMap(helpPhones)) expect(prompt).not.toContain(label);
  });
});

describe('variante adulte', () => {
  it('information générale sur trois compléments, sans dosage', () => {
    const prompt = PROMPTS['coach-1/adult'];
    for (const s of ['Créatine, protéine en poudre, caféine', 'sans aucun dosage'])
      expect(prompt).toContain(s);
  });
});

describe('variante mineur', () => {
  it('chaque terme interdit pour un mineur, en plus de ceux de tous', () => {
    const prompt = PROMPTS['coach-1/minor'];
    for (const { term } of FORBIDDEN_TERMS.minor) expect(prompt).toContain(`« ${term} »`);
    for (const { term } of FORBIDDEN_TERMS.all) expect(prompt).toContain(`« ${term} »`);
  });

  it('règles propres aux 16-17 ans : barre, parent, compléments', () => {
    const prompt = PROMPTS['coach-1/minor'];
    for (const s of ['adulte expérimenté', 'un parent', 'pharmacien', '16 ou 17 ans'])
      expect(prompt).toContain(s);
  });

  it('les mots du refus des produits dopants restent permis', () => {
    for (const t of FORBIDDEN_TERMS.allowedForMinor) expect(PROMPTS['coach-1/minor']).toContain(`« ${t} »`);
  });

  it('reprend chaque section commune de la variante adulte, sans en retirer', () => {
    for (const section of [INTRO, IDENTITY, SCOPE, TOOLS, DATA, SAFETY, INSTRUCTIONS, FORM, CODES]) {
      expect(PROMPTS['coach-1/adult']).toContain(section);
      expect(PROMPTS['coach-1/minor']).toContain(section);
    }
  });
});

describe('blocs de style', () => {
  it('une voix par coach', () => {
    expect(Object.keys(STYLES).sort()).toEqual([...COACH_IDS].sort());
  });

  it.each(COACH_IDS)(
    '%s : un court paragraphe sans chiffre, qui laisse la sécurité aux consignes',
    (coach) => {
      const style = STYLES[coach];
      expect(style).not.toMatch(/\d/);
      expect(style).not.toContain('\n');
      expect(style.length).toBeLessThanOrEqual(700);
      expect(style).toContain('sécurité');
    },
  );
});

describe('textes fixes', () => {
  it('réponse type et message de refus, mot pour mot', () => {
    expect(STANDARD_REPLY).toBe(
      'Je préfère ne pas te répondre avec un chiffre ou un mot que je ne peux pas vérifier. Tes repères sont dans Mon programme, et la page « Bien utiliser le coach » explique ce que je peux faire pour toi.',
    );
    expect(REFUSAL_MESSAGE).toBe('Le coach ne peut pas répondre à cette demande.');
  });

  it('une note de régénération par règle', () => {
    const notes = RULES.map(regenerationNote);
    expect(new Set(notes).size).toBe(RULES.length);
    for (const note of notes) expect(note.length).toBeGreaterThan(0);
  });

  it.each(AUDIENCES)('public %s : réponse type, refus et notes passent le filtre du flux', (audience) => {
    for (const text of [STANDARD_REPLY, REFUSAL_MESSAGE, ...RULES.map(regenerationNote)]) {
      expect(filtered(text, audience)).toEqual({ ok: true });
    }
  });

  it('la note du terme interdit ne contient aucune forme interdite, ni pour tous ni pour un mineur', () => {
    const words = ` ${(normalizeForTerms(regenerationNote('forbidden_term')).match(/\p{L}+|\p{N}+/gu) ?? []).join(' ')} `;
    for (const { forms } of [...FORBIDDEN_TERMS.all, ...FORBIDDEN_TERMS.minor]) {
      for (const form of forms) {
        const plain = (normalizeForTerms(form).match(/\p{L}+|\p{N}+/gu) ?? []).join(' ');
        expect(words).not.toContain(` ${plain} `);
      }
    }
  });
});
