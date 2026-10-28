// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { containsInvitationCode, maskInvitation } from '../../e2e/support/sanitize';

const SAMPLE_CODE = '0123-4567-89AB-CDEF';
const SAMPLE_LINK = `https://rune.example.ts.net/invite#${SAMPLE_CODE}`;

describe('masquage des codes et liens d’invitation dans les journaux et traces (T38-F3)', () => {
  it('masque le fragment d’un lien d’invitation (URL complète)', () => {
    const line = `Lien : ${SAMPLE_LINK}`;
    const masked = maskInvitation(line);
    expect(masked).not.toContain(SAMPLE_CODE);
    expect(masked).toContain('/invite#***');
    expect(containsInvitationCode(masked)).toBe(false);
  });

  it('masque la ligne « Code : XXXX-XXXX-XXXX-XXXX » du CLI', () => {
    const line = `Code : ${SAMPLE_CODE}`;
    const masked = maskInvitation(line);
    expect(masked).toBe('Code : ***');
    expect(containsInvitationCode(masked)).toBe(false);
  });

  it('masque un code nu de 16 caractères Crockford en 4 groupes', () => {
    const text = `extrait ${SAMPLE_CODE} dans un journal`;
    const masked = maskInvitation(text);
    expect(masked).not.toContain(SAMPLE_CODE);
    expect(masked).toContain('***');
    expect(containsInvitationCode(masked)).toBe(false);
  });

  it('masque sur plusieurs lignes et plusieurs occurrences', () => {
    const text = [
      '>>> Démarrage',
      `Lien : ${SAMPLE_LINK}`,
      `Code : ${SAMPLE_CODE}`,
      'Prêt.',
      `Autre code : WXYZ-0123-4567-89AB`,
    ].join('\n');
    const masked = maskInvitation(text);
    expect(masked).not.toContain(SAMPLE_CODE);
    expect(masked).not.toContain('WXYZ-0123-4567-89AB');
    expect(containsInvitationCode(masked)).toBe(false);
    // Les lignes non concernées restent lisibles.
    expect(masked).toContain('>>> Démarrage');
    expect(masked).toContain('Prêt.');
  });

  it('ne masque pas une suite de chiffres ou de lettres qui n’est pas un code Crockford groupé', () => {
    const text = 'commit 683ee9b-abcd-1234-ef56 non masqué car hex court';
    expect(maskInvitation(text)).toBe(text);
    expect(containsInvitationCode(text)).toBe(false);
  });

  it('ne masque pas un code qui contient des lettres interdites par Crockford (I, L, O, U)', () => {
    // Crockford exclut I, L, O, U — un « code » qui les contient n’en est pas un.
    const fakeWithO = 'OOOO-OOOO-OOOO-OOOO';
    expect(containsInvitationCode(fakeWithO)).toBe(false);
    expect(maskInvitation(`Code : ${fakeWithO}`)).toBe(`Code : ${fakeWithO}`);
  });

  it('détecte un code nu dans un texte pour les assertions des tests du harnais', () => {
    expect(containsInvitationCode(`texte ${SAMPLE_CODE} ici`)).toBe(true);
    expect(containsInvitationCode(SAMPLE_LINK)).toBe(true);
    expect(containsInvitationCode('rien à voir ici')).toBe(false);
  });
});
