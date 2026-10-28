### Task 34: Confidentialité, santé, export, suppression, compteurs et rejets

**Files:**
- Create: `apps/web/src/features/privacy/{PrivacySettingsPage.tsx, HealthSection.tsx, ConsentWithdrawDialog.tsx, ExportButton.tsx, DeleteAccountDialog.tsx, HealthReconsentGate.tsx, privacy.module.css}`, `apps/web/src/features/status/{PendingCounter.tsx, ConnectionStatus.tsx, RejectionsPage.tsx, SettingsPage.tsx}`, `apps/web/src/ui/download.ts`
- Modify: `apps/web/src/ui/{AppShell.tsx, index.ts}` (zone d'état : `ConnectionStatus`, `PendingCounter`, `RejectedCounter`), `apps/web/src/App.tsx` (`/profile/health`, `/profile/privacy`, `/settings`, `/rejections` ; `<HealthReconsentGate/>` hors `/onboarding`)
- Test: `apps/web/test/privacy/{withdraw,export-delete,health-section}.test.tsx`, `apps/web/test/status/{counters,rejections-settings}.test.tsx`

**Interfaces:**
- Consumes : T28 ; T29 (`useRepos`, `seedMirror`, `seedOutbox`) ; T25 (`dumpLocalDb`) ; T31 (`HealthConsentPanel`, `ScreeningQuestions`, `LimitationsEditor`, `CautiousModeToggle`) ; domain (`parisDate`) ; contracts (`HEALTH_CONSENT_TEXT`, `PRIVACY_POLICY_VERSION`).
- Produces : `data-testid` `pending-counter`, `rejected-counter`, `connection-status` (Interfaces partagées §6) et :
```ts
export function downloadJson(filename: string, data: unknown): void; export function exportFileName(nowMs: number): string;   // 'appsport-export-AAAA-MM-JJ.json' (Paris)
export function PendingCounter(): JSX.Element; export function RejectedCounter(): JSX.Element; export function ConnectionStatus(): JSX.Element;
export const CONNECTION_LABELS: Record<ConnectionState, string>; export const REJECTION_CODE_LABELS: Record<string, string>;
export function RejectionsPage(): JSX.Element; export function SettingsPage(): JSX.Element; export function PrivacySettingsPage(): JSX.Element; export function HealthSection(): JSX.Element;
export function ConsentWithdrawDialog(p: { open: boolean; onClose(): void; onWithdrawn?(): void }): JSX.Element | null;
export function ExportButton(p: { label?: string /* 'Télécharger mes données' */ }): JSX.Element;
export function DeleteAccountDialog(p: { open: boolean; onClose(): void }): JSX.Element | null; export function HealthReconsentGate(): JSX.Element | null;
```

**Spec:** 01 R-SYN-18, R-SYN-30, R-SYN-31, R-SYN-34 ; 02 §11, R-CST-4 à R-CST-6, R-EXP-1, R-SUP-1, R-SUP-4, R-SUP-5 ; 03 P-CST-1, P-CST-3, P-CST-4, P-DRT-1 à P-DRT-4, P-DRT-6, §17 n°4 et n°9.

- [ ] **Step 1: Write the failing test**

```ts
// counters.test.tsx
it.each([['online', 'En ligne'], ['offline', 'Hors ligne'], ['unknown', 'Connexion…'], ['unauthenticated', 'Session expirée'],
  ['protocol_unsupported', 'Mise à jour nécessaire'], ['account_deleted', 'Compte supprimé']])('connection-status %s', /* data-state et texte exacts */);
// pending-counter : data-count '0' puis '3' après sync.set({ pending: 3 }), texte '3 en attente'
// rejected-counter : un sync_rejection non ignoré → data-count '1', texte '1 refusé', lien '/rejections' ; deux → '2 refusés' (R-SYN-34)
// rejections-settings.test.tsx : r-1 (validation) et deadletter op-7 (parent_rejected) → « Données invalides » et « Élément parent refusé » ;
//   « Ignorer » r-1 → op patch { dismissedAt: '2026-10-06T12:00:00.000Z' }, élément retiré, rejected-counter '1' ; aucun → « Aucun refus. »
// /settings : persistGranted true → « Stockage persistant : accordé » ; false → « Stockage persistant : refusé » et « Ton navigateur peut effacer les données de l'appli
//   si l'espace manque. Pense à télécharger tes données régulièrement. » (lien /profile/privacy) ; absent → « Stockage persistant : pas encore demandé »
// withdraw.test.tsx : « Retirer mon accord santé » → dialog avec 'indicateur de prudence', 'limitations et zones sensibles', 'Le mode prudent est conservé.',
//   « Télécharger mes données d'abord » ; « Retirer mon accord » désactivé sans mot de passe ; POST withdraw { type: 'health', password } → 200 MeResponse →
//   « Accord retiré. Tes données de santé ont été effacées. » ; dumpLocalDb sans 'TEMOIN-C2' ; 401 → « Mot de passe incorrect. », miroir intact ; hors ligne → 'Nécessite le réseau', rien purgé
// HealthReconsentGate : textVersion '0.9' → dialog « Le texte de l'accord santé a changé », HEALTH_CONSENT_TEXT.text, case décochée ;
//   « J'accepte » → POST /api/me/consents { type: 'health', textVersion: '1.0' } ; « Je refuse » → ConsentWithdrawDialog ; '1.0' ou inactif → rien ;
//   porte sans bouton de fermeture ; ConsentWithdrawDialog fermé sans retrait → la porte réapparaît (R-CST-6 : seul le retrait ou l'accord la lève)
// export-delete.test.tsx : 2 ops en attente → status « 2 éléments ne sont pas encore envoyés au serveur : ils ne figureront pas dans l'export. », aucune requête ;
//   « Exporter quand même » → <a download='appsport-export-2026-10-06.json'> cliqué une fois, createObjectURL appelé ; file vide → téléchargement au premier clic
// « Supprimer mon compte » → DeleteAccountDialog avec le texte de liste, la mention P-DRT-6 et ExportButton « Télécharger mes données d'abord » (R-SUP-1) ;
//   « Supprimer définitivement » désactivé sans mot de passe ;
//   POST /api/me/delete { password } → outbox vide, meta.me absente, location '/login?reason=account_deleted', « Ce compte a été supprimé » ;
//   409 last_admin → « Tu es le dernier administrateur : nomme d'abord un autre administrateur. », rien effacé ;
//   GET /api/me → 410 account_deleted (autre appareil) → base vidée outbox comprise, redirection ; 410 watermark_expired → rien effacé
// health-section.test.tsx : sans accord → HealthConsentPanel puis ScreeningQuestions ; avec accord → « Dernière réponse le 01/10/2026 », « Genou · Gauche · Légère »,
//   « Répondre de nouveau » → PUT /api/me/health-screening { answers: [false,false,false,false], questionnaireVersion: '1.0' } ;
//   « Supprimer » → DELETE /api/me/limitations/l-1 {}, « Modifier » → PATCH /api/me/limitations/l-1 { severity: 'severe' } ; 403 health_consent_required → « Cette action demande ton accord santé. » ;
//   CautiousModeToggle → PATCH { cautiousMode: false }, désactivé pour un mineur
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/web test privacy/ status/counters status/rejections-settings` → modules et `data-testid` introuvables.

- [ ] **Step 3: Implement**

Textes exacts : `REJECTION_CODE_LABELS` `validation` « Données invalides », `forbidden` « Action non autorisée », `parent_rejected` « Élément parent refusé », `stale_revision` « Version périmée », `unknown_entity` « Type de donnée inconnu », `protocol` « Version de l'appli trop ancienne » (repli : le code) ; retrait « Seront effacés : ton indicateur de prudence (questionnaire), tes limitations et zones sensibles, et toute donnée de santé enregistrée par l'appli (douleurs, pesées, suivi nutritionnel). Le mode prudent est conservé. » ; suppression « Ton compte, ton profil, tes lieux, tes données de santé et l'historique de tes accords seront supprimés. Les salles restent : tu y apparaîtras comme « ancien membre ». Le journal de sécurité est gardé 12 mois et les sauvegardes 30 jours au plus. » et (P-DRT-6) « Si tu as utilisé le coach, appsport ne peut pas faire effacer tes échanges chez Anthropic : ils y sont effacés sous 30 jours, ou gardés jusqu'à 2 ans si ses filtres de sécurité en ont signalé un. » ; Confidentialité : « Version en vigueur : 1.0 », « Lire la page Confidentialité et règles », accord santé « Donné le <date> » ou « Non donné » (`me.consents.health`), accord coach « Non donné » (`me.consents.aiCoach`, inactif au socle). `RejectedCounter` lit `useLive(() => repos.rejections.count())`, texte `plural(n, 'refusé', 'refusés')`. `downloadJson` : `Blob` JSON indenté, `<a download>` cliqué puis retiré, `revokeObjectURL`.

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/web test privacy/ status/`, puis `pnpm --filter @appsport/web test`, `pnpm lint`, `pnpm typecheck` → vert.

- [ ] **Step 5: Commit**

`git commit -m "feat(privacy): confidentialité, accord santé, export, suppression, compteurs et rejets"`

---

## Partie 6 — PWA

