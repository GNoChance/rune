### Task 8: Règles d'identifiants, codes secrets et Argon2id

**Files:**
- Create: `packages/contracts/src/{auth-constants.ts, api/auth.ts}` (base) ; Modify: `packages/contracts/src/index.ts`
- Create: `packages/domain/src/auth/{username.ts, password.ts, secret-code.ts}` ; Modify: `packages/domain/src/index.ts`
- Create: `apps/server/src/auth/{password-hash.ts, secret.ts, common-passwords-list.ts, common-passwords.ts}`, `apps/server/scripts/make-common-passwords.mjs`
- Test: `packages/contracts/test/auth-constants.test.ts`, `packages/domain/test/auth/{username,password,secret-code}.test.ts`, `apps/server/test/auth/{password-hash,secret,common-passwords}.test.ts`

**Interfaces:**
- Consumes : `Role` (T2) ; `IdGen`, `Argon2Params`, `ARGON2_PARAMS`, `loadConfig` (T6) ; `seqIds`, `TEST_ARGON2`.
- Produces : Interfaces partagées §3 (`auth-constants.ts` ; `api/auth.ts` : `CivilDate`, `RoleSchema`, `UserStatusSchema`, `AgeBandSchema` ; `domain/auth/*` ; `password-hash.ts`, `secret.ts`, `common-passwords.ts`).

**Spec:** 02 R-INV-3, R-INV-5, R-RST-1, R-MDP-1 à R-MDP-4, §3.4, R-ROLE-5, 03 P-AUT-1, P-AUT-2, 02 §15 n°3 et n°6.

- [ ] **Step 1: Write the failing test**

```ts
// auth-constants.test.ts
expect([INVITATION_TTL_DAYS, BOOTSTRAP_INVITATION_TTL_HOURS, RESET_TTL_HOURS, SECRET_CODE_LENGTH, INVITATION_NOTE_MAX, USERNAME_MIN, USERNAME_MAX,
  PASSWORD_MIN_MEMBER, PASSWORD_MIN_ADMIN, PASSWORD_MAX, SESSION_IDLE_DAYS, SESSION_MAX_DAYS, ADMIN_PASSWORD_REMINDER_MONTHS]).toEqual([7, 24, 24, 16, 60, 3, 24, 12, 14, 128, 90, 365, 12]);
expect(RESERVED_USERNAMES).toEqual(['admin', 'appsport', 'systeme']); expect(CODE_CHECKS_PER_HOUR).toBe(20);
expect(LOGIN_LIMITS).toEqual({ consecutiveThreshold: 5, firstDelayMs: 60_000, maxDelayMs: 900_000, hourlyMaxFailures: 10, lockMs: 3_600_000, windowMs: 3_600_000, ipMaxFailuresPerHour: 30 });
// CivilDate : '2026-10-06' et '2024-02-29' acceptés ; '2026-02-30' et '06/10/2026' refusés
// username.test.ts
expect(validateUsername('ab')).toEqual({ ok: false, reason: 'length' }); expect(validateUsername('a'.repeat(25))).toEqual({ ok: false, reason: 'length' });
expect(validateUsername('abc')).toEqual({ ok: true }); expect(validateUsername('a'.repeat(24))).toEqual({ ok: true });
expect(validateUsername('é'.repeat(24))).toEqual({ ok: true });   // longueur après NFC
for (const u of ['Éloïse_2', 'jean-marc.b']) expect(validateUsername(u)).toEqual({ ok: true });
for (const u of ['lea b', 'lea@x', 'lea💪', '\u0430dmin', 'l\u0435a', 'Αθηνά']) expect(validateUsername(u)).toEqual({ ok: false, reason: 'characters' });   // a et e cyrilliques ; grec
expect(validateUsername('Le\u0301a')).toEqual({ ok: true });   // NFD → contrôlé sur la forme NFC
for (const u of ['Admin', 'APPSPORT', 'Système']) expect(validateUsername(u)).toEqual({ ok: false, reason: 'reserved' });   // [décision plan] sans accents
expect(usernameKey('Éloïse')).toBe('éloïse'); expect(usernameKey('ＬＥＡ')).toBe('lea');
// password.test.ts (02 §15 n°6) — member = { username: 'lea', role: 'member', commonPasswords: new Set(['soleil123456']) }
expect(validatePassword('abcdefghijk', member)).toEqual({ ok: false, reason: 'too_short' }); expect(validatePassword('girafebleuet', member)).toEqual({ ok: true });
expect(validatePassword('girafebleuet1', admin)).toEqual({ ok: false, reason: 'too_short' }); expect(validatePassword('girafebleuet12', admin)).toEqual({ ok: true });
expect(validatePassword('ab'.repeat(64), member)).toEqual({ ok: true }); expect(validatePassword(`${'ab'.repeat(64)}c`, member)).toEqual({ ok: false, reason: 'too_long' });
expect(validatePassword('SOLEIL123456', member)).toEqual({ ok: false, reason: 'common' });
expect(validatePassword('xxÉloïse_2 et la mer', { ...member, username: 'éloïse_2' })).toEqual({ ok: false, reason: 'contains_username' });
expect(validatePassword('mon appSport adoré', member)).toEqual({ ok: false, reason: 'contains_appsport' });
expect(validatePassword('aaaaaaaaaaaa', member)).toEqual({ ok: false, reason: 'single_char' }); expect(validatePassword('💪'.repeat(12), member)).toEqual({ ok: false, reason: 'single_char' });
expect(passwordLength('💪'.repeat(11))).toBe(11); expect(validatePassword(`${'💪'.repeat(11)}a`, member)).toEqual({ ok: true });
expect(validatePassword(`${'é'.repeat(6)}abcde`, member)).toEqual({ ok: false, reason: 'too_short' });
// secret-code.test.ts (02 §15 n°3)
expect(encodeCrockford(new Uint8Array(10))).toBe('0000000000000000'); expect(encodeCrockford(new Uint8Array(10).fill(255))).toBe('ZZZZZZZZZZZZZZZZ');
expect(encodeCrockford(Uint8Array.of(8, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('1000000000000000');
expect(formatSecretCode('ABCDEFGHJKMNPQRS')).toBe('ABCD-EFGH-JKMN-PQRS');
for (const s of ['abcd-efgh-jkmn-pqrs', ' abcd efgh jkmn pqrs ', 'abcdefghjkmnpqrs', 'https://appsport.tail1234.ts.net/invite#abcd-efgh-jkmn-pqrs',
  'https://appsport.tail1234.ts.net/reset#ABCD-EFGH-JKMN-PQRS']) expect(parseSecretCode(s)).toBe('ABCDEFGHJKMNPQRS');
expect(parseSecretCode('O0OO-IiLl-0000-0000')).toBe('0000111100000000');
for (const s of ['ABCD-EFGH-JKMN-PQR', 'ABCD-EFGH-JKMN-PQRST', 'ABCD-EFGH-JKMN-PQRU', '']) expect(parseSecretCode(s)).toBeNull();
// password-hash.test.ts (R-MDP-4)
expect(await hashPassword('girafebleuet', ARGON2_PARAMS, seqIds())).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
expect(loadConfig({ APP_ORIGIN: 'https://appsport.test.ts.net' }).argon2).toEqual(ARGON2_PARAMS);
// verifyPassword : bon (NFC et NFD) → true ; mauvais → false ; 'pas-un-phc' → false ; deux hachés du même mot de passe diffèrent
// needsRehash : mêmes paramètres → false ; memoryKiB 2048 ou passes 2 → true ; memoryKiB 512 → false ; 'garbage' → true
// secret.test.ts (R-INV-3) : canonical /^[0-9A-HJKMNP-TV-Z]{16}$/ ; formatted = formatSecretCode(canonical) ; hash = sha256 hex ; randomBytes appelé avec 10
// common-passwords.test.ts (R-MDP-3) : 9000 < size ≤ 10000 ; contient '123456' et 'password' ; tout en minuscules ;
expect([...parseCommonPasswords('# Licence MIT\r\nPassword\r\n\r\nabc\n')]).toEqual(['password', 'abc']);
expect(COMMON_PASSWORDS_RAW.startsWith('# Source: SecLists')).toBe(true); expect(COMMON_PASSWORDS_RAW).toContain('MIT');
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/contracts test auth-constants` ; `pnpm --filter @appsport/domain test auth` ; `pnpm --filter @appsport/server test password-hash secret common-passwords` → `Failed to resolve import "../src/auth-constants"` (et équivalents).

- [ ] **Step 3: Implement**

- `validateUsername` sur `n = username.normalize('NFC')` : longueur `[...n]` ∈ [3, 24] ; `/^[\p{Script=Latin}\p{Nd}._-]+$/u` (écriture latine seule, contre les homoglyphes) ; réservé si `usernameKey(n)` sans diacritiques (`normalize('NFD').replace(/\p{M}/gu, '')`) ∈ `RESERVED_USERNAMES` ; pas de `trim`.
- `validatePassword` sur `pw.normalize('NFC')`, contrôles dans l'ordre : `too_short`, `too_long`, `single_char`, `common` (minuscules), `contains_username` (`usernameKey(p).includes(usernameKey(username))`), `contains_appsport`.
- `parseSecretCode` : garde ce qui suit le dernier `#`, majuscules, retire blancs et `-`, `I`/`L` → `1`, `O` → `0`, exige 16 caractères de `CROCKFORD_ALPHABET`.
- `hashPassword` : `argon2` de `node:crypto` (`argon2id`, sel `ids.randomBytes(saltLength)`), entrée NFC ; PHC `$argon2id$v=19$m=<m>,t=<t>,p=<p>$<sel b64 sans =>$<haché b64 sans =>` ; `verifyPassword` par `timingSafeEqual`, toute erreur → `false` ; `needsRehash` vrai si PHC illisible, autre algorithme ou version, `m < memoryKiB`, `t < passes`, `p ≠ parallelism` ou sel trop court.
- `common-passwords-list.ts` **[décision plan, remplace le `.txt` et le loader esbuild]** : généré une fois par `node apps/server/scripts/make-common-passwords.mjs <10k-most-common.txt>` (fichier `SecLists/Passwords/Common-Credentials/10k-most-common.txt` téléchargé à la main), qui écrit `export const COMMON_PASSWORDS_RAW = ${JSON.stringify(texte)};` (pas de littéral gabarit : `` ` ``, `${` et `\u` restent sûrs) ; `texte` = minuscules, dédoublonné, LF, commençant exactement par :
  `# Source: SecLists, Passwords/Common-Credentials/10k-most-common.txt (https://github.com/danielmiessler/SecLists)`
  `# Licence : MIT, Copyright (c) Daniel Miessler. Converti en minuscules et dédoublonné pour appsport.`
  `COMMON_PASSWORDS = parseCommonPasswords(COMMON_PASSWORDS_RAW)`.

- [ ] **Step 4: Run test to verify it passes**

Mêmes commandes → `Test Files  1 passed`, `Test Files  3 passed`, `Test Files  3 passed` ; `pnpm typecheck` et `pnpm lint` passent.

- [ ] **Step 5: Commit**

`git commit -m "feat(auth): règles de pseudo et de mot de passe, codes Crockford et Argon2id"`

---

