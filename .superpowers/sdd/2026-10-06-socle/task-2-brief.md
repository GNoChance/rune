### Task 2: Domaine de base (constantes, UUIDv7, âge, profil prudent)

**Files:**
- Modify: `packages/contracts/src/constants.ts` (version complète), `packages/domain/src/index.ts`, `packages/domain/package.json` (devDependency `fast-check@^4`)
- Create: `packages/domain/src/{ids.ts, age.ts, cautious.ts}`
- Test: `packages/domain/test/{ids,age,cautious,purity}.test.ts`, `packages/contracts/test/constants.test.ts`

**Interfaces:**
- Consumes : Task 1.
- Produces : `constants.ts` (dont `PROTOCOL_HEADER`, `EPOCH_HEADER`), `ids.ts`, `age.ts`, `cautious.ts` — signatures : Interfaces partagées §1.

**Spec:** R-AGE-1, R-AGE-2, R-AGE-3, R-CST-7, R-SYN-2, R-VER-1, 09 §0.2, 02 §15 n°10, 03 §17 n°5.

- [ ] **Step 1: Write the failing test**

```ts
// constants.test.ts
expect({ MIN_AGE, ADULT_AGE, PARIS_TZ, PRIVACY_POLICY_VERSION, SYNC_PROTOCOL, MIN_PROTOCOL, PROTOCOL_HEADER, EPOCH_HEADER }).toEqual({ MIN_AGE: 16,
  ADULT_AGE: 18, PARIS_TZ: 'Europe/Paris', PRIVACY_POLICY_VERSION: '1.0', SYNC_PROTOCOL: 1, MIN_PROTOCOL: 1,
  PROTOCOL_HEADER: 'X-Appsport-Protocol', EPOCH_HEADER: 'X-Appsport-Epoch' });
expect(MIN_PROTOCOL).toBeGreaterThanOrEqual(SYNC_PROTOCOL - 1); // R-VER-1
// ids.test.ts
it('vecteur de la RFC 9562', () => expect(createUuidV7(0x017f22e279b0, Uint8Array.of(0x0c,0xc3,0x18,0xc4,0xdc,0x0c,0x0c,0x07,0x39,0x8f))).toBe('017f22e2-79b0-7cc3-98c4-dc0c0c07398f'));
it('RangeError : aléa < 10 octets, horodatage hors [0, 2^48)', () => { /* createUuidV7(0, new Uint8Array(9)), (-1, …), (2 ** 48, …) */ });
it('isUuidV7 : minuscules, version 7, variante 10xx', () => {
  expect(isUuidV7('017f22e2-79b0-7cc3-98c4-dc0c0c07398f')).toBe(true);
  for (const s of ['017F22E2-79B0-7CC3-98C4-DC0C0C07398F', '017f22e2-79b0-4cc3-98c4-dc0c0c07398f', '017f22e2-79b0-7cc3-c8c4-dc0c0c07398f', 'user:1']) expect(isUuidV7(s)).toBe(false);
});
it('createMonotonicUuidV7 strictement croissant quand l\'horloge recule', () => { /* horloge [1000, 999, 999, 500, 1000, 1001], 5000 ids : croissants, tous isUuidV7 */ });
it('propriété fast-check : toute suite d\'horloges (0..2^40, 1..300 valeurs) → ids uniques et croissants', () => {});
// age.test.ts (02 §15 n°10)
expect(ageOn('2000-06-15', '2018-06-14')).toBe(17); expect(ageOn('2000-06-15', '2018-06-15')).toBe(18);
expect(ageOn('2008-02-29', '2026-02-28')).toBe(17); expect(ageOn('2008-02-29', '2026-03-01')).toBe(18); expect(ageOn('2008-02-29', '2028-02-29')).toBe(20);
expect(ageOn('2010-10-07', '2026-10-06')).toBe(15);
expect(() => ageOn('2008-02-30', '2026-01-01')).toThrow(RangeError); expect(() => ageOn('2008-2-3', '2026-01-01')).toThrow(RangeError);
expect(parisDate(new Date('2026-03-31T22:30:00Z'))).toBe('2026-04-01'); expect(parisDate(new Date('2026-03-31T21:30:00Z'))).toBe('2026-03-31');
expect(parisDate(new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-02');
expect(ageBandOn('2008-04-01', '2026-03-31')).toBe('minor'); expect(ageBandOn('2008-04-01', '2026-04-01')).toBe('adult');
expect(ageBandOn('2010-10-06', '2026-10-06')).toBe('minor');
// cautious.test.ts : it.each sur les 24 cas (2 × 2 × 2 × 3) ; attendu = ageBand === 'minor' || cautiousMode || (healthConsentActive && caution === true)
//   cas nommés R-CST-7 : { adult, false, false, caution: true } → false ; { minor, false, false, null } → true
// purity.test.ts : aucun .ts de packages/domain/src ne contient /\bDate\.now\s*\(/, /\bMath\.random\s*\(/, /new Date\(\s*\)/, /from ['"]node:/ ;
//   hors age.ts, aucun ne contient /birth_?date/i (R-AGE-3 : les règles reçoivent ageBand)
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/domain test` → « Failed to resolve import "../src/ids" » ; `pnpm --filter @appsport/contracts test constants` → `ADULT_AGE` vaut `undefined`.

- [ ] **Step 3: Implement**

`isUuidV7` : `/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`. `parisDate` : `Intl.DateTimeFormat('en-CA', { timeZone: PARIS_TZ, … })`. Octets de `createUuidV7` : 0-5 = `unixMs` 48 bits gros-boutiste ; 6 = `0x70 | (r[0] & 0x0f)` ; 7 = `r[1]` ; 8 = `0x80 | (r[2] & 0x3f)` ; 9-15 = `r[3..9]`. Monotonie (RFC 9562 méthode 1, compteur sur `rand_a`) :
```ts
let lastMs = -1; let seq = 0;
return () => {
  const t = Math.floor(now());
  if (t > lastMs) { lastMs = t; const r = random(2); seq = ((r[0]! & 0x07) << 8) | r[1]!; }
  else { seq += 1; if (seq > 0xfff) { lastMs += 1; seq = 0; } }
  return createUuidV7(lastMs, Uint8Array.of(seq >> 8, seq & 0xff, ...random(8)));
};
```

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/domain test` → `Test Files  4 passed` ; contracts vert ; `pnpm typecheck` et `pnpm lint` passent.

- [ ] **Step 5: Commit**

`git commit -m "feat(socle): constantes partagées, UUIDv7 monotones, âge à Paris et profil prudent"`

---

