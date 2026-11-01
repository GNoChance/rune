import {
  defaultLoadSettings,
  EFFORTS,
  type Effort,
  type LoadMode,
  NEXT_ADJUSTMENTS,
  type NextAdjustment,
  type ServedSheet,
  ServedSheetSchema,
  type SessionProfile,
  SWAP_REASONS,
  type SwapReason,
} from '@rune/contracts';
import { currentRules, loadGrid, type PlannedSet, type PlannedWorkout, RULES_VERSION } from '@rune/domain';
import { useMemo } from 'react';
import { type AppServices, useLive, useServices } from '../app-services';
import { healthConsentCached } from '../local-db/consent';
import type { MirrorRow } from '../local-db/db';
import { ensureDeviceId, getMeta, setMeta } from '../local-db/meta';
import type { SyncState } from '../sync/engine';
import { type LocalChange, writeLocal } from '../sync/outbox';
import { catalogRepoFor } from './catalog-repo';
import { programViewFor } from './program-view';
import { currentUserId, isLive, text } from './rows';
import { composeSessions, latestFirst, type WorkoutSessionView } from './session-records';

export type { WorkoutExerciseView, WorkoutSessionView, WorkoutSetView } from './session-records';

/*
 * Séances (spec brique 3 D2, D4, D12, §5.4, §7.1, §7.3) : tables J écrites hors ligne par `writeLocal`, chaque action
 * en une transaction Dexie (lignes et ops ensemble, R-SYN-11). « Commencer » fige le plan entier ; une série est faite
 * quand `loggedAt` est posé ; « Terminer » supprime logiquement les séries jamais faites.
 */

/** Version de l'appli écrite dans chaque séance (`app_version`) : `VITE_APP_VERSION` au build, sinon « dev ». */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev';

export type WorkoutErrorCode =
  | 'not_signed_in'
  | 'not_found'
  /** Une séance est déjà en cours sur cet appareil. */
  | 'in_progress'
  /** Séance en cours tenue par un autre appareil : lecture seule ici (« Continuer ici » d'abord). */
  | 'held_elsewhere'
  | 'not_in_progress'
  /** Série déjà faite : elle ne se retire pas. */
  | 'set_done'
  /** Une série est faite : le plan ne se refait plus (« Changer de lieu »). */
  | 'sets_done'
  /** Valeur hors des bornes d'une série (charge, répétitions, durée, position) ou non entière. */
  | 'out_of_range'
  | 'note_too_long'
  /** Fiche absente du catalogue local. */
  | 'unknown_exercise';

export class WorkoutError extends Error {
  readonly code: WorkoutErrorCode;

  constructor(code: WorkoutErrorCode) {
    super(`workout_${code}`);
    this.name = 'WorkoutError';
    this.code = code;
  }
}

export interface StartInput {
  /** Séance prévue (`plannedWorkout`) ; null pour une séance libre, sans exercice au départ. */
  plan: PlannedWorkout | null;
  placeId: string | null;
  instanceId: string | null;
  workoutId: string | null;
  /** Profil figé dans la séance (D3) ; par défaut celui du cache, comme l'onglet Exercices. */
  profile?: SessionProfile;
  templateVersion: number | null;
}

/** Valeurs saisies ; une clé absente reste telle quelle. */
export interface SetInput {
  loadG?: number | null;
  reps?: number | null;
  durationS?: number | null;
  effort?: Effort | null;
}

export type NoteTarget = { kind: 'session'; id: string } | { kind: 'exercise'; id: string };

export interface WorkoutsRepo {
  /** Séance, exercices et toutes les séries prévues avec leurs cibles, en une transaction ; rend l'id de la séance. */
  start(input: StartInput): Promise<string>;
  /**
   * N'écrit que `loadG`, `reps`, `durationS` et `effort`, et pose `loggedAt` (l'heure d'une série déjà faite reste à la
   * correction) ; synchro 2 s plus tard. Séance close : série faite seulement (`not_in_progress` sinon, §7.6).
   */
  logSet(setId: string, values?: SetInput): Promise<void>;
  /** Pendant la séance seulement (`not_in_progress` sinon). */
  reopenSet(setId: string): Promise<void>;
  /** Séance close : série faite seulement, comme `logSet`. */
  setEffort(setId: string, effort: Effort | null): Promise<void>;
  /**
   * Une série de travail après la dernière (deux lignes en unilatéral), cibles de la précédente ; rend les ids.
   * Pendant la séance seulement.
   */
  addSet(performedExerciseId: string): Promise<string[]>;
  /**
   * Série non faite, ses deux côtés en unilatéral (`set_done` si une ligne de la série est faite) ; pendant la séance
   * seulement.
   */
  removeSet(setId: string): Promise<void>;
  /**
   * Autre fiche pour la suite de l'exercice : sans série faite, l'exercice change de fiche ; sinon les séries faites
   * restent à l'ancienne et un nouvel exercice du même slot reprend la suite. Les séries non faites sont réécrites
   * pour la nouvelle fiche (côtés, mode de charge, sans charge visée). Rend l'id de l'exercice qui porte la fiche.
   * `pain` n'est gardé qu'avec l'accord santé. Pendant la séance seulement.
   */
  swapExercise(performedExerciseId: string, exerciseId: string, reason: SwapReason): Promise<string>;
  /**
   * Douleur ou gêne (05 §13.6) : `nextAdjustment` toujours (`discomfort` → `hold`, `pain` → `lighten`) ; `painLevel`
   * seulement avec l'accord santé (R-SYN-10).
   */
  markPain(performedExerciseId: string, level: 'discomfort' | 'pain'): Promise<void>;
  setAdjustment(performedExerciseId: string, adjustment: NextAdjustment | null): Promise<void>;
  /** Texte nettoyé ; vide → null ; au plus 500 caractères (`note_too_long`). */
  setNote(target: NoteTarget, text: string): Promise<void>;
  /**
   * Autre lieu : avec un plan, exercices et séries refaits tant qu'aucune série n'est faite (`sets_done` ensuite) ;
   * sans plan (séance libre), seul le lieu change.
   */
  changePlace(sessionId: string, plan: PlannedWorkout | null, placeId: string | null): Promise<void>;
  /**
   * `completed` avec au moins une série de travail faite, sinon `abandoned` (D4) ; séries jamais faites supprimées
   * logiquement ; séance en cours effacée ; décisions de fin gardées en copies provisoires.
   */
  finish(sessionId: string): Promise<'completed' | 'abandoned'>;
  /** Suppression logique de la séance, de ses exercices et de ses séries (R-SYN-6). */
  remove(sessionId: string): Promise<void>;
  /** « Continuer ici » : la séance passe à cet appareil (`device_id`, R-SYN-7). */
  continueHere(sessionId: string): Promise<void>;
  /**
   * Séances oubliées (D12) : en cours sans activité depuis 6 h sur cet appareil, 24 h sur un autre, closes avec
   * `status` (`completed` si une série de travail faite est connue, sinon `abandoned`) et `ended_at` = dernière série
   * faite (le début sans série), sans supprimer aucune série (ruling R33). Efface aussi une séance en cours notée ici
   * mais finie ou reprise ailleurs. Rien tant qu'aucun pull n'a réussi dans cette exécution
   * (`SyncState.pulledThisRun`) : `closeStaleAfterPull` l'appelle à ce moment-là. Rend les ids clôturés.
   */
  closeStale(now: number): Promise<string[]>;
  /** Exercice de séance libre (sans slot ni cible), avec une première série vide ; rend son id. */
  addFreeExercise(sessionId: string, exerciseId: string): Promise<string>;

  /** Séance en cours tenue par cet appareil (`meta.activeSessionId`). */
  activeSession(): Promise<WorkoutSessionView | null>;
  session(id: string): Promise<WorkoutSessionView | null>;
  /** Séances terminées ou abandonnées, la plus récente d'abord. */
  history(): Promise<WorkoutSessionView[]>;
  /** Séance en cours tenue par un autre appareil, la plus récente (« Séance en cours sur un autre appareil »). */
  otherDeviceSession(): Promise<WorkoutSessionView | null>;
}

const SESSION = 'workout_session';
const EXERCISE = 'performed_exercise';
const SET = 'performed_set';
const HOUR_MS = 3_600_000;

interface Writer {
  userId: string;
  deviceId: string;
  healthConsentActive: boolean;
  put(change: LocalChange): Promise<void>;
}

const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const isDone = (set: MirrorRow) => set.loggedAt != null;
const byPosition = (a: MirrorRow, b: MirrorRow) =>
  (num(a.position) ?? 0) - (num(b.position) ?? 0) || binary(a.id, b.id);
const sideRank = (side: unknown) => (side === 'left' ? 1 : side === 'right' ? 2 : 0);
const lineOrder = (a: MirrorRow, b: MirrorRow) =>
  (a.kind === 'warmup' ? 0 : 1) - (b.kind === 'warmup' ? 0 : 1) ||
  byPosition(a, b) ||
  sideRank(a.side) - sideRank(b.side);

/** Seules clés que `logSet` écrit. */
const SET_INPUT_KEYS = [
  'loadG',
  'reps',
  'durationS',
  'effort',
] as const satisfies readonly (keyof SetInput)[];

/** Bornes d'une série (règles en vigueur) : entier, dans [min, max] ; null admis (pas de valeur). */
function checkSetInput(values: SetInput): void {
  const { setBounds } = currentRules();
  const ok = (v: number | null | undefined, [min, max]: readonly [number, number]) =>
    v === undefined || v === null || (Number.isInteger(v) && v >= min && v <= max);
  const both = values.reps != null && values.durationS != null;
  if (
    both ||
    !ok(values.loadG, setBounds.loadG) ||
    !ok(values.reps, setBounds.reps) ||
    !ok(values.durationS, setBounds.durationS)
  ) {
    throw new WorkoutError('out_of_range');
  }
  if (values.effort !== undefined && values.effort !== null && !EFFORTS.includes(values.effort)) {
    throw new WorkoutError('out_of_range');
  }
}

/** Fiche à charge : échauffement possible (R29 : pas d'échauffement sans charge). */
const loaded = (sheet: ServedSheet) => loadGrid(sheet.load_mode, defaultLoadSettings('gym')).kind !== 'none';

/**
 * Séries non faites réécrites pour `sheet` : une ligne par (type, position), ou deux en unilatéral ; répétitions,
 * durée et effort visés gardés ; ni charge visée ni variante (sauf une variante de la même chaîne) ; pas
 * d'échauffement pour une fiche sans charge. `renumber` repart de 1 par type (nouvel exercice).
 */
function rewrite(
  open: readonly MirrorRow[],
  sheet: ServedSheet,
  previous: ServedSheet | undefined,
  renumber: boolean,
): PlannedSet[] {
  const groups = new Map<string, MirrorRow>();
  for (const row of [...open].sort(lineOrder)) {
    const key = `${String(row.kind)}:${String(row.position)}`;
    if (!groups.has(key)) groups.set(key, row);
  }
  const sameChain = previous?.chain_id !== undefined && previous.chain_id === sheet.chain_id;
  const sides = sheet.unilateral ? (['left', 'right'] as const) : ([null] as const);
  const counters = { warmup: 0, work: 0 };
  const out: PlannedSet[] = [];
  for (const row of groups.values()) {
    const kind = row.kind === 'warmup' ? 'warmup' : 'work';
    if (kind === 'warmup' && !loaded(sheet)) continue;
    counters[kind] += 1;
    const position = renumber ? counters[kind] : (num(row.position) ?? counters[kind]);
    for (const side of sides) {
      out.push({
        kind,
        position,
        side,
        targetRepsMin: num(row.targetRepsMin),
        targetRepsMax: num(row.targetRepsMax),
        targetDurationS: num(row.targetDurationS),
        targetLoadG: null,
        targetRir: num(row.targetRir),
        targetVariant: sameChain && row.targetVariant != null ? sheet.id : null,
      });
    }
  }
  return out;
}

const emptySet = (position: number, side: 'left' | 'right' | null): PlannedSet => ({
  kind: 'work',
  position,
  side,
  targetRepsMin: null,
  targetRepsMax: null,
  targetDurationS: null,
  targetLoadG: null,
  targetRir: null,
  targetVariant: null,
});

export function createWorkoutRepo(s: AppServices): WorkoutsRepo {
  const { db } = s;
  const nowIso = () => new Date(s.now()).toISOString();
  const newId = () => s.newOpId();
  const tables = () => [
    db.outbox,
    db.meta,
    db.table('exercises'),
    db.mirror(SESSION),
    db.mirror(EXERCISE),
    db.mirror(SET),
  ];
  /** Écritures d'une action, ensemble ou pas du tout. */
  const tx = <T>(fn: () => Promise<T>): Promise<T> => db.transaction('rw', tables(), fn);

  /** Contexte d'écriture, lu avant la transaction (accord santé : miroir `consent_event` hors de son périmètre). */
  async function writer(): Promise<Writer> {
    const userId = await currentUserId(db);
    if (userId === null) throw new WorkoutError('not_signed_in');
    const deviceId = await ensureDeviceId(db, newId);
    const healthConsentActive = await healthConsentCached(db);
    const ctx = { userId, now: nowIso, newOpId: newId, healthConsentActive };
    return {
      userId,
      deviceId,
      healthConsentActive,
      async put(change) {
        await writeLocal(db, change, ctx);
      },
    };
  }

  async function sheetOf(id: string): Promise<ServedSheet | undefined> {
    const parsed = ServedSheetSchema.safeParse(await db.table('exercises').get(id));
    return parsed.success ? parsed.data : undefined;
  }

  async function owned(store: string, id: string, w: Writer): Promise<MirrorRow> {
    const row = await db.mirror(store).get(id);
    if (!row || !isLive(row) || row.ownerId !== w.userId) throw new WorkoutError('not_found');
    return row;
  }

  const ownedLive = (w: Writer) => (r: MirrorRow) => isLive(r) && r.ownerId === w.userId;

  async function exercisesOf(sessionId: string, w: Writer): Promise<MirrorRow[]> {
    const rows = await db
      .mirror(EXERCISE)
      .where('sessionId')
      .equals(sessionId)
      .filter(ownedLive(w))
      .toArray();
    return rows.sort(byPosition);
  }

  async function setsOf(exerciseIds: readonly string[], w: Writer): Promise<MirrorRow[]> {
    const rows = await db
      .mirror(SET)
      .where('performedExerciseId')
      .anyOf([...exerciseIds])
      .filter(ownedLive(w))
      .toArray();
    return rows.sort(lineOrder);
  }

  /** Une séance en cours ne s'écrit que sur l'appareil qui la tient ; une séance close se corrige partout. */
  function assertEditable(session: MirrorRow, w: Writer): void {
    if (session.status === 'in_progress' && session.deviceId !== w.deviceId) {
      throw new WorkoutError('held_elsewhere');
    }
  }

  async function exerciseContext(peId: string, w: Writer) {
    const exercise = await owned(EXERCISE, peId, w);
    const session = await owned(SESSION, String(exercise.sessionId), w);
    assertEditable(session, w);
    return { exercise, session };
  }

  async function setContext(setId: string, w: Writer) {
    const set = await owned(SET, setId, w);
    const { exercise, session } = await exerciseContext(String(set.performedExerciseId), w);
    return { set, exercise, session };
  }

  /** Changement de structure (séries, fiche) : seulement pendant la séance (une séance close ne se refait pas). */
  function assertInProgress(session: MirrorRow): void {
    if (session.status !== 'in_progress') throw new WorkoutError('not_in_progress');
  }

  /** Séance close : seules les valeurs d'une série faite se corrigent (§7.6, « Modifier »). */
  function assertValueEditable(session: MirrorRow, set: MirrorRow): void {
    if (session.status !== 'in_progress' && !isDone(set)) throw new WorkoutError('not_in_progress');
  }

  async function createSet(w: Writer, peId: string, loadMode: LoadMode, set: PlannedSet): Promise<string> {
    const id = newId();
    await w.put({
      entity: SET,
      id,
      kind: 'create',
      fields: {
        performedExerciseId: peId,
        position: set.position,
        kind: set.kind,
        loadMode,
        loadG: null,
        reps: null,
        durationS: null,
        side: set.side,
        effort: null,
        targetRepsMin: set.targetRepsMin,
        targetRepsMax: set.targetRepsMax,
        targetDurationS: set.targetDurationS,
        targetLoadG: set.targetLoadG,
        targetRir: set.targetRir,
        targetVariant: set.targetVariant,
        loggedAt: null,
      },
    });
    return id;
  }

  /** Exercice réalisé ; `pain_level` (C2) n'est jamais écrit à la création. */
  async function createExercise(
    w: Writer,
    fields: {
      sessionId: string;
      slotId: string | null;
      plannedExerciseId: string | null;
      exerciseId: string;
      swapReason: SwapReason | null;
      position: number;
    },
  ): Promise<string> {
    const id = newId();
    await w.put({
      entity: EXERCISE,
      id,
      kind: 'create',
      fields: { ...fields, nextAdjustment: null, note: null },
    });
    return id;
  }

  /** Exercices et séries d'un plan, slots sautés exclus (D2). */
  async function createPlanned(w: Writer, sessionId: string, plan: PlannedWorkout | null): Promise<void> {
    let position = 0;
    for (const ex of plan?.exercises ?? []) {
      if (ex.exerciseId === null || ex.loadMode === null) continue;
      position += 1;
      const peId = await createExercise(w, {
        sessionId,
        slotId: ex.slotId,
        plannedExerciseId: ex.plannedExerciseId,
        exerciseId: ex.exerciseId,
        swapReason: null,
        position,
      });
      for (const set of ex.sets) await createSet(w, peId, ex.loadMode, set);
    }
  }

  async function deleteRow(w: Writer, entity: string, id: string): Promise<void> {
    await w.put({ entity, id, kind: 'delete', fields: {} });
  }

  async function clearActiveIf(sessionId: string): Promise<void> {
    if ((await getMeta(db, 'activeSessionId')) === sessionId) await setMeta(db, 'activeSessionId', null);
  }

  /** Une séance en cours tenue ici (sinon `meta.activeSessionId` ne vaut plus rien). */
  async function heldHere(sessionId: string | null | undefined, w: Writer): Promise<boolean> {
    if (!sessionId) return false;
    const row = await db.mirror(SESSION).get(sessionId);
    return !!row && isLive(row) && row.status === 'in_progress' && row.deviceId === w.deviceId;
  }

  /**
   * Fin de séance (D4) dans la transaction en cours ; une séance déjà close rend son statut. « Terminer » (`prune`)
   * supprime aussi les séries jamais faites (D2). La clôture d'une séance oubliée n'en supprime aucune (ruling R33) :
   * le miroir peut ignorer des séries faites sur un autre appareil ; elle n'écrit que le statut et la fin, et les
   * lectures ignorent les séries jamais faites d'une séance close.
   */
  async function close(
    w: Writer,
    sessionId: string,
    endedAt: string,
    prune: boolean,
  ): Promise<{ status: 'completed' | 'abandoned'; instanceId: string | null }> {
    const session = await owned(SESSION, sessionId, w);
    const instanceId = text(session.instanceId);
    if (session.status !== 'in_progress') {
      return { status: session.status === 'completed' ? 'completed' : 'abandoned', instanceId };
    }
    const sets = await setsOf(
      (await exercisesOf(sessionId, w)).map((e) => e.id),
      w,
    );
    if (prune) for (const set of sets) if (!isDone(set)) await deleteRow(w, SET, set.id);
    const status = sets.some((set) => set.kind === 'work' && isDone(set)) ? 'completed' : 'abandoned';
    await w.put({ entity: SESSION, id: sessionId, kind: 'patch', fields: { status, endedAt } });
    await clearActiveIf(sessionId);
    return { status, instanceId };
  }

  /** Après une séance terminée d'un programme : décisions et cibles suivantes en copies provisoires (§4.4.8). */
  async function afterCompleted(
    closed: readonly { status: string; instanceId: string | null }[],
  ): Promise<void> {
    if (!closed.some((c) => c.status === 'completed' && c.instanceId !== null)) return;
    try {
      await programViewFor(s).refreshProvisional();
    } catch {
      // Copies provisoires seulement : le pull apportera celles du serveur.
    }
  }

  async function readSessions(select: (deviceId: string | null) => Promise<MirrorRow[]>) {
    const ownerId = await currentUserId(db);
    if (ownerId === null) return [];
    const deviceId = (await getMeta(db, 'deviceId')) ?? null;
    return composeSessions(db, await select(deviceId), ownerId, deviceId);
  }

  return {
    async start(input) {
      const w = await writer();
      const profile = input.profile ?? ((await catalogRepoFor(s).context()).cautious ? 'cautious' : 'adult');
      const id = await tx(async () => {
        if (await heldHere(await getMeta(db, 'activeSessionId'), w)) throw new WorkoutError('in_progress');
        const sessionId = newId();
        await w.put({
          entity: SESSION,
          id: sessionId,
          kind: 'create',
          fields: {
            instanceId: input.instanceId,
            workoutId: input.workoutId,
            placeId: input.placeId,
            deviceId: w.deviceId,
            startedAt: nowIso(),
            endedAt: null,
            status: 'in_progress',
            weekType: input.plan?.weekType ?? 'normal',
            templateVersion: input.templateVersion,
            rulesVersion: input.plan?.rulesVersion ?? RULES_VERSION,
            appVersion: APP_VERSION,
            profile,
            note: null,
          },
        });
        await createPlanned(w, sessionId, input.plan);
        await setMeta(db, 'activeSessionId', sessionId);
        return sessionId;
      });
      void s.sync.syncNow('mutation');
      return id;
    },

    async logSet(setId, values = {}) {
      checkSetInput(values);
      const w = await writer();
      await tx(async () => {
        const { set, session } = await setContext(setId, w);
        assertValueEditable(session, set);
        // Liste blanche : rien d'autre que les valeurs saisies n'est écrit (ni `loggedAt`, ni le parent).
        const fields: Record<string, unknown> = Object.fromEntries(
          SET_INPUT_KEYS.flatMap((k) => (values[k] === undefined ? [] : [[k, values[k]]])),
        );
        const reps = 'reps' in fields ? fields.reps : set.reps;
        const durationS = 'durationS' in fields ? fields.durationS : set.durationS;
        if (reps != null && durationS != null) throw new WorkoutError('out_of_range');
        if (!isDone(set)) fields.loggedAt = nowIso();
        if (Object.keys(fields).length === 0) return;
        await w.put({ entity: SET, id: setId, kind: 'patch', fields });
      });
      void s.sync.syncNow('set_logged');
    },

    async reopenSet(setId) {
      const w = await writer();
      await tx(async () => {
        const { set, session } = await setContext(setId, w);
        assertInProgress(session);
        if (isDone(set)) await w.put({ entity: SET, id: setId, kind: 'patch', fields: { loggedAt: null } });
      });
      void s.sync.syncNow('set_logged');
    },

    async setEffort(setId, effort) {
      checkSetInput({ effort });
      const w = await writer();
      await tx(async () => {
        const { set, session } = await setContext(setId, w);
        assertValueEditable(session, set);
        await w.put({ entity: SET, id: setId, kind: 'patch', fields: { effort } });
      });
      void s.sync.syncNow('set_logged');
    },

    async addSet(performedExerciseId) {
      const w = await writer();
      const ids = await tx(async () => {
        const { exercise, session } = await exerciseContext(performedExerciseId, w);
        assertInProgress(session);
        const work = (await setsOf([performedExerciseId], w)).filter((r) => r.kind === 'work');
        const last = work.at(-1);
        const position = (num(last?.position) ?? 0) + 1;
        if (position > currentRules().setBounds.position[1]) throw new WorkoutError('out_of_range');
        const sheet = await sheetOf(String(exercise.exerciseId));
        const loadMode = (last?.loadMode as LoadMode | undefined) ?? sheet?.load_mode;
        if (loadMode === undefined) throw new WorkoutError('unknown_exercise');
        const unilateral = last === undefined ? sheet?.unilateral === true : work.some((r) => r.side != null);
        const sides = unilateral ? (['left', 'right'] as const) : ([null] as const);
        const out: string[] = [];
        for (const side of sides) {
          out.push(
            await createSet(w, performedExerciseId, loadMode, {
              ...emptySet(position, side),
              targetRepsMin: num(last?.targetRepsMin),
              targetRepsMax: num(last?.targetRepsMax),
              targetDurationS: num(last?.targetDurationS),
              targetLoadG: num(last?.targetLoadG),
              targetRir: num(last?.targetRir),
              targetVariant: text(last?.targetVariant),
            }),
          );
        }
        return out;
      });
      void s.sync.syncNow('set_logged');
      return ids;
    },

    async removeSet(setId) {
      const w = await writer();
      await tx(async () => {
        const { set, session } = await setContext(setId, w);
        assertInProgress(session);
        // Une série unilatérale est une paire : ses deux côtés partent ensemble, s'ils ne sont pas faits.
        const lines = (await setsOf([String(set.performedExerciseId)], w)).filter(
          (r) => r.kind === set.kind && r.position === set.position,
        );
        if (lines.some(isDone)) throw new WorkoutError('set_done');
        for (const line of lines) await deleteRow(w, SET, line.id);
      });
      void s.sync.syncNow('set_logged');
    },

    async swapExercise(performedExerciseId, exerciseId, reason) {
      if (!SWAP_REASONS.includes(reason)) throw new WorkoutError('out_of_range');
      const w = await writer();
      const id = await tx(async () => {
        const sheet = await sheetOf(exerciseId);
        if (sheet === undefined) throw new WorkoutError('unknown_exercise');
        const { exercise, session } = await exerciseContext(performedExerciseId, w);
        assertInProgress(session);
        const sets = await setsOf([performedExerciseId], w);
        const open = sets.filter((r) => !isDone(r));
        const previous = await sheetOf(String(exercise.exerciseId));
        const split = sets.some(isDone);
        let target = performedExerciseId;
        if (split) {
          // Les séries faites restent à l'ancienne fiche ; la suite passe à un nouvel exercice du même slot.
          target = await createExercise(w, {
            sessionId: String(exercise.sessionId),
            slotId: text(exercise.slotId),
            plannedExerciseId: text(exercise.plannedExerciseId),
            exerciseId,
            swapReason: reason,
            position: num(exercise.position) ?? 1,
          });
        } else {
          await w.put({
            entity: EXERCISE,
            id: performedExerciseId,
            kind: 'patch',
            fields: { exerciseId, swapReason: reason },
          });
        }
        for (const row of open) await deleteRow(w, SET, row.id);
        for (const set of rewrite(open, sheet, previous, split))
          await createSet(w, target, sheet.load_mode, set);
        return target;
      });
      void s.sync.syncNow('set_logged');
      return id;
    },

    async markPain(performedExerciseId, level) {
      if (level !== 'discomfort' && level !== 'pain') throw new WorkoutError('out_of_range');
      const w = await writer();
      await tx(async () => {
        await exerciseContext(performedExerciseId, w);
        const fields: Record<string, unknown> = { nextAdjustment: level === 'pain' ? 'lighten' : 'hold' };
        // Sans accord santé, aucune trace de la douleur : seul l'ajustement neutre est écrit (R-SYN-10).
        if (w.healthConsentActive) fields.painLevel = level;
        await w.put({ entity: EXERCISE, id: performedExerciseId, kind: 'patch', fields });
      });
      void s.sync.syncNow('set_logged');
    },

    async setAdjustment(performedExerciseId, adjustment) {
      if (adjustment !== null && !NEXT_ADJUSTMENTS.includes(adjustment))
        throw new WorkoutError('out_of_range');
      const w = await writer();
      await tx(async () => {
        await exerciseContext(performedExerciseId, w);
        await w.put({
          entity: EXERCISE,
          id: performedExerciseId,
          kind: 'patch',
          fields: { nextAdjustment: adjustment },
        });
      });
      void s.sync.syncNow('set_logged');
    },

    async setNote(target, value) {
      const trimmed = value.trim();
      if (trimmed.length > currentRules().noteMaxLength) throw new WorkoutError('note_too_long');
      const note = trimmed === '' ? null : trimmed;
      const w = await writer();
      await tx(async () => {
        if (target.kind === 'session') assertEditable(await owned(SESSION, target.id, w), w);
        else await exerciseContext(target.id, w);
        await w.put({
          entity: target.kind === 'session' ? SESSION : EXERCISE,
          id: target.id,
          kind: 'patch',
          fields: { note },
        });
      });
      void s.sync.syncNow('set_logged');
    },

    async changePlace(sessionId, plan, placeId) {
      const w = await writer();
      await tx(async () => {
        const session = await owned(SESSION, sessionId, w);
        if (session.status !== 'in_progress') throw new WorkoutError('not_in_progress');
        assertEditable(session, w);
        if (plan === null) {
          await w.put({ entity: SESSION, id: sessionId, kind: 'patch', fields: { placeId } });
          return;
        }
        const exercises = await exercisesOf(sessionId, w);
        const sets = await setsOf(
          exercises.map((e) => e.id),
          w,
        );
        if (sets.some(isDone)) throw new WorkoutError('sets_done');
        for (const set of sets) await deleteRow(w, SET, set.id);
        for (const exercise of exercises) await deleteRow(w, EXERCISE, exercise.id);
        await w.put({
          entity: SESSION,
          id: sessionId,
          kind: 'patch',
          fields: { placeId, weekType: plan.weekType, rulesVersion: plan.rulesVersion },
        });
        await createPlanned(w, sessionId, plan);
      });
      void s.sync.syncNow('set_logged');
    },

    async finish(sessionId) {
      const w = await writer();
      const closed = await tx(() => close(w, sessionId, nowIso(), true));
      await afterCompleted([closed]);
      void s.sync.syncNow('mutation');
      return closed.status;
    },

    async remove(sessionId) {
      const w = await writer();
      await tx(async () => {
        await owned(SESSION, sessionId, w);
        const exercises = await exercisesOf(sessionId, w);
        const sets = await setsOf(
          exercises.map((e) => e.id),
          w,
        );
        for (const set of sets) await deleteRow(w, SET, set.id);
        for (const exercise of exercises) await deleteRow(w, EXERCISE, exercise.id);
        await deleteRow(w, SESSION, sessionId);
        await clearActiveIf(sessionId);
      });
      void s.sync.syncNow('mutation');
    },

    async continueHere(sessionId) {
      const w = await writer();
      await tx(async () => {
        const session = await owned(SESSION, sessionId, w);
        if (session.status !== 'in_progress') throw new WorkoutError('not_in_progress');
        const active = await getMeta(db, 'activeSessionId');
        if (active !== sessionId && (await heldHere(active, w))) throw new WorkoutError('in_progress');
        if (session.deviceId !== w.deviceId) {
          await w.put({ entity: SESSION, id: sessionId, kind: 'patch', fields: { deviceId: w.deviceId } });
        }
        await setMeta(db, 'activeSessionId', sessionId);
      });
      void s.sync.syncNow('mutation');
    },

    async closeStale(now) {
      // Miroir d'avant le premier pull de cette exécution : il peut ignorer « Continuer ici » et les séries d'un autre
      // appareil ; rien ne se clôt avant (ruling R33). Sans utilisateur non plus.
      if (!s.sync.getState().pulledThisRun || (await currentUserId(db)) === null) return [];
      const w = await writer();
      const { sameDevice, otherDevice } = currentRules().forgottenSessionH;
      const closed = await tx(async () => {
        const open = await db
          .mirror(SESSION)
          .where('status')
          .equals('in_progress')
          .filter(ownedLive(w))
          .toArray();
        const out: { id: string; status: 'completed' | 'abandoned'; instanceId: string | null }[] = [];
        for (const session of open.sort((a, b) => binary(a.id, b.id))) {
          const sets = await setsOf(
            (await exercisesOf(session.id, w)).map((e) => e.id),
            w,
          );
          const started = Date.parse(String(session.startedAt));
          const logged = sets.flatMap((set) => (isDone(set) ? [Date.parse(String(set.loggedAt))] : []));
          const lastLogged = logged.length === 0 ? null : Math.max(...logged);
          const last = Math.max(started, lastLogged ?? started);
          const hours = session.deviceId === w.deviceId ? sameDevice : otherDevice;
          if (Number.isNaN(last) || now - last < hours * HOUR_MS) continue;
          const endedAt = new Date(lastLogged ?? started).toISOString();
          out.push({ id: session.id, ...(await close(w, session.id, endedAt, false)) });
        }
        // Séance notée en cours ici mais close ou reprise ailleurs : elle ne bloque plus rien.
        const active = await getMeta(db, 'activeSessionId');
        if (active && !(await heldHere(active, w))) await setMeta(db, 'activeSessionId', null);
        return out;
      });
      if (closed.length > 0) {
        await afterCompleted(closed);
        void s.sync.syncNow('mutation');
      }
      return closed.map((c) => c.id);
    },

    async addFreeExercise(sessionId, exerciseId) {
      const w = await writer();
      const id = await tx(async () => {
        const sheet = await sheetOf(exerciseId);
        if (sheet === undefined) throw new WorkoutError('unknown_exercise');
        const session = await owned(SESSION, sessionId, w);
        if (session.status !== 'in_progress') throw new WorkoutError('not_in_progress');
        assertEditable(session, w);
        const last = (await exercisesOf(sessionId, w)).at(-1);
        const position = (num(last?.position) ?? 0) + 1;
        if (position > currentRules().setBounds.position[1]) throw new WorkoutError('out_of_range');
        const peId = await createExercise(w, {
          sessionId,
          slotId: null,
          plannedExerciseId: null,
          exerciseId,
          swapReason: null,
          position,
        });
        for (const side of sheet.unilateral ? (['left', 'right'] as const) : ([null] as const)) {
          await createSet(w, peId, sheet.load_mode, emptySet(1, side));
        }
        return peId;
      });
      void s.sync.syncNow('set_logged');
      return id;
    },

    async activeSession() {
      const activeId = await getMeta(db, 'activeSessionId');
      if (!activeId) return null;
      const [view] = await readSessions(async () => {
        const row = await db.mirror(SESSION).get(activeId);
        return row ? [row] : [];
      });
      return view && view.status === 'in_progress' && view.heldHere ? view : null;
    },

    async session(id) {
      const [view] = await readSessions(async () => {
        const row = await db.mirror(SESSION).get(id);
        return row ? [row] : [];
      });
      return view ?? null;
    },

    async history() {
      const views = await readSessions(() =>
        db.mirror(SESSION).where('status').anyOf(['completed', 'abandoned']).toArray(),
      );
      return views.sort(latestFirst);
    },

    async otherDeviceSession() {
      const views = await readSessions((deviceId) =>
        db
          .mirror(SESSION)
          .where('status')
          .equals('in_progress')
          .filter((r) => r.deviceId !== deviceId)
          .toArray(),
      );
      return views.sort(latestFirst)[0] ?? null;
    },
  };
}

const repos = new WeakMap<AppServices, WorkoutsRepo>();

/** Un seul dépôt par services : celui des hooks ci-dessous et `useRepos().workouts` sont le même objet. */
export function workoutRepoFor(services: AppServices): WorkoutsRepo {
  let repo = repos.get(services);
  if (!repo) {
    repo = createWorkoutRepo(services);
    repos.set(services, repo);
  }
  return repo;
}

/**
 * Clôture des séances oubliées (D12) dès que le moteur a réussi un pull dans cette exécution (ruling R33) : à chaque
 * passage de `pulledThisRun` à vrai (lancement, puis un autre utilisateur). Branchée par `bootApp` ; rend la fonction
 * qui la retire.
 */
export function closeStaleAfterPull(services: AppServices): () => void {
  let pulled = false;
  const check = (state: SyncState) => {
    const was = pulled;
    pulled = state.pulledThisRun;
    if (!pulled || was) return;
    workoutRepoFor(services)
      .closeStale(services.now())
      .catch(() => {
        // Base illisible ou session perdue : la prochaine exécution réessaiera.
      });
  };
  const unsubscribe = services.sync.subscribe(check);
  check(services.sync.getState());
  return unsubscribe;
}

function useWorkoutRepo(): WorkoutsRepo {
  const services = useServices();
  return useMemo(() => workoutRepoFor(services), [services]);
}

/** Séance en cours sur cet appareil, observée ; `undefined` tant que la base n'a pas répondu. */
export function useActiveSession(): WorkoutSessionView | null | undefined {
  const repo = useWorkoutRepo();
  return useLive(() => repo.activeSession(), [repo]);
}

export function useSession(id: string): WorkoutSessionView | null | undefined {
  const repo = useWorkoutRepo();
  return useLive(() => repo.session(id), [repo, id]);
}

export function useHistory(): WorkoutSessionView[] | undefined {
  const repo = useWorkoutRepo();
  return useLive(() => repo.history(), [repo]);
}

export function useOtherDeviceSession(): WorkoutSessionView | null | undefined {
  const repo = useWorkoutRepo();
  return useLive(() => repo.otherDeviceSession(), [repo]);
}
