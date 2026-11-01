import {
  ChangeErrorsBody,
  type CreateChangeRequest,
  type DecideChangeRequest,
  type EnrollRequest,
  type InstanceChangeOperation,
  InstanceChangeView,
  type MachineStepRequest,
  ProgramInstanceView,
  ServedProgramTemplateSchema,
  SlotStateView,
} from '@rune/contracts';
import { type Recommendation, recommendTemplate, type TemplateDescriptor } from '@rune/domain';
import { z } from 'zod';
import { ApiError } from '../api/client';
import type { AppServices } from '../app-services';
import { createPlacesRepo } from './places-repo';
import { createProfileRepo } from './profile-repo';
import { sendThenPull } from './rows';

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
}

export function createProgramRepo(s: AppServices): ProgramRepo {
  const { db } = s;
  const profile = createProfileRepo(s);
  const places = createPlacesRepo(s);

  async function templates(): Promise<ServedProgramTemplate[]> {
    const rows: unknown[] = await db.table('programTemplates').toArray();
    return rows.flatMap((row) => {
      // Le magasin ajoute la clé `id` au modèle servi (LocalProgramTemplate), que le schéma strict refuse.
      const { id: _id, ...served } = row as Record<string, unknown>;
      const parsed = ServedProgramTemplateSchema.safeParse(served);
      return parsed.success ? [parsed.data] : [];
    });
  }

  return {
    templates,
    async recommendation() {
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
    },
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
  };
}
