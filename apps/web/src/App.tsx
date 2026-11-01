import type { MeResponse } from '@rune/contracts';
import { isReviewer } from '@rune/domain';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { useMeState, useSyncState } from './app-services';
import { AdminGymsPage } from './features/admin/AdminGymsPage';
import { InvitationsPage } from './features/admin/InvitationsPage';
import { MembersPage } from './features/admin/MembersPage';
import { ServerHealthPage } from './features/admin/ServerHealthPage';
import { InvitePage } from './features/auth/InvitePage';
import { LoginPage } from './features/auth/LoginPage';
import { ResetPage } from './features/auth/ResetPage';
import { MyCoachPage } from './features/coach/MyCoachPage';
import { ExerciseSheetPage } from './features/exercises/ExerciseSheetPage';
import { ExercisesHome } from './features/exercises/ExercisesHome';
import { GroupList } from './features/exercises/GroupList';
import { HomePage } from './features/home/HomePage';
import { OnboardingFlow } from './features/onboarding/OnboardingFlow';
import { GymPage } from './features/places/GymPage';
import { PlaceDetail } from './features/places/PlaceDetail';
import { PlacesPage } from './features/places/PlacesPage';
import { HealthReconsentGate } from './features/privacy/HealthReconsentGate';
import { HealthSection } from './features/privacy/HealthSection';
import { PrivacySettingsPage } from './features/privacy/PrivacySettingsPage';
import { ProfileHub } from './features/profile/ProfileHub';
import { ProfilePage } from './features/profile/ProfilePage';
import { ProgressionPage } from './features/progression/ProgressionPage';
import { CreditsPage } from './features/public/CreditsPage';
import { HelpPage } from './features/public/HelpPage';
import { NotFound } from './features/public/NotFound';
import { PrivacyPage } from './features/public/PrivacyPage';
import { HowToReviewFirstPass } from './features/review/HowToReview';
import { ReviewList } from './features/review/ReviewList';
import { ReviewSheet } from './features/review/ReviewSheet';
import { RejectionsPage } from './features/status/RejectionsPage';
import { SettingsPage } from './features/status/SettingsPage';
import { useRepos } from './repos';
import type { ConnectionState } from './sync/engine';
import { AppShell, PublicShell } from './ui';

/** Réglages de charge : hors du bundle initial, chargés à la première ouverture (fichier précaché par le SW). */
const PlaceLoadSettings = lazy(() =>
  import('./features/places/LoadSettingsPage').then((m) => ({ default: m.PlaceLoadSettings })),
);
const GymLoadSettings = lazy(() =>
  import('./features/places/LoadSettingsPage').then((m) => ({ default: m.GymLoadSettings })),
);

/** Historique des séances : hors du bundle initial, chargé à la première ouverture (fichiers précachés par le SW). */
const HistoryList = lazy(() =>
  import('./features/history/HistoryList').then((m) => ({ default: m.HistoryList })),
);
const HistoryDetail = lazy(() =>
  import('./features/history/HistoryDetail').then((m) => ({ default: m.HistoryDetail })),
);

/** Pages lisibles sans session (03 §13 : Confidentialité, Crédits, Aide) et parcours d'accès. */
export const PUBLIC_PATHS: readonly string[] = [
  '/login',
  '/invite',
  '/reset',
  '/privacy',
  '/credits',
  '/help',
];

export type GuardResult =
  | { kind: 'render' }
  | { kind: 'wait' }
  | { kind: 'redirect'; to: string }
  | { kind: 'not_found' };

const LOST_SESSION: readonly ConnectionState[] = ['unauthenticated', 'account_deleted'];

/** Sans tenir compte de la casse, comme les routes de wouter : `/Admin/members` est une page admin. */
const isAdminPath = (path: string) => {
  const p = path.toLowerCase();
  return p === '/admin' || p.startsWith('/admin/');
};

/** Relecture des exercices (spec brique 2 §4.4) : `/review` et tout ce qui est dessous, casse comprise. */
export const isReviewPath = (path: string) => {
  const p = normalizePath(path).toLowerCase();
  return p === '/review' || p.startsWith('/review/');
};

/**
 * Anciennes adresses des lieux : `/profile/places…` mène au même chemin sous `/places` (la suite, un identifiant
 * par exemple, est gardée telle quelle). Les lieux s'ouvrent depuis Profil › Mes lieux (spec brique 2, D5 :
 * l'onglet Salles devient Exercices) et gardent leurs adresses `/places…`.
 */
const MOVED_PLACES = /^\/profile\/places(\/.*)?$/i;

/** Mon profil : seule page servie tant que le mot de passe est à changer (R-MDP-1), le formulaire y est. */
const PROFILE_EDIT_PATH = '/profile/edit';

/** Chemin sans barre finale (`/privacy/` → `/privacy`), `/` gardé. */
export const normalizePath = (path: string): string => path.replace(/\/+$/, '') || '/';

/**
 * Garde des routes, dans l'ordre : chemin public ; base locale pas encore lue ; session absente ou
 * refusée par le serveur ; mot de passe à changer (R-MDP-1) ; onboarding ; rôle admin (R-ROLE-1) ; relecteur
 * effectif pour /review… (spec brique 2 §4.4 : drapeau ou admin, `isReviewer` ; un profil en cache d'avant la
 * brique 2, sans drapeaux, n'est pas relecteur) ; anciennes adresses des lieux. Les deux gardes de rôle
 * répondent comme une page introuvable.
 */
export function resolveGuard(i: {
  path: string;
  loaded: boolean;
  me: MeResponse | null;
  connection: ConnectionState;
}): GuardResult {
  const path = normalizePath(i.path);
  const sessionValid = i.me !== null && !LOST_SESSION.includes(i.connection);
  if (PUBLIC_PATHS.includes(path)) {
    return path === '/login' && sessionValid ? { kind: 'redirect', to: '/' } : { kind: 'render' };
  }
  if (!i.loaded) return { kind: 'wait' };
  if (!i.me || !sessionValid) return { kind: 'redirect', to: '/login' };
  if (i.me.mustChangePassword) {
    return path === PROFILE_EDIT_PATH ? { kind: 'render' } : { kind: 'redirect', to: PROFILE_EDIT_PATH };
  }
  const onboarded = i.me.onboardingCompletedAt !== null;
  if (!onboarded && path !== '/onboarding') return { kind: 'redirect', to: '/onboarding' };
  if (onboarded && path === '/onboarding') return { kind: 'redirect', to: '/' };
  if (isAdminPath(path) && i.me.role !== 'admin') return { kind: 'not_found' };
  if (isReviewPath(path) && !isReviewer(i.me)) return { kind: 'not_found' };
  const moved = MOVED_PLACES.exec(path);
  if (moved) return { kind: 'redirect', to: `/places${moved[1] ?? ''}` };
  return { kind: 'render' };
}

function PublicRoutes() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/invite" component={InvitePage} />
      <Route path="/reset" component={ResetPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/credits" component={CreditsPage} />
      <Route path="/help" component={HelpPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ConnectedRoutes() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/progression" component={ProgressionPage} />
      <Route path="/history" component={HistoryList} />
      <Route path="/history/:id">{(params) => <HistoryDetail id={params.id} />}</Route>
      <Route path="/exercises" component={ExercisesHome} />
      <Route path="/exercises/group">
        <Redirect to="/exercises" replace />
      </Route>
      <Route path="/exercises/group/:code" component={GroupList} />
      <Route path="/exercises/:id" component={ExerciseSheetPage} />
      <Route path="/places" component={PlacesPage} />
      <Route path="/places/:id" component={PlaceDetail} />
      <Route path="/places/:id/load" component={PlaceLoadSettings} />
      <Route path="/profile" component={ProfileHub} />
      <Route path="/profile/edit" component={ProfilePage} />
      <Route path="/profile/coach" component={MyCoachPage} />
      <Route path="/profile/health" component={HealthSection} />
      <Route path="/profile/privacy" component={PrivacySettingsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/rejections" component={RejectionsPage} />
      <Route path="/gyms/:id" component={GymPage} />
      <Route path="/gyms/:id/load" component={GymLoadSettings} />
      <Route path="/admin/members" component={MembersPage} />
      <Route path="/admin/invitations" component={InvitationsPage} />
      <Route path="/admin/gyms" component={AdminGymsPage} />
      <Route path="/admin/health" component={ServerHealthPage} />
      <Route path="/review">
        <Redirect to="/review/exercises" replace />
      </Route>
      <Route path="/review/exercises" component={ReviewList} />
      <Route path="/review/exercises/:id" component={ReviewSheet} />
      <Route component={NotFound} />
    </Switch>
  );
}

export function App() {
  const [path] = useLocation();
  const { loaded, me } = useMeState();
  const { connection } = useSyncState();
  const repos = useRepos();
  const knownUser = loaded && me !== null;
  const refreshed = useRef(false);
  // Profil frais au lancement si l'appareil connaît une session (ageBand, consentements, mot de
  // passe à changer) ; hors ligne : cache. Sans session connue, aucune requête (pages publiques).
  useEffect(() => {
    if (!knownUser || refreshed.current) return;
    refreshed.current = true;
    repos.me.refresh().catch(() => {});
  }, [repos, knownUser]);
  const guard = resolveGuard({ path, loaded, me, connection });

  switch (guard.kind) {
    case 'wait':
      return null;
    case 'redirect':
      return <Redirect to={guard.to} replace />;
    case 'not_found':
      return (
        <AppShell>
          <NotFound />
          <HealthReconsentGate />
        </AppShell>
      );
    case 'render': {
      const route = normalizePath(path);
      if (PUBLIC_PATHS.includes(route)) {
        return (
          <PublicShell>
            <PublicRoutes />
          </PublicShell>
        );
      }
      // L'onboarding n'a ni navigation de compte ni bandeau de mise à jour.
      if (route === '/onboarding') {
        return (
          <PublicShell homeLink={false}>
            <OnboardingFlow />
          </PublicShell>
        );
      }
      // Accord santé à redemander (R-CST-6) : sur tout écran connecté, jamais pendant l'onboarding.
      // « Comment relire » au premier passage sur n'importe quelle page de la relecture (spec brique 2 §4.4).
      return (
        <AppShell>
          <Suspense fallback={null}>
            <ConnectedRoutes />
          </Suspense>
          {isReviewPath(route) ? <HowToReviewFirstPass /> : null}
          <HealthReconsentGate />
        </AppShell>
      );
    }
  }
}
