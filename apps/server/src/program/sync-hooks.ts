import type { PainLevel } from '@rune/contracts';
import { currentRules } from '@rune/domain';
import type { Transaction } from 'kysely';
import { z } from 'zod';
import { userTraits } from '../auth/me';
import { writeStamp } from '../db/rev';
import type { Database } from '../db/schema';
import type { BatchCtx, EntitySyncHooks, HookCtx, SyncHooksMap } from '../sync/hooks';
import { OpRejection } from '../sync/push';
import { replayInstanceInDb } from './replay-service';

/*
 * Contrôles du serveur au push des séances (spec brique 3 §5.3), en plus des règles génériques de la synchro, et
 * rejeu des instances touchées par le lot (§4.4, R-SYN-19). `fields` : colonnes snake_case déjà filtrées (liste
 * blanche, colonnes C2 à null sans consentement santé) ; un hook les corrige en place ou rejette l'op.
 */

type Trx = Transaction<Database>;
type Fields = Record<string, unknown>;

const MINUTE_MS = 60_000;
/** Avance tolérée de l'horloge d'un téléphone sur celle du serveur (ruling R24). */
const CLOCK_SKEW_MS = 10 * MINUTE_MS;

const IsoDateTime = z.iso.datetime();

/** Instant d'une colonne de date : absent → undefined, null → null, sinon ms Unix ; pas un instant ISO → rejet. */
function instantOf(fields: Fields, column: string): number | null | undefined {
  if (!Object.hasOwn(fields, column)) return undefined;
  const value = fields[column];
  if (value === null) return null;
  if (typeof value !== 'string' || !IsoDateTime.safeParse(value).success) {
    throw new OpRejection('validation', column);
  }
  return Date.parse(value);
}

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Bornage des dates d'une séance (rulings R24 et R24 bis). À la création, un début à plus de 10 min dans le futur du
 * serveur est ramené à maintenant, et la fin décalée d'autant (la durée est gardée). Toute fin écrite qui reste à plus
 * de 10 min dans le futur est ramenée à maintenant, jamais avant le début : elle date une suspension pour douleur
 * (spec §4.4.4). Les instants gardés sont réécrits au format du serveur. `storedStart` : début de la ligne existante
 * (patch) ; absent, le début est lu dans `fields` (création, restore_upsert).
 */
function boundInstants(fields: Fields, now: number, storedStart?: number): void {
  const started = storedStart === undefined ? instantOf(fields, 'started_at') : undefined;
  const ended = instantOf(fields, 'ended_at');
  const shift = typeof started === 'number' && started > now + CLOCK_SKEW_MS ? started - now : 0;
  if (typeof started === 'number') fields.started_at = iso(started - shift);
  const start = typeof started === 'number' ? started - shift : storedStart;
  if (typeof ended === 'number') {
    const end = ended - shift;
    fields.ended_at = iso(end > now + CLOCK_SKEW_MS ? Math.max(now, start ?? now) : end);
  }
}

/**
 * Instance ou lieu cité par une séance (D17) : un identifiant inconnu est admis (restauration, spec §5.1), une ligne
 * supprimée aussi ; une ligne d'un autre membre est refusée.
 */
async function assertOwnReference(
  trx: Trx,
  table: 'programInstance' | 'place',
  id: unknown,
  userId: string,
): Promise<void> {
  if (id === null || id === undefined) return;
  if (typeof id !== 'string') throw new OpRejection('validation', table);
  const row = await trx.selectFrom(table).select('ownerId').where('id', '=', id).executeTakeFirst();
  if (row && row.ownerId !== userId) throw new OpRejection('forbidden_reference', table);
}

const workoutSession: Omit<EntitySyncHooks, 'afterBatch'> = {
  // Écrits à la création seulement (D3, R24, ruling R30) : ignorés d'un patch, qui s'applique pour le reste.
  immutableColumns: ['instance_id', 'started_at', 'profile'],

  async beforeApply({ trx, deps, userId, op }: HookCtx, fields: Fields) {
    if (op.kind === 'delete') return;
    const now = deps.clock.now().getTime();
    let storedStart: number | undefined;
    if (op.kind === 'patch') {
      const existing = await trx
        .selectFrom('workoutSession')
        .select(['status', 'startedAt', 'deletedAt'])
        .where('id', '=', op.id)
        .executeTakeFirst();
      // Ligne absente ou supprimée : la synchro générique rejette ou applique sans effet.
      if (!existing || existing.deletedAt !== null) return;
      // Jamais de retour à `in_progress` ; une séance terminée n'est jamais abandonnée après coup (ruling R33). Une
      // séance abandonnée peut encore être terminée : l'appareil qui la tenait la finit après sa clôture (D12).
      const back = fields.status === 'in_progress' && existing.status !== 'in_progress';
      const dropped = fields.status === 'abandoned' && existing.status === 'completed';
      if (back || dropped) throw new OpRejection('invalid_transition', 'status');
      storedStart = Date.parse(existing.startedAt);
    }
    await assertOwnReference(trx, 'programInstance', fields.instance_id, userId);
    await assertOwnReference(trx, 'place', fields.place_id, userId);
    boundInstants(fields, now, storedStart);
    // Profil durci (D3) : passé à `cautious` si le serveur calcule un profil prudent, jamais baissé.
    if (op.kind !== 'patch' && (await userTraits(trx, deps, userId)).cautious) fields.profile = 'cautious';
  },

  /** Séance supprimée (delete, ou restore_upsert qui porte une suppression) : ses enfants aussi (R-SYN-6). */
  async afterApply({ trx, deps, userId, op }: HookCtx) {
    const deleting = op.kind === 'delete' || (op.kind === 'restore_upsert' && op.fields.deletedAt != null);
    if (!deleting) return;
    const session = await trx
      .selectFrom('workoutSession')
      .select('deletedAt')
      .where('id', '=', op.id)
      .executeTakeFirst();
    if (session?.deletedAt == null) return;
    const exercises = await trx
      .selectFrom('performedExercise')
      .select(['id', 'deletedAt'])
      .where('sessionId', '=', op.id)
      .where('ownerId', '=', userId)
      .orderBy('id')
      .execute();
    const sets =
      exercises.length === 0
        ? []
        : await trx
            .selectFrom('performedSet')
            .select('id')
            .where(
              'performedExerciseId',
              'in',
              exercises.map((e) => e.id),
            )
            .where('ownerId', '=', userId)
            .where('deletedAt', 'is', null)
            .orderBy('id')
            .execute();
    for (const e of exercises.filter((x) => x.deletedAt === null)) {
      const stamp = await writeStamp(trx, deps, userId);
      await trx
        .updateTable('performedExercise')
        .set({ deletedAt: stamp.updatedAt, ...stamp })
        .where('id', '=', e.id)
        .execute();
    }
    for (const s of sets) {
      const stamp = await writeStamp(trx, deps, userId);
      await trx
        .updateTable('performedSet')
        .set({ deletedAt: stamp.updatedAt, ...stamp })
        .where('id', '=', s.id)
        .execute();
    }
  },
};

/** Ajustement neutre qu'impose une douleur stockée (05 §13.6) : gêne → hold, douleur → lighten. */
const PAIN_ADJUSTMENT: Partial<Record<PainLevel, 'hold' | 'lighten'>> = {
  discomfort: 'hold',
  pain: 'lighten',
};

const performedExercise: Omit<EntitySyncHooks, 'afterBatch'> = {
  // La séance d'un exercice est fixée à sa création (ruling R30).
  immutableColumns: ['session_id'],

  async beforeApply({ trx, op }: HookCtx, fields: Fields) {
    if (op.kind === 'delete') return;
    let existing: { painLevel: PainLevel | null; nextAdjustment: string | null } | undefined;
    if (op.kind === 'patch') {
      const row = await trx
        .selectFrom('performedExercise')
        .select(['painLevel', 'nextAdjustment', 'deletedAt'])
        .where('id', '=', op.id)
        .executeTakeFirst();
      if (!row || row.deletedAt !== null) return;
      existing = row;
    }
    // Fiche servie aux téléphones (spec §5.3, même règle que `servedSheets`) : publiée, ou retirée après avoir été
    // publiée ; un brouillon, même retiré, n'a jamais quitté le serveur.
    if (Object.hasOwn(fields, 'exercise_id')) {
      const id = fields.exercise_id;
      const sheet =
        typeof id === 'string'
          ? await trx
              .selectFrom('exercise')
              .select('id')
              .where('id', '=', id)
              .where((eb) =>
                eb.or([
                  eb('status', '=', 'published'),
                  eb.and([eb('status', '=', 'retired'), eb('publishedAt', 'is not', null)]),
                ]),
              )
              .executeTakeFirst()
          : undefined;
      if (!sheet) throw new OpRejection('unknown_exercise', 'exercise_id');
    }
    // Douleur stockée ⇒ ajustement (ruling R15), lu après le filtre C2 : sans consentement, rien n'est déduit.
    const pain = Object.hasOwn(fields, 'pain_level') ? fields.pain_level : (existing?.painLevel ?? null);
    const adjustment = Object.hasOwn(fields, 'next_adjustment')
      ? fields.next_adjustment
      : (existing?.nextAdjustment ?? null);
    const imposed = typeof pain === 'string' ? PAIN_ADJUSTMENT[pain as PainLevel] : undefined;
    if (adjustment == null && imposed !== undefined) fields.next_adjustment = imposed;
  },
};

const SET_BOUNDS = Object.entries({
  load_g: currentRules().setBounds.loadG,
  reps: currentRules().setBounds.reps,
  duration_s: currentRules().setBounds.durationS,
  position: currentRules().setBounds.position,
});

const performedSet: Omit<EntitySyncHooks, 'afterBatch'> = {
  // L'exercice d'une série est fixé à sa création (ruling R30).
  immutableColumns: ['performed_exercise_id'],

  /**
   * Bornes d'une série (spec §5.3) ; une valeur qui n'est pas un nombre est laissée aux contraintes SQL. `logged_at`
   * doit être un instant ISO, comme les dates d'une séance (sinon l'export CSV échouerait sur cette ligne).
   */
  async beforeApply({ op }: HookCtx, fields: Fields) {
    if (op.kind === 'delete') return;
    for (const [column, [min, max]] of SET_BOUNDS) {
      const value = fields[column];
      if (typeof value === 'number' && (value < min || value > max))
        throw new OpRejection('out_of_range', column);
    }
    instantOf(fields, 'logged_at');
  },

  /**
   * Série faite d'une séance vivante (ruling R49) : un `delete` du client est ignoré, la ligne prend un rev neuf et
   * revient à l'appareil qui l'a supprimée. Seul un miroir en retard sur un autre appareil en envoie un (« Terminer »
   * d'un appareil qui croit encore tenir la séance, changement d'exercice ou de lieu sur une série faite ailleurs) :
   * le téléphone ne supprime une série qu'il voit faite qu'avec sa séance (« Supprimer la séance »), et la
   * suppression de la séance, qui suit dans l'outbox, emporte alors toutes ses séries (`afterApply` de la séance).
   */
  async keepOnDelete({ trx, userId, op }: HookCtx) {
    const done = await trx
      .selectFrom('performedSet as t')
      .innerJoin('performedExercise as e', 'e.id', 't.performedExerciseId')
      .innerJoin('workoutSession as s', 's.id', 'e.sessionId')
      .select('t.id')
      .where('t.id', '=', op.id)
      .where('t.ownerId', '=', userId)
      .where('t.loggedAt', 'is not', null)
      .where('s.deletedAt', 'is', null)
      .executeTakeFirst();
    return done !== undefined;
  },
};

/** Séances des exercices et des séries écrits par le lot, lignes supprimées comprises. */
async function sessionsOf(
  trx: Trx,
  userId: string,
  exerciseIds: readonly string[],
  setIds: readonly string[],
): Promise<string[]> {
  const out: string[] = [];
  if (exerciseIds.length > 0) {
    const rows = await trx
      .selectFrom('performedExercise')
      .select('sessionId')
      .where('id', 'in', exerciseIds)
      .where('ownerId', '=', userId)
      .execute();
    out.push(...rows.map((r) => r.sessionId));
  }
  if (setIds.length > 0) {
    const rows = await trx
      .selectFrom('performedSet as t')
      .innerJoin('performedExercise as e', 'e.id', 't.performedExerciseId')
      .select('e.sessionId')
      .where('t.id', 'in', setIds)
      .where('t.ownerId', '=', userId)
      .execute();
    out.push(...rows.map((r) => r.sessionId));
  }
  return out;
}

/**
 * D4 tenue par le serveur (ruling R51) : une séance touchée, vivante et `abandoned` qui a au moins une série de travail
 * faite vivante (sous un exercice vivant) passe `completed`, avec un rev neuf ; sa fin devient la dernière série faite
 * si elle est plus tardive (une série datée à plus de 10 min dans le futur compte pour maintenant, ruling R24 bis). Une
 * clôture décidée sur un miroir en retard (« La terminer », séance oubliée, ruling R33) ignore les séries d'un autre
 * appareil : elles terminent la séance en arrivant.
 */
async function completeAbandoned(
  trx: Trx,
  deps: BatchCtx['deps'],
  userId: string,
  touched: readonly string[],
): Promise<void> {
  const rows = await trx
    .selectFrom('workoutSession as s')
    .innerJoin('performedExercise as e', 'e.sessionId', 's.id')
    .innerJoin('performedSet as t', 't.performedExerciseId', 'e.id')
    .select(['s.id', 's.endedAt', 't.loggedAt'])
    .where('s.id', 'in', touched)
    .where('s.ownerId', '=', userId)
    .where('s.status', '=', 'abandoned')
    .where('s.deletedAt', 'is', null)
    .where('e.deletedAt', 'is', null)
    .where('t.deletedAt', 'is', null)
    .where('t.kind', '=', 'work')
    .where('t.loggedAt', 'is not', null)
    .orderBy('s.id')
    .execute();
  const now = deps.clock.now().getTime();
  const ends = new Map<string, number[]>();
  for (const r of rows) {
    const list = ends.get(r.id) ?? (r.endedAt === null ? [] : [Date.parse(r.endedAt)]);
    const logged = Date.parse(r.loggedAt ?? '');
    list.push(logged > now + CLOCK_SKEW_MS ? now : logged);
    ends.set(r.id, list);
  }
  for (const [id, list] of ends) {
    const known = list.filter(Number.isFinite);
    const stamp = await writeStamp(trx, deps, userId);
    await trx
      .updateTable('workoutSession')
      .set({
        status: 'completed',
        ...(known.length > 0 ? { endedAt: iso(Math.max(...known)) } : {}),
        ...stamp,
      })
      .where('id', '=', id)
      .execute();
  }
}

/**
 * Rejeu des instances touchées par le lot (spec §5.3), une fois chacune, dans l'ordre de leur identifiant : celles des
 * séances écrites, ou dont un exercice ou une série l'a été (lignes supprimées comprises). Une séance en cours et
 * vivante n'est jamais évaluée : une instance que le lot ne touche que par de telles séances n'est pas rejouée (le
 * téléphone pousse 2 s après chaque série). Les rattachements étant immuables (ruling R30), aucune séance ne quitte
 * son instance : c'est la seule à rejouer. D4 est appliquée d'abord (`completeAbandoned`).
 */
async function replayTouched({ trx, deps, userId, applied }: BatchCtx): Promise<void> {
  const idsOf = (entity: string) => applied.filter((a) => a.entity === entity).map((a) => a.id);
  const touched = new Set([
    ...idsOf('workout_session'),
    ...(await sessionsOf(trx, userId, idsOf('performed_exercise'), idsOf('performed_set'))),
  ]);
  if (touched.size === 0) return;
  await completeAbandoned(trx, deps, userId, [...touched]);
  const sessions = await trx
    .selectFrom('workoutSession')
    .select(['instanceId', 'status', 'deletedAt'])
    .where('id', 'in', [...touched])
    .where('ownerId', '=', userId)
    .execute();
  const instances = new Set<string>();
  for (const s of sessions) {
    const running = s.status === 'in_progress' && s.deletedAt === null;
    if (s.instanceId !== null && !running) instances.add(s.instanceId);
  }
  for (const instanceId of [...instances].sort()) {
    await replayInstanceInDb(trx, { ownerId: userId, instanceId, touchedSessionIds: touched }, deps);
  }
}

/** Hooks des tables J des séances ; un seul `afterBatch` partagé, donc un rejeu par instance et par lot. */
export const PROGRAM_SYNC_HOOKS: SyncHooksMap = {
  workout_session: { ...workoutSession, afterBatch: replayTouched },
  performed_exercise: { ...performedExercise, afterBatch: replayTouched },
  performed_set: { ...performedSet, afterBatch: replayTouched },
};
