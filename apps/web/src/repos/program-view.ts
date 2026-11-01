import {
  defaultLoadSettings,
  entityRules,
  InstanceChangeView,
  ProgramInstanceView,
  type ProgramTemplate,
  ProgramTemplateSchema,
  type ServedProgramTemplate,
  ServedProgramTemplateSchema,
  type SessionProfile,
  SLOT_MODES,
} from '@rune/contracts';
import {
  type AcceptedChange,
  currentRules,
  type EffectiveProgram,
  expandEquipment,
  type PlaceContext,
  type PlannedWorkout,
  parisDate,
  planWorkout,
  type ReplayInput,
  type ReplayResult,
  RULES_BY_VERSION,
  type RulesSet,
  replayInstance,
  type SlotState,
  UnknownRulesVersionError,
} from '@rune/domain';
import { useMemo } from 'react';
import { type AppServices, useLive, useServices } from '../app-services';
import { isC2Value } from '../local-db/c2';
import { healthConsentCached } from '../local-db/consent';
import type { MirrorRow } from '../local-db/db';
import { getMeta } from '../local-db/meta';
import { catalogRepoFor } from './catalog-repo';
import { createPlacesRepo, type PlaceView, placeView } from './places-repo';
import { currentUserId, isLive, oneOf, ownedRows, parseJsonColumn, text } from './rows';
import { composeSessions, type WorkoutSessionView } from './session-records';

/*
 * Programme vu du téléphone (spec brique 3 §4.4.8, §7.2, §7.7) : l'instance active et son rejeu local sur le miroir
 * (séances des autres appareils déjà reçues, plus celles de cet appareil pas encore envoyées), d'où la séance du
 * jour. Le téléphone n'écrit jamais de changement ; les cibles qu'il calcule restent des copies `provisional`.
 */

export interface ProgramView {
  instance: ProgramInstanceView;
  /**
   * Modèle servi du même id (magasin `programTemplates`) ; null s'il n'est plus servi. Sa `version` peut dépasser
   * celle de l'instance : bandeau « Une nouvelle version de ton programme existe. » (§7.7).
   */
  template: ServedProgramTemplate | null;
  /** Programme effectif : `snapshot` plus les changements acceptés (D5). */
  program: EffectiveProgram;
  replay: ReplayResult;
  /** États des slots : ceux du rejeu local, ou ceux du serveur (`source: 'server'`). */
  slotStates: SlotState[];
  /**
   * `server` : une séance du miroir porte une version de règles que cette appli ne connaît pas (faite sur un appareil
   * plus à jour) ; les cibles viennent des `slot_state` du miroir (ceux du serveur, ou les copies provisoires qui les
   * ont remplacés jusqu'au pull), sans rejeu local, et l'écran propose la mise à jour (§4.4.8). L'état du programme
   * (semaine, rotation) est tout de même recompté.
   */
  source: 'local' | 'server';
  /** Propositions en attente et non expirées, la plus ancienne d'abord. */
  proposals: InstanceChangeView[];
  /** Les autres changements, du plus récent au plus ancien (journal, §7.7). */
  changes: InstanceChangeView[];
}

/** Séance prévue, prête pour `repos.workouts.start` (D2, D3). */
export interface PlannedSession {
  plan: PlannedWorkout;
  placeId: string;
  instanceId: string;
  workoutId: string;
  /** Profil avec lequel le plan a été fait, figé dans la séance. */
  profile: SessionProfile;
  templateVersion: number;
}

export interface ProgramViewRepo {
  /** Null sans instance active (ou avec un `snapshot` illisible). */
  view(): Promise<ProgramView | null>;
  /**
   * Séance du jour au lieu `placeId` (le lieu principal si null) : `workoutId`, ou celle de la rotation si null. Null
   * sans programme, sans ce lieu, ou pour une séance absente du programme.
   */
  plannedWorkout(placeId: string | null, workoutId: string | null): Promise<PlannedSession | null>;
  /**
   * Copies provisoires (`provisional: 1`) des états et décisions du rejeu, que le pull remplace : une ligne de même
   * contenu reste telle quelle, une copie que le rejeu ne produit plus est retirée. Sans accord santé, `painStreak`
   * (C2) reste vide.
   */
  storeProvisional(replay: ReplayResult): Promise<void>;
  /** Rejeu local de l'instance active, gardé en copies provisoires ; rien quand les cibles viennent du serveur. */
  refreshProvisional(): Promise<void>;
}

/** Marque des copies provisoires : 1, IndexedDB n'indexe pas les booléens (index `provisional`). */
export const PROVISIONAL = 1;

const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const int = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isInteger(v) ? v : fallback;
const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

function instanceOf(row: MirrorRow): ProgramInstanceView | null {
  const parsed = ProgramInstanceView.safeParse({
    id: row.id,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    daysPerWeek: row.daysPerWeek,
    status: row.status,
    revision: row.revision,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? null,
  });
  return parsed.success ? parsed.data : null;
}

function changeOf(row: MirrorRow): InstanceChangeView | null {
  const parsed = InstanceChangeView.safeParse({
    id: row.id,
    instanceId: row.instanceId,
    baseRevision: row.baseRevision,
    author: row.author,
    operations: row.operations,
    reasonCode: row.reasonCode,
    reason: row.reason ?? null,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt ?? null,
    decidedAt: row.decidedAt ?? null,
  });
  return parsed.success ? parsed.data : null;
}

/** `slot_state` reçu du serveur, au format du domaine ; `painStreak` vide (sans accord) compte pour 0. */
function slotStateOf(row: MirrorRow): SlotState | null {
  const mode = oneOf(SLOT_MODES, row.mode);
  const instanceId = text(row.instanceId);
  const slotId = text(row.slotId);
  const exerciseId = text(row.exerciseId);
  if (mode === null || instanceId === null || slotId === null || exerciseId === null) return null;
  return {
    id: row.id,
    instanceId,
    slotId,
    exerciseId,
    mode,
    loadG: intOrNull(row.loadG),
    targetReps: intOrNull(row.targetReps),
    variantRank: intOrNull(row.variantRank),
    durationS: intOrNull(row.durationS),
    machineStepGOverride: intOrNull(row.machineStepGOverride),
    calibrationLeft: int(row.calibrationLeft),
    noProgressCount: int(row.noProgressCount),
    stallRank: int(row.stallRank),
    painStreak: int(row.painStreak),
    suspended: row.suspended === true,
    lastSessionId: text(row.lastSessionId),
    rulesVersion: text(row.rulesVersion) ?? '',
  };
}

/** Lieu d'une séance pour le moteur : matériel développé, réglages du lieu ou de sa salle, sinon par défaut. */
const placeContext = (p: PlaceView): PlaceContext => ({
  id: p.id,
  equipment: expandEquipment(p.equipment),
  loadSettings: p.loadSettings ?? defaultLoadSettings(p.kind),
});

/** JSON aux clés triées : deux objets égaux, quel que soit l'ordre de leurs clés, donnent le même texte. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const entries = Object.entries(v).sort(([a], [b]) => binary(a, b));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const sameContent = (row: MirrorRow, fields: Record<string, unknown>): boolean =>
  Object.entries(fields).every(([k, v]) => stable(row[k]) === stable(v));

/** Copie provisoire d'une ligne de classe D : colonnes du registre en camelCase, hors synchro. */
interface Copy {
  id: string;
  fields: Record<string, unknown>;
}

/** Valeurs de santé vidées (`pain_streak`) : sans accord, aucune trace de douleur en local (R-SYN-10). */
function withoutC2(entity: string, fields: Record<string, unknown>): Record<string, unknown> {
  const rule = entityRules[entity];
  if (rule === undefined) return fields;
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, isC2Value(rule, k, v) ? null : v]));
}

/** Dernière charge de travail faite sur chaque exercice, toutes séances comprises (calibration, spec §4.3.5). */
function lastLoads(sessions: readonly WorkoutSessionView[]): Map<string, number> {
  const latest = new Map<string, { at: number; loadG: number }>();
  for (const s of sessions) {
    for (const e of s.exercises) {
      for (const set of e.sets) {
        if (set.kind !== 'work' || set.loggedAt === null || set.loadG === null) continue;
        const known = latest.get(e.exerciseId);
        if (known === undefined || set.loggedAt >= known.at) {
          latest.set(e.exerciseId, { at: set.loggedAt, loadG: set.loadG });
        }
      }
    }
  }
  return new Map([...latest].map(([id, v]) => [id, v.loadG]));
}

/**
 * Rejeu sans les règles inconnues (§4.4.8) : chaque version inconnue est lue avec les règles courantes, seulement pour
 * recompter l'état du programme ; états des slots ceux du serveur, ni décision ni événement.
 */
function serverReplay(input: ReplayInput, states: SlotState[]): ReplayResult {
  const book: Record<string, RulesSet> = { ...RULES_BY_VERSION };
  // Chaque tour ajoute une version de plus, prise aux séances : la boucle s'arrête.
  for (;;) {
    try {
      const replay = replayInstance({ ...input, rulesBook: book });
      return { ...replay, slotStates: states, decisions: [], events: [] };
    } catch (error) {
      if (!(error instanceof UnknownRulesVersionError)) throw error;
      book[error.version] = currentRules();
    }
  }
}

export function createProgramViewRepo(s: AppServices): ProgramViewRepo {
  const { db } = s;
  const catalog = catalogRepoFor(s);
  const places = createPlacesRepo(s);

  /** Lieux du membre, supprimés compris (une séance passée peut en citer un). */
  async function placeContexts(ownerId: string): Promise<Map<string, PlaceContext>> {
    const rows = await db
      .mirror('place')
      .filter((r) => r.ownerId === ownerId)
      .toArray();
    const views = await Promise.all(rows.map((r) => placeView(db, r)));
    return new Map(views.map((p) => [p.id, placeContext(p)]));
  }

  async function servedTemplate(id: string): Promise<ServedProgramTemplate | null> {
    const row: { template?: unknown; available?: unknown } | undefined = await db
      .table('programTemplates')
      .get(id);
    const parsed = ServedProgramTemplateSchema.safeParse({
      template: row?.template,
      available: row?.available,
    });
    return parsed.success ? parsed.data : null;
  }

  async function activeInstance(
    ownerId: string,
  ): Promise<{ instance: ProgramInstanceView; snapshot: ProgramTemplate } | null> {
    const rows = (await ownedRows(db, 'program_instance', ownerId))
      .filter((r) => r.status === 'active')
      .sort((a, b) => binary(String(b.startedAt), String(a.startedAt)) || binary(b.id, a.id));
    const row = rows[0];
    if (row === undefined) return null;
    const instance = instanceOf(row);
    const snapshot = parseJsonColumn(row.snapshot, ProgramTemplateSchema);
    return instance === null || snapshot === null ? null : { instance, snapshot };
  }

  async function view(): Promise<ProgramView | null> {
    const ownerId = await currentUserId(db);
    if (ownerId === null) return null;
    const active = await activeInstance(ownerId);
    if (active === null) return null;
    const { instance, snapshot } = active;
    const owned = (r: MirrorRow) => isLive(r) && r.ownerId === ownerId;

    const changeViews = (await db.mirror('instance_change').where('instanceId').equals(instance.id).toArray())
      .filter(owned)
      .flatMap((r) => {
        const c = changeOf(r);
        return c === null ? [] : [c];
      });
    const accepted: AcceptedChange[] = changeViews.flatMap((c) =>
      c.status === 'accepted' && c.decidedAt !== null
        ? [
            {
              id: c.id,
              author: c.author,
              reasonCode: c.reasonCode,
              decidedAt: Date.parse(c.decidedAt),
              operations: c.operations,
            },
          ]
        : [],
    );
    const deviceId = (await getMeta(db, 'deviceId')) ?? null;
    const sessionRows = await db
      .mirror('workout_session')
      .filter((r) => r.instanceId === instance.id)
      .toArray();
    // Toutes les lignes vivantes, copies provisoires comprises : une copie a remplacé la ligne du serveur jusqu'au pull
    // et en porte le pas de machine (ruling de la revue de la Task 15).
    const knownStates = (await db.mirror('slot_state').where('instanceId').equals(instance.id).toArray())
      .filter(owned)
      .flatMap((r) => {
        const state = slotStateOf(r);
        return state === null ? [] : [state];
      })
      .sort((a, b) => binary(a.id, b.id));
    const input: ReplayInput = {
      instance: {
        id: instance.id,
        snapshot,
        daysPerWeek: instance.daysPerWeek,
        startedAt: Date.parse(instance.startedAt),
      },
      sessions: await composeSessions(db, sessionRows, ownerId, deviceId),
      changes: accepted,
      catalog: await catalog.sheets(),
      places: await placeContexts(ownerId),
      overrides: new Map(
        knownStates.flatMap((st) =>
          st.machineStepGOverride === null ? [] : [[st.id, st.machineStepGOverride] as const],
        ),
      ),
    };

    let replay: ReplayResult;
    let source: ProgramView['source'] = 'local';
    try {
      replay = replayInstance(input);
    } catch (error) {
      if (!(error instanceof UnknownRulesVersionError)) throw error;
      replay = serverReplay(input, knownStates);
      source = 'server';
    }

    const now = s.now();
    const pending = (c: InstanceChangeView) =>
      c.status === 'proposed' && (c.expiresAt === null || Date.parse(c.expiresAt) > now);
    const byCreation = (a: InstanceChangeView, b: InstanceChangeView) =>
      binary(a.createdAt, b.createdAt) || binary(a.id, b.id);
    return {
      instance,
      template: await servedTemplate(instance.templateId),
      program: replay.program,
      replay,
      slotStates: replay.slotStates,
      source,
      proposals: changeViews.filter(pending).sort(byCreation),
      changes: changeViews.filter((c) => !pending(c)).sort((a, b) => byCreation(b, a)),
    };
  }

  async function plannedWorkout(
    placeId: string | null,
    workoutId: string | null,
  ): Promise<PlannedSession | null> {
    const ownerId = await currentUserId(db);
    const program = await view();
    if (ownerId === null || program === null) return null;
    const all = await places.list();
    const place = placeId === null ? all.find((p) => p.isPrimary) : all.find((p) => p.id === placeId);
    if (place === undefined) return null;
    const [member, sheets, me, sessionRows, deviceId] = await Promise.all([
      catalog.context(),
      catalog.sheets(),
      getMeta(db, 'me'),
      db.mirror('workout_session').toArray(),
      getMeta(db, 'deviceId'),
    ]);
    const profile: SessionProfile = member.cautious ? 'cautious' : 'adult';
    const history = await composeSessions(db, sessionRows, ownerId, deviceId ?? null);
    try {
      const plan = planWorkout({
        replay: program.replay,
        workoutId: workoutId ?? program.replay.state.nextWorkoutId,
        place: placeContext(place),
        catalog: sheets,
        profile,
        // Faute de savoir, le message aux mineurs s'affiche (comme le profil prudent par défaut).
        ageBand: me?.ageBand ?? 'minor',
        context: program.program.template.context,
        today: parisDate(new Date(s.now())),
        lastLoadByExercise: lastLoads(history),
        maxLevel: member.maxLevel,
      });
      return {
        plan,
        placeId: place.id,
        instanceId: program.instance.id,
        workoutId: plan.workoutId,
        profile,
        templateVersion: program.instance.templateVersion,
      };
    } catch (error) {
      // Séance absente du programme.
      if (error instanceof RangeError) return null;
      throw error;
    }
  }

  async function storeProvisional(replay: ReplayResult): Promise<void> {
    const ownerId = await currentUserId(db);
    if (ownerId === null) return;
    const consent = await healthConsentCached(db);
    const instanceIds = new Set([
      ...replay.slotStates.map((st) => st.instanceId),
      ...replay.decisions.map((d) => d.instanceId),
    ]);
    const copies = (entity: 'slot_state' | 'engine_decision', rows: readonly { id: string }[]): Copy[] =>
      rows.map(({ id, ...fields }) => ({ id, fields: consent ? fields : withoutC2(entity, fields) }));
    const states = db.mirror('slot_state');
    const decisions = db.mirror('engine_decision');

    /**
     * Copies d'un magasin : une ligne de même contenu reste, une copie que le rejeu ne produit plus part. Le pas de
     * machine (`machine_step_g_override`) n'est écrit que par l'API en ligne : une copie garde celui de la ligne
     * qu'elle remplace.
     */
    async function store(table: typeof states, rows: Copy[]): Promise<void> {
      for (const copy of rows) {
        const { id } = copy;
        const existing = await table.get(id);
        const live = existing !== undefined && isLive(existing);
        const fields =
          live && 'machineStepGOverride' in copy.fields
            ? { ...copy.fields, machineStepGOverride: existing.machineStepGOverride ?? null }
            : copy.fields;
        if (live && sameContent(existing, fields)) continue;
        await table.put({
          ...fields,
          id,
          ownerId,
          serverRevSeen: null,
          deletedAt: null,
          provisional: PROVISIONAL,
        });
      }
      const produced = new Set(rows.map((r) => r.id));
      const stale = await table
        .where('provisional')
        .equals(PROVISIONAL)
        .filter((r) => instanceIds.has(String(r.instanceId)) && !produced.has(r.id))
        .primaryKeys();
      await table.bulkDelete(stale);
    }

    await db.transaction('rw', [states, decisions], async () => {
      await store(states, copies('slot_state', replay.slotStates));
      await store(decisions, copies('engine_decision', replay.decisions));
    });
  }

  return {
    view,
    plannedWorkout,
    storeProvisional,
    async refreshProvisional() {
      const current = await view();
      if (current?.source === 'local') await storeProvisional(current.replay);
    },
  };
}

const repos = new WeakMap<AppServices, ProgramViewRepo>();

/** Un seul dépôt par services : celui des hooks ci-dessous et `useRepos().programView` sont le même objet. */
export function programViewFor(services: AppServices): ProgramViewRepo {
  let repo = repos.get(services);
  if (!repo) {
    repo = createProgramViewRepo(services);
    repos.set(services, repo);
  }
  return repo;
}

function useProgramViewRepo(): ProgramViewRepo {
  const services = useServices();
  return useMemo(() => programViewFor(services), [services]);
}

/** Programme actif, observé ; `undefined` tant que la base n'a pas répondu, null sans programme. */
export function useProgramView(): ProgramView | null | undefined {
  const repo = useProgramViewRepo();
  return useLive(() => repo.view(), [repo]);
}

/** Séance prévue au lieu et pour la séance donnés (null : lieu principal, séance de la rotation), observée. */
export function usePlannedWorkout(
  placeId: string | null,
  workoutId: string | null,
): PlannedSession | null | undefined {
  const repo = useProgramViewRepo();
  return useLive(() => repo.plannedWorkout(placeId, workoutId), [repo, placeId, workoutId]);
}
