import {
  type CatalogBundle,
  CURRENT_CONSENT_TEXTS,
  InstanceChangeOperationSchema,
  MAX_CHANGE_OPERATIONS,
  maxExerciseLevel,
} from '@rune/contracts';
import {
  ANYWHERE,
  type BriefLimitation,
  type BriefPlaceInput,
  type BriefProgramInput,
  type BriefSession,
  type CoachBriefInput,
  expandEquipment,
  lastLoadsOf,
  type PlanInput,
  parisDate,
  parisDaysBetween,
  type ReplayInput,
  type ReplayResult,
  replayInstance,
  type SessionRecord,
  templateContext,
  UnknownRulesVersionError,
} from '@rune/domain';
import { z } from 'zod';
import { traitsOn } from '../auth/me';
import { currentCatalog } from '../catalog/bundle';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { getConsentState } from '../privacy/consent-state';
import { activeInstance, type InstanceRow } from '../program/enroll';
import { isEquipmentCode, toPlaceContext, toSessionRecords } from '../program/records';
import { loadInput, parseSnapshot, placeRowsOf } from '../program/replay-service';

/*
 * Entrée du dossier du coach (spec brique 4 §9) et contexte de la séance prévue, rassemblés par le serveur avec ses
 * chargeurs existants : rejeu de l'instance (`loadInput`), lieux (`placeRowsOf`), séances (`toSessionRecords`),
 * accords, catalogue servi (`currentCatalog`). Lecture seule : rien n'est écrit (pas même l'expiration des
 * propositions, filtrées à la lecture), hors reconstruction du bloc servi s'il manque. R-AGE-3 : l'âge vient de
 * `traitsOn` au jour de Paris de `now` ; l'entrée n'en garde que `audience` et `ageBand`.
 */

const DAY_MS = 86_400_000;

const Operations = z.array(InstanceChangeOperationSchema).min(1).max(MAX_CHANGE_OPERATIONS);

function skip(deps: AppDeps, code: string): void {
  deps.logger.warn('coach_replay_skipped', { code });
}

/** Entrée du rejeu d'`instance`, comme `replayInstanceInDb` la charge ; null si elle est illisible (journalisé). */
async function replayInputOf(
  db: DbExecutor,
  deps: AppDeps,
  instance: InstanceRow,
): Promise<ReplayInput | null> {
  // États existants, supprimés compris : surcharges du pas de machine.
  const slotRows = await db
    .selectFrom('slotState')
    .selectAll()
    .where('ownerId', '=', instance.ownerId)
    .where('instanceId', '=', instance.id)
    .execute();
  const input = await loadInput(db, instance, slotRows);
  if (typeof input === 'string') {
    skip(deps, input);
    return null;
  }
  return input;
}

/** Entrée du rejeu de l'instance active de `userId` ; null sans instance active (ou entrée illisible). */
export async function loadReplayInput(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
): Promise<ReplayInput | null> {
  const instance = await activeInstance(db, userId);
  return instance === undefined ? null : replayInputOf(db, deps, instance);
}

// ---------------------------------------------------------------------------------------------------------------
// Profil, accords, lieux
// ---------------------------------------------------------------------------------------------------------------

function trainingProfile(db: DbExecutor, userId: string) {
  return db
    .selectFrom('trainingProfile')
    .select(['goal', 'experience', 'daysPerWeek', 'sessionMinutes', 'sportCode', 'cautiousMode'])
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
}

/** Accord santé actif ; accord coach à la version exacte du texte en vigueur (choix C36), comme la garde. */
async function consentsOf(db: DbExecutor, userId: string): Promise<CoachBriefInput['consents']> {
  const { health, aiCoach } = await getConsentState(db, userId);
  return {
    health: health.active,
    coach: aiCoach.active && aiCoach.textVersion === CURRENT_CONSENT_TEXTS.ai_coach.version,
  };
}

/**
 * Lieux vivants, triés par identifiant (ordre binaire) : `lieu_2`… désigne le même lieu dans le dossier figé et dans
 * les outils (`search_exercises`, par `namedPlaces`). Matériel vivant déclaré, sans ses implications (le dossier les
 * étend pour résoudre les slots), trié ; réglages de charge résolus (lieu, salle, défaut), ceux du rejeu.
 */
export async function livePlaces(db: DbExecutor, userId: string): Promise<BriefPlaceInput[]> {
  const rows = new Map((await placeRowsOf(db, userId, { live: true })).map((p) => [p.id, p]));
  const places = await db
    .selectFrom('place')
    .select(['id', 'name', 'isPrimary'])
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .orderBy('id')
    .execute();
  return places.flatMap((r) => {
    const place = rows.get(r.id);
    if (place === undefined) return [];
    return [
      {
        id: r.id,
        name: r.name,
        kind: place.kind,
        primary: r.isPrimary === 1,
        equipment: [...new Set(place.equipment.filter(isEquipmentCode))].sort(),
        loadSettings: toPlaceContext(place).loadSettings,
      },
    ];
  });
}

/** Limitations vivantes et actives, complètes. */
async function limitationsOf(db: DbExecutor, userId: string): Promise<BriefLimitation[]> {
  const rows = await db
    .selectFrom('limitation')
    .select(['bodyArea', 'side', 'severity', 'note'])
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .where('active', '=', 1)
    .orderBy('id')
    .execute();
  return rows.flatMap(({ bodyArea, side, severity, note }) =>
    bodyArea === null || side === null || severity === null ? [] : [{ area: bodyArea, side, severity, note }],
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Séances
// ---------------------------------------------------------------------------------------------------------------

/** Nom de la séance de programme de `workoutId` dans le `snapshot` de son instance ; « Séance A » sinon. */
async function workoutNames(
  db: DbExecutor,
  userId: string,
  instanceIds: readonly string[],
): Promise<(instanceId: string | null, workoutId: string) => string> {
  const rows =
    instanceIds.length === 0
      ? []
      : await db
          .selectFrom('programInstance')
          .select(['id', 'snapshot'])
          .where('ownerId', '=', userId)
          .where('id', 'in', instanceIds)
          .execute();
  const snapshots = new Map(rows.map((r) => [r.id, parseSnapshot(r.snapshot)]));
  return (instanceId, workoutId) =>
    (instanceId === null ? undefined : snapshots.get(instanceId))?.workouts.find((w) => w.id === workoutId)
      ?.name ?? `Séance ${workoutId}`;
}

/**
 * Séances `completed` vivantes des `readTrainingMaxDays` derniers jours de Paris (bornes comprises, comme le
 * dossier), avec leurs notes, exercices (par position) et séries vivants. La douleur n'y entre qu'avec l'accord
 * santé et l'accord coach (C2).
 */
async function recentSessions(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  now: Date,
  pain: boolean,
): Promise<BriefSession[]> {
  const days = deps.coachConfig.limits.readTrainingMaxDays;
  // Marge de deux jours pour les changements d'heure ; le compte exact est en jours civils de Paris.
  const since = new Date(now.getTime() - (days + 2) * DAY_MS).toISOString();
  const sessions = (
    await db
      .selectFrom('workoutSession')
      .selectAll()
      .where('ownerId', '=', userId)
      .where('status', '=', 'completed')
      .where('deletedAt', 'is', null)
      .where('endedAt', '>=', since)
      .orderBy('endedAt')
      .orderBy('id')
      .execute()
  ).filter((s) => s.endedAt !== null && parisDaysBetween(Date.parse(s.endedAt), now.getTime()) <= days);
  if (sessions.length === 0) return [];
  const ids = sessions.map((s) => s.id);
  const exercises = await db
    .selectFrom('performedExercise')
    .selectAll()
    .where('ownerId', '=', userId)
    .where('sessionId', 'in', ids)
    .where('deletedAt', 'is', null)
    .orderBy('position')
    .orderBy('id')
    .execute();
  const sets =
    exercises.length === 0
      ? []
      : await db
          .selectFrom('performedSet')
          .selectAll()
          .where('ownerId', '=', userId)
          .where(
            'performedExerciseId',
            'in',
            exercises.map((e) => e.id),
          )
          .where('deletedAt', 'is', null)
          .execute();
  const sessionNotes = new Map(sessions.map((s) => [s.id, s.note]));
  const exerciseNotes = new Map(exercises.map((e) => [e.id, e.note]));
  const nameOf = await workoutNames(db, userId, [
    ...new Set(sessions.flatMap((s) => (s.instanceId === null ? [] : [s.instanceId]))),
  ]);
  return toSessionRecords({ sessions, exercises, sets }).flatMap((s): BriefSession[] =>
    s.endedAt === null
      ? []
      : [
          {
            endedAt: s.endedAt,
            workoutName: s.workoutId === null ? null : nameOf(s.instanceId, s.workoutId),
            placeId: s.placeId,
            note: sessionNotes.get(s.id) ?? null,
            exercises: s.exercises.map((e) => ({
              exerciseId: e.exerciseId,
              painLevel: pain ? e.painLevel : null,
              note: exerciseNotes.get(e.id) ?? null,
              sets: e.sets,
            })),
          },
        ],
  );
}

/** Toutes les séances vivantes de `userId`, en cours comprises, pour `lastLoadsOf` (comme le téléphone). */
async function allSessions(db: DbExecutor, userId: string): Promise<SessionRecord[]> {
  const sessions = await db
    .selectFrom('workoutSession')
    .selectAll()
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .execute();
  const exercises = await db
    .selectFrom('performedExercise')
    .selectAll()
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .execute();
  const sets = await db
    .selectFrom('performedSet')
    .selectAll()
    .where('ownerId', '=', userId)
    .where('deletedAt', 'is', null)
    .execute();
  return toSessionRecords({ sessions, exercises, sets });
}

// ---------------------------------------------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------------------------------------------

/**
 * Propositions en attente de l'instance : `proposed`, vivantes, à la révision courante et pas encore échues (la
 * limite elle-même encore valable, comme `expireProposals`), la plus ancienne d'abord. Une ligne illisible est
 * écartée.
 */
async function pendingOf(
  db: DbExecutor,
  instance: InstanceRow,
  now: Date,
): Promise<BriefProgramInput['pending']> {
  const rows = await db
    .selectFrom('instanceChange')
    .select(['author', 'operations', 'expiresAt'])
    .where('ownerId', '=', instance.ownerId)
    .where('instanceId', '=', instance.id)
    .where('status', '=', 'proposed')
    .where('deletedAt', 'is', null)
    .where('baseRevision', '=', instance.revision)
    .where('expiresAt', '>=', now.toISOString())
    .orderBy('createdAt')
    .orderBy('id')
    .execute();
  return rows.flatMap((r) => {
    let raw: unknown;
    try {
      raw = JSON.parse(r.operations);
    } catch {
      return [];
    }
    const operations = Operations.safeParse(raw);
    return operations.success && r.expiresAt !== null
      ? [{ author: r.author, operations: operations.data, expiresAt: Date.parse(r.expiresAt) }]
      : [];
  });
}

/**
 * Programme du dossier : l'instance active rejouée (`program` = `replay.program`, une seule source pour les slots et
 * leurs états), la fin de séance de chaque décision du rejeu, propositions en attente, modèles servis. Null sans
 * instance active, ou si le rejeu est impossible (entrée illisible, règles inconnues du serveur : journalisé).
 */
async function programOf(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  now: Date,
  catalog: CatalogBundle,
): Promise<BriefProgramInput | null> {
  const instance = await activeInstance(db, userId);
  if (instance === undefined) return null;
  const input = await replayInputOf(db, deps, instance);
  if (input === null) return null;
  let replay: ReplayResult;
  try {
    replay = replayInstance(input);
  } catch (err) {
    if (!(err instanceof UnknownRulesVersionError)) throw err;
    skip(deps, 'unknown_rules_version');
    return null;
  }
  // Une décision par exercice réalisé (`EngineDecision.id`), sur toutes les séances rejouées.
  const decisionEndedAt = new Map(
    input.sessions.flatMap((s) => {
      const { endedAt } = s;
      return endedAt === null ? [] : s.exercises.map((e) => [e.id, endedAt] as const);
    }),
  );
  return {
    templateVersion: instance.templateVersion,
    revision: instance.revision,
    program: replay.program,
    replay,
    decisionEndedAt,
    pending: await pendingOf(db, instance, now),
    templates: catalog.programTemplates,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------------------------------------------

/**
 * Entrée de `buildCoachBrief` à l'instant `now` (spec §9) : jour de Paris, public et tranche d'âge (`age.ts`), accords,
 * profil, lieux vivants, programme rejoué, séances des 28 derniers jours, catalogue servi ; limitations seulement
 * avec l'accord santé et l'accord coach (C2).
 */
export async function loadBriefInput(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  now: Date,
): Promise<CoachBriefInput> {
  const today = parisDate(now);
  const { audience, ageBand, cautious } = await traitsOn(db, userId, today);
  const consents = await consentsOf(db, userId);
  const health = consents.health && consents.coach;
  const profile = await trainingProfile(db, userId);
  const catalog = await currentCatalog(deps, db);
  return {
    today,
    audience,
    ageBand,
    consents,
    profile: {
      experience: profile?.experience ?? null,
      goal: profile?.goal ?? null,
      daysPerWeek: profile?.daysPerWeek ?? null,
      sessionMinutes: profile?.sessionMinutes ?? null,
      sportCode: profile?.sportCode ?? null,
      cautiousMode: profile?.cautiousMode === 1,
      engineProfile: cautious ? 'cautious' : 'adult',
    },
    places: await livePlaces(db, userId),
    program: await programOf(db, deps, userId, now, catalog),
    sessions: await recentSessions(db, deps, userId, now, health),
    catalog: catalog.exercises,
    limitations: health ? await limitationsOf(db, userId) : [],
  };
}

/**
 * Contexte de `planWorkout` pour l'aperçu d'un changement (tâche 18) : lieu principal (tout le matériel sans lieu),
 * catalogue servi, profil (prudent ou non), public, contexte du programme suivi (sinon celui du profil), jour de
 * Paris, niveau de fiche le plus haut, dernières charges par `lastLoadsOf`, la fonction du téléphone.
 */
export async function loadPlanContext(
  db: DbExecutor,
  deps: AppDeps,
  userId: string,
  now: Date,
): Promise<Omit<PlanInput, 'replay' | 'workoutId'>> {
  const today = parisDate(now);
  const { audience, cautious } = await traitsOn(db, userId, today);
  const profile = await trainingProfile(db, userId);
  const primary = (await livePlaces(db, userId)).find((p) => p.primary);
  const instance = await activeInstance(db, userId);
  const snapshot = instance === undefined ? null : parseSnapshot(instance.snapshot);
  return {
    place:
      primary === undefined
        ? ANYWHERE
        : {
            id: primary.id,
            equipment: expandEquipment(primary.equipment),
            loadSettings: primary.loadSettings,
          },
    catalog: (await currentCatalog(deps, db)).exercises,
    profile: cautious ? 'cautious' : 'adult',
    ageBand: audience,
    context:
      snapshot?.context ??
      templateContext(profile?.goal ?? null, profile?.sportCode ?? null, primary?.kind ?? 'gym'),
    today,
    lastLoadByExercise: lastLoadsOf(await allSessions(db, userId)),
    maxLevel: maxExerciseLevel(profile?.experience),
  };
}
