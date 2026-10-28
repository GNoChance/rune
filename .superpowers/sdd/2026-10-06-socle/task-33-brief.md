### Task 33: Écrans d'administration

**Files:**
- Create: `apps/web/src/features/admin/{MembersPage.tsx, InvitationsPage.tsx, AdminGymsPage.tsx, ServerHealthPage.tsx, AdminNav.tsx, share-message.ts, admin.module.css}`
- Modify: `apps/web/src/App.tsx` (`/admin/members`, `/admin/invitations`, `/admin/gyms`, `/admin/health`)
- Test: `apps/web/test/admin/{members,invitations,gyms-health}.test.tsx`

**Interfaces:**
- Consumes : T28 (dont `formatAge`, `useServices().now`) ; T29 (`useRepos().admin` dont `deleteMember(id, confirmUsername, password)`, `useRepos().gyms.update`) ; T13 (`AdminDeleteMemberRequest`, 401 `invalid_credentials`) ; T12 (`MemberSummary.consents.aiCoach`) ; contracts (`MemberSummary`, `InvitationSummary`, `OpsStatus`, `OpsStatusResponse`, `INVITATION_NOTE_MAX`).
- Produces :
```ts
export function buildInvitationShareMessage(origin: string, link: string, code: string): string;
// = `1. Installe Tailscale et accepte le partage.\n2. Ouvre ${origin} et installe l'appli.\n3. Dans l'appli, colle ce lien ou tape le code ${code} (valable 7 jours).\n${link}`
export const BACKUP_LATE_MS = 26 * 3_600_000;   // [décision plan] période de 24 h + 2 h de grâce (08 §9)
export const DISK_WARN_PCT = 80;
export function MembersPage(): JSX.Element; export function InvitationsPage(): JSX.Element; export function AdminGymsPage(): JSX.Element;
export function ServerHealthPage(): JSX.Element; export function AdminNav(): JSX.Element;   // Membres · Invitations · Salles · État du serveur
```

**Spec:** 02 §6, R-ROLE-2, R-ROLE-4, R-INV-1 à R-INV-3, R-INV-7, R-INV-9, R-RST-3, R-RST-4, R-ADM-1, R-AGE-4, R-SUP-2, R-SAL-7 ; 08 §9 ; 03 P-ADM-1, P-AUT-5, P-DRT-3.

- [ ] **Step 1: Write the failing test**

```ts
// members.test.tsx (u-1 'bastien' admin, u-2 'lea' mineure jamais connectée, onboarding en cours, santé oui)
// ligne lea : 'mineur', 'Jamais connecté', 'Onboarding en cours' ; ligne bastien : '06/10/2026'
// « Lien de réinitialisation » + « Générer » → 'ABCD-EFGH-JKMN-PQRS', « Copier », 'Ce code ne sera plus affiché.' ; « J'ai transmis le lien » → code disparu
// « Fermer les sessions » → POST …/u-2/revoke-sessions {} ; « Désactiver » → …/status { status: 'disabled' } ; « Réactiver » → { status: 'active' }
// « Promouvoir administrateur » + « Ton mot de passe » → …/role { role: 'admin', password: 'mon mot de passe admin' } ; « Rétrograder » u-1 + 409 last_admin → « Il doit rester au moins un administrateur actif. »
// « Corriger la date de naissance » → …/birth-date { birthDate: '2009-02-01' } ; 400 under_min_age → « appsport est réservé aux 16 ans et plus »
// « Supprimer définitivement » désactivé tant que « Tape le pseudo pour confirmer » ≠ 'lea' ou « Ton mot de passe » vide →
//   …/delete { confirmUsername: 'lea', password: 'mon mot de passe admin' } ; 401 invalid_credentials (suppression ou rôle) → « Mot de passe incorrect. », dialogue gardé
// 403 reset_self_forbidden → « Pour toi-même, utilise la commande admin:reset sur le serveur. » ; liste rechargée après chaque succès ;
// santé et coach (consents.health, consents.aiCoach) affichés en « oui » / « non », aucune autre donnée C1 à C3 ; un membre sur /admin/members → « Page introuvable », aucune requête
// invitations.test.tsx : « Date de naissance » '2009-05-01', « Note (facultative) » 'pour Léa' (maxLength 60), « Créer l'invitation » → POST { birthDate: '2009-05-01', note: 'pour Léa' } ;
//   code affiché ; data-testid share-message = buildInvitationShareMessage(origin, link, code) ; « Partager » → navigator.share({ text: message }) ;
//   sans navigator.share → « Copier le message » ; états « En attente (expire le 13/10/2026) », « Utilisée par lea », « Révoquée », « Expirée » ;
//   « Révoquer » (pending seulement) → POST …/i-1/revoke puis rechargement ; under_min_age → message ; après « J'ai noté le code », code absent
// gyms-health.test.tsx : AdminGymsPage liste GET /api/gyms?q= ; « Modifier » 'Villeurbanne' → PATCH /api/gyms/g-1 { city } ; « Supprimer » → DELETE /api/admin/gyms/g-1 {} ;
//   409 gym_in_use → « Des membres ont encore cette salle parmi leurs lieux : elle ne peut pas être supprimée. »
// ServerHealthPage (now '2026-10-06T12:00:00.000Z', version v1.2.3, OPS de 08 §9) : « Version en service : v1.2.3 » ; « Dernier déploiement : v1.2.3 le 01/10/2026 (réussi) » ;
//   « Dernière sauvegarde : il y a 5 h (réussie) » ; « Dernier test de restauration : 04/10/2026 (réussi) » ; « / : 42 % » ; « /srv/appsport : 81 % (au-delà de 80 %) » ;
//   « Redémarrage nécessaire » ; sauvegarde à 28 h → Banner « Sauvegarde en retard (plus de 26 h) » ; backup.ok false → « (échouée) » et Banner error ;
//   opsStatus null → « Aucun état d'exploitation disponible : les scripts de l'hôte n'ont encore rien écrit. »
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test admin/` → modules introuvables.

- [ ] **Step 3: Implement**

Tableau accessible (une ligne `role="row"` nommée par le pseudo ; rôle « admin »/« membre », dernière connexion `formatDateTime` ou « Jamais connecté », « Onboarding terminé »/« Onboarding en cours », « SMART : OK »/« SMART : problème détecté »). Chaque action passe par une `Dialog` de confirmation et `useAction` (surcharge `invalid_credentials` « Mot de passe incorrect. » pour le rôle et la suppression) ; le code ou le lien n'existe que dans l'état du composant jusqu'à la confirmation de transmission. Retard de sauvegarde si `now − backup.at > BACKUP_LATE_MS` ; disque en alerte si `usedPct > DISK_WARN_PCT`.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/web test admin/` → vert.

- [ ] **Step 5: Commit**

`git commit -m "feat(admin): écrans membres, invitations, salles et état du serveur"`

---

