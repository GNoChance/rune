## Global Constraints — Rune redesign (verbatim from the plan)

- Branche `socle`, un commit (ou plusieurs) par tâche, messages en français au format du dépôt (`feat(web): …`, `fix(server): …`), trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` verts à la fin de chaque tâche ; E2E (`pnpm --filter @rune/web test:e2e`) verts pour les tâches qui touchent un parcours E2E.
- CSP inchangée : `default-src 'self'` — aucune ressource externe (polices embarquées), aucun `<script>` inline, aucun `dangerouslySetInnerHTML`, aucun `style="…"` en HTML statique (les props `style` de React sont permises).
- Plus rien ne s'appelle appsport (décision du 2026-10-13, tâche 0) : affichage « Rune », code `rune` (paquets `@rune/*`, en-têtes `X-Rune-*`, variables `RUNE_*`, chemins `/srv/rune`, image `ghcr.io/gnochance/rune`, dépôt `GNoChance/rune`). Seuls `docs/superpowers/` et `docs/research/` gardent l'ancien nom par historique ; dans ces documents (et dans les règles du socle citées plus bas), lire « rune » partout où un identifiant dit « appsport ». Aucun script du dépôt ne contient de chemin hors dépôt.
- Apostrophe droite `'` dans tous les textes ; tutoiement ; textes légaux (consentement santé, avertissement santé, ligne d'écoute) mot pour mot, seule substitution « appsport » → « Rune ».
- Accessibilité : rôles et noms accessibles existants conservés ; cible tactile ≥ 44 px ; contrastes ≥ 4,5:1 (texte) et 3:1 (grand texte, éléments d'interface) dans les 5 thèmes ; `prefers-reduced-motion` respecté.
- Animations : 150–250 ms (retour de geste), 300–450 ms (écran), 600–1 200 ms (célébration) ; courbe unique `cubic-bezier(.2,.8,.2,1)`.
- Le coach : textes écrits à l'avance, étiquetés, jamais de chiffre nutritionnel, jamais d'indicateur « en train d'écrire ».
- Aucune fausse donnée à l'écran : avant-goûts à 0 / rang E, pas de valeur inventée.
- Maximum 5 agents en parallèle ; une tâche ne modifie que les fichiers de sa liste (plus les tests qu'elle met à jour pour un texte changé).

## Still binding from the socle (unchanged by the redesign)

The socle's global constraints keep applying to everything outside the look: `C:\Users\eliott.colin\appsport\.superpowers\sdd\2026-10-06-socle\global-constraints.md` (read the lines on HTTP headers and CSP, CSRF, API error format, admin and other users' data (404, never C1–C3 in `/api/admin/*`), sync classes and the « Nécessite le réseau » rule, the connected state never from `navigator.onLine`, PWA update banner rules (never during onboarding or a session), tests (no Dexie access from screens, only `repos/`), SQLite rules (STRICT, CHECK enums, migrations in a transaction, `entityRules` covers every column)).

## Redesign values every task relies on (from the spec)

- Themes: `auto` (default, follows `prefers-color-scheme`), `clair`, `sombre`, `carnet`, `nuit`; stored per device in localStorage key `rune.theme`; a forced theme always wins over the phone setting.
- Fonts: Chakra Petch 600/700 (titles, numbers, ranks, Système voice), Barlow 400/500/600 (text), Newsreader 600 (Carnet titles only); embedded woff2 latin subsets, precached.
- Tabs: Accueil `/` · Progression `/progression` · Salles `/places` · Profil `/profile`; active tab `aria-current="page"`; side navigation at ≥ 900 px, content ≈ 960 px max.
- Profile hub groups: Entraînement (Mon profil, Mon coach, Mes lieux, Santé) · Compte et appli (Confidentialité et données, Réglages with a badge when there are sync refusals, Aide) · Cercle (Administration, admin only) · « Se déconnecter » apart at the bottom. Crédits move into Aide.
- Coaches: `ombre` (L'Ombre), `skald` (Le Skald), `scribe` (Le Scribe); chosen at onboarding step 1 of 9; texts are scripted, labelled « Aujourd'hui », « Aperçu » or « Message d'accueil ».
- Onboarding 9 steps: coach, objectif, sport, type de lieu, lieu, niveau, disponibilité, santé, prêt; advance button « Continuer ».
- Ranks « Pierre runique » E D C B A S; Progression teaser at rank E, 0 XP, counters at 0, 9 muscle groups at E.
- Buttons 52 px high, full width on phone; fields 16 px text; a dangerous action is isolated at the bottom, never next to a primary.
