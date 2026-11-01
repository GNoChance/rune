import {
  ChangeErrorsBody,
  type CreateChangeRequest,
  type DecideChangeRequest,
  type EnrollRequest,
  type ExerciseLevel,
  type InstanceChangeOperation,
  InstanceChangeView,
  type MachineStepRequest,
  ProgramInstanceView,
  ServedProgramTemplateSchema,
  type ServedSheet,
  type SessionProfile,
  SlotStateView,
} from '@rune/contracts';
import {
  levelFromExperience,
  type PlaceContext,
  type ProgramLevel,
  type Recommendation,
  recommendTemplate,
  type TemplateDescriptor,
} from '@rune/domain';
import { useMemo } from 'react';
import { z } from 'zod';
import { ApiError } from '../api/client';
import { type AppServices, useLive, useServices } from '../app-services';
import { getMeta, setMeta } from '../local-db/meta';
import { catalogRepoFor } from './catalog-repo';
import { createPlacesRepo } from './places-repo';
import { createProfileRepo } from './profile-repo';
import { placeContext } from './program-view';
import { currentUserId, ownedRows, sendThenPull } from './rows';

type ServedProgramTemplate = z.infer<typeof ServedProgramTemplateSchema>;

const EnrollResponse = z.object({ instance: ProgramInstanceView });
const ChangeResponse = z.object({ change: InstanceChangeView, instance: ProgramInstanceView });
const RejectResponse = z.object({ change: InstanceChangeView });
const MachineStepResponse = z.object({ slotState: SlotStateView });

/** Refus 422 `invalid_change` : une entrée par opération fautive (`op` = rang dans la demande) ; null sinon. */
export function changeErrorsOf(e: unknown): ChangeErrorsBody['errors'] | null {
  if (!(e instanceof ApiError) || e.code !== 'invalid_change') return null;
  const parsed = ChangeErrorsBody.safeParse(e.body);
  return parsed.success ? parsed.data.errors : null;
}

/** 409 `stale_revision` : le programme a changé, la proposition valable reste telle quelle. */
export const isStaleRevision = (e: unknown): boolean => e instanceof ApiError && e.code === 'stale_revision';

/** 409 `expired` : la proposition a expiré. */
export const isExpired = (e: unknown): boolean => e instanceof ApiError && e.code === 'expired';

/**
 * Programme (spec brique 3 §6), classe E : l'API d'abord, rien d'écrit en local, hors ligne
 * `NetworkRequiredError` (« Nécessite le réseau ») ; chaque appel réussi déclenche un pull qui ramène instance,
 * modifications et états de slot dans les miroirs. Les jours courants se lisent dans le programme effectif
 * (R35), pas dans `daysPerWeek` de l'instance, qui garde les jours de l'inscription.
 */
export interface ProgramRepo {
  /** Modèles servis du catalogue de l'appareil, avec leur disponibilité. */
  templates(): Promise<ServedProgramTemplate[]>;
  /** Modèle conseillé d'après le profil d'entraînement et le lieu principal ; null sans profil complet. */
  recommendation(): Promise<Recommendation | null>;
  enroll(templateId: string, daysPerWeek: number): Promise<ProgramInstanceView>;
  /** 422 : `changeErrorsOf` ; 409 `stale_revision` : `isStaleRevision`. */
  change(
    operations: InstanceChangeOperation[],
    baseRevision: number,
  ): Promise<{ change: InstanceChangeView; instance: ProgramInstanceView }>;
  /** 409 `stale_revision` : `isStaleRevision` ; 409 `expired` : `isExpired` ; 422 : `changeErrorsOf`. */
  accept(
    id: string,
    baseRevision: number,
  ): Promise<{ change: InstanceChangeView; instance: ProgramInstanceView }>;
  reject(id: string): Promise<InstanceChangeView>;
  /** `stepG` en grammes (500 à 10 000), ou null pour revenir au pas du lieu. */
  setMachineStep(slotStateId: string, stepG: number | null): Promise<SlotStateView>;
  /** Ce que lisent les écrans du programme pour résoudre les slots et valider un changement avant l'envoi. */
  editContext(): Promise<ProgramEditContext>;
  /**
   * R-REC-7 : le modèle recommandé à proposer dans le Profil (« Un autre programme te correspond mieux ») ; null sans
   * programme actif, sans recommandation, quand il est le modèle suivi, ou s'il a déjà été vu sur l'appareil. Rien ne
   * change d'inscription de soi-même.
   */
  recommendationNotice(): Promise<string | null>;
  /** Modèle recommandé vu (choisi à l'inscription, ou bandeau masqué) : il n'est plus proposé (meta, appareil). */
  acknowledgeRecommendation(templateId: string): Promise<void>;
}

/** Contexte des écrans du programme : fiches, lieux, profil et niveau, comme les lit le validateur du serveur. */
export interface ProgramEditContext {
  /** Fiches servies (publiées et retirées). */
  sheets: ServedSheet[];
  /** Lieux vivants de l'utilisateur, au format du moteur. */
  places: PlaceContext[];
  /** Lieu principal (exercice résolu de chaque slot, spec §7.7) ; null sans lieu principal. */
  primary: PlaceContext | null;
  /** Profil prudent (mineur, mode prudent, prudence santé) ou adulte. */
  profile: SessionProfile;
  /** Niveau d'après l'expérience (débutant faute de la connaître, comme le serveur). */
  level: ProgramLevel;
  maxLevel: ExerciseLevel;
  templates: ServedProgramTemplate[];
}

export function createProgramRepo(s: AppServices): ProgramRepo {
  const { db } = s;
  const profile = createProfileRepo(s);
  const places = createPlacesRepo(s);
  const catalog = catalogRepoFor(s);

  async function templates(): Promise<ServedProgramTemplate[]> {
    const rows: unknown[] = await db.table('programTemplates').toArray();
    return rows.flatMap((row) => {
      // Le magasin ajoute la clé `id` au modèle servi (LocalProgramTemplate), que le schéma strict refuse.
      const { id: _id, ...served } = row as Record<string, unknown>;
      const parsed = ServedProgramTemplateSchema.safeParse(served);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async function recommendation(): Promise<Recommendation | null> {
    const p = await profile.get();
    if (!p?.goal || !p.experience || !p.daysPerWeek) return null;
    const all = await places.list();
    const primary = all.find((x) => x.isPrimary) ?? all[0];
    const descriptors: TemplateDescriptor[] = (await templates()).map(({ template, available }) => ({
      id: template.id,
      context: template.context,
      level: template.level,
      days: { min: template.daysPerWeek.min, max: template.daysPerWeek.max },
      available,
    }));
    return recommendTemplate(
      {
        goal: p.goal,
        sportCode: p.sportCode,
        experience: p.experience,
        daysPerWeek: p.daysPerWeek,
        primaryPlaceKind: primary?.kind ?? 'home',
      },
      descriptors,
    );
  }

  return {
    templates,
    recommendation,
    async enroll(templateId, daysPerWeek) {
      const body: EnrollRequest = { templateId, daysPerWeek: daysPerWeek as EnrollRequest['daysPerWeek'] };
      const { instance } = await sendThenPull(s, 'POST', '/api/program/enroll', {
        body,
        schema: EnrollResponse,
      });
      return instance;
    },
    change(operations, baseRevision) {
      const body: CreateChangeRequest = { baseRevision, operations };
      return sendThenPull(s, 'POST', '/api/program/changes', { body, schema: ChangeResponse });
    },
    accept(id, baseRevision) {
      const body: DecideChangeRequest = { baseRevision };
      return sendThenPull(s, 'POST', `/api/program/changes/${encodeURIComponent(id)}/accept`, {
        body,
        schema: ChangeResponse,
      });
    },
    async reject(id) {
      const { change } = await sendThenPull(
        s,
        'POST',
        `/api/program/changes/${encodeURIComponent(id)}/reject`,
        {
          body: {},
          schema: RejectResponse,
        },
      );
      return change;
    },
    async setMachineStep(slotStateId, stepG) {
      const body: MachineStepRequest = { stepG };
      const { slotState } = await sendThenPull(
        s,
        'PUT',
        `/api/program/slot-states/${encodeURIComponent(slotStateId)}/machine-step`,
        { body, schema: MachineStepResponse },
      );
      return slotState;
    },
    async editContext() {
      const [sheets, member, all, training, served] = await Promise.all([
        catalog.sheets(),
        catalog.context(),
        places.list(),
        profile.get(),
        templates(),
      ]);
      const primary = all.find((p) => p.isPrimary);
      return {
        sheets,
        places: all.map(placeContext),
        primary: primary ? placeContext(primary) : null,
        profile: member.cautious ? 'cautious' : 'adult',
        level: training?.experience ? levelFromExperience(training.experience) : 'beginner',
        maxLevel: member.maxLevel,
        templates: served,
      };
    },
    async recommendationNotice() {
      const ownerId = await currentUserId(db);
      const active = (await ownedRows(db, 'program_instance', ownerId)).find((r) => r.status === 'active');
      if (active === undefined) return null;
      const recommended = (await recommendation())?.templateId ?? null;
      if (recommended === null || recommended === active.templateId) return null;
      return (await getMeta(db, 'recommendationSeen')) === recommended ? null : recommended;
    },
    async acknowledgeRecommendation(templateId) {
      await setMeta(db, 'recommendationSeen', templateId);
    },
  };
}

const repos = new WeakMap<AppServices, ProgramRepo>();

/** Un seul dépôt par services : celui des hooks ci-dessous et `useRepos().program` sont le même objet. */
export function programRepoFor(services: AppServices): ProgramRepo {
  let repo = repos.get(services);
  if (!repo) {
    repo = createProgramRepo(services);
    repos.set(services, repo);
  }
  return repo;
}

function useProgramRepo(): ProgramRepo {
  const services = useServices();
  return useMemo(() => programRepoFor(services), [services]);
}

/** Modèles servis, observés (suivent chaque téléchargement du catalogue) ; `undefined` tant que la base n'a pas répondu. */
export function useProgramTemplates(): ServedProgramTemplate[] | undefined {
  const repo = useProgramRepo();
  return useLive(() => repo.templates(), [repo]);
}

/** Recommandation, observée (profil, lieux, modèles) ; null sans profil complet. */
export function useRecommendation(): Recommendation | null | undefined {
  const repo = useProgramRepo();
  return useLive(() => repo.recommendation(), [repo]);
}

/** Contexte des écrans du programme, observé. */
export function useProgramEditContext(): ProgramEditContext | undefined {
  const repo = useProgramRepo();
  return useLive(() => repo.editContext(), [repo]);
}

/** Modèle à proposer dans le Profil (R-REC-7), observé ; null s'il n'y a rien à proposer. */
export function useRecommendationNotice(): string | null | undefined {
  const repo = useProgramRepo();
  return useLive(() => repo.recommendationNotice(), [repo]);
}
