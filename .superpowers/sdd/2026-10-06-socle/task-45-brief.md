### Task 45: Procédures écrites et registre

**Files:**
- Create: `docs/exploitation/{P1-installation, P2-deverrouiller, P3-deployer, P4-restaurer, P5-rotation-secrets, P6-proches, P7-maintenance, P8-incident, P9-admin-indisponible, installer-appsport, recette-telephones}.md`, `infra/RUNBOOK-reconstruction.md`, `docs/fiche-de-traitement.md`, `docs/incidents.md`
- Test: `apps/server/test/infra/docs.test.ts`

**Interfaces:**
- Consumes : scripts `infra/host/appsport-*` (T43, T44) ; commandes CLI (Interfaces partagées §2) ; formes d'appel `docker compose --project-name appsport -f /opt/appsport/infra/compose.yaml --env-file /srv/appsport/deploy.env exec -T app node /app/server.mjs <cmd>` (service en marche) et `… run --rm --no-deps app node /app/server.mjs <cmd>` (arrêté) ; fichiers de `infra/` (T41, T44) ; partition GPT `appsport-data`, mapper `appsport` ; variables de `healthchecks.env` (dont `APPSPORT_URL`) et `b2.env` (T43).
- Produces : procédures P1 à P9, fiche « Installer appsport », recette sur téléphones, runbook de reconstruction, fiche de traitement (source de la page Confidentialité, version `1.0`), registre des incidents.

**Spec:** 08 §6, §9, §10 à §13, R-OPS-1, R-OPS-5, R-OPS-7, R-OPS-9, R-OPS-12, R-OPS-14 ; 01 R-TST-4 ; 02 R-ONB-4 ; 03 P-MIN-4, §1, §7, §10, §13.5, §13.7, §14 ; 07 (ancien numéro TCA absent). **[décision plan]** Healthchecks : `alive` grâce 8 min, `restore-test` période 35 j.

- [ ] **Step 1: Write the failing test**

```ts
// chaque Pn : titre '# Pn ', liste numérotée, 'Résultat attendu :' et 'Sinon :'
// les 6 scripts `appsport-*` de 08 §15 sont cités
it.each(['init', 'db:check', 'admin:bootstrap', 'admin:reset', 'snapshot', 'restore', 'privacy:collect', 'privacy:reapply', 'sessions:active', 'db:stats'])
  ('server.mjs %s est cité', (c) => expect(opsText()).toMatch(new RegExp(`server\\.mjs ${c}(?![\\w:-])`)));
expect(p1Headings).toEqual(['BIOS', 'Debian', 'Volume chiffré', 'Docker', 'Tailscale', 'Pare-feu (ufw)', 'Dépôt et secrets', 'Dépôts restic', 'Timers systemd',
  'Healthchecks', 'Initialisation de la base et invitation admin', 'Premier déploiement', 'Recette', 'Exercice de reconstruction', 'Enveloppe de secours']);
// P1 « Recette » : ≥ 11 items numérotés et 'recette-telephones.md' ; « Enveloppe de secours » : 'phrase LUKS', 'compte Unix', 'mot de passe restic', 'clé B2', 'P2', 'P9', 'datée'
// P1 contient 'luks,noauto', 'chattr +i', '6 mots', 'tailscale set --auto-update', 'IPV6=yes', 'EU Central', 'limitée au bucket', 'known_hosts',
//   'RESTIC_OFFSITE_REPOSITORY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'APPSPORT_URL', 'VITE_OWNER_FIRST_NAME', 'chown -R 1000:1000 /srv/appsport/data' ;
//   « Healthchecks » : 'alive : 5 min, grâce 8 min', 'restore-test : 35 j, grâce 3 j', 'backup : 24 h, grâce 2 h', 'host : 24 h, grâce 2 h' ;
//   « Initialisation… » + « Premier déploiement » : 'APPSPORT_VERSION=v' < ' pull' < '.appsport-volume' < 'server.mjs init' < 'server.mjs admin:bootstrap' < ' up -d'
// RTST4 = les 6 contrôles de 01 §9.3 R-TST-4 mot pour mot, sans « ; » final ; recette-telephones.md : les 6 RTST4, 'moins de 2 minutes hors écran Santé', "Interrupteur d'urgence", 'Bandeau de mise à jour', 'iPhone', 'Android',
//   '| Date | Version | Appareil | Résultat |' ; P3 : 'recette-telephones.md', 'src/sw', 'local-db', 'iOS', avant 'git tag'
// P4 « Sur place » : 'server.mjs privacy:collect' < 'stop app' < 'server.mjs restore' < 'server.mjs privacy:reapply' < 'up -d' ; 'replaced-' ;
//   « Nouvelle machine » : '/var/lib/tailscale' avant 'systemctl start tailscaled' ; P7 : 'up -d --force-recreate app' ;
//   P8 « Interrupteur d'urgence » : 'SW_KILL_SWITCH=1' < '"swKill":true' < '"swKill":false'
// P9 : 'appsport-unlock', 'export', 'Aucune invitation' ; installer-appsport : "Sur l'écran d'accueil", "Installer l'application", 'VPN permanent',
//   'Bloquer les connexions sans VPN', 'Site introuvable' ; installer-appsport et P6 : 'son propre compte Tailscale' (P-MIN-4) ; runbook : /chronom/i et '## Journal des exercices'
// fiche de traitement : '## Responsable', '## Finalités', '## Personnes concernées', '## Catégories de données', '## Destinataires', '## Transferts hors UE',
//   '## Durées de conservation', '## Mesures de sécurité' ; mots 'C0', 'C1', 'C2', 'C3', 'Anthropic', 'Backblaze', 'Tailscale', '30 jours'
expect(read('docs/incidents.md')).toContain('| Date | Faits | Données exposées | Mesures | Personnes prévenues |');
// l'ancien numéro TCA ['0810','037','037'].join('[ .]?') n'apparaît dans aucun fichier texte du dépôt (hors node_modules, .git, dist, .e2e-data,
//   test-results, playwright-report, docs/research, docs/superpowers)
```

- [ ] **Step 2: Run test to verify it fails**

`pnpm --filter @appsport/server test infra/docs` → `ENOENT … docs/exploitation/P1-installation.md`.

- [ ] **Step 3: Implement**

Chaque procédure : `# Pn <Titre>`, « Quand : … », « Durée : … », puis des étapes numérotées au format **action**, bloc de commande, « Résultat attendu : … », « Sinon : … ». Contenu imposé (08 §12 sauf mention) :
- P1 : sections dans l'ordre du test, contenu de 08 §12 P1 et §13 ; décisions à reprendre telles quelles : `/etc/crypttab` `appsport /dev/disk/by-partlabel/appsport-data none luks,noauto`, `/etc/fstab` `/dev/mapper/appsport /srv/appsport ext4 noauto,nofail 0 2`, `chattr +i /srv/appsport` **avant** le premier montage, `systemctl disable docker.service docker.socket` (Docker démarré par `appsport-unlock`), `tailscale serve --bg --https=443 http://127.0.0.1:3000`, liens `ln -s /opt/appsport/infra/host/appsport-* /usr/local/sbin/`, secrets en mode 600 ; chaque chaîne du test dans sa section (`IPV6=yes` dans `/etc/default/ufw` ; `known_hosts` de root vérifié contre l'empreinte publiée par GitHub) ; première installation dans l'ordre du test, sans `appsport-update` (qui exige une appli saine), `init` et `admin:bootstrap` par `run --rm --no-deps` ; « Recette » : 08 §13 puis `recette-telephones.md`.
- P2 : `ssh appsport` (Tailscale SSH « check »), `sudo appsport-unlock` → « OK : appsport répond (version vX.Y.Z). » ; sinon P8.
- P3 : CI de `main` verte, numéros de la page Aide revérifiés (03 §13.7), `recette-telephones.md` passée si la version touche `src/sw`, la synchro, `local-db` ou iOS (build de recette du poste, via son `tailscale serve`), sinon pas de tag ; `git tag`, workflow `release` vert, `sudo appsport-update vX.Y.Z` le soir, `deploy.log` (6 résultats), `--rollback` ; jeton GHCR expiré → P5.
- P4 « Sur place » : `privacy:collect` (`--source` du plus récent instantané si la base est illisible), `stop app`, `restore` (base remplacée gardée 30 jours dans `snapshots/replaced-…/`), `privacy:reapply` (« Aucun administrateur actif » → `admin:bootstrap`), liste supprimée, `up -d`, vérification des renvois ; « Nouvelle machine » : `/var/lib/tailscale` restauré avant `systemctl start tailscaled`, puis même séquence avec l'image de la même version.
- P5 (tableau de 08 §10, enveloppe refaite), P6 (08 §6), P7 (08 §12 P7 et `up -d --force-recreate app`, journaux de 90 jours au plus), P8 (une section par alerte de 08 §9 ; « Interrupteur d'urgence » : `SW_KILL_SWITCH=1` dans `secrets/app.env`, `up -d`, `swKill` lu sur `/api/health`, retrait après le correctif (P3) ; « Vol, cambriolage ou fuite » selon 03 §14, `admin:reset`), P9 (« Aucune invitation ni réinitialisation n'est possible sans admin. »).
- `recette-telephones.md` : iPhone et Android avec la PWA installée ; les 6 contrôles (« sans objet au socle » admis pour 2, 4 et 5 : aucune saisie J avant la brique 3), R-ONB-4 chronométré, interrupteur d'urgence et bandeau de mise à jour sur iPhone, au format « Résultat attendu / Sinon » ; tableau final.
- `installer-appsport.md` : 08 §6 côté proche et 08 §11, une ligne « Capture : à ajouter pendant P1 (captures/installer-0N.png). » par étape. Runbook (R-OPS-12) : chronométré, objectif moins de 2 h, restauration B2 sur une autre machine, destruction de la copie, tableau Date | Durée | Écarts constatés. Fiche de traitement : 03 §1, §2, §7, §10. `incidents.md` : consigne de 03 §14 (72 h), en-tête du test et « Aucun incident enregistré. »

- [ ] **Step 4: Run test to verify it passes**

`pnpm --filter @appsport/server test infra/docs` → `Test Files  1 passed`.

- [ ] **Step 5: Commit**

`git commit -m "docs(docs): procédures P1 à P9, runbook de reconstruction, fiche de traitement et registre des incidents"`

