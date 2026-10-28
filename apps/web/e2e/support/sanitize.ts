/**
 * Masquage des codes et liens d'invitation dans les journaux et traces du harnais E2E (T38-F3).
 *
 * Un code d'invitation est un secret Crockford base32 de 16 caractères affiché en groupes de 4
 * séparés par des tirets (`XXXX-XXXX-XXXX-XXXX`, 19 caractères visibles). L'alphabet Crockford
 * exclut I, L, O et U. Il circule dans deux formes :
 *   - en lien : `${appOrigin}/invite#XXXX-XXXX-XXXX-XXXX`
 *   - en texte : la ligne « Code : XXXX-XXXX-XXXX-XXXX » du CLI `admin:bootstrap`, ou nu.
 *
 * Tout journal ou trace exposé à la CI (reporter HTML, stdout, erreur) doit passer par
 * `maskInvitation` pour éviter la fuite (privacy, T38-F3).
 */

const CROCKFORD_CHAR = '[0-9A-HJKMNP-TV-Z]';
const CODE_GROUP = `${CROCKFORD_CHAR}{4}(?:-${CROCKFORD_CHAR}{4}){3}`;

const INVITE_LINK_RE = new RegExp(`(/invite)#${CODE_GROUP}`, 'g');
const CODE_LINE_RE = new RegExp(`^(Code\\s*:\\s*)${CODE_GROUP}\\s*$`, 'gm');
const BARE_CODE_RE = new RegExp(`\\b${CODE_GROUP}\\b`, 'g');
const ANY_CODE_RE = new RegExp(CODE_GROUP);

export function maskInvitation(text: string): string {
  return text.replace(INVITE_LINK_RE, '$1#***').replace(CODE_LINE_RE, '$1***').replace(BARE_CODE_RE, '***');
}

export function containsInvitationCode(text: string): boolean {
  return ANY_CODE_RE.test(text);
}
