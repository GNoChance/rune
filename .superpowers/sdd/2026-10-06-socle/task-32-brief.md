### Task 32: Profil, lieux et fiche de salle

**Files:**
- Create: `apps/web/src/features/profile/{ProfilePage.tsx, profile.module.css}`, `apps/web/src/features/places/{PlacesPage.tsx, PlaceDetail.tsx, GymPage.tsx}`
- Modify: `apps/web/src/App.tsx` (`/profile`, `/profile/places`, `/profile/places/:id`, `/gyms/:id`, dans `AppShell`)
- Test: `apps/web/test/profile/profile-page.test.tsx`, `apps/web/test/places/{places-page,gym-page}.test.tsx`

**Interfaces:**
- Consumes : T28 ; T29 (`useRepos`, `useLive`, `seedMirror`) ; T30 (`LogoutDialog`, `PasswordFields`, `checkNewPassword`, `USERNAME_MESSAGES`) ; T31 (`GoalStep`, `SportStep`, `ExperienceStep`, `AvailabilityStep`, `StepProps`, `GymPicker`, `EquipmentChecklist`, `CautiousModeToggle`) ; contracts (`GOAL_LABELS`, `EXPERIENCE_LABELS`, `EQUIPMENT_LABELS`, `EQUIPMENT_PRESETS`, `GymDetail`).
- Produces :
```ts
export function ProfilePage(): JSX.Element; export function PlacesPage(): JSX.Element;
export function PlaceDetail(p: { params: { id: string } }): JSX.Element; export function GymPage(p: { params: { id: string } }): JSX.Element;
export const GYM_HISTORY_LIMIT = 10;
export function historyLine(h: GymDetail['history'][number]): string;   // « 06/10/2026 à 14:05 — Matériel ajouté : Kettlebell — modifié par lea » | « … — ancien membre »
```

**Spec:** 02 §11 (Compte, Entraînement, Lieux), §1 principe 4, R-ONB-3, R-CPT-3, R-MDP-1, R-MDP-6, R-AUTH-7, R-SAL-1 à R-SAL-4, R-SAL-6, R-LIEU-1 à R-LIEU-4, R-VIS-1 à R-VIS-4, R-CHG-3, §8 E2, §15 n°15 et n°17 ; 03 P-DRT-2.

- [ ] **Step 1: Write the failing test**

```ts
// profile-page.test.tsx : « Pseudo » 'lea' ; « Date de naissance » readOnly '01/01/1990' ; « Enregistrer le pseudo » → PATCH /api/me { username: 'leo' } ;
//   hors ligne → alerte 'Nécessite le réseau' ; 409 username_taken → « Ce pseudo est déjà pris. »
// mot de passe : « Mot de passe actuel », « Nouveau mot de passe », « Confirmation », « Changer le mot de passe » →
//   POST /api/auth/password { currentPassword: 'ancien mot de passe ok', newPassword: 'cheval agrafe batterie correcte' } →
//   « Mot de passe changé. Tes autres appareils ont été déconnectés. » ; 401 → « Mot de passe actuel incorrect. »
// mustChangePassword admin → Banner « Ton mot de passe doit être changé avant de continuer (14 caractères au moins pour un administrateur). », seule la section mot de passe ;
//   changement réussi (GET /api/me suivant → mustChangePassword false) → Banner absent, sections Compte, Entraînement et liens visibles, triggers contient 'manual'
// « Déconnecter tous mes appareils » → LogoutDialog all (POST /api/auth/logout-all) ; « Se déconnecter » → LogoutDialog current
// Entraînement : « Prendre du muscle », « Jamais », « 3 séances de 45 min » ; « Modifier l'objectif » → GoalStep edit, PATCH { goal: 'strength' } ;
//   « Modifier le sport » → SportStep edit, « Course à pied » → PATCH { sportCode: 'running', sportOtherLabel: null } ; « Modifier le niveau » → PATCH { experience: 'lt_6_months' } ;
//   « Modifier la disponibilité » → PATCH { daysPerWeek: 4, sessionMinutes: 60 } ; mode prudent → PATCH { cautiousMode: true }
// liens « Lieux » /profile/places, « Santé » /profile/health, « Confidentialité » /profile/privacy, « Réglages » /settings
// places-page.test.tsx (p-1 salle 'Basic Fit' principale visible, p-2 maison 'Garage') : 'Basic Fit' avec badge « Principal » puis 'Garage' ;
//   « Définir comme principal » p-2 → PATCH { isPrimary: true } ; renommer → PATCH { name: 'Cave' }, maxLength 30 ; « Visible à la salle » décoché p-1 → PATCH { visibleAtGym: false } ;
//   « Supprimer » p-2 → DELETE {} ; p-1 → choix « Nouveau lieu principal » 'Garage' → DELETE { newPrimaryId: 'p-2' } ;
//   un seul lieu → « Supprimer » désactivé et « Tu dois garder au moins un lieu. » (même message sur 409 last_place) ;
//   « Ajouter une salle » → GymPicker (isPrimary false, defaultVisible true pour un adulte) ; « Ajouter une maison » → POST { kind: 'home', name: 'Garage 2', equipment: […], isPrimary: false }
//   PlaceDetail maison : cocher « Haltères fixes ou réglables » → PUT /api/places/p-2/equipment/dumbbells {} ; décocher « Chaise ou banc stable » → DELETE …/chair ;
//   PlaceDetail salle : lien « Voir la salle » → /gyms/g-1, aucune case
// gym-page.test.tsx : titre 'Basic Fit', 'Lyon', 'Barre droite et disques' ; liste « Qui va à cette salle » ['lea','max'] ;
//   « Dernières modifications » : 10 éléments, le 1er 'ancien membre', le 2e 'modifié par lea' et 'Matériel ajouté : Barre droite et disques'
// canEdit : « Modifier » 'Basic Fit Part-Dieu' → PATCH { name } ; « Kettlebell » → PUT …/kettlebell ; « Banc plat » décoché → DELETE …/flat_bench
// !canEdit : ni « Modifier » ni case, « Seuls les membres qui ont cette salle parmi leurs lieux peuvent la modifier. », liste « Qui va à cette salle » ['lea','max'] affichée (R-VIS-2) ;
//   visibleMembers [] → « Personne n'est visible pour l'instant. »
// hors ligne : Banner « Hors ligne : dernière version connue. », nom et matériel du miroir, aucune case cochable, « Liste disponible en ligne » (pas « Personne n'est visible »)
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test profile/ places/places-page places/gym-page` → modules introuvables.

- [ ] **Step 3: Implement**

Date de naissance accompagnée de « Seul l'administrateur peut la corriger. » ; chaque « Modifier … » rend l'écran d'onboarding en `mode="edit"` ; le bandeau `mustChangePassword` suit `useMe()` (disparaît après le `refresh()` de `changePassword`) ; `last_place` et `primary_required` surchargés (« Tu dois garder au moins un lieu. », « Choisis d'abord un nouveau lieu principal. ») ; libellés d'historique : `create` « Création de la salle », `update_info` « Nom ou ville modifiés », `add_equipment` « Matériel ajouté : <libellé> », `remove_equipment` « Matériel retiré : <libellé> », `update_load_settings` « Réglages de charge modifiés » ; pas d'édition des réglages de charge (brique 3, R-CHG-3).

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/web test profile/ places/` → vert.

- [ ] **Step 5: Commit**

`git commit -m "feat(salles): profil, lieux et fiche de salle"`

---

