import { useMemo } from 'react';
import { type AppServices, useServices } from '../app-services';
import { type AdminRepo, createAdminRepo } from './admin-repo';
import { type CatalogRepo, catalogRepoFor } from './catalog-repo';
import { type CoachRepo, coachRepoFor } from './coach-repo';
import { type ConsentRepo, createConsentRepo } from './consent-repo';
import { type CreditsRepo, createCreditsRepo } from './credits-repo';
import { createGymsRepo, type GymsRepo } from './gyms-repo';
import { createMeRepo, type MeRepo } from './me-repo';
import { type NutritionRepo, nutritionRepoFor } from './nutrition-repo';
import { createPlacesRepo, type PlacesRepo } from './places-repo';
import { createProfileRepo, type ProfileRepo } from './profile-repo';
import { type ProgramRepo, programRepoFor } from './program-repo';
import { type ProgramViewRepo, programViewFor } from './program-view';
import { createRejectionsRepo, type RejectionsRepo } from './rejections-repo';
import { createReviewRepo, type ReviewRepo } from './review-repo';
import { createStatusRepo, type StatusRepo } from './status-repo';
import { type WeighInsRepo, weighInRepoFor } from './weigh-in-repo';
import { type WorkoutsRepo, workoutRepoFor } from './workout-repo';

export type { AdminRepo } from './admin-repo';
export {
  type CatalogPlace,
  type CatalogRepo,
  type CatalogSnapshot,
  type CatalogState,
  type ExerciseFilter,
  type ExerciseGroupCount,
  type ExerciseSearch,
  type ExerciseView,
  type MemberCatalogContext,
  type SheetIllustration,
  type SheetView,
  sheetIllustrations,
  useCatalog,
  useExerciseView,
} from './catalog-repo';
export type { CoachRepo } from './coach-repo';
export type { ConsentRepo, LimitationView } from './consent-repo';
export type { CreditsRepo, CreditsView } from './credits-repo';
export { type DeviceSettings, useDeviceSettings } from './device-settings';
export type { GymsRepo } from './gyms-repo';
export type { DeviceOwner, MeRepo } from './me-repo';
export {
  type NutritionCheckinView,
  type NutritionRepo,
  type NutritionSettingsView,
  type NutritionTargetView,
  type NutritionView,
  useNutritionView,
} from './nutrition-repo';
export type { PlacesRepo, PlaceView } from './places-repo';
export type { ProfileRepo, TrainingProfileView } from './profile-repo';
export {
  changeErrorsOf,
  isExpired,
  isStaleRevision,
  type ProgramEditContext,
  type ProgramRepo,
  useProgramEditContext,
  useProgramTemplates,
  useRecommendation,
  useRecommendationNotice,
} from './program-repo';
export {
  type PlannedSession,
  type ProgramView,
  type ProgramViewRepo,
  type SwapCandidate,
  usePlannedWorkout,
  useProgramView,
  useSwapCandidates,
} from './program-view';
export type { RejectionsRepo, RejectionView } from './rejections-repo';
export {
  type CatalogExport,
  type CommentDraft,
  commentDraft,
  isLostAccess,
  ReviewAccessLostError,
  type ReviewListFilters,
  type ReviewRepo,
  revisionConflictOf,
  transitionBlockersOf,
} from './review-repo';
export { isLive, parseJsonColumn } from './rows';
export type { StatusRepo } from './status-repo';
export {
  useWeighIns,
  WeighInError,
  type WeighInErrorCode,
  type WeighInsRepo,
  type WeighInView,
} from './weigh-in-repo';
export {
  closeStaleAfterPull,
  type LiveContext,
  type NoteTarget,
  type SessionDecision,
  type SetInput,
  type StartInput,
  useActiveSession,
  useHistory,
  useLiveContext,
  useOtherDeviceSession,
  useSession,
  useSessionDecisions,
  WorkoutError,
  type WorkoutErrorCode,
  type WorkoutExerciseView,
  type WorkoutSessionView,
  type WorkoutSetView,
  type WorkoutsRepo,
} from './workout-repo';

/** Seul accès des écrans aux données : Dexie (miroirs, meta, outbox) et API en ligne (01 §2 et §3). */
export interface Repos {
  me: MeRepo;
  profile: ProfileRepo;
  places: PlacesRepo;
  gyms: GymsRepo;
  consent: ConsentRepo;
  admin: AdminRepo;
  rejections: RejectionsRepo;
  status: StatusRepo;
  catalog: CatalogRepo;
  credits: CreditsRepo;
  review: ReviewRepo;
  program: ProgramRepo;
  /** Séances : saisie hors ligne par l'outbox (spec brique 3 D2, D4, D12). */
  workouts: WorkoutsRepo;
  /** Programme actif, rejeu local et séance du jour (spec brique 3 §4.4.8). */
  programView: ProgramViewRepo;
  /** Coach IA : API en ligne et flux SSE, rien d'écrit sur l'appareil (spec brique 4 C17). */
  coach: CoachRepo;
  /** Nutrition : API en ligne, descente de mode hors ligne (spec brique 5 D11). */
  nutrition: NutritionRepo;
  /** Pesées : saisie hors ligne par l'outbox (spec brique 5 §6.3). */
  weighIns: WeighInsRepo;
}

export function createRepos(s: AppServices): Repos {
  return {
    me: createMeRepo(s),
    profile: createProfileRepo(s),
    places: createPlacesRepo(s),
    gyms: createGymsRepo(s),
    consent: createConsentRepo(s),
    admin: createAdminRepo(s),
    rejections: createRejectionsRepo(s),
    status: createStatusRepo(s),
    // Le même que celui des hooks du catalogue (`useCatalog`, `useExerciseView`).
    catalog: catalogRepoFor(s),
    credits: createCreditsRepo(s),
    review: createReviewRepo(s),
    // Le même que celui des hooks (`useRecommendation`, `useProgramTemplates`…).
    program: programRepoFor(s),
    // Les mêmes que ceux des hooks (`useActiveSession`, `useProgramView`…).
    workouts: workoutRepoFor(s),
    programView: programViewFor(s),
    // Le même que celui du magasin du coach.
    coach: coachRepoFor(s),
    nutrition: nutritionRepoFor(s),
    weighIns: weighInRepoFor(s),
  };
}

const cache = new WeakMap<AppServices, Repos>();

/** Dépôts de `services`, un seul jeu par services : ceux des écrans et ceux de main.tsx sont les mêmes. */
export function reposFor(services: AppServices): Repos {
  let repos = cache.get(services);
  if (!repos) {
    repos = createRepos(services);
    cache.set(services, repos);
  }
  return repos;
}

/** Dépôts des services courants (référence stable). */
export function useRepos(): Repos {
  const services = useServices();
  return useMemo(() => reposFor(services), [services]);
}
