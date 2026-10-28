## Global Constraints — brique 2 Exercices (verbatim from the plan)


- Branche `brique-2`, un ou plusieurs commits par tâche, messages en français au format du dépôt (`feat(server): …`), trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` verts à la fin de chaque tâche ; `pnpm --filter @rune/web test:e2e` (Chromium et WebKit) vert pour toute tâche qui touche un parcours E2E.
- Contraintes du socle et de la refonte toujours valables : CSP `default-src 'self'` (aucun `dangerouslySetInnerHTML`, aucune ressource externe), format d'erreur API, 404 pour les données d'un autre, jamais de C1–C3 dans `/api/admin/*`, classes de synchro (spec 01), aucun accès Dexie depuis `features/`, `ui/` ou `App.tsx` (seulement `repos/`), tables STRICT avec CHECK, migrations transactionnelles, `entityRules` couvre chaque colonne.
- Textes : français, apostrophe droite `'`, tutoiement, voix du Système seulement aux moments clés ; aucun « appsport » hors `docs/superpowers` et `docs/research`.
- Accessibilité : cibles ≥ 44 × 44 px, contrastes ≥ 4,5:1 dans les 5 thèmes, rien porté par la couleur seule, `prefers-reduced-motion` respecté.
- Codes de taxonomie, tables, colonnes et slugs en anglais (kebab-case immuable pour les fiches) ; noms affichés en français (04 §2).
- Nouvelle dépendance : version exacte publiée depuis au moins deux semaines (`npm view <pkg> time`), et seulement si la tâche la nomme.
- Aucune donnée personnelle envoyée à l'API Claude ; la clé vit dans `.env.local` (ignoré par git), jamais dans un fichier versionné, un journal ou un rapport.
- Valeurs fixées par la spec, à reprendre telles quelles : `CATALOG_MAX_SHEETS = 300`, `SUBSTITUTE_LIMIT = 5`, `SENSITIVE_JOINTS = ['lower_back','knees','shoulders','neck']`, 9 groupes `MUSCLE_GROUPS` (spec §4.3), commentaires de 1 à 1000 caractères, entrées de `safety` ≤ 120 caractères, `batch` ∈ `A` | `B` | `E1`…`E99`.


## Review Focus (verbatim)


1. **Fiche publiée corrigée** : elle reste servie avec le nouveau contenu, `catalog_version` change, le téléphone la retélécharge, et elle entre dans « À revalider » si elle est sensible. Test dans la tâche 9.
2. **Mineur et chaîne** : en profil prudent, aucun écran (liste, recherche, variantes, URL directe) ne montre le contenu d'une fiche `not_for_minors`. Tests dans les tâches 13 et 14.
3. **Deux onglets admin ouverts** : deux enregistrements partis de la même révision donnent un 200 et un 409, et l'écran du second garde sa saisie à côté de la version courante. Tests dans les tâches 9 et 17.
4. **Relectrice qui perd son rôle en pleine session** : la requête suivante répond 403 ; l'écran affiche « Tu n'as plus accès à la relecture. » et revient au Profil, sans boucle. Tests dans les tâches 7 et 16.
5. **Catalogue vide ou pas encore téléchargé** : premier lancement hors ligne, l'onglet Exercices montre l'état « Connecte-toi une fois… », jamais 9 tuiles à 0. Test dans la tâche 14.
