### Task 15: recommendTemplate, objectifs et reprise de l'onboarding

**Files:**
- Create: `packages/contracts/src/api/profile.ts` (objectifs, expérience), `packages/domain/src/{recommend-template.ts, onboarding.ts}`, `packages/domain/test/fixtures/templates.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/domain/src/index.ts`
- Test: `packages/domain/test/{recommend-template,onboarding}.test.ts`

**Interfaces:**
- Consumes : `ONBOARDING_STEPS`, `OnboardingStep` (T10) ; `AgeBand` (T2).
- Produces : Interfaces partagées §4 (`GOALS`, `Goal`, `EXPERIENCES`, `Experience`, `GOAL_LABELS`, `EXPERIENCE_LABELS` ; `recommend-template.ts` ; `onboarding.ts`). Support local :
```ts
// packages/domain/test/fixtures/templates.ts
export const FAKE_TEMPLATES: readonly TemplateDescriptor[];   // 6 modèles factices ci-dessous
export function withUnavailable(ids: readonly string[]): TemplateDescriptor[];   // copie, ces ids à available = false
```

**Spec:** 02 §9 R-REC-1 à R-REC-8, 05 §3 (règles 1 à 4), 02 R-ONB-2, §8 E1, §15 n°11 et n°12.

- [ ] **Step 1: Write the failing test**

`FAKE_TEMPLATES` : `gym-beginner-full-body-ab` (gym, beginner, 2..3), `gym-intermediate-upper-lower` (gym, intermediate, 3..4), `home-beginner-full-body` (home, beginner, 2..3), `home-intermediate-upper-lower` (home, intermediate, 3..4), `sport-beginner-complement` (sport, beginner, 2..2), `sport-intermediate-strength-prevention` (sport, intermediate, 2..2), tous disponibles.
```ts
// recommend-template.test.ts : 240 cas (5 objectifs × sportCode null|'football' × gym|home × 4 expériences × 2|3|4 jours)
// contexte attendu = goal === 'sport_support' && sportCode ? 'sport' : primaryPlaceKind ; niveau de l'expérience ; oracle écrit à la main :
// gym|home beginner : 2 → full-body 2 ; 3 → 3 ; 4 → 3 ['DAYS_ADJUSTED']
// gym|home intermediate : 2 → <contexte>-beginner-… 2 ['FEW_DAYS_FULL_BODY'] ; 3 → upper-lower 3 ; 4 → upper-lower 4
// sport beginner : 2 → sport-beginner-complement 2 ; 3 et 4 → 2 ['DAYS_ADJUSTED'] ; sport intermediate : idem avec sport-intermediate-strength-prevention
expect(EXPERIENCES.map(levelFromExperience)).toEqual(['beginner', 'beginner', 'intermediate', 'intermediate']);   // R-REC-2
// R-REC-1 : sport_support avec sportCode null, '' ou '   ' → contexte du lieu
const base = { goal: 'muscle', sportCode: null, primaryPlaceKind: 'gym', experience: 'gt_24_months', daysPerWeek: 2 };
expect(recommendTemplate(base, FAKE_TEMPLATES)).toEqual({ templateId: 'gym-beginner-full-body-ab', context: 'gym', level: 'beginner', daysPerWeek: 2, reasons: ['FEW_DAYS_FULL_BODY'] });
expect(recommendTemplate({ ...base, daysPerWeek: 4 }, withUnavailable(['gym-intermediate-upper-lower'])))
  .toEqual({ templateId: 'gym-beginner-full-body-ab', context: 'gym', level: 'beginner', daysPerWeek: 3, reasons: ['DAYS_ADJUSTED'] });   // R-REC-4
expect(recommendTemplate(base, withUnavailable(['gym-beginner-full-body-ab'])))
  .toEqual({ templateId: 'gym-intermediate-upper-lower', context: 'gym', level: 'intermediate', daysPerWeek: 3, reasons: ['FEW_DAYS_FULL_BODY', 'DAYS_ADJUSTED'] });
expect(recommendTemplate({ ...base, daysPerWeek: 4 }, withUnavailable(['gym-beginner-full-body-ab', 'gym-intermediate-upper-lower'])))
  .toEqual({ templateId: null, context: 'gym', level: 'intermediate', daysPerWeek: 4, reasons: ['NO_TEMPLATE_AVAILABLE'] });
// R-REC-5 : DAYS_ADJUSTED seulement si les jours changent ; propriétés fast-check : jours dans [min, max] d'un modèle disponible du bon contexte
//   (ou null + NO_TEMPLATE_AVAILABLE), contexte sport ⇔ sport_support et sportCode non vide, résultat déterministe
// onboarding.test.ts (R-ONB-2)
expect(ONBOARDING_STEPS).toEqual(['goal','sport','place_kind','place','experience','availability','health','ready']);
```

13 cas, entrée complète (`goal`, `experience`, `daysPerWeek`, `sessionMinutes`, `hasPrimaryPlace`, `lastValidatedStep`) ; `full` = (muscle, none, 3, 45, true).

| Entrée | `firstIncompleteStep` |
|---|---|
| (null, null, null, null, false, null) | `goal` |
| (muscle, null, null, null, false, `goal`) ; (muscle, null, null, null, false, `sport`) | `sport` ; `place_kind` |
| (muscle, null, null, null, false, `place_kind`) | `place_kind` |
| (muscle, null, null, null, true, `sport`) | `experience` |
| (muscle, none, null, null, true, `experience`) ; (muscle, none, 3, null, true, `availability`) | `availability` |
| `full` + `availability` ; `full` + `health` ; `full` + `ready` | `health` ; `ready` ; `ready` |
| `full` + `goal` (retour arrière) | `sport` |
| (null, none, 3, 45, true, `health`) ; (muscle, none, 3, 45, false, `health`) | `goal` ; `place_kind` |

```ts
expect(availableGoals('minor')).toEqual(['muscle','strength','fitness','sport_support']);   // E1, 02 §15 n°11
expect(availableGoals('adult')).toEqual(['muscle','strength','fat_loss','fitness','sport_support']);
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/domain test recommend-template onboarding` → `Failed to resolve import "../src/recommend-template"` (de même `onboarding`).

- [ ] **Step 3: Implement**

Libellés : `GOAL_LABELS` muscle « Prendre du muscle », strength « Gagner en force », fat_loss « Perdre du gras », fitness « Forme et santé », sport_support « Me renforcer pour mon sport » ; `EXPERIENCE_LABELS` none « Jamais », lt_6_months « Moins de 6 mois », 6_to_24_months « 6 mois à 2 ans », gt_24_months « Plus de 2 ans ».

`recommendTemplate`, dans cet ordre, sans paramètre d'âge ni de prudence (R-REC-6) : contexte `sport` si `sport_support` et `sportCode?.trim()`, sinon le lieu (R-REC-1) ; niveau `levelFromExperience` (R-REC-2) ; intermédiaire avec moins de jours que le `days.min` du descripteur intermédiaire du contexte, même indisponible → débutant + `FEW_DAYS_FULL_BODY` (R-REC-3) ; modèle indisponible → celui de l'autre niveau, et si lui aussi manque → `{ templateId: null, level: levelFromExperience(…), daysPerWeek: <demandé>, reasons: [...reasons, 'NO_TEMPLATE_AVAILABLE'] }` (R-REC-4) ; jours bornés à `[days.min, days.max]` du modèle retenu, `DAYS_ADJUSTED` s'ils changent (R-REC-5) ; `level` renvoyé = celui du modèle retenu.
`firstIncompleteStep` (`validated(s)` = `lastValidatedStep` d'index ≥ `s`) : `goal` nul → `goal` ; `!validated('sport')` → `sport` ; pas de lieu principal → `place_kind` ; `experience` nul → `experience` ; jours ou durée nuls → `availability` ; `!validated('health')` → `health` ; sinon `ready`.

- [ ] **Step 4: Run test to verify it passes**

Même commande → `Test Files  2 passed` (240 cas, cas ciblés, 3 propriétés, 13 cas d'onboarding) ; `pnpm typecheck`.

- [ ] **Step 5: Commit**

`git commit -m "feat(profil): recommendTemplate et reprise de l'onboarding"`

---

