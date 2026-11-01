import {
  type CatalogBundle,
  type ChangeAuthor,
  type CreateChangeRequest,
  type DecideChangeRequest,
  type InstanceChangeOperation,
  InstanceChangeOperationSchema,
  type InstanceChangeView,
  MAX_CHANGE_OPERATIONS,
  type ProgramInstanceView,
} from '@rune/contracts';
import { type EffectiveProgram, effectiveProgram, levelFromExperience, validateChange } from '@rune/domain';
import type { Selectable, Transaction } from 'kysely';
import { z } from 'zod';
import { userTraits } from '../auth/me';
import { writeStamp } from '../db/rev';
import type { Database, DbExecutor, InstanceChangeTable } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { isHealthConsentActive } from '../privacy/consent-state';
import {
  activeInstance,
  availableTemplate,
  daysRange,
  type InstanceRow,
  insertInstance,
  instanceView,
} from './enroll';
import { expireProposals } from './expire';
import { acceptedChanges, parseSnapshot, placesOf, replayInstanceInDb } from './replay-service';

/*
 * Changements de programme (spec brique 3 §6, D5, D18 ; 05 §6 et §15) : le journal `instance_change` est en ajout
 * seul ; une ligne ne passe que de `proposed` à `accepted`, `rejected` ou `expired`. Un changement de l'utilisateur
 * naît accepté. Toute acceptation passe le validateur sur le programme effectif, incrémente `revision` et rejoue
 * l'instance dans la même transaction. `days_per_week` de l'instance reste celui de l'inscription : c'est l'entrée du
 * rejeu (`ReplayInput`), et les `set_days_per_week` acceptés font les jours en vigueur (programme effectif).
 */

type Trx = Transaction<Database>;
export type ChangeRow = Selectable<InstanceChangeTable>;

/** Catalogue servi : fiches connues et modèles avec leur disponibilité. */
export type ServedCatalog = Pick<CatalogBundle, 'exercises' | 'programTemplates'>;

/** Refus qui laisse la transaction s'achever : l'expiration de la proposition est gardée. */
export type Refusal = { refused: 'expired' | 'stale_revision' | 'not_proposed' };

const Operations = z.array(InstanceChangeOperationSchema).min(1).max(MAX_CHANGE_OPERATIONS);

/** Opérations d'une ligne écrite par le serveur ; une ligne illisible est une erreur interne. */
const operationsOf = (row: ChangeRow): InstanceChangeOperation[] =>
  Operations.parse(JSON.parse(row.operations));

/** Vue d'un changement ; `reason` est C2 : rendu seulement avec le consentement santé actif. */
export function changeView(r: ChangeRow, consent: boolean): InstanceChangeView {
  return {
    id: r.id,
    instanceId: r.instanceId,
    baseRevision: r.baseRevision,
    author: r.author,
    operations: operationsOf(r),
    reasonCode: r.reasonCode as InstanceChangeView['reasonCode'],
    reason: consent ? r.reason : null,
    status: r.status,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    decidedAt: r.decidedAt,
  };
}

/** Changement vivant de `ownerId`, sinon 404 : aucune exception pour l'admin (05 §17.8, P-ADM-2). */
export async function ownChange(db: DbExecutor, ownerId: string, id: string): Promise<ChangeRow> {
  const row = await db
    .selectFrom('instanceChange')
    .selectAll()
    .where('id', '=', id)
    .where('ownerId', '=', ownerId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (!row) throw httpError('not_found');
  return row;
}

const instanceById = (db: DbExecutor, ownerId: string, id: string) =>
  db
    .selectFrom('programInstance')
    .selectAll()
    .where('id', '=', id)
    .where('ownerId', '=', ownerId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();

/**
 * Programme effectif de l'instance (D5) : son `snapshot` plus ses changements acceptés. Un `snapshot` ou un changement
 * illisible (jamais écrit ainsi par le serveur) est une erreur interne.
 */
export async function instanceProgram(
  db: DbExecutor,
  instance: Pick<InstanceRow, 'id' | 'ownerId' | 'snapshot' | 'daysPerWeek'>,
): Promise<EffectiveProgram> {
  const snapshot = parseSnapshot(instance.snapshot);
  const changes = await acceptedChanges(db, instance);
  if (snapshot === null || changes === null) throw new Error('program_unreadable');
  return effectiveProgram(snapshot, instance.daysPerWeek, changes);
}

interface PendingChange {
  id: string;
  author: ChangeAuthor;
  baseRevision: number;
  operations: readonly InstanceChangeOperation[];
}

/**
 * Validateur des changements (05 §15) sur le programme effectif de l'instance, avec le profil (prudent ou non), le
 * niveau (`experience`), les lieux vivants et le catalogue servi du membre. Rend le programme résultant ; 422
 * `invalid_change` avec une erreur par opération fautive sinon.
 */
async function validate(
  trx: DbExecutor,
  deps: AppDeps,
  instance: InstanceRow,
  change: PendingChange,
  catalog: ServedCatalog,
): Promise<EffectiveProgram> {
  const { ownerId } = instance;
  const { cautious } = await userTraits(trx, deps, ownerId);
  const training = await trx
    .selectFrom('trainingProfile')
    .select('experience')
    .where('ownerId', '=', ownerId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  const result = validateChange({
    program: await instanceProgram(trx, instance),
    revision: instance.revision,
    change,
    catalog: catalog.exercises,
    places: [...(await placesOf(trx, ownerId, { live: true })).values()],
    profile: cautious ? 'cautious' : 'adult',
    level: training?.experience == null ? 'beginner' : levelFromExperience(training.experience),
    servedTemplates: catalog.programTemplates,
    instanceTemplateVersion: instance.templateVersion,
  });
  if (!result.ok) throw httpError('invalid_change', { errors: result.errors });
  return result.program;
}

/** Changement de modèle porté par le changement : le dernier `switch_template`, s'il y en a un. */
const switchOf = (operations: readonly InstanceChangeOperation[]) =>
  operations.findLast((op) => op.op === 'switch_template');

/** `switch_template` pendant une séance de l'instance → 409 `session_in_progress` (spec §6). */
async function assertNoSessionInProgress(trx: DbExecutor, instance: InstanceRow): Promise<void> {
  const running = await trx
    .selectFrom('workoutSession')
    .select('id')
    .where('ownerId', '=', instance.ownerId)
    .where('instanceId', '=', instance.id)
    .where('status', '=', 'in_progress')
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (running) throw httpError('session_in_progress');
}

/**
 * Effet d'un changement accepté sur son instance (05 §15.3) : `revision` + 1, puis rejeu dans la transaction. Un
 * `switch_template` (05 §6.2, D18) termine l'instance et en crée une nouvelle, active, sur le modèle servi ; sans
 * `daysPerWeek`, les jours en vigueur (`program`, changement compris) sont ramenés dans les bornes du nouveau modèle.
 * Rend l'instance que le membre suit désormais.
 */
async function applyAccepted(
  trx: Trx,
  deps: AppDeps,
  userId: string,
  instance: InstanceRow,
  operations: readonly InstanceChangeOperation[],
  program: EffectiveProgram,
  catalog: ServedCatalog,
): Promise<InstanceRow> {
  const switched = switchOf(operations);
  const stamp = await writeStamp(trx, deps, userId);
  await trx
    .updateTable('programInstance')
    .set({
      revision: instance.revision + 1,
      ...(switched ? { status: 'ended' as const, endedAt: stamp.updatedAt } : {}),
      ...stamp,
    })
    .where('id', '=', instance.id)
    .execute();
  let followed = instance.id;
  if (switched) {
    const template = availableTemplate(catalog.programTemplates, switched.templateId);
    // Le validateur a refusé un modèle indisponible : il est servi.
    if (template === undefined) throw new Error('switch_template_unavailable');
    const [min, max] = daysRange(template);
    const days = switched.daysPerWeek ?? Math.min(Math.max(program.daysPerWeek, min), max);
    followed = (await insertInstance(trx, deps, userId, template, days)).id;
  }
  await replayInstanceInDb(trx, { ownerId: userId, instanceId: instance.id }, deps);
  const row = await instanceById(trx, userId, followed);
  if (!row) throw new Error('instance_vanished');
  return row;
}

async function decidedView(
  trx: DbExecutor,
  userId: string,
  changeId: string,
  instance: InstanceRow,
): Promise<{ change: InstanceChangeView; instance: ProgramInstanceView }> {
  const consent = await isHealthConsentActive(trx, userId);
  return {
    change: changeView(await ownChange(trx, userId, changeId), consent),
    instance: instanceView(instance),
  };
}

/**
 * `POST /api/program/changes` : changement de l'utilisateur sur son instance active, accepté d'emblée (05 §15.2) :
 * `author` `user`, `reason_code` `USER_CHANGE`, `decided_at` maintenant. 404 sans instance active, 409
 * `stale_revision` si `baseRevision` n'est pas la révision courante, 422 `invalid_change` si le validateur refuse,
 * 409 `session_in_progress` pour un `switch_template` pendant une séance. Le changement reste attaché à l'instance
 * qu'il modifie, l'ancienne pour un `switch_template` ; l'instance rendue est celle que le membre suit.
 */
export async function createUserChange(
  trx: Trx,
  deps: AppDeps,
  userId: string,
  body: CreateChangeRequest,
  catalog: ServedCatalog,
): Promise<{ change: InstanceChangeView; instance: ProgramInstanceView }> {
  const now = deps.clock.now();
  await expireProposals(trx, userId, now);
  const instance = await activeInstance(trx, userId);
  if (!instance) throw httpError('not_found');
  if (body.baseRevision !== instance.revision) throw httpError('stale_revision');
  const change: PendingChange = {
    id: deps.ids.uuidv7(),
    author: 'user',
    baseRevision: instance.revision,
    operations: body.operations,
  };
  const program = await validate(trx, deps, instance, change, catalog);
  if (switchOf(body.operations)) await assertNoSessionInProgress(trx, instance);

  const stamp = await writeStamp(trx, deps, userId);
  await trx
    .insertInto('instanceChange')
    .values({
      id: change.id,
      ownerId: userId,
      instanceId: instance.id,
      baseRevision: change.baseRevision,
      author: 'user',
      operations: JSON.stringify(body.operations),
      reasonCode: 'USER_CHANGE',
      reason: null,
      status: 'accepted',
      expiresAt: null,
      decidedAt: stamp.updatedAt,
      aiGenerated: 0,
      aiModel: null,
      promptVersion: null,
      coachThreadId: null,
      createdAt: stamp.updatedAt,
      deletedAt: null,
      ...stamp,
    })
    .execute();
  const followed = await applyAccepted(trx, deps, userId, instance, body.operations, program, catalog);
  return decidedView(trx, userId, change.id, followed);
}

/** Proposition passée à `expired` (05 §15.4), un rev neuf ; `decided_at` reste vide : personne n'a décidé. */
async function expire(trx: DbExecutor, deps: AppDeps, id: string): Promise<void> {
  const stamp = await writeStamp(trx, deps, null);
  await trx
    .updateTable('instanceChange')
    .set({ status: 'expired', ...stamp })
    .where('id', '=', id)
    .execute();
}

/**
 * `POST /api/program/changes/:id/accept` (05 §15.3) : 409 `not_proposed` pour un changement déjà décidé ou expiré.
 * La proposition elle-même périmée (05 §15.4, ruling R37) passe à `expired`, refus rendu après la transaction : date
 * limite dépassée → `expired` ; sa `base_revision` n'est plus la révision de son instance, ou l'instance n'est plus
 * active → `stale_revision`. Un `baseRevision` du client seul périmé → 409 `stale_revision`, proposition intacte : le
 * client relit et recommence. 422 `invalid_change` si le programme résultant ne passe pas le validateur (la
 * proposition reste `proposed`). Acceptée : `decided_at` maintenant, `revision` + 1, rejeu.
 */
export async function acceptChange(
  trx: Trx,
  deps: AppDeps,
  userId: string,
  id: string,
  body: DecideChangeRequest,
  catalog: ServedCatalog,
): Promise<{ change: InstanceChangeView; instance: ProgramInstanceView } | Refusal> {
  const now = deps.clock.now();
  const row = await ownChange(trx, userId, id);
  if (row.status !== 'proposed') return { refused: 'not_proposed' };
  const instance = await instanceById(trx, userId, row.instanceId);
  const outdated: Refusal['refused'] | null =
    row.expiresAt !== null && Date.parse(row.expiresAt) < now.getTime()
      ? 'expired'
      : instance?.status !== 'active' || row.baseRevision !== instance.revision
        ? 'stale_revision'
        : null;
  if (outdated !== null || instance === undefined) {
    await expire(trx, deps, id);
    await expireProposals(trx, userId, now);
    return { refused: outdated ?? 'stale_revision' };
  }
  await expireProposals(trx, userId, now);
  if (body.baseRevision !== instance.revision) return { refused: 'stale_revision' };

  const operations = operationsOf(row);
  const program = await validate(
    trx,
    deps,
    instance,
    { id, author: row.author, baseRevision: row.baseRevision, operations },
    catalog,
  );
  if (switchOf(operations)) await assertNoSessionInProgress(trx, instance);
  const stamp = await writeStamp(trx, deps, userId);
  await trx
    .updateTable('instanceChange')
    .set({ status: 'accepted', decidedAt: stamp.updatedAt, ...stamp })
    .where('id', '=', id)
    .execute();
  const followed = await applyAccepted(trx, deps, userId, instance, operations, program, catalog);
  return decidedView(trx, userId, id, followed);
}

/**
 * `POST /api/program/changes/:id/reject` : propositions périmées expirées d'abord (spec §4.4.6), puis 409
 * `not_proposed` si celle-ci n'est plus `proposed` ; sinon `rejected`, `decided_at` maintenant. Le programme ne change
 * pas : ni révision ni rejeu.
 */
export async function rejectChange(
  trx: DbExecutor,
  deps: AppDeps,
  userId: string,
  id: string,
): Promise<{ change: InstanceChangeView } | Refusal> {
  await expireProposals(trx, userId, deps.clock.now());
  const row = await ownChange(trx, userId, id);
  if (row.status !== 'proposed') return { refused: 'not_proposed' };
  const stamp = await writeStamp(trx, deps, userId);
  await trx
    .updateTable('instanceChange')
    .set({ status: 'rejected', decidedAt: stamp.updatedAt, ...stamp })
    .where('id', '=', id)
    .execute();
  const consent = await isHealthConsentActive(trx, userId);
  return { change: changeView(await ownChange(trx, userId, id), consent) };
}
