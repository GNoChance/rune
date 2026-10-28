# Task 34 report: privacy, health, export, account deletion, counters and rejections

Status: DONE_WITH_CONCERNS (all green; concerns at the end)
Commit: 7f3d547 feat(privacy): confidentialité, accord santé, export, suppression, compteurs et rejets (Closes #35)
Review package: .superpowers/sdd/2026-10-06-socle/review-30484af..7f3d547.diff

## What I implemented

### features/privacy
- `PrivacySettingsPage` (`/profile/privacy`, back to `/profile`). It shows « Version en vigueur : 1.0 » and the link « Lire la page Confidentialité et règles » → `/privacy`. The consents list (`dl`) shows « Accord santé » and « Accord coach », each as « Donné le JJ/MM/AAAA » or « Non donné », read from `me.consents.health` and `me.consents.aiCoach`. With health consent: a « Retirer mon accord santé » button. Without it: a link « Donner mon accord santé » → `/profile/health`. The page also has `ExportButton` and « Supprimer mon compte ». After a withdrawal the button that opened the dialog is gone, so focus moves to the « Accords » heading.
- `ConsentWithdrawDialog` (title « Retirer l'accord santé »). It shows the verbatim list text, `ExportButton` « Télécharger mes données d'abord », the « Mot de passe » field, « Annuler » and « Retirer mon accord ». That last button is disabled without a password and submits the form, so Enter works too. It calls `repos.consent.withdrawHealth(password)` (T29): POST withdraw `{ type: 'health', password }`, then the 200 MeResponse goes to meta.me, then `purgeHealthData`, then a pull. On success the dialog shows « Accord retiré. Tes données de santé ont été effacées. » with « Fermer ». The dialog is remounted under a new key so it takes focus again. Error messages:
  - 401 `invalid_credentials`: « Mot de passe incorrect. »
  - `rate_limited`: the wait in minutes (`loginErrorMessage`).
  - Offline: « Nécessite le réseau ».
- `DeleteAccountDialog` (title « Supprimer ton compte ? »). It shows the verbatim list text and the P-DRT-6 Anthropic text, `ExportButton` « Télécharger mes données d'abord » (R-SUP-1), the password field, and « Supprimer définitivement », disabled without a password. It calls `repos.me.deleteAccount` (POST `/api/me/delete { password }`, then a wipe that includes the outbox), then navigates to `/login?reason=account_deleted` (replace). 409 `last_admin` shows « Tu es le dernier administrateur : nomme d'abord un autre administrateur. » and nothing is wiped.
- `ExportButton` (`label` defaults to « Télécharger mes données »). Before any request it calls `repos.status.pendingCount()`. When the count is above 0 it shows a warning (`Banner` warning, role status): « N éléments ne sont pas encore envoyés au serveur : ils ne figureront pas dans l'export. » (singular form for 1), with « Exporter quand même ». It then does `repos.me.exportData()` (GET `/api/me/export`) and `downloadJson(exportFileName(now()), data)`.
- `HealthReconsentGate`: `useLive(repos.consent.needsHealthReconsent())`.
  - The dialog « Le texte de l'accord santé a changé » shows `HEALTH_CONSENT_TEXT.text` with an unchecked checkbox, and only two buttons: « Je refuse » and « J'accepte ». « J'accepte » is disabled until the box is checked.
  - It has no close button, and Escape does nothing (stable no-op `onClose`).
  - « J'accepte » sends POST `/api/me/consents { type: 'health', textVersion: '1.0' }` (`grantHealth`).
  - « Je refuse » opens `ConsentWithdrawDialog`, which requires the password. Closing it without withdrawing brings the gate back. After a withdrawal the withdraw dialog stays until « Fermer », then nothing is shown.
  - The gate is hidden while `mustChangePassword` is set. App renders it on every connected screen (AppShell branch and the admin `not_found` branch), never on `/onboarding` or public pages.
- `HealthSection` (`/profile/health`, title « Santé », back to `/profile`).
  - Without consent: an « Accord santé » section with `HealthConsentPanel`, then `ScreeningQuestions record={false}` as a self-check (P-CST-2).
  - With consent: an h2 « Questionnaire de prudence ». It shows « Dernière réponse le JJ/MM/AAAA », « Indicateur de prudence : actif|inactif » and « Répondre de nouveau ». That button opens `ScreeningQuestions record` (PUT `/api/me/health-screening`) plus « Annuler », and focus returns to « Répondre de nouveau » when the questions close. If there is no answer yet, the questions show directly.
  - `LimitationsEditor editable headingLevel={2}`, plus the line « Ton accord santé se retire dans Confidentialité. » with a link.
  - Always: an h2 « Mode prudent » with `CautiousModeToggle` (PATCH training-profile `{ cautiousMode }`). The toggle shows the draft value until the profile is read back, is disabled while sending, and is imposed and disabled for a minor. Then `HealthWarning`.
- `messages.ts` (extra file): verbatim texts and `passwordActionError`.
- `privacy.module.css`.

### features/status
- `ConnectionStatus`, plus `CONNECTION_LABELS` (exact labels). It reads `useSyncState().connection` and renders `data-testid="connection-status"`, `data-state`, role status.
- `PendingCounter` and `RejectedCounter` (both in `PendingCounter.tsx`). Both read `useSyncState()`, following the controller ruling that counters come from the engine.
  - Pending: `data-count`, text « N en attente ».
  - Rejected: `data-count`. When N is above 0 it is a link « N refusé(s) » → `/rejections`, using `plural`. When N is 0 the element is empty and hidden by CSS `:empty`, with `data-count="0"`.
- `RejectionsPage` (`/rejections`, title « Éléments refusés »). It lists `repos.rejections.list()` (useLive) in a `ul` named « Éléments refusés ». Each item shows the code label (`REJECTION_CODE_LABELS`, falling back to the code itself), « Refusé le … » and « Ignorer » (`aria-describedby` set to the label), which calls `repos.rejections.dismiss(id)` (T29, atomic). An empty list shows « Aucun refus. ».
- `SettingsPage` (`/settings`, « Réglages », section « Stockage »):
  - granted: « Stockage persistant : accordé »
  - refused: « Stockage persistant : refusé », then the advice text and a link « Télécharger mes données » → `/profile/privacy`
  - absent: « Stockage persistant : pas encore demandé »

### ui
- `download.ts`:
  - `exportFileName(nowMs)` returns `appsport-export-${parisDate}.json`.
  - `downloadJson`: a `Blob` with the JSON indented by 2, a hidden `<a download>` appended, clicked and removed, then `revokeObjectURL` after 40 s (Safari cancels a download whose blob: URL is revoked too early; 40 s is the FileSaver.js value).
  - Exported from `ui/index.ts`.
- `AppShell`: a status zone in the header with `ConnectionStatus`, `PendingCounter` and `RejectedCounter`. The onboarding (`PublicShell`) has none.

### Changes to earlier code (needed by the brief)
- `features/onboarding/LimitationFields.tsx` (new). It holds:
  - `LimitationFields`: the zone, side, severity and note fields, extracted from `LimitationsEditor` with no DOM change.
  - `limitationLabel`: « Genou · Gauche · Légère », from the contract labels.
  - `LimitationEditForm`: a form named « Modifier : <label> » that keeps the values from when it was opened. « Enregistrer » sends only the fields changed since opening (PATCH `/api/me/limitations/:id`) and sends nothing if none changed. « Annuler » closes it. Focus goes to « Zone » on open and back to « Modifier » on close. Errors (for example 403 `health_consent_required` → « Cette action demande ton accord santé. ») stay inside the form.
- `LimitationsEditor` (T31) gains optional `editable` and `headingLevel` props. Their defaults leave the onboarding unchanged.
- `app-services.tsx`: new `whenSignedOut(db, timeoutMs = 2000)`, used by `handleAccountDeleted` and by `MeRepo.deleteAccount` after the wipe. See the bug below.

## Bug found and fixed (P-DRT-4)
Navigating to `/login?reason=account_deleted` right after the wipe lost the reason. The guard still saw the cached `me`, so it bounced `/login` → `/`, then `/` → `/login` once meta.me disappeared. The logged visits were `["/profile/privacy","/login?reason=account_deleted","/","/login"]`. As a result, « Ce compte a été supprimé » was not shown after a 410 `account_deleted` on GET /api/me (another device), nor after deleting from this device. Now the navigation waits until the observed meta.me query (the same one the guard reads) sees no user. If nobody observes it, it continues immediately; otherwise it gives up after 2 s.

## TDD evidence

RED (before any implementation): `pnpm --filter @appsport/web test privacy/ status/counters status/rejections-settings`
```
FAIL test/privacy/export-delete.test.tsx  Error: Failed to resolve import "../../src/ui/download"
FAIL test/status/counters.test.tsx        Error: Failed to resolve import "../../src/features/status/ConnectionStatus"
FAIL test/status/rejections-settings.test.tsx Error: Failed to resolve import "../../src/features/status/RejectionsPage"
× health-section (9 tests): Unable to find role="heading" and name "Santé"     (route absent → NotFound)
× withdraw (13 tests):      Unable to find role="heading" and name "Confidentialité" / dialog « Le texte de l'accord santé a changé »
Test Files  5 failed (5)
     Tests  22 failed | 3 passed (25)
```
These failures were expected: the modules, routes and `data-testid` did not exist yet. The 3 tests that passed check that something is absent (no gate for '1.0', for an inactive consent, or on /onboarding).

Second RED (the bug, during the first GREEN attempt):
- `export-delete` › « POST /api/me/delete … » failed with `expected '/login' to be '/login?reason=account_deleted'`.
- « GET /api/me → 410 account_deleted » failed the same way.

Both passed after `whenSignedOut`. The 3 unit tests in `test/app/when-signed-out.test.tsx` were written after that fix.

Third RED (the edit form keeps its opening values): I added the test « seuls les champs changés depuis l'ouverture partent, même après une relecture ». I ran it with `const l = p.limitation` (1 failed: the form changed under the user after the mirror was read back), then with `const [l] = useState(p.limitation)` (10 passed).

GREEN:
- `pnpm --filter @appsport/web test privacy/ status/ app/when-signed-out`: Test Files 9 passed (9), Tests 85 passed (85).
- `pnpm lint`: Checked 390 files, no fixes applied, 0 errors.
- `pnpm typecheck`: exit 0.
- `pnpm test`: Test Files 138 passed (138), Tests 1595 passed | 2 skipped (1597). No warnings and no stderr in the output.

## Tests (files)
- `test/status/counters.test.tsx`:
  - each `connection-status` state (data-state and exact text), and live update from the engine
  - the header carries all 3 indicators; none during onboarding
  - pending '0' then '3' via `sync.set`, text « 3 en attente »
  - rejected: a `sync_rejection` row seeded and counted by the real engine (offline) → '1 refusé', link `/rejections` that navigates
  - '2 refusés'
  - 0 → empty and no link
- `test/status/rejections-settings.test.tsx`:
  - the 6 labels
  - r-1 « Données invalides » and op-7 deadletter « Élément parent refusé »
  - an unknown code is shown as-is
  - « Ignorer » r-1 → outbox op `{ entity: 'sync_rejection', id: 'r-1', kind: 'patch', fields: { dismissedAt: '2026-10-06T12:00:00.000Z' } }`, item removed, `rejected-counter` '2' → '1' (real engine)
  - local rejection ignored with no op, counter '0'
  - « Aucun refus. »
  - Réglages: granted, refused (advice + link `/profile/privacy`), absent
- `test/privacy/withdraw.test.tsx`:
  - Confidentialité page: version, link, consents, buttons; without consent, « Non donné » and the link to Santé
  - Withdraw dialog: texts and export offer, button disabled without a password, focus stays in the password field while typing (the T33 note about inline `onClose`)
  - 200: message, meta.me inactive, `dumpLocalDb` no longer contains 'TEMOIN-C2', one pull, then « Fermer » and focus on the « Accords » heading
  - 401: « Mot de passe incorrect. », mirror intact; offline: « Nécessite le réseau », nothing purged; « Annuler » sends no request
  - Gate: texts, unchecked box, exactly 2 buttons, Escape does nothing
  - Gate « J'accepte » → POST and the gate lifts; « Je refuse » → withdraw dialog, cancel → the gate comes back
  - Gate refusal then withdrawal: message, then no gate
  - No gate for '1.0' or an inactive consent, nor on /onboarding; the gate shows on /profile/privacy, with a single dialog
- `test/privacy/export-delete.test.tsx`:
  - `exportFileName`, including the Paris date-change edge case
  - `downloadJson`: indented JSON Blob, one click while attached, link removed, URL revoked later
  - Export with 2 pending ops: warning and no request, then « Exporter quand même » → `download='appsport-export-2026-10-06.json'`, `createObjectURL` called once
  - Export with 1 pending op: singular message; empty queue: download on the first click; offline: no download
  - Delete dialog: texts, export button, confirm disabled without a password, export from inside the dialog
  - Delete 204: outbox emptied, meta.me absent, `/login?reason=account_deleted`, « Ce compte a été supprimé »
  - Delete 409 `last_admin`: message and nothing wiped; 401: message; focus kept in the password field
  - 410 `account_deleted` on GET /api/me: everything wiped including the outbox, redirect and message; 410 `watermark_expired`: nothing wiped
- `test/privacy/health-section.test.tsx`:
  - Without consent: panel, self-check, then grant → recorded questions and « Limitations » h2
  - With consent: « Dernière réponse le 01/10/2026 », « Genou · Gauche · Légère »
  - « Répondre de nouveau » → PUT `{ answers: [false×4], questionnaireVersion: '1.0' }`
  - « Supprimer » → DELETE `{}`
  - « Modifier » → PATCH `{ severity: 'severe' }`, with form values prefilled and focus returned
  - Opening values kept after a re-read; no change → no request
  - 403 → message and the form stays open
  - Toggle → PATCH `{ cautiousMode: false }`; for a minor it is disabled and checked
- `test/app/when-signed-out.test.tsx`: unobserved → resolves at once; observed → resolves after the wipe; never wiped → resolves after the timeout.

## Self-review
- Screens never touch Dexie and never read `navigator.onLine`. Connection state comes from `useSyncState`. The architecture test passes.
- All copy uses the straight apostrophe. The brief's texts are used verbatim. Limitation labels are capitalised and come from the contracts.
- Dialogs follow the `ActionDialog` pattern from T33:
  - stable `onClose` reference (no focus stolen from the password field on each render; tested)
  - Escape and « Annuler » do nothing while a request is in flight
  - focus goes back to the trigger (`useRestoreFocus`)
  - each opening starts empty (nothing is mounted while closed)

## Concerns
1. Rejected counter source. The brief said `useLive(() => repos.rejections.count())`, but the controller ruling (counters from the engine) took precedence, so `RejectedCounter` reads `SyncState.rejected`. That value is refreshed at the end of each engine cycle. After « Ignorer », the dismissal triggers a « mutation » sync, so the counter updates at the end of that cycle (up to `SYNC_TIMEOUT_MS` when the network hangs), while the list updates immediately.
2. Files outside the brief's list:
   - `features/privacy/messages.ts`
   - `features/onboarding/LimitationFields.tsx`
   - edits to `LimitationsEditor` (T31): `editable` and `headingLevel` props, fields extracted with no change in onboarding
   - `whenSignedOut` in `app-services.tsx` and its use in `MeRepo.deleteAccount` (T28/T29)
   - `test/app/when-signed-out.test.tsx`
3. Cross-feature imports: privacy imports `useRestoreFocus` from `features/admin/admin-ui.tsx` and `loginErrorMessage` from `features/auth/messages.ts`. Moving `useRestoreFocus` into `ui/` would be cleaner but would modify T33 code. `AppShell` (ui) imports the status components (features/status), which the brief asks for.
4. Choices the brief did not specify, open to review:
   - titles: « Retirer l'accord santé », « Supprimer ton compte ? », « Éléments refusés », « Réglages »
   - the gate's sentence « Relis le nouveau texte. Refuser revient à retirer ton accord : tes données de santé seront effacées. »
   - « Indicateur de prudence : actif|inactif »
   - « Un fichier JSON avec tout ce qu'appsport garde sur ton compte. »
   - a rejection shows « Refusé le … » without the raw entity name
   - the rejected counter is empty when N = 0

---

# Fix round 1 (review findings T34-F1 … T34-F21)

Status: DONE_WITH_CONCERNS (all green; concerns at the end)

Commits on socle, after 7f3d547. Each message ends with « Refs #35 » and the Co-Authored-By trailer.
- 62f48f0 fix(status): détail de chaque refus et phrase d'introduction seulement s'il y en a (F1, F13)
- 911a774 fix(privacy): porte de réacceptation levée en ligne, modale pour de vrai, dialogues défilants (F2, F3, F9, F10)
- 05b6dc8 fix(privacy): file d'envoi illisible, l'export avertit avant de partir (F4)
- 3d86018 fix(privacy): Santé, un formulaire de limitation à la fois et questionnaire d'alerte confirmé (F5, F7, F12, F14, F19)
- ad5c572 test(privacy): témoin C2 partout, état final après suppression, révocation à 40 s, attente annoncée (F15, F16, F20, F21)

## Changes per finding

- **F1 (R-SYN-18).** `RejectionsPage` now shows each rejection's detail, without any values:
  - the entity label (`ENTITY_LABELS`; an unknown entity falls back to its raw name);
  - the operation: `create` → création, `patch` → modification, `delete` → suppression, `restore_upsert` → restauration;
  - the field names, read from the real detail shapes (server `{ kind, fieldNames, reason }`, deadletter `{ kind, fieldNames }`).

  Example: « Lieu · modification · champs : name, note ». A missing or unknown detail shape shows only what is readable (the entity alone). The new exported function is `rejectionDetail(r)`. The element that « Ignorer »'s `aria-describedby` points to now wraps the code, the detail and the date, with spaces between them, so each « Ignorer » has its own description.
- **F13.** The intro « Le serveur a refusé ces modifications… » is rendered only when the list is not empty.
- **F2.** `Dialog` can no longer grow taller than the screen:
  - `.dialog` gets `max-height: 100%`, relative to the fixed backdrop;
  - the title and `.actions` are `flex: none`;
  - the body (new `.dialogBody`) scrolls (`overflow-y: auto`, `min-height: 0`, `overscroll-behavior: contain`), with 4 px of padding and a matching negative margin so focus outlines are not clipped.

  Checked in headless Chrome, before and after, with static mocks of the gate at 667×375 and of the delete dialog (with the export warning) at 375×550. Before, the title and the actions were cut off. After, both stay visible and the content scrolls between them.
- **F3.** `HealthReconsentGate` reads `useSyncState().connection`, never `navigator.onLine`.
  - The gate rises only when the connection is `online` (latched in state).
  - Once raised, it stays until the user accepts or withdraws, as the controller ruling requires.
  - If the connection drops while the gate is shown, a warning Banner « Nécessite le réseau » appears and both « Je refuse » and « J'accepte » are disabled until the engine is back online.
  - Offline at launch, there is no gate: the app stays usable under the still-active consent.

  This is the finding's preferred option, plus its minimum option for the case where the network drops after the gate has risen.
- **F9.** New `ui/inert-outside.ts`, `inertOutside(root)`:
  - it sets `inert` and `aria-hidden="true"` on every sibling of the dialog backdrop and of each of its ancestors, up to `body`;
  - holds are counted, so stacked dialogs work;
  - elements the page already hides, and script/style nodes, are left alone;
  - it returns an undo function.

  `Dialog` gains an opt-in `inertOutside` prop. It is applied in a layout effect, so the page is reachable again before `useRestoreFocus` (a passive cleanup) puts focus back on the trigger. A dialog that ends up under an inert-making dialog ignores Escape and Tab while it is inert. The gate and `ConsentWithdrawDialog` (both its form state and its « done » state) pass `inertOutside`.
- **F10.** Tests only; the behaviour was already correct. See Tests.
- **F4.** `ExportButton` no longer treats a failed outbox read as an empty outbox. It shows « Impossible de vérifier les éléments non envoyés : ils pourraient manquer dans l'export. » (warning Banner, role status) with « Exporter quand même », and sends nothing before that click.
- **F5.** In `LimitationsEditor`, while a « Modifier » form is open, including during its save, the other « Modifier » buttons are disabled. A slow save can therefore no longer close another limitation's form, and its error can no longer be lost. If the limitation being edited disappears from the list (deleted elsewhere), `editing` is reset and the other buttons are freed.

  I chose the finding's second option (disable the others) rather than a scoped `closeEditor(id)`: with the buttons disabled, a second form can never be open, so a scoped close would be unreachable code.
- **F7.** `ScreeningSection` drops the `returnFocus` flag. When the questions close (saved, re-read before the PUT returns, or « Annuler »), an effect keyed on the « questions shown » transition moves focus to « Répondre de nouveau » if focus was lost (`activeElement` is body or null). If the user has moved focus elsewhere in the meantime, it stays there. The initial load never moves focus.
- **F12.** After a save, the summary shows an info Banner (role status) « Réponses enregistrées. » until the next « Répondre de nouveau ».
- **F14.** The h2 is now « Questionnaire d'alerte », as in the glossary. Without consent, the self-check (`ScreeningQuestions record={false}`) has its own h2 « Questionnaire d'alerte » section, after the « Accord santé » section.
- **F15, F16, F19, F20, F21.** Tests only. See Tests.

## Tests (new or changed)

### `test/status/rejections-settings.test.tsx`
- Fixtures now use the real detail shapes.
- New: « chaque refus montre son détail ». Server rejection r-1, deadletter op-7 with a detail, deadletter op-8 without one (→ « Lieu »).
- New: « deux refus de même code : chaque « Ignorer » est décrit par son propre détail ». Uses place, gym and an unknown entity `quota`, and checks the full description `Données invalides Lieu · création · champ : name Refusé le …`.
- The intro is present when there are rejections and absent next to « Aucun refus. ».

### `test/privacy/withdraw.test.tsx`
- Gate offline at launch: no gate and the page stays usable, also while the connection is `unknown`. The gate rises once the connection is `online`.
- Gate raised, then the connection drops: the gate stays, a status shows « Nécessite le réseau », both buttons are disabled, and both are enabled again once online.
- F10: « J'accepte » with the request failing offline. The alert « Nécessite le réseau » appears inside the gate, the gate is still there after settle, and meta.me textVersion is still '0.9'.
- F9: gate on /profile/health. « Ajouter une limitation », « Répondre de nouveau » and the main navigation are inert and missing from the accessibility tree; all three come back after acceptance.
- F15: `seedHealth` now also writes, directly into Dexie:
  - a pending `limitation` create op with `note: WITNESS`;
  - a `limitation` deadletter whose detail contains WITNESS.

  `witnessStores(db)` lists the stores that contain the witness: `['deadletter','limitation','outbox']` before the withdrawal and `[]` after, and the `health_screening` and `limitation` mirrors are empty. The 401, offline and 429 tests check that all three stores are kept.
- F15, new gate test on /profile/health: the witness note is visible behind the gate, the page is inert behind the withdraw dialog, and after the withdrawal the note is gone from the screen and from every store.
- F21: 429 `rate_limited` with `retryAfterS: 90` → « Trop de tentatives. Réessaie dans 2 min. »

### `test/privacy/export-delete.test.tsx`
- F4: unreadable outbox (`db.outbox.where` throws) → warning, no request and no download; then « Exporter quand même » downloads.
- F10: delete while offline → « Nécessite le réseau ». The outbox count is unchanged, meta.me is kept, the location stays `/profile/privacy`, the dialog stays open and the engine is restarted (`sync.started`).
- F16: both account-deleted tests now call `expectAccountDeletedScreen`. After `settle()` it checks that:
  - the location is still `/login?reason=account_deleted`;
  - `visits()` never contains `/`;
  - the last visit is the target;
  - the message is shown.
- F20: `revokeObjectURL` is not called right after the click nor after 39 999 ms, and is called exactly once at 40 000 ms.

### `test/privacy/health-section.test.tsx`
- F19: screening `answeredAt` 2026-10-03 with consent at 2026-10-01 → « Dernière réponse le 03/10/2026 » and « Indicateur de prudence : inactif », inside the « Questionnaire d'alerte » section.
- F12: answering again → status « Réponses enregistrées. » in the summary, focus on « Répondre de nouveau ». The banner is gone on reopen and after « Annuler ».
- F7: first questionnaire (no screening yet). The PUT handler writes the mirror row and lets React re-render (`settle()`) before answering. Focus still reaches « Répondre de nouveau » and the confirmation is shown.
- F5, with limitations l-1 and l-2:
  - opening l-1 disables l-2's « Modifier », which stays disabled while the PATCH hangs;
  - after the response, l-1's form closes, focus returns to l-1's « Modifier », and l-2's button is enabled;
  - if l-1 is deleted elsewhere while its form is open, l-2's « Modifier » is freed.
- F14: without consent, the consent checkbox is in « Accord santé » and the self-check text is in « Questionnaire d'alerte », not in « Accord santé ».

### `test/app/ui.test.tsx` (F9)
- `inertOutside`: the header and the siblings are inert and aria-hidden, an element that was already aria-hidden is left untouched, and everything is restored on close.
- Stacked dialogs: the dialog underneath ignores Escape and Tab while it is inert, and handles Escape again after the top one closes.
- Two strict dialogs: an element stays inert as long as one of them still holds it.

## TDD evidence

RED runs, before the fix, with the same commands:
```
pnpm --filter @appsport/web test status/rejections-settings
  × chaque refus montre son détail : type de donnée, opération et champs (R-SYN-18)
  × deux refus de même code : chaque « Ignorer » est décrit par son propre détail
  × aucun refus → « Aucun refus. »
  TestingLibraryElementError: Unable to find an element with the text: Lieu · modification · champs : name, note.
  AssertionError: expected 'Données invalides' to contain 'Lieu · création · champ : name'
  AssertionError: expected <p></p> to be null
  Tests  3 failed | 13 passed (16)

pnpm --filter @appsport/web test privacy/withdraw privacy/export-delete
  × hors ligne à l'ouverture : pas de porte, l'appli reste utilisable ; elle se lève une fois en ligne
  × porte levée puis réseau perdu : elle reste, « Nécessite le réseau » affiché et ses deux boutons désactivés
  × modale pour de vrai : le reste de la page est inerte et caché tant que la porte est là
  AssertionError: expected <div role="dialog" …(4)>…(3)</div> to be null
  TestingLibraryElementError: Unable to find an accessible element with the role "status"
  AssertionError: expected null not to be null
  Tests  3 failed | 32 passed (35)
  (the two F10 tests passed at once: the behaviour was right, only the tests were missing)

pnpm --filter @appsport/web test privacy/export-delete
  × file illisible : avertissement, rien ne part avant « Exporter quand même »
  TestingLibraryElementError: Unable to find an element with the text: Impossible de vérifier les éléments non envoyés : ils pourraient manquer dans l'export..
  Tests  1 failed | 15 passed (16)

pnpm --filter @appsport/web test privacy/health-section
  × accord proposé (case décochée) et auto-vérification … (self-check inside « Accord santé »: expected true to be false)
  × dernière réponse (date du questionnaire, pas de l'accord) … (no « Questionnaire d'alerte » heading)
  × « Répondre de nouveau » → PUT … (Unable to find an accessible element with the role "status")
  × premier questionnaire relu avant la fin de l'envoi … (Error: until: condition jamais remplie, focus never reached « Répondre de nouveau »)
  × « Modifier » ouvert ou en cours d'envoi … (expected false to be true)
  × limitation en cours de modification supprimée ailleurs … (expected false to be true)
  Tests  6 failed | 7 passed (13)   (5 failed | 8 passed after renaming the h2 alone, to isolate F7, F12 and F5)
```

Some tests passed at once, either because the behaviour was already right or because the test was written after the code. Each was checked with a temporary mutation. Every mutation was reverted, and `git status` showed only the intended files before each commit.
- Dialog key guard removed → « Dialog inertOutside par-dessus un autre dialogue » fails (`expected [ 'dessous', 'dessus' ] to deeply equal [ 'dessus' ]`).
- Hold counting removed → « Dialog inertOutside empilés » fails.
- `deleteAccount` wiping before the request, and `grantHealth` writing meta.me before sending → both F10 tests fail (outbox `expected +0 to be 2`; no alert).
- F19: the summary date forced to the consent date → `Unable to find … Dernière réponse le 03/10/2026`.
- F15, F16, F20 and F21, mutated together in one run:
  - `purgeHealthData` limited to the mirrors;
  - `whenSignedOut` removed from `deleteAccount` and `handleAccountDeleted`;
  - the URL revoked right after the click;
  - the `rate_limited` branch removed.

  Result: 7 tests fail. Among the failures: `expected [ 'deadletter', 'outbox' ] to deeply equal []`, `expected "revokeObjectURL" to not be called at all`, `expected '/login' to be '/login?reason=account_deleted'` (twice) and `expected 'Trop d'essais. Réessaie plus tard.' to be 'Trop de tentatives. Réessaie dans 2 m…'`.

GREEN:
- `pnpm --filter @appsport/web test privacy/ status/ app/ui onboarding` → Test Files 14 passed (14), Tests 168 passed (168)
- `pnpm lint` → Checked 391 files in 214ms. No fixes applied. (0 errors, 0 warnings)
- `pnpm typecheck` → exit 0
- `pnpm test` → Test Files 138 passed (138), Tests 1611 passed | 2 skipped (1613); no warning and no stderr in the output
- `git show --stat HEAD` → ad5c572, the 2 test files. `git status` → clean. `git diff --stat 7f3d547 HEAD` → 14 files, +709 −114.

## Concerns

1. **F2, recette items not added.** They belong in `docs/exploitation/recette-telephones.md`, which T45 creates and which sits under `docs/`, where I may not write. Suggested items for T45:
   - « Porte de réacceptation en paysage (667×375) : titre et “J'accepte” / “Je refuse” visibles, texte défilant »
   - « Suppression du compte avec éléments en attente, portrait iPhone SE : titre et “Supprimer définitivement” visibles »
2. **F9, `inertOutside` is opt-in**, used by the gate and the withdraw dialog only. Making it the default for every `Dialog` would be better for accessibility, but it would change the T32 and T33 dialogs. Eight of their tests query the page behind an open dialog by role and would need `{ hidden: true }`: members (6), places (1) and the ui Dialog test (1). That choice is the controller's.
3. **Observation, not fixed.** After an account deletion the visits are `["/profile/privacy","/login","/login?reason=account_deleted"]`. As soon as the guard sees no user it redirects to `/login`, and the screen then replaces that with the URL carrying the reason. The final state is right, and it is now tested, but the plain login screen can flash for one frame before « Ce compte a été supprimé » appears. The same happens after a 410 `account_deleted` on GET /api/me.
4. **`ENTITY_LABELS` covers the socle entities only.** Later bricks that add J entities should extend it; until then the raw entity name is shown. Field names are shown raw (for example `dismissedAt`), as the finding suggested.
