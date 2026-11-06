import type { MeResponse } from '@rune/contracts';
import { isHealthReviewer, isReviewer } from '@rune/domain';
import { useCallback, useRef, useState } from 'react';
import { useSearch } from 'wouter';
import { useLive, useMe, useSyncState } from '../../app-services';
import { useNutritionView, useRepos } from '../../repos';
import {
  Badge,
  Banner,
  COACH_NAMES,
  CoachAvatar,
  ListGroup,
  ListRow,
  Page,
  plural,
  RankBadge,
} from '../../ui';
import { LogoutDialog } from '../auth/LogoutDialog';
import { NUTRITION_TEXTS } from '../nutrition/nutrition-texts';
import { REVIEW_ACCESS_LOST_MESSAGE, REVIEW_ACCESS_LOST_REASON } from '../review/use-lost-access';
import {
  ChatIcon,
  HeartIcon,
  HelpIcon,
  LogoutIcon,
  NutritionIcon,
  PinIcon,
  ReviewIcon,
  ShieldIcon,
  SlidersIcon,
  TargetIcon,
  UsersIcon,
} from './icons';
import styles from './profile.module.css';
import { profileSummary } from './profile-summary';
import { RecommendationBanner } from './RecommendationBanner';
import { useFocusAfterClose } from './use-focus-after-close';

/**
 * Valeur de la ligne « Relecture des exercices » : ce que le compte y fait. La relectrice santé y lit son propre
 * drapeau (spec brique 2 §3.1) ; l'admin n'est jamais relecteur santé.
 */
function reviewRowValue(me: MeResponse): string {
  if (me.role === 'admin') return 'Corriger, valider et publier les fiches';
  return isHealthReviewer(me) ? 'Commenter, donner le feu vert santé' : 'Commenter et valider les fiches';
}

/**
 * Espace Profil (spec refonte §5, maquette C01), qui remplace « Plus » : l'en-tête du compte (initiale,
 * pseudo, rôle, rang), puis les lignes groupées (Entraînement ; Compte et appli, avec un badge sur Réglages
 * quand la synchro a des refus ; Cercle pour l'admin et les relecteurs : Administration, puis « Relecture des
 * exercices », spec brique 2 §4.4), et « Se déconnecter » à part, en bas, qui ouvre la feuille où se choisit cet
 * appareil ou tous. Les valeurs des lignes sont lues sur l'appareil, jamais inventées : une valeur pas encore
 * connue n'est pas affichée. Au retour d'une relecture refusée en pleine session (`?reason=review_access_lost`),
 * un bandeau le dit. Quand le modèle de programme recommandé change, un bandeau le propose (R-REC-7).
 */
export function ProfileHub() {
  const me = useMe();
  const repos = useRepos();
  const search = useSearch();
  const { rejected } = useSyncState();
  const profile = useLive(() => repos.profile.get(), [repos]);
  const places = useLive(() => repos.places.list(), [repos]);
  const limitations = useLive(() => repos.consent.limitations(), [repos]);
  const nutrition = useNutritionView();
  const [logout, setLogout] = useState(false);
  const logoutRow = useRef<HTMLDivElement>(null);
  const closeLogout = useCallback(() => setLogout(false), []);
  useFocusAfterClose(logout, () => logoutRow.current?.querySelector('button'));
  if (!me) return null;

  const coach = profile?.coach ?? null;
  const primary = places?.find((p) => p.isPrimary)?.name;
  const activeLimitations = limitations?.filter((l) => l.active).length ?? 0;
  const health = me.consents.health.active
    ? `Accord donné${activeLimitations > 0 ? ` · ${activeLimitations} ${plural(activeLimitations, 'limitation', 'limitations')}` : ''}`
    : 'Accord non donné';
  const reviewer = isReviewer(me);
  const accessLost = new URLSearchParams(search).get('reason') === REVIEW_ACCESS_LOST_REASON;

  return (
    <Page title="Profil">
      {accessLost ? <Banner tone="warning">{REVIEW_ACCESS_LOST_MESSAGE}</Banner> : null}
      <RecommendationBanner />
      <div className={`${styles.hub} stagger`}>
        <section aria-label="Ton compte" className={styles.account}>
          <span className={styles.initial} aria-hidden="true">
            {me.username.charAt(0).toUpperCase()}
          </span>
          <span className={styles.who}>
            <span className={styles.username}>{me.username}</span>
            <Badge tone="accent">{me.role === 'admin' ? 'Admin' : 'Membre'}</Badge>
          </span>
          <RankBadge rank="E" size={40} mini />
        </section>
        <nav aria-label="Pages du profil" className={styles.groups}>
          <ListGroup title="Entraînement">
            <ListRow
              icon={<TargetIcon />}
              label="Mon profil"
              value={profileSummary(profile ?? null)}
              href="/profile/edit"
            />
            <ListRow
              icon={
                coach ? (
                  <span className={styles.coachIcon}>
                    <CoachAvatar coach={coach} size={36} decorative />
                  </span>
                ) : (
                  <ChatIcon />
                )
              }
              label="Mon coach"
              value={coach ? `${COACH_NAMES[coach]} · entraînement et nutrition` : undefined}
              href="/profile/coach"
            />
            <ListRow icon={<PinIcon />} label="Mes lieux" value={primary} href="/places" />
            <ListRow
              icon={<NutritionIcon />}
              label="Nutrition"
              value={nutrition ? NUTRITION_TEXTS.entry[nutrition.mode] : undefined}
              href="/nutrition"
            />
            <ListRow
              icon={<HeartIcon />}
              label="Santé"
              value={limitations === undefined ? undefined : health}
              href="/profile/health"
            />
          </ListGroup>
          <ListGroup title="Compte et appli">
            <ListRow
              icon={<ShieldIcon />}
              label="Confidentialité et données"
              value="Accords, export, suppression"
              href="/profile/privacy"
            />
            <ListRow
              icon={<SlidersIcon />}
              label="Réglages"
              value="Apparence, synchronisation"
              href="/settings"
              badge={
                rejected > 0 ? (
                  <Badge tone="warning">{`${rejected} ${plural(rejected, 'refusé', 'refusés')}`}</Badge>
                ) : undefined
              }
            />
            <ListRow icon={<HelpIcon />} label="Aide" value="En cas d'urgence : 15 ou 112" href="/help" />
          </ListGroup>
          {/* Un admin est toujours relecteur : le groupe n'existe que pour un relecteur effectif. */}
          {reviewer ? (
            <ListGroup title="Cercle">
              {me.role === 'admin' ? (
                <ListRow
                  icon={<UsersIcon />}
                  label="Administration"
                  value="Membres, invitations, salles"
                  href="/admin/members"
                />
              ) : null}
              <ListRow
                icon={<ReviewIcon />}
                label="Relecture des exercices"
                value={reviewRowValue(me)}
                href="/review/exercises"
              />
            </ListGroup>
          ) : null}
        </nav>
        <div ref={logoutRow}>
          <ListGroup>
            <ListRow
              icon={<LogoutIcon />}
              label="Se déconnecter"
              tone="danger"
              onClick={() => setLogout(true)}
            />
          </ListGroup>
        </div>
      </div>
      <LogoutDialog open={logout} onClose={closeLogout} />
    </Page>
  );
}
