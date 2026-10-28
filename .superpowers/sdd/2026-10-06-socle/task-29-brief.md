### Task 29: Dépôts d'accès aux données, état hors ligne et voyant « Prêt hors ligne »

**Files:**
- Create: `apps/web/src/repos/{index.ts, rows.ts, me-repo.ts, profile-repo.ts, places-repo.ts, gyms-repo.ts, consent-repo.ts, admin-repo.ts, rejections-repo.ts, status-repo.ts}`, `apps/web/src/features/status/{readiness.ts, use-readiness.ts, OfflineReadyIndicator.tsx, status.module.css}`, `apps/web/test/support/seed.ts`
- Modify: `apps/web/src/sw/protocol.ts` (T26 : ajoute `SwStatus`, dont `localDbVersion?` que T36 remplit), `apps/web/src/sw/sw-client.ts` (T26, `postToSw` : ajoute `getSwStatus`), `apps/web/src/local-db/meta.ts` (T25 : `lastAgeBand: AgeBand` dans `MetaValues` et `USER_META_KEYS`), `apps/web/src/app-services.tsx` et `main.tsx` (`swStatus`), `apps/web/test/support/render.tsx` (`RenderAppOptions.swStatus`), `apps/web/src/App.tsx` (`repos.me.refresh()` au montage), `apps/web/src/features/home/HomePage.tsx` (`<OfflineReadyIndicator/>`, avis des 18 ans)
- Test: `apps/web/test/repos/{me-repo,profile-places-gyms,consent-repo,admin-rejections,offline-mutations,status-repo}.test.ts(x)`, `apps/web/test/status/{readiness,sw-client}.test.ts`, `apps/web/test/status/offline-ready.test.tsx`, `apps/web/test/home/adult-notice.test.tsx`, `apps/web/test/architecture.test.ts`

**Interfaces:**
- Consumes : T28 ; T25 (`AppDb`, `MirrorRow`, `getMeta`, `setMeta`, `wipeUserData`, `purgeHealthData`, `writeLocal`, `pendingCount`) ; T26 (`refreshCatalog`, `PageToSw`, `postToSw`, `SyncEngine.start`, `connection` remis à `unknown` au changement de `meta.userId`) ; schémas de contracts des parties comptes et profil, dont `ConsentState.aiCoach` et `UpdateMeRequest` strict (T10), `AdminDeleteMemberRequest` avec `password` (T13), `IllustrationRef` (T23) ; domain (`firstIncompleteStep`).
- Produces : Interfaces partagées §6 (`Repos`, `createRepos`, `useRepos`, `SwStatus`, `getSwStatus`, `readiness.ts`, `useReadiness`, `OfflineReadyIndicator`, support `seedMirror`, `seedOutbox`) ; `AppServices.swStatus(): Promise<SwStatus | null>` ; `RenderAppOptions.swStatus?: SwStatus | null` (défaut `{ type: 'STATUS', buildHash: 'test', shellCached: true, illustrationsMissing: 0 }`). Dépôts (toute écriture E = `api.send` puis `await sync.pullNow()` ; aucune écriture locale avant la réponse) :
```ts
export function parseJsonColumn<T>(v: unknown, schema: z.ZodType<T>): T | null; export function isLive(row: MirrorRow): boolean;
export interface MeRepo { current(): Promise<MeResponse | null>; refresh(): Promise<MeResponse | null> /* hors ligne → cache ; ApiError → null sans effacer */;
  deviceOwner(): Promise<{ userId: string | null; username: string | null; pending: number }>; login(r: LoginRequest): Promise<MeResponse>;
  checkInvitation(code: string): Promise<InvitationCheckResponse>; acceptInvitation(r: AcceptInvitationRequest): Promise<MeResponse>;
  checkReset(code: string): Promise<ResetCheckResponse>; resetPassword(r: ResetPasswordRequest): Promise<MeResponse>; updateUsername(u: string): Promise<MeResponse>;
  changePassword(r: ChangePasswordRequest): Promise<void> /* 204 → refresh() puis syncNow('manual') */; logout(mode: 'current' | 'all'): Promise<void>;
  exportData(): Promise<ExportV1>; deleteAccount(password: string): Promise<void>; adultNotice(): Promise<boolean>; dismissAdultNotice(): Promise<void> }
// login, acceptInvitation, resetPassword → adoptSession : autre meta.userId → wipeUserData({ keepOutbox: false }) ; setMeta userId et me ; syncNow('manual') (réarme le moteur, même après 410)
// logout et deleteAccount → wipeUserData({ keepOutbox: false }) après la réponse
// avis des 18 ans (une fois par appareil) : refresh et adoptSession posent meta.lastAgeBand = me.ageBand s'il est absent ou si me.ageBand = 'minor' ;
//   adultNotice() = lastAgeBand 'minor' et me.ageBand 'adult' ; dismissAdultNotice() → lastAgeBand 'adult'
export interface TrainingProfileView { goal: Goal | null; experience: Experience | null; daysPerWeek: 2 | 3 | 4 | null; sessionMinutes: 30 | 45 | 60 | 75 | 90 | null;
  sportCode: SportCode | null; sportOtherLabel: string | null; cautiousMode: boolean }
export interface ProfileRepo { get(): Promise<TrainingProfileView | null>; update(p: TrainingProfilePatch): Promise<MeResponse>; completeOnboarding(): Promise<MeResponse>;
  onboardingInput(): Promise<Parameters<typeof firstIncompleteStep>[0]> }
export interface PlaceView { id: string; kind: 'gym' | 'home'; gymId: string | null; name: string; city: string | null; isPrimary: boolean; visibleAtGym: boolean | null;
  loadSettings: LoadSettings | null; equipment: EquipmentCode[] }
export interface PlacesRepo { list(): Promise<PlaceView[]> /* principal d'abord puis nom */; get(id: string): Promise<PlaceView | null>; create(r: CreatePlaceRequest): Promise<void>;
  update(id: string, r: UpdatePlaceRequest): Promise<void>; remove(id: string, r: DeletePlaceRequest): Promise<void>; setEquipment(placeId: string, code: EquipmentCode, present: boolean): Promise<void> }
export interface GymsRepo { search(q: string): Promise<GymSummary[]>; similar(name: string, city: string): Promise<GymSummary[]>; create(r: CreateGymRequest): Promise<CreateGymResponse>;
  detail(id: string): Promise<{ detail: GymDetail; offline: boolean }> /* hors ligne : miroirs, canEdit false, history [], visibleMembers [] non affiché */;
  update(id: string, r: UpdateGymRequest): Promise<void>; setEquipment(id: string, code: EquipmentCode, present: boolean): Promise<void> }
export interface ConsentRepo { state(): Promise<ConsentState | null>; needsHealthReconsent(): Promise<boolean> /* actif et majorOf(textVersion) < majorOf(HEALTH_CONSENT_TEXT.version) */;
  grantHealth(): Promise<MeResponse>; withdrawHealth(password: string): Promise<MeResponse> /* MeResponse → meta.me, purgeHealthData, pullNow */;
  screening(): Promise<{ caution: boolean; questionnaireVersion: string; answeredAt: string } | null>; saveScreening(a: [boolean, boolean, boolean, boolean]): Promise<{ caution: boolean }>;
  limitations(): Promise<{ id: string; bodyArea: BodyArea; side: LimitationSide; severity: LimitationSeverity; note: string | null; active: boolean }[]>;
  addLimitation(i: LimitationInput): Promise<{ id: string }>; updateLimitation(id: string, p: LimitationPatch): Promise<void>; removeLimitation(id: string): Promise<void> }
export interface AdminRepo { members(): Promise<MemberSummary[]>; resetLink(id: string): Promise<ResetLinkResponse>; revokeSessions(id: string): Promise<void>;
  setStatus(id: string, s: UserStatus): Promise<void>; setRole(id: string, r: Role, password: string): Promise<void>; setBirthDate(id: string, d: string): Promise<void>;
  deleteMember(id: string, confirmUsername: string, password: string): Promise<void>; invitations(): Promise<InvitationSummary[]>; createInvitation(r: CreateInvitationRequest): Promise<CreateInvitationResponse>;
  revokeInvitation(id: string): Promise<void>; opsStatus(): Promise<OpsStatusResponse>; gyms(): Promise<GymSummary[]>; deleteGym(id: string): Promise<void> }
export interface RejectionView { id: string /* id sync_rejection ou 'local:<opId>' */; source: 'server' | 'local'; opId: string; entity: string; rowId: string; code: string; detail: unknown; at: string }
export interface RejectionsRepo { list(): Promise<RejectionView[]>; count(): Promise<number>; dismiss(id: string): Promise<void> }
export interface StatusRepo { readinessInputs(): Promise<{ catalogVersion: string | null; serverCatalogVersion: string | null; lastPullOkAt: string | null }>;
  persistGranted(): Promise<boolean | null>; pendingCount(): Promise<number>; retry(): Promise<void> /* syncNow('manual') puis refreshCatalog */;
  activeSessionId(): Promise<string | null>; illustrationFiles(): Promise<string[]> /* champ file du store illustrations, trié */;
  requestPersistentStorage(storage?: Pick<StorageManager, 'persist' | 'persisted'> /* navigator.storage */): Promise<boolean> /* l'appelant vérifie isStandalone() */ }
```

**Spec:** 01 §1 principe 4, §2 et §3 (Dexie derrière des dépôts), R-SYN-12, R-SYN-18, R-SYN-30 à R-SYN-34 ; 02 §1 principe 4, R-AUTH-8, R-MDP-1, R-AGE-6 ; 03 P-AUT-6, P-CST-3, P-CST-4, P-MIN-8.

- [ ] **Step 1: Write the failing test**

```ts
// me-repo.test.ts : refresh → meta.me.username 'lea2' ; hors ligne → cache 'lea' gardé ;
//   connexion de u-B avec 2 ops de u-A : deviceOwner { userId: 'u-A', username: 'lea', pending: 2 } puis outbox vide, meta.userId 'u-B', sync.triggers contient 'manual' ;
//   reconnexion de u-A ('Lea') → outbox gardée (2) ; logout('current') → calls ['/api/auth/logout'], outbox vide, meta.me absente ;
//   changePassword → POST /api/auth/password puis GET /api/me, meta.me.mustChangePassword false, triggers contient 'manual' ;
//   moteur réel : 410 account_deleted (base vidée) puis login de u-B → le cycle suivant envoie GET /api/health puis GET /api/sync/pull ;
//   18 ans : lastAgeBand 'minor' + refresh adulte → adultNotice true ; dismissAdultNotice → false, lastAgeBand 'adult' ;
//   lastAgeBand absent + adulte → lastAgeBand 'adult', adultNotice false ; mineur → 'minor', false
// status-repo.test.ts : activeSessionId → meta ou null ; illustrationFiles → ['a.11111111.svg','b.22222222.svg'] ;
//   requestPersistentStorage : API absente → false ; persisted() vrai → true sans persist() ; accordé → true ; refusé → false ; erreur → false ; meta.persistGranted = résultat
// profile-places-gyms.test.ts (seedMirror au format du pull : booléens, objets) : update({ goal: 'strength', onboardingStep: 'goal' }) → PATCH ce corps, meta.me à jour, pullCount 1 ;
//   onboardingInput → { goal: 'muscle', experience: 'none', daysPerWeek: 3, sessionMinutes: 45, hasPrimaryPlace: true, lastValidatedStep: 'sport' } ;
//   places.list → [p-1 salle 'Basic Fit' 'Lyon' principale visibleAtGym true, p-2 maison 'Garage' equipment ['chair'], loadSettings maison], p-3 supprimé absent ;
//   gyms.detail hors ligne → { offline: true, canEdit: false, history: [], visibleMembers: [] } et matériel du miroir ; 409 gym_duplicate → ApiError body.gymId 'g-1'
// consent-repo.test.ts : withdrawHealth('pw') → POST { type: 'health', password: 'pw' }, meta.me à jour, miroirs C2 vidés, pullCount 1 ; 401 → rien de purgé ;
//   needsHealthReconsent : '0.9' → true ; '1.0', '1.4', inactif → false ; saveScreening → PUT { answers, questionnaireVersion: '1.0' }
// admin-rejections.test.ts : sync_rejection r-1 (op-1), r-2 ignoré, r-3 supprimé ; deadletter op-1, op-7 (u-1), op-8 (u-2) →
//   list [{ id: 'r-1', source: 'server', opId: 'op-1' }, { id: 'local:op-7', source: 'local', opId: 'op-7' }], count 2 ;
//   dismiss('r-1') → op patch { dismissedAt: '2026-10-06T12:00:00.000Z' }, deadletter op-1 supprimée, trigger 'mutation' ; dismiss('local:op-7') → aucune op ;
//   admin.deleteMember('u-2', 'lea', 'pw') → POST /api/admin/members/u-2/delete { confirmUsername: 'lea', password: 'pw' }
// offline-mutations.test.ts : profile.update, places.create, gyms.setEquipment, consent.grantHealth, admin.revokeSessions hors ligne → 'Nécessite le réseau', base inchangée, pullCount 0
// readiness.test.ts : 16 combinaisons → { ready: s && c && i && p, checks } ; pull à 24 h exactement → recentPull false, à 24 h − 1 ms → true
// sw-client.test.ts : réponse par MessageChannel au message { type: 'GET_STATUS' } ; sans contrôleur → null et postToSw false ; contrôleur muet → getSwStatus(50) null
// offline-ready.test.tsx : pull il y a 1 h → data-state 'ready', « Prêt hors ligne » ; 25 h → 'not-ready', « Pas encore prêt hors ligne », « Pas de synchronisation depuis plus de 24 h » ;
//   swStatus null → 'not-ready', « Appli pas encore enregistrée sur l'appareil »
// adult-notice.test.tsx : lastAgeBand 'minor', me adulte → Banner « Tu as 18 ans : tu peux désormais choisir l'objectif « Perdre du gras » dans ton profil. » ;
//   « J'ai compris » → Banner absent, et absent au rendu suivant sur la même base ; lastAgeBand absent → aucun Banner
// architecture.test.ts : features/, ui/, App.tsx et src/sw/**/*.tsx n'importent ni dexie ni local-db/ ; aucun 'navigator.onLine' dans src/
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test repos/ status/ home/ architecture` → `../../src/repos` introuvable.

- [ ] **Step 3: Implement**

Lectures par `db.mirror` et `getMeta`, filtrées par `isLive` ; les miroirs portent les valeurs décodées par le pull (booléens, objets ; `COLUMN_CODECS`, T21) : aucune conversion 0/1 ni `JSON.parse`, `parseJsonColumn(v, LoadSettings)` valide l'objet (invalide → null). `rejections.dismiss` passe par `writeLocal(db, { entity: 'sync_rejection', id, kind: 'patch', fields: { dismissedAt } }, …)`, supprime la deadletter de même `opId`, puis `syncNow('mutation')`. `computeReadiness` : `shell = sw?.shellCached === true` ; `catalog` = versions locale et serveur égales et non nulles ; `illustrations = sw !== null && sw.illustrationsMissing === 0` ; `recentPull = now − lastPullOkAt < RECENT_PULL_MS`. `useReadiness` lit `services.swStatus()` et recalcule au montage, à chaque `SyncState` et toutes les 5 s ; **[décision plan]** `main.tsx` : `swStatus = import.meta.env.DEV ? async () => ({ type: 'STATUS', buildHash: 'dev', shellCached: true, illustrationsMissing: 0 }) : () => getSwStatus()` (Vite dev n'a pas de SW). `HomePage` : avis des 18 ans en `Banner` info, « J'ai compris » → `dismissAdultNotice`. Libellés d'échec : « Appli pas encore enregistrée sur l'appareil », « Catalogue à télécharger », « Illustrations à télécharger », « Pas de synchronisation depuis plus de 24 h ».

- [ ] **Step 4: Run test to verify it passes**

Même commande → vert.

- [ ] **Step 5: Commit**

`git commit -m "feat(web): dépôts d'accès aux données et voyant Prêt hors ligne"`

---

