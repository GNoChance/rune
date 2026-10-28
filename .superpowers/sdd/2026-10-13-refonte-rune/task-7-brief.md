### Task 7: Choix du coach, présentation et textes des coachs

**Files:**
- Create: `apps/web/src/features/coach/coach-lines.ts`, `CoachStep.tsx`, `CoachIntro.tsx`, `apps/web/test/coach/coach-step.test.tsx`
- Modify: `apps/web/src/features/onboarding/OnboardingFlow.tsx` (étape « coach » avant « goal », numérotation sur 9, reprise : si `profile.coach == null` → coach puis l'étape enregistrée)

**Interfaces:**
- Consumes: `CoachAvatar`, `CoachBubble`, `ChoiceCard`, `SegmentedProgress` (Tasks 3–4), `setCoach` (Task 6).
- Produces: `COACHES: Record<CoachId, { name: string; temper: string; sample: string; intro: string; nutri: string; ready: string; daily: readonly string[] }>` ; `coachLine(coach: CoachId, moment: 'daily', date: Date, pseudo: string): string` (ligne du jour = `daily[jourParis % daily.length]`, `{pseudo}` remplacé).

Textes (mot pour mot ; `{pseudo}` remplacé par le pseudo) :

| | L'Ombre | Le Skald | Le Scribe |
|---|---|---|---|
| name | L'Ombre | Le Skald | Le Scribe |
| temper | Froid et laconique. Exigeant, jamais humiliant. | Mentor chaleureux. Il raconte, il explique. | Calme et précis. Il aime les plans clairs et les bilans. |
| sample | Quête acceptée. Rang E. Montre-moi ta discipline. | Chaque saga commence par un premier pas, {pseudo}. Je serai là pour la raconter. | Trois séances par semaine : c'est un rythme tenable. Je note tout. |
| intro | Je suis L'Ombre. Je fixe tes quêtes, tu les accomplis. Le dialogue viendra plus tard : d'ici là, avance. | Je suis le Skald. Je raconterai ta saga, séance après séance, et je t'expliquerai chaque étape. Nos vraies conversations viendront plus tard : pour l'instant, je pose les premiers vers. | Je suis le Scribe. Je prépare un plan clair et je note chaque série pour faire le point avec toi. Nos échanges viendront plus tard : pour l'instant, je consigne. |
| nutri | Bois régulièrement. Après l'effort, un vrai repas. La récupération fait partie de la quête. | À table aussi, la saga s'écrit, {pseudo}. Un vrai repas après ta séance t'aidera à récupérer. | Note du jour : bois régulièrement, et prévois un vrai repas après ta séance. |
| ready | Éveil validé. Rang E. Le reste se gagne en séance. | Le prologue est écrit, {pseudo}. La saga commence. | Profil complet, lieu noté. Le plan arrivera ici. |
| daily (3) | Jour 1. Rang E. La discipline se prouve, elle ne se promet pas. / Une quête attend. Ton rang aussi. / Pas d'excuse aujourd'hui. Juste la suite. | Le premier chapitre de ta saga s'ouvre aujourd'hui, {pseudo}. Les grands récits commencent toujours ainsi. / Chaque jour ajoute une ligne à ta saga. / Les héros aussi ont commencé au rang E. | Profil complet, lieu noté, rythme de {jours} séances par semaine. Le plan arrivera ici. / Point du jour : ton profil est à jour. / Je consigne. Les premières séances arriveront bientôt. |

(`{jours}` = `daysPerWeek` du profil.)

- [ ] **Step 1: Tests qui échouent** — `coach-step.test.tsx` : l'étape 1 affiche « Choisis ton coach », « Étape 1 sur 9 » et 3 radios nommées L'Ombre, Le Skald, Le Scribe ; choisir Le Skald puis « Continuer » appelle `setCoach('skald')` et montre la présentation (texte `intro` du Skald, étiquette « Message d'accueil », bouton « C'est parti ») ; « C'est parti » mène à l'objectif (« Étape 2 sur 9 ») ; reprise : profil `coach: null`, `onboardingStep: 'availability'` → coach d'abord, puis disponibilité ; `coachLine('scribe','daily', …)` remplace `{jours}` ; aucune ligne des trois coachs ne contient de chiffre suivi de « kcal », « g », « kg » ou « % ».
- [ ] **Step 2: Lancer** — FAIL.
- [ ] **Step 3: Implémenter** selon le prototype (`src.html`, écrans « coach » et « intro ») et `B01-Objectif-*.dc.html` pour la mise en page ; démonstration nutrition : bascule automatique une fois vers `mode="nutrition"` + ligne `nutri`, puis retour ; interrupteur « Entraînement / Nutrition » pour la rejouer.
- [ ] **Step 4: Lancer** les tests web — PASS.
- [ ] **Step 5: Commit** `feat(web): choix du coach dès l'onboarding et présentation animée`.

