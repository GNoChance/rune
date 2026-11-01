import { useMemo } from 'react';
import { type AppServices, useServices } from '../app-services';
import { type AdminRepo, createAdminRepo } from './admin-repo';
import { type CatalogRepo, catalogRepoFor } from './catalog-repo';
import { type ConsentRepo, createConsentRepo } from './consent-repo';
import { type CreditsRepo, createCreditsRepo } from './credits-repo';
import { createGymsRepo, type GymsRepo } from './gyms-repo';
import { createMeRepo, type MeRepo } from './me-repo';
import { createPlacesRepo, type PlacesRepo } from './places-repo';
import { createProfileRepo, type ProfileRepo } from './profile-repo';
import { createProgramRepo, type ProgramRepo } from './program-repo';
import { createRejectionsRepo, type RejectionsRepo } from './rejections-repo';
import { createReviewRepo, type ReviewRepo } from './review-repo';
import { createStatusRepo, type StatusRepo } from './status-repo';

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
export type { ConsentRepo, LimitationView } from './consent-repo';
export type { CreditsRepo, CreditsView } from './credits-repo';
export type { GymsRepo } from './gyms-repo';
export type { DeviceOwner, MeRepo } from './me-repo';
export type { PlacesRepo, PlaceView } from './places-repo';
export type { ProfileRepo, TrainingProfileView } from './profile-repo';
export { changeErrorsOf, isExpired, isStaleRevision, type ProgramRepo } from './program-repo';
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
    program: createProgramRepo(s),
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
