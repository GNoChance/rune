import { defaultLoadSettings, type SlotSpec, type SlotStateView } from '@rune/contracts';
import {
  currentRules,
  type EffectiveProgram,
  findSlot,
  initialMode,
  type LoadGrid,
  loadGrid,
  RULES_VERSION,
  slotShape,
} from '@rune/domain';
import { type Selectable, sql, type Transaction } from 'kysely';
import { writeStamp } from '../db/rev';
import type { Database, DbExecutor, SlotStateTable } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { isHealthConsentActive } from '../privacy/consent-state';
import { instanceProgram, type ServedCatalog } from './changes';
import { activeInstance, type InstanceRow } from './enroll';
import { expireProposals } from './expire';
import { replayInstanceInDb } from './replay-service';

/*
 * Pas d'une machine (spec brique 3 §6 ; 05 §12) : tenu par (slot, exercice) dans `slot_state.machine_step_g_override`,
 * que le rejeu relit et garde (spec §4.4.2 et §4.4.5). L'identifiant est celui, déterministe, de l'état :
 * `instance:slot:exercice`.
 */

type SlotRow = Selectable<SlotStateTable>;

/**
 * Le CamelCasePlugin écrirait `machine_step_goverride` : la colonne passe par une référence brute (`SlotStateTable`).
 */
const OVERRIDE = sql.ref('machine_step_g_override');

/** Colonnes de la vue, communes à une ligne et à un état initial pas encore écrit. */
type ViewSource = Pick<
  SlotRow,
  | 'id'
  | 'instanceId'
  | 'slotId'
  | 'exerciseId'
  | 'mode'
  | 'loadG'
  | 'targetReps'
  | 'variantRank'
  | 'durationS'
  | 'machineStepGOverride'
  | 'calibrationLeft'
  | 'noProgressCount'
  | 'stallRank'
  | 'suspended'
>;

export function slotStateView(r: ViewSource): SlotStateView {
  return {
    id: r.id,
    instanceId: r.instanceId,
    slotId: r.slotId,
    exerciseId: r.exerciseId,
    mode: r.mode,
    loadG: r.loadG,
    targetReps: r.targetReps,
    variantRank: r.variantRank,
    durationS: r.durationS,
    machineStepGOverride: r.machineStepGOverride,
    calibrationLeft: r.calibrationLeft,
    noProgressCount: r.noProgressCount,
    stallRank: r.stallRank,
    suspended: r.suspended === 1,
  };
}

/** `instance:slot:exercice` → ses trois parties (le slot peut contenir `:`), ou null. */
function parseStateId(id: string): { instanceId: string; slotId: string; exerciseId: string } | null {
  const first = id.indexOf(':');
  const last = id.lastIndexOf(':');
  if (first <= 0 || last <= first + 1 || last === id.length - 1) return null;
  return {
    instanceId: id.slice(0, first),
    slotId: id.slice(first + 1, last),
    exerciseId: id.slice(last + 1),
  };
}

export interface MachineStepTarget {
  id: string;
  instance: InstanceRow;
  program: EffectiveProgram;
  slot: SlotSpec;
  exerciseId: string;
}

/**
 * État visé par `id`, sinon 404 (spec §6) : l'instance est l'instance active de l'appelant, le slot existe dans son
 * programme effectif (slot ajouté compris, slot retiré exclu), l'exercice est une fiche servie ou la chaîne du slot.
 * Aucune exception pour l'admin (P-ADM-2).
 */
export async function machineStepTarget(
  db: DbExecutor,
  userId: string,
  id: string,
  catalog: ServedCatalog,
): Promise<MachineStepTarget> {
  const parts = parseStateId(id);
  const instance = parts === null ? undefined : await activeInstance(db, userId);
  if (parts === null || instance === undefined || instance.id !== parts.instanceId) {
    throw httpError('not_found');
  }
  const program = await instanceProgram(db, instance);
  const slot = findSlot(program.template, parts.slotId)?.slot;
  const known =
    slot !== undefined &&
    (slot.chain === parts.exerciseId || catalog.exercises.some((s) => s.id === parts.exerciseId));
  if (!known) throw httpError('not_found');
  return { id, instance, program, slot, exerciseId: parts.exerciseId };
}

/**
 * État initial (spec §4.3.5) d'un exercice encore en calibration : 3 séances de calibration, compteurs à 0, mode
 * tiré de la progression du slot comme le moteur (`initialMode`), règles courantes ; suspendu si le slot l'est.
 * `pain_streak` est C2 : rien sans consentement santé.
 */
function initialState(target: MachineStepTarget, catalog: ServedCatalog, consent: boolean) {
  const { slot, exerciseId } = target;
  const sheet = catalog.exercises.find((s) => s.id === exerciseId);
  // `initialMode` ne lit que la mesure du slot et le type de grille de la fiche, pas les réglages d'un lieu.
  const grid: LoadGrid =
    sheet === undefined ? { kind: 'none' } : loadGrid(sheet.load_mode, defaultLoadSettings('gym'));
  const shape = slotShape(slot, 'adult', grid, currentRules(), null);
  return {
    instanceId: target.instance.id,
    slotId: slot.id,
    exerciseId,
    mode: initialMode(slot.progression.type, shape, slot.chain === exerciseId),
    loadG: null,
    targetReps: null,
    variantRank: null,
    durationS: null,
    calibrationLeft: currentRules().calibrationSessions,
    noProgressCount: 0,
    stallRank: 0,
    painStreak: consent ? 0 : null,
    suspended: target.program.suspended.has(slot.id) ? 1 : 0,
    lastSessionId: null,
    rulesVersion: RULES_VERSION,
  };
}

/**
 * `PUT /api/program/slot-states/:id/machine-step` : écrit la surcharge du pas (`stepG`, ou `null` pour revenir au pas
 * du lieu), puis rejoue l'instance dans la transaction. Une ligne absente ou supprimée (exercice en calibration) naît
 * avec l'état initial ; `null` sans surcharge à effacer, ou la même valeur, n'écrit rien. Rend l'état après le rejeu.
 */
export async function setMachineStep(
  trx: Transaction<Database>,
  deps: AppDeps,
  userId: string,
  id: string,
  stepG: number | null,
  catalog: ServedCatalog,
): Promise<SlotStateView> {
  await expireProposals(trx, userId, deps.clock.now());
  const target = await machineStepTarget(trx, userId, id, catalog);
  const consent = await isHealthConsentActive(trx, userId);
  const readRow = () =>
    trx
      .selectFrom('slotState')
      .selectAll()
      .where('id', '=', id)
      .where('ownerId', '=', userId)
      .executeTakeFirst();
  const row = await readRow();
  const live = row !== undefined && row.deletedAt === null;
  if (live && row.machineStepGOverride === stepG) return slotStateView(row);
  if (!live && stepG === null) {
    return slotStateView({ id, ...initialState(target, catalog, consent), machineStepGOverride: null });
  }

  const stamp = await writeStamp(trx, deps, userId);
  if (!live) {
    const values = initialState(target, catalog, consent);
    if (row === undefined) {
      await trx
        .insertInto('slotState')
        .values({ id, ownerId: userId, ...values, createdAt: stamp.updatedAt, deletedAt: null, ...stamp })
        .execute();
    } else {
      await trx
        .updateTable('slotState')
        .set({ ...values, deletedAt: null, ...stamp })
        .where('id', '=', id)
        .execute();
    }
  }
  // Même rev que l'écriture de la ligne : une écriture, un rev.
  await trx
    .updateTable('slotState')
    .set(OVERRIDE, stepG)
    .set({ ...stamp })
    .where('id', '=', id)
    .execute();
  await replayInstanceInDb(trx, { ownerId: userId, instanceId: target.instance.id }, deps);
  const after = await readRow();
  if (!after) throw new Error('slot_state_vanished');
  return slotStateView(after);
}
