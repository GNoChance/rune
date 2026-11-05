import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { type ProgramTemplate, ProgramTemplateSchema } from '@rune/contracts';
import {
  type AcceptedChange,
  currentRules,
  type EngineDecision,
  type EngineEvent,
  type PlaceContext,
  type ReplayInput,
  type ReplayResult,
  replayInstance,
  type SlotState,
  UnknownRulesVersionError,
} from '@rune/domain';
import type { Selectable, Transaction } from 'kysely';
import { servedSheets } from '../catalog/bundle';
import { writeStamp } from '../db/rev';
import type {
  Database,
  DbExecutor,
  EngineDecisionTable,
  ProgramInstanceTable,
  SlotStateTable,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { isHealthConsentActive } from '../privacy/consent-state';
import { expireProposals } from './expire';
import { type PlaceRow, toAcceptedChange, toPlaceContext, toSessionRecords } from './records';

/*
 * Rejeu d'une instance par le serveur (spec brique 3 §4.4, §5.3 ; R-SYN-19) : il charge l'historique de l'instance,
 * appelle `replayInstance` (le même moteur que le téléphone) et n'écrit que ce qui change. Le résultat fait foi : les
 * `slot_state` et `engine_decision` (classe D) suivent le rejeu, les événements du moteur deviennent des
 * `instance_change` à identifiant déterministe.
 */

const DAY_MS = 86_400_000;

type Trx = Transaction<Database>;
type InstanceRow = Selectable<ProgramInstanceTable>;
type SlotRow = Selectable<SlotStateTable>;

/**
 * Identifiant d'un événement du moteur (spec §4.4.4) : SHA-256 de la clé UTF-8, 16 premiers octets, bits de version
 * 8 et de variante RFC 9562. Même clé, même identifiant : rejouer n'écrit jamais deux fois le même événement.
 */
export function uuidFromKey(key: string): string {
  const bytes = createHash('sha256').update(key, 'utf8').digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface ReplayTarget {
  ownerId: string;
  instanceId: string;
  /**
   * Séances touchées par le lot du push (ruling R27) : une proposition du moteur n'est écrite que si sa séance
   * déclenchante en fait partie. Vide hors push (API du programme) : aucune proposition.
   */
  touchedSessionIds?: ReadonlySet<string>;
}

/**
 * Rejoue l'instance `instanceId` de `ownerId` dans `trx` : propositions périmées expirées d'abord, puis écriture
 * minimale du résultat. Une instance absente, supprimée ou d'un autre membre n'est pas rejouée (séance gardée hors
 * programme, spec §5.1) ; une entrée illisible ou une séance aux règles inconnues du serveur non plus : l'état écrit
 * reste celui du dernier rejeu, et le journal technique le note. Une instance terminée (`ended`) garde ses états et
 * ses décisions à jour, mais ne reçoit plus aucun événement du moteur (ruling R31).
 */
export async function replayInstanceInDb(trx: Trx, target: ReplayTarget, deps: AppDeps): Promise<void> {
  const { ownerId, instanceId } = target;
  const now = deps.clock.now();
  await expireProposals(trx, ownerId, now);
  const instance = await trx
    .selectFrom('programInstance')
    .selectAll()
    .where('id', '=', instanceId)
    .where('ownerId', '=', ownerId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  if (!instance) return;

  // États existants, supprimés compris : surcharges du pas de machine (entrée) et écriture minimale (sortie).
  const slotRows = await trx
    .selectFrom('slotState')
    .selectAll()
    .where('ownerId', '=', ownerId)
    .where('instanceId', '=', instanceId)
    .execute();
  const input = await loadInput(trx, instance, slotRows);
  if (typeof input === 'string') return skip(deps, input);
  let result: ReplayResult;
  try {
    result = replayInstance(input);
  } catch (err) {
    if (err instanceof UnknownRulesVersionError) return skip(deps, 'unknown_rules_version');
    throw err;
  }
  const consent = await isHealthConsentActive(trx, ownerId);
  const w: Writer = { trx, deps, ownerId, instanceId };
  await writeSlotStates(w, slotRows, result.slotStates, consent);
  await writeDecisions(w, result.decisions);
  if (instance.status === 'active') {
    await writeEvents(w, instance, result.events, target.touchedSessionIds ?? new Set(), now);
  }
}

function skip(deps: AppDeps, code: string): void {
  deps.logger.warn('program replay skipped', { event: 'program_replay_skipped', code });
}

// ---------------------------------------------------------------------------------------------------------------
// Entrée du rejeu
// ---------------------------------------------------------------------------------------------------------------

/** `snapshot` d'une instance relu et validé ; null s'il ne passe pas `ProgramTemplateSchema`. */
export function parseSnapshot(text: string): ProgramTemplate | null {
  try {
    const parsed = ProgramTemplateSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Entrée de `replayInstance`, ou le code de la raison qui empêche le rejeu. */
export async function loadInput(
  trx: DbExecutor,
  instance: InstanceRow,
  slotRows: readonly SlotRow[],
): Promise<ReplayInput | string> {
  const { ownerId, id: instanceId } = instance;
  const snapshot = parseSnapshot(instance.snapshot);
  if (snapshot === null) return 'invalid_snapshot';
  const changes = await acceptedChanges(trx, instance);
  if (changes === null) return 'invalid_change';

  // Séances terminées vivantes de l'instance, avec leurs exercices et leurs séries vivants.
  const sessions = await trx
    .selectFrom('workoutSession')
    .selectAll()
    .where('ownerId', '=', ownerId)
    .where('instanceId', '=', instanceId)
    .where('status', '=', 'completed')
    .where('deletedAt', 'is', null)
    .execute();
  const exercises = await trx
    .selectFrom('performedExercise as e')
    .innerJoin('workoutSession as s', 's.id', 'e.sessionId')
    .selectAll('e')
    .where('s.ownerId', '=', ownerId)
    .where('s.instanceId', '=', instanceId)
    .where('s.status', '=', 'completed')
    .where('s.deletedAt', 'is', null)
    .where('e.ownerId', '=', ownerId)
    .where('e.deletedAt', 'is', null)
    .execute();
  const sets = await trx
    .selectFrom('performedSet as t')
    .innerJoin('performedExercise as e', 'e.id', 't.performedExerciseId')
    .innerJoin('workoutSession as s', 's.id', 'e.sessionId')
    .selectAll('t')
    .where('s.ownerId', '=', ownerId)
    .where('s.instanceId', '=', instanceId)
    .where('s.status', '=', 'completed')
    .where('s.deletedAt', 'is', null)
    .where('e.deletedAt', 'is', null)
    .where('t.ownerId', '=', ownerId)
    .where('t.deletedAt', 'is', null)
    .execute();

  return {
    instance: {
      id: instanceId,
      snapshot,
      daysPerWeek: instance.daysPerWeek,
      startedAt: Date.parse(instance.startedAt),
    },
    sessions: toSessionRecords({ sessions, exercises, sets }),
    changes,
    catalog: await servedSheets(trx),
    places: await placesOf(trx, ownerId),
    overrides: new Map(
      slotRows.flatMap((r) =>
        r.deletedAt === null && r.machineStepGOverride !== null ? [[r.id, r.machineStepGOverride]] : [],
      ),
    ),
  };
}

/** Changements acceptés de l'instance (suspensions du moteur et propositions acceptées comprises) ; null si l'un est illisible. */
export async function acceptedChanges(
  trx: DbExecutor,
  instance: Pick<InstanceRow, 'id' | 'ownerId'>,
): Promise<AcceptedChange[] | null> {
  const rows = await trx
    .selectFrom('instanceChange')
    .selectAll()
    .where('ownerId', '=', instance.ownerId)
    .where('instanceId', '=', instance.id)
    .where('status', '=', 'accepted')
    .where('deletedAt', 'is', null)
    .execute();
  const changes: AcceptedChange[] = [];
  for (const row of rows) {
    const change = toAcceptedChange(row);
    if (change === null) return null;
    changes.push(change);
  }
  return changes;
}

/**
 * Lieux du membre : réglages du lieu ou de sa salle, matériel vivant. Supprimés compris pour le rejeu (spec §4.4) ;
 * `live` : vivants seulement (« faisable dans au moins un lieu de l'utilisateur », 05 §15).
 */
export async function placesOf(
  trx: DbExecutor,
  ownerId: string,
  o: { live?: boolean } = {},
): Promise<Map<string, PlaceContext>> {
  return new Map((await placeRowsOf(trx, ownerId, o)).map((p) => [p.id, toPlaceContext(p)]));
}

/** Lieux de `placesOf` avant `toPlaceContext` : réglages bruts et matériel vivant déclaré, sans ses implications. */
export async function placeRowsOf(
  trx: DbExecutor,
  ownerId: string,
  o: { live?: boolean } = {},
): Promise<PlaceRow[]> {
  const places = await trx
    .selectFrom('place')
    .leftJoin('gym', 'gym.id', 'place.gymId')
    .select([
      'place.id',
      'place.kind',
      'place.gymId',
      'place.loadSettings',
      'gym.loadSettings as gymLoadSettings',
    ])
    .where('place.ownerId', '=', ownerId)
    .$if(o.live === true, (q) => q.where('place.deletedAt', 'is', null))
    .execute();
  const home = await trx
    .selectFrom('homeEquipment')
    .select(['placeId', 'equipmentCode'])
    .where('ownerId', '=', ownerId)
    .where('deletedAt', 'is', null)
    .execute();
  const gymIds = [...new Set(places.flatMap((p) => (p.gymId === null ? [] : [p.gymId])))];
  const gym =
    gymIds.length === 0
      ? []
      : await trx
          .selectFrom('gymEquipment')
          .select(['gymId', 'equipmentCode'])
          .where('gymId', 'in', gymIds)
          .where('deletedAt', 'is', null)
          .execute();
  return places.map((p) => ({
    id: p.id,
    kind: p.kind,
    loadSettings: p.loadSettings,
    gymLoadSettings: p.kind === 'gym' ? p.gymLoadSettings : null,
    equipment:
      p.kind === 'gym'
        ? gym.filter((g) => g.gymId === p.gymId).map((g) => g.equipmentCode)
        : home.filter((h) => h.placeId === p.id).map((h) => h.equipmentCode),
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Écriture minimale (spec §4.4.5)
// ---------------------------------------------------------------------------------------------------------------

interface Writer {
  trx: Trx;
  deps: AppDeps;
  ownerId: string;
  instanceId: string;
}

/** Une ligne écrite, un rev neuf ; auteur vide : c'est le moteur qui écrit. */
const stampOf = (w: Writer) => writeStamp(w.trx, w.deps, null);

/**
 * Colonnes de `slot_state` que le rejeu écrit. `machine_step_g_override` n'en est pas : il appartient à l'API du
 * pas de machine, et le rejeu ne fait que le relire (spec §4.4.2). Une ligne qui le porte est vivante : un état
 * inséré par le rejeu n'en a donc jamais.
 */
function slotStateValues(s: SlotState, consent: boolean) {
  return {
    instanceId: s.instanceId,
    slotId: s.slotId,
    exerciseId: s.exerciseId,
    mode: s.mode,
    loadG: s.loadG,
    targetReps: s.targetReps,
    variantRank: s.variantRank,
    durationS: s.durationS,
    calibrationLeft: s.calibrationLeft,
    noProgressCount: s.noProgressCount,
    stallRank: s.stallRank,
    // `pain_streak` est C2 : rien sans consentement santé (05 §13.8).
    painStreak: consent ? s.painStreak : null,
    suspended: s.suspended ? 1 : 0,
    lastSessionId: s.lastSessionId,
    rulesVersion: s.rulesVersion,
  };
}

const sameValues = (existing: Readonly<Record<string, unknown>>, values: Readonly<Record<string, unknown>>) =>
  Object.entries(values).every(([key, value]) => existing[key] === value);

/**
 * États rendus par le rejeu : insérés, mis à jour ou ressuscités seulement s'ils changent ; ceux qu'il ne produit plus
 * sont supprimés logiquement, sauf ceux qui portent une surcharge du pas de machine (spec §4.4.5).
 */
async function writeSlotStates(
  w: Writer,
  rows: readonly SlotRow[],
  states: readonly SlotState[],
  consent: boolean,
): Promise<void> {
  const existing = new Map(rows.map((r) => [r.id, r]));
  for (const s of states) {
    const values = slotStateValues(s, consent);
    const row = existing.get(s.id);
    if (row && row.deletedAt === null && sameValues(row, values)) continue;
    const stamp = await stampOf(w);
    if (row) {
      await w.trx
        .updateTable('slotState')
        .set({ ...values, deletedAt: null, ...stamp })
        .where('id', '=', s.id)
        .execute();
    } else {
      await w.trx
        .insertInto('slotState')
        .values({
          id: s.id,
          ownerId: w.ownerId,
          ...values,
          createdAt: stamp.updatedAt,
          deletedAt: null,
          ...stamp,
        })
        .execute();
    }
  }
  const produced = new Set(states.map((s) => s.id));
  await softDelete(
    w,
    'slotState',
    [...existing.values()].filter(
      (r) => r.deletedAt === null && r.machineStepGOverride === null && !produced.has(r.id),
    ),
  );
}

function decisionValues(d: EngineDecision) {
  return {
    instanceId: d.instanceId,
    slotId: d.slotId,
    exerciseId: d.exerciseId,
    result: d.result,
    reasonCode: d.reasonCode,
    profile: d.profile,
    rulesVersion: d.rulesVersion,
  };
}

const sameTarget = (stored: string | null, target: EngineDecision['nextTarget']) =>
  stored === null ? target === null : target !== null && isDeepStrictEqual(JSON.parse(stored), target);

/**
 * Décisions rendues par le rejeu (`id` = celui de l'exercice, qui existe : clé étrangère) ; celles de l'instance qu'il
 * ne produit plus (séance ou exercice supprimés, séance rouverte) sont supprimées logiquement.
 */
async function writeDecisions(w: Writer, decisions: readonly EngineDecision[]): Promise<void> {
  const existing = new Map(
    (
      await w.trx
        .selectFrom('engineDecision')
        .selectAll()
        .where('ownerId', '=', w.ownerId)
        .where((eb) =>
          eb.or([
            eb('instanceId', '=', w.instanceId),
            eb(
              'id',
              'in',
              eb
                .selectFrom('performedExercise as e')
                .innerJoin('workoutSession as s', 's.id', 'e.sessionId')
                .select('e.id')
                .where('s.ownerId', '=', w.ownerId)
                .where('s.instanceId', '=', w.instanceId),
            ),
          ]),
        )
        .execute()
    ).map((r) => [r.id, r]),
  );
  for (const d of decisions) {
    const values = decisionValues(d);
    const row = existing.get(d.id);
    if (
      row &&
      row.deletedAt === null &&
      sameValues(row, values) &&
      sameTarget(row.nextTarget, d.nextTarget)
    ) {
      continue;
    }
    const nextTarget = d.nextTarget === null ? null : JSON.stringify(d.nextTarget);
    const stamp = await stampOf(w);
    if (row) {
      await w.trx
        .updateTable('engineDecision')
        .set({ ...values, nextTarget, deletedAt: null, ...stamp })
        .where('id', '=', d.id)
        .execute();
    } else {
      await w.trx
        .insertInto('engineDecision')
        .values({
          id: d.id,
          ownerId: w.ownerId,
          ...values,
          nextTarget,
          createdAt: stamp.updatedAt,
          deletedAt: null,
          ...stamp,
        })
        .execute();
    }
  }
  const produced = new Set(decisions.map((d) => d.id));
  await softDelete(
    w,
    'engineDecision',
    [...existing.values()].filter(
      (r: Selectable<EngineDecisionTable>) =>
        r.deletedAt === null && r.instanceId === w.instanceId && !produced.has(r.id),
    ),
  );
}

async function softDelete(
  w: Writer,
  table: 'slotState' | 'engineDecision',
  rows: readonly { id: string }[],
): Promise<void> {
  for (const { id } of [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const stamp = await stampOf(w);
    await w.trx
      .updateTable(table)
      .set({ deletedAt: stamp.updatedAt, ...stamp })
      .where('id', '=', id)
      .execute();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Événements du moteur (spec §4.4.4, rulings R27)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Événements absents de la base, identifiant dérivé de la clé ; un événement déjà écrit (proposé, décidé ou expiré)
 * n'est jamais recréé ni modifié. Une suspension pour douleur est toujours écrite, acceptée à la fin de sa séance
 * déclenchante, et l'instance prend `revision` + 1 ; une proposition seulement si sa séance déclenchante est dans le
 * lot, faite à la révision courante (suspensions de ce rejeu comprises), valable `proposalValidDays` jours.
 */
async function writeEvents(
  w: Writer,
  instance: InstanceRow,
  events: readonly EngineEvent[],
  touched: ReadonlySet<string>,
  now: Date,
): Promise<void> {
  const absent = async (e: EngineEvent): Promise<boolean> =>
    !(await w.trx
      .selectFrom('instanceChange')
      .select('id')
      .where('id', '=', uuidFromKey(e.key))
      .executeTakeFirst());

  let revision = instance.revision;
  for (const e of events.filter((x) => x.kind === 'pain_suspend')) {
    if (!(await absent(e))) continue;
    await insertEvent(w, e, {
      baseRevision: revision,
      status: 'accepted',
      decidedAt: e.decidedAt,
      expiresAt: null,
    });
    revision += 1;
  }
  if (revision !== instance.revision) {
    const stamp = await stampOf(w);
    await w.trx
      .updateTable('programInstance')
      .set({ revision, ...stamp })
      .where('id', '=', instance.id)
      .execute();
  }

  const expiresAt = new Date(now.getTime() + currentRules().proposalValidDays * DAY_MS).toISOString();
  for (const e of events.filter((x) => x.kind !== 'pain_suspend' && touched.has(x.triggerSessionId))) {
    if (!(await absent(e))) continue;
    await insertEvent(w, e, { baseRevision: revision, status: 'proposed', decidedAt: null, expiresAt });
  }
}

async function insertEvent(
  w: Writer,
  e: EngineEvent,
  o: {
    baseRevision: number;
    status: 'accepted' | 'proposed';
    decidedAt: string | null;
    expiresAt: string | null;
  },
): Promise<void> {
  const stamp = await stampOf(w);
  await w.trx
    .insertInto('instanceChange')
    .values({
      id: uuidFromKey(e.key),
      ownerId: w.ownerId,
      instanceId: w.instanceId,
      baseRevision: o.baseRevision,
      author: 'engine',
      operations: JSON.stringify(e.operations),
      reasonCode: e.reasonCode,
      reason: null,
      status: o.status,
      expiresAt: o.expiresAt,
      decidedAt: o.decidedAt,
      aiGenerated: 0,
      aiModel: null,
      promptVersion: null,
      coachThreadId: null,
      createdAt: stamp.updatedAt,
      deletedAt: null,
      ...stamp,
    })
    .execute();
}
