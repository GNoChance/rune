# Fiche de traitement Rune

Version 1.1 (`PRIVACY_POLICY_VERSION`), mise à jour le 2026-11-05 (coach IA), complétée le 2026-10-13 avant toute mise en service.

Cette fiche tient lieu de registre des traitements, obligatoire dès qu'on traite des données de santé (RGPD, art. 30.5). Elle est la source de la page Confidentialité de l'appli (`apps/web/src/features/public/privacy-content.ts`) : toute modification de fond change les deux, et la version `PRIVACY_POLICY_VERSION` (03 §1, §13.5). L'exemption domestique (art. 2.2.c) est plausible mais pas garantie : on ne s'y fie pas.

## Responsable

Le porteur du projet, personne physique, qui héberge le serveur chez lui, en France, à titre personnel et sans but lucratif. Son prénom figure sur la page Confidentialité (variable `VITE_OWNER_FIRST_NAME`). Contact : directement auprès de lui. Il est le seul administrateur, et le seul détenteur des clés au quotidien ; une copie scellée (enveloppe de secours, R-OPS-14) est confiée à une personne de confiance majeure, ouverte seulement en cas d'indisponibilité longue, pour permettre l'export (P9). Reportés tant que l'appli reste entre proches : AIPD, DPO, CGU, mentions légales.

## Finalités

- Suivi d'entraînement entre proches : comptes sur invitation, profil, lieux et matériel, programmes, séances et progression.
- Adaptation des séances et des repères aux données de santé, seulement avec l'accord santé.
- Séances et séries (brique 3) : enregistrement de chaque séance faite (exercices, séries, charges, répétitions, durées, effort ressenti), calcul des repères de charge à partir de cet historique, et export des séries en CSV à la demande de la personne.
- Coach IA, seulement avec l'accord coach.
- Relecture des fiches d'exercices (brique 2) : des membres volontaires, que l'admin désigne comme relectrices, commentent et valident les fiches ; une relectrice qui se déclare professionnelle de santé donne le feu vert santé des fiches sensibles. Base légale : l'accord de la personne, recueilli par l'admin avant de cocher un drapeau de relecteur.
- Sécurité du service : journal de sécurité, sessions, sauvegardes, supervision.

## Personnes concernées

De 2 à 5 personnes : le porteur et 1 à 4 proches, invités par lui. L'âge minimum est de 16 ans (`MIN_AGE`), vérifié par la date de naissance que saisit l'admin. Un mineur de 16 ou 17 ans consent seul dès 15 ans (loi Informatique et Libertés, art. 45) : aucun circuit d'accord parental.

## Catégories de données

| Cat. | Nom | Contenu | Accès dans l'appli |
|---|---|---|---|
| C0 | Interne | pour tout le cercle : référentiels (fiches d'exercices publiées, illustrations, matériel, modèles de programmes), salles partagées et leur historique, pseudos rendus visibles ; pour les relectrices et l'admin : fiches d'exercices en relecture, commentaires et validations de relecture, versions successives des fiches ; pour l'admin seulement : métadonnées de compte (pseudo, rôle, statut, date de naissance, mineur ou non, création, dernière connexion, état des accords, nombre de sessions actives, drapeaux de relecteur, coût IA du mois à partir de la brique 4), invitations, liens de réinitialisation, journal de sécurité (date, type, acteur, sujet, IP du tailnet, résultat ; aucune donnée C1 à C3) | le cercle, les relectrices ou l'admin, selon la ligne |
| C1 | Personnel | profil d'entraînement, lieux de type maison, visibilité par lieu, mode prudent manuel, programmes et modifications de programme, séances, séries, records, réglages, rejets de synchro, détail des sessions, historique des accords | le propriétaire seul |
| C2 | Santé | indicateur de prudence issu du questionnaire, limitations et zones sensibles, douleur, motif d'une modification de programme, taille, pesées, sexe utilisé par les formules, profil, cibles et bilans nutritionnels | le propriétaire seul, avec l'accord santé |
| C3 | Sensible | fils et messages du coach (tables `coach_thread` et `coach_message`), signalements (`coach_report`) | le propriétaire seul, avec l'accord coach ; un échange signalé devient lisible par l'admin |

Coach IA (spec de la brique 4, §6 et §14) : `coach_thread` (un fil par jour), `coach_message` (messages, dossier envoyé et blocs) et `coach_report` (échange signalé, copie choisie par la personne) sont C3 ; `coach_call` est le journal d'usage, sans contenu, en C1. Ces quatre tables sont exportées en entier. Le fil du jour n'existe que sur le serveur : rien du coach n'est gardé sur le téléphone. La personne lit le dossier envoyé dans « Ce que le coach voit » (Profil, Mon coach).

Séances, séries et programmes (spec de la brique 3, §5.5, §5.6 et §9) : les programmes suivis et leurs modifications, les séances, les exercices faits, les séries (charge, répétitions, durée, effort ressenti, cibles) et les décisions du moteur de progression sont C1 : le propriétaire seul. Quatre éléments sont C2 : le niveau de douleur d'un exercice, le remplacement d'un exercice pour cause de douleur (`swap_reason = pain`), les séries de douleur d'un slot (`pain_streak`) et le motif d'un changement de programme (`instance_change.reason`). Au retrait de l'accord santé, ces quatre éléments sont effacés avec de nouvelles révisions, les codes de raison `PAIN_*` des changements et des décisions sont réécrits en `USER_*`, aucun recalcul n'est fait et une suspension déjà décidée reste. Le profil prudent d'une séance (`profile`, adulte ou prudent) reste en C1, y compris après ce retrait : il mêle l'âge, le mode prudent manuel et l'indicateur de prudence sans dire lequel a joué, et les cibles et décisions passées le reflètent de toute façon. Le CSV des séries (`GET /api/me/export/sets.csv`, en ligne seulement) contient les séries faites du compte seul, sous un en-tête fixe ; sa colonne douleur n'existe que si l'accord santé est actif ; il est journalisé (`data_exported`) sans contenu ; une requête venue d'un autre site est refusée (`origin_mismatch`). L'export JSON contient les sept tables de la brique, sans les copies provisoires du téléphone.

C0 ne veut pas dire « non personnel » : C0 regroupe ce que le cercle ou l'admin voit par conception. Exception : les sessions sont C1 mais ne sont pas exportées (R-EXP-2) ; à la suppression du compte, elles sont anonymisées, puis purgées à leur expiration absolue (P-DRT-3).

Drapeaux de relecteur (spec de la brique 2, §3.1) : « relectrice » (`catalog_reviewer`) et « professionnelle de santé » (`health_professional`) sont C0 pour l'admin, comme le rôle. Ce ne sont pas des données de santé mais une qualification professionnelle déclarée. La personne voit ses propres drapeaux ; les autres membres ne les voient jamais ; les autres relectrices ne savent pas qui est professionnelle de santé et voient seulement si le feu vert santé d'une fiche est à jour ; seul l'admin voit qui a donné un feu vert santé. Chaque changement de drapeau exige le mot de passe de l'admin et s'inscrit au journal de sécurité, avec les valeurs avant et après.

Exception à P-CAT-3 : les commentaires et les validations de relecture sont C0, mais l'export d'une personne contient ceux qu'elle a écrits (spec de la brique 2, §3.9) ; les versions successives des fiches ne sont pas exportées, car elles ne contiennent aucune donnée de la personne. Ses drapeaux sont dans son export et effacés avec son compte ; ses commentaires et validations restent attachés aux fiches, sans auteur. Un commentaire envoyé ne se modifie ni ne se supprime (spec de la brique 2, §3.3).

Aucun e-mail n'est collecté : l'identifiant est un pseudo. Les empreintes de mot de passe et de jetons sont hors catégorie : elles ne sont jamais exportées, synchronisées, journalisées ni renvoyées par l'API. Le porteur voit l'adresse du compte Tailscale de chaque proche, une information gérée par Tailscale. L'admin a la main sur le serveur et peut techniquement lire la base : il s'engage à ne faire aucune requête manuelle sur les données d'une personne sans son accord (P-ADM-3).

## Destinataires

- Dans le cercle : les données C0 seulement (salles partagées, pseudos rendus visibles) ; l'admin voit les métadonnées de compte, jamais les données C1 à C3 d'un autre dans l'appli, sauf un échange signalé (`coach_report`, P-ADM-1).
- Relecture des fiches d'exercices : les relectrices et l'admin voient les fiches en relecture et les commentaires, avec leur auteur ; seul l'admin voit les drapeaux de relecteur et qui a validé une fiche.
- Anthropic (coach, brique 4) : avec l'accord coach, les messages et le dossier du coach : tranche d'âge (`age_band`, jamais l'âge exact), niveau, objectif, contexte, matériel, programme, historique récent ; C2 seulement si les accords santé et coach sont actifs (P-COA-1). Jamais : pseudo, date de naissance, identifiant interne, nom ou enseigne de la salle, autres membres, adresse IP.
- Backblaze (B2) : sauvegardes chiffrées côté client avant de quitter le serveur ; Backblaze ne voit que des données chiffrées.
- Tailscale (réseau) : comptes Tailscale des proches et métadonnées de leurs appareils ; le trafic de l'appli reste chiffré de bout en bout.
- Personne de confiance majeure, gardienne de l'enveloppe de secours : aucun accès au quotidien. La copie scellée des clés (phrase du volume chiffré ; nom et mot de passe du compte Unix du serveur, qui a les droits sudo ; mot de passe des sauvegardes ; clé B2) donne, une fois ouverte, le même accès technique que l'admin au serveur et à la base. Elle n'est ouverte qu'en cas d'indisponibilité longue de l'admin, pour remettre le serveur en marche afin que les proches exportent leurs données, puis pour effacer les sauvegardes et arrêter le service (P9). La personne de confiance s'engage, comme l'admin, à ne faire aucune requête manuelle sur les données d'une personne sans son accord (P-ADM-3).

Aucun autre sous-traitant : ni statistiques, ni traceur, ni service tiers dans l'appli (P-LOG-4) ; la supervision (Healthchecks.io) ne reçoit aucune donnée personnelle.

## Transferts hors UE

- Anthropic, États-Unis : messages et dossier du coach, avec l'accord coach qui l'annonce. Anthropic n'entraîne pas ses modèles sur ces données et les efface sous 30 jours, ou jusqu'à 2 ans si ses filtres de sécurité signalent un échange.
- Backblaze, société américaine : données stockées en région UE (EU Central), chiffrées côté client ; les clés restent chez le porteur (copie scellée chez la personne de confiance, voir Destinataires). Choix assumé, inscrit ici.
- Tailscale, société américaine : serveur de coordination et relais éventuels, sans accès au contenu du trafic.

## Durées de conservation

| Donnée | Durée |
|---|---|
| C0 de compte, C1 | tant que le compte existe |
| C2 | tant que le compte existe et que l'accord santé est actif ; supprimées au retrait |
| Fils et messages du coach (C3) | 90 jours après le dernier message ; suppression possible à tout moment |
| Signalements (C3) | jusqu'au classement par l'admin, 90 jours au plus |
| Journal d'usage du coach (sans contenu) | 12 mois |
| Côté Anthropic | 30 jours au plus ; 2 ans au plus si l'échange est signalé |
| Sessions | 90 jours sans usage, 365 jours au maximum ; lignes fermées purgées 30 jours après |
| Sessions `account_deleted` | jusqu'à leur expiration absolue ; anonymisées dès la suppression du compte (P-DRT-3) |
| Invitations, liens de réinitialisation | 7 jours ou 24 h, usage unique ; purgés 30 jours après |
| Journal de sécurité | 12 mois |
| Journaux techniques | 90 jours au plus |
| Marques de suppression de la synchro (tombstones) | 90 jours (`TOMBSTONE_TTL`) ; les salles et lieux supprimés restent, pour l'historique (R-SAL-7, R-LIEU-5 du socle) |
| Journal d'idempotence de la synchro (`applied_op` : identifiants d'opération, sans contenu) | 12 mois (R-SYN-23) ; supprimé avec le compte |
| Sauvegardes | 30 jours au plus, instantanés locaux compris ; effacées à l'arrêt du service, après le dernier export de chaque proche (P9) |
| Données locales du téléphone | jusqu'à la déconnexion (si la file d'envoi est vide), au retrait d'un accord pour la catégorie concernée, ou jusqu'au `410 account_deleted` |

## Mesures de sécurité

- Aucune exposition sur Internet : ni redirection de port ni Funnel ; seule entrée de l'appli : `tailscale serve` (HTTPS) ; administration par Tailscale SSH et, en secours, SSH depuis le réseau local ; pare-feu en refus par défaut, en IPv4 comme en IPv6.
- L'appli n'écoute que sur `127.0.0.1` ; la base n'est jamais joignable par le réseau.
- Partage de la seule machine `rune` avec le compte Tailscale de chaque proche, limité au port 443 ; l'admin, seul membre du tailnet, a une double authentification.
- Noms publics : le nom de machine `rune` et le nom du tailnet, aléatoire et sans nom de personne, figurent dans les journaux publics de certificats ; rien de personnel.
- Données chiffrées au repos (volume LUKS déverrouillé à la main) ; sauvegardes chiffrées par restic, une copie hors du domicile, test de restauration chaque mois.
- Authentification obligatoire dans l'appli : mots de passe Argon2id, limitation des échecs, cookie `__Host-session`, contrôle de l'origine des requêtes ; en-têtes HSTS, CSP `default-src 'self'` sans script en ligne et `frame-ancestors 'none'` (P-AUT-9).
- Séparation des données : l'admin n'a aucune route vers les données C1 à C3 d'un autre (réponse `404`), sauf un échange signalé (`coach_report`, P-ADM-1).
- Clé API Anthropic sur le serveur seulement, jamais dans le client ni dans le dépôt ; limite de dépense fixée dans la console.
- Flux sortants du serveur : API Claude, mises à jour, sauvegardes, sonde de supervision ; aucun autre.
- Journaux sans corps de requête, cookie, jeton, code ni valeur C1 à C3.
- Export et suppression du compte en libre-service ; retrait d'un accord avec effacement immédiat ; suppressions réappliquées après toute restauration (03 §8).
- Secrets sur le volume chiffré, rotation selon P5 ; enveloppe de secours scellée chez une personne de confiance.
- Incident : procédure P8, proches concernés prévenus sous 72 h, registre [incidents.md](incidents.md).
