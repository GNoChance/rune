# Balayage des points reportés — T30 à T45

Ce document balaie les points mineurs reportés pendant les tâches T30 à T45 du socle (avant
la refonte Rune). Chaque point est marqué `corrigé`, `rendu caduc par la refonte` ou
`fermé : <raison>`, selon la spec de la Task 15 du plan `docs/superpowers/plans/2026-10-13-refonte-rune.md`.

**Source** : `.superpowers/sdd/2026-10-06-socle/progress.md`, conservée sur la branche
`archive/notes-locales` (notes de travail restées en local, commit `b0a068e`).

**Méthode** : Option C (balayage intermédiaire validée par le propriétaire 2026-10-28) —
les points qui touchent les zones réécrites par la refonte (Tasks 0-13 du plan) sont groupés
en « rendu caduc par la refonte » ; les points explicitement nommés par la spec de la Task 15
(flaky web tests, T38-F3, rulings T45) et les points qui restent potentiellement actifs
(infrastructure, backups, CI) sont documentés en détail.

---

## Points traités en détail

### T38-F3 — Codes et liens d'invitation dans les journaux et traces CI

**Statut : corrigé** (Task 15 Step 4)

Les tests E2E utilisent `admin:bootstrap --birth-date` qui émet « Lien : » et « Code : »
sur stdout, et les URLs d'invitation contiennent le code en fragment (`/invite#XXXX-XXXX-XXXX-XXXX`).
Playwright capture ces lignes dans le journal (`LOG_TAIL_LINES`), les traces (`retain-on-failure`)
et le reporter HTML en CI.

**Masquage ajouté** dans `apps/web/e2e/support/sanitize.ts` (`maskInvitation`, `containsInvitationCode`).
Appliqué dans :
- `apps/web/e2e/support/server.ts::startBackend` (log tail du backend)
- `apps/web/e2e/support/server.ts::bootstrapAdmin` (erreur sur CLI échoué)

**Test du harnais** : `apps/web/test/e2e-harness/sanitize.test.ts` (7 assertions couvrant lien,
ligne « Code : », code nu, lignes mélangées, faux positifs, lettres non-Crockford, détection pour
assertions E2E).

**Limitation connue** : les traces Playwright peuvent encore contenir une URL de page observée
par le navigateur (`page.url()` avec fragment). Un masquage côté reporter/trace demandera une
étape supplémentaire au Task 16 si la revue finale le juge nécessaire.

### Tests web instables (profile-page, withdraw, places-page)

**Statut : corrigé** (vérifié stable 5× consécutifs sur socle `9cc7579`)

Les 3 fichiers nommés par la spec passent 5 fois de suite sans échec (RUN_1_EXIT=0 à
RUN_5_EXIT=0, loop du 2026-10-28). Les flakies notés en T37 et T41 (focus sur `profile-page`,
« Je refuse » sur `withdraw`) ont été résolus par les refactors successifs apportés via
socle-coach, socle-profil et socle-ecrans ; les tests actuels ont été réécrits pendant la
refonte.

### T45-F32, T45-F42, T45-F51 (rulings propriétaire)

**Statut : corrigé** (Task 14, commit `c87ef0e fix(ops): enveloppe de secours dite,
sauvegardes effacées à l'arrêt, admin réactivé et déploiements ratés visibles`)

- **T45-F32** : la fiche de traitement et la page Confidentialité disent désormais qu'une
  copie scellée (R-OPS-14) est confiée à une personne de confiance majeure.
- **T45-F42** : l'arrêt définitif (P9) supprime les sauvegardes (B2 offsite, dépôt restic
  local, instantanés) après l'export final de chaque membre.
- **T45-F51** : `admin:reset` réactive désormais un admin désactivé (accès à l'hôte = pleine
  confiance), avec test.

### T32 — « Exporter mes données » cassé en forced password

**Statut : rendu caduc par la refonte** (socle-profil, Task 10)

Le flot de changement de mot de passe forcé a été refondu : la page de forced password n'affiche
plus le lien « Exporter mes données » cassé ; l'export est accessible via `Profil → Confidentialité
et données` après connexion normale. Le minor noté le 2026-10-08 n'a plus d'objet.

---

## Points rendus caduc par la refonte (groupés)

Les points ci-dessous concernaient le socle **avant la refonte Rune** (identité, thèmes,
navigation, Profil, administration, salles, écrans d'accès). La refonte (Tasks 0-13) a
réécrit ou profondément restructuré ces zones ; les minors d'origine ne s'y appliquent plus
et sont fermés avec le statut `rendu caduc par la refonte`. Si une régression de même nature
apparaît à la revue finale (Task 16), ouvrir un nouveau ticket plutôt que de reprendre le
minor historique.

- **T30** F5, F7, F11, F13, F14, F15 (session reopened without /login bounce, P-AUT-6 warning
  before reset, fragments, logout dialog — tout refondu par socle-coach et socle-profil)
- **T31** nouveau minor identifié en T31-F23 (bootstrap link dans un rapport implementer,
  règle `implementer-common.md` déjà en place) — fermé : règle de documentation en place
- **T35** F17, F18 (chunk > 500 kB, PWA manifest) — manifest et icônes refaits par Task 2
- **T36** F12, F13, F14, F19 (SW et kill-switch) — rejoués par la refonte
- **T37** F9, F10, F11, F12, F15, F18, F20 + minor du remount test — SW et PWA refaits
- **T38** F7 (proxy port collision, ::1 listen ignored), F15 (helpers T39), F18 (Windows output),
  cleanup rmSync minor — zones harness stables, hors spec Step 4

## Points potentiellement actifs (hors scope refonte, à suivre)

Les points ci-dessous touchent des zones **non modifiées par la refonte** (infrastructure,
backups, CI). Ils ne sont ni corrigés ni rendus caduc : ils sont **reportés à la revue finale**
(Task 16) ou à des tickets de suite.

- **T39-F4, F5, F11, F13** — `fermé : hors scope refonte` ; mesure global-setup 3 builds vs
  budget CI 30 min, à vérifier au premier run CI post-fusion.
- **T40 F6, F7, F8, F11, F12, F14** + 2 new minors — `fermé : hors scope refonte` ; concernent
  les scénarios de backup/restore côté ops, couverts partiellement par Task 14 (c87ef0e).
- **T41-F11** (cap_drop ALL / no-new-privileges), **T41-F15** (content copy never read) —
  `fermé : hors scope refonte` ; infrastructure Docker non modifiée.
- **T42-F6** (Dependabot bumps turn pinned-version tests red) — `fermé : follow-up ouvert` ;
  à traiter au premier bump réel.
- **T43-F14, F18, F22** + 2 re-review minors (unlock.bats sleep pattern, Ctrl-C after
  successful deploy) — `fermé : hors scope refonte`.
- **T43 fix-round-1 group-4 uncommitted** (F8, F9, F17, F20, F23, F24, F26) — `fermé :
  travail abandonné, voir task-43-g4-uncommitted.diff sur archive/notes-locales si à
  réappliquer en Task 16`.
- **T44-F4, F5, F20** — `fermé : hors scope refonte`.

---

## À vérifier au premier run CI distant post-fusion socle

- Les 3 fichiers tests nommés (`profile-page`, `withdraw`, `places-page`) stables **sur
  l'hôte CI** (ils peuvent flapper différemment sur un runner GitHub Actions ; la stabilité
  5× a été constatée en local Windows).
- Aucune ligne de journal ni trace Playwright uploadée en artefact ne contient `#` suivi d'un
  code d'invitation (regex `[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}`).
- Temps du global-setup Playwright ≤ 30 min (T39-F11/F13).
