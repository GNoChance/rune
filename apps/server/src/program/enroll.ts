import type { ProgramInstanceView, ProgramTemplate, ServedProgramTemplate } from '@rune/contracts';
import { currentRules } from '@rune/domain';
import type { Selectable } from 'kysely';
import { writeStamp } from '../db/rev';
import type { DbExecutor, ProgramInstanceTable } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { expireProposals } from './expire';

/*
 * Inscription à un programme (spec brique 3 §6, D5 ; 05 §6.1) : une seule instance active par membre, dont le
 * `snapshot` est le modèle servi entier, jamais réécrit. Le changement de modèle (`switch_template`, D18) crée la
 * nouvelle instance par `insertInstance`.
 */

export type InstanceRow = Selectable<ProgramInstanceTable>;

export function instanceView(r: InstanceRow): ProgramInstanceView {
  return {
    id: r.id,
    templateId: r.templateId,
    templateVersion: r.templateVersion,
    daysPerWeek: r.daysPerWeek,
    status: r.status,
    revision: r.revision,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  };
}

/** Instance active et vivante de `ownerId`, s'il en a une (index unique partiel, 09 §3). */
export function activeInstance(db: DbExecutor, ownerId: string): Promise<InstanceRow | undefined> {
  return db
    .selectFrom('programInstance')
    .selectAll()
    .where('ownerId', '=', ownerId)
    .where('status', '=', 'active')
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
}

/** Jours par semaine permis par un modèle : ses bornes, dans celles des règles (2 à 4, 05 §15). */
export function daysRange(template: ProgramTemplate): readonly [number, number] {
  const [low, high] = currentRules().programBounds.days;
  return [Math.max(template.daysPerWeek.min, low), Math.min(template.daysPerWeek.max, high)];
}

/** Modèle servi et disponible d'identifiant `templateId`, s'il y en a un. */
export const availableTemplate = (
  served: readonly ServedProgramTemplate[],
  templateId: string,
): ProgramTemplate | undefined => served.find((s) => s.template.id === templateId && s.available)?.template;

/**
 * Nouvelle instance active de `ownerId` (05 §6.1) : `snapshot` = le modèle servi entier (D5), sa version, révision 0,
 * commencée maintenant. L'appelant a vérifié qu'aucune autre instance n'est active.
 */
export async function insertInstance(
  trx: DbExecutor,
  deps: AppDeps,
  ownerId: string,
  template: ProgramTemplate,
  daysPerWeek: number,
): Promise<InstanceRow> {
  const stamp = await writeStamp(trx, deps, ownerId);
  return trx
    .insertInto('programInstance')
    .values({
      id: deps.ids.uuidv7(),
      ownerId,
      templateId: template.id,
      templateVersion: template.version,
      snapshot: JSON.stringify(template),
      daysPerWeek,
      status: 'active',
      revision: 0,
      startedAt: stamp.updatedAt,
      endedAt: null,
      createdAt: stamp.updatedAt,
      deletedAt: null,
      ...stamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * `POST /api/program/enroll` : 409 `already_enrolled` si une instance est active (passer par `switch_template`),
 * 422 `template_unavailable` pour un modèle inconnu ou indisponible, 422 `days_out_of_range` hors des jours permis.
 */
export async function enroll(
  trx: DbExecutor,
  deps: AppDeps,
  ownerId: string,
  body: { templateId: string; daysPerWeek: number },
  served: readonly ServedProgramTemplate[],
): Promise<ProgramInstanceView> {
  await expireProposals(trx, ownerId, deps.clock.now());
  if (await activeInstance(trx, ownerId)) throw httpError('already_enrolled');
  const template = availableTemplate(served, body.templateId);
  if (template === undefined) throw httpError('template_unavailable');
  const [min, max] = daysRange(template);
  if (body.daysPerWeek < min || body.daysPerWeek > max) throw httpError('days_out_of_range');
  return instanceView(await insertInstance(trx, deps, ownerId, template, body.daysPerWeek));
}
