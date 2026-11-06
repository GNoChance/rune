import { parisDate } from '@rune/domain';
import { useMemo } from 'react';
import { type AppServices, useLive, useServices } from '../app-services';
import { healthConsentCached } from '../local-db/consent';
import { localNutritionMode } from '../local-db/nutrition';
import { type LocalChange, writeLocal } from '../sync/outbox';
import { currentUserId, isLive, ownedRows } from './rows';

/*
 * Pesées (spec brique 5 §6.3, §12.3, §15) : table J écrite hors ligne par `writeLocal` (outbox). Une seule pesée
 * vivante par date sur l'appareil, comme sur le serveur (R-SYN-5) : enregistrer une date déjà prise supprime
 * logiquement l'ancienne et crée une pesée neuve. La date ne se corrige pas (le serveur refuse un patch de `date`) :
 * supprimer, puis recréer.
 */

const ENTITY = 'weigh_in';
const MIN_WEIGHT_G = 30_000;
const MAX_WEIGHT_G = 250_000;
const WEIGHT_STEP_G = 100;

export type WeighInErrorCode =
  | 'not_signed_in'
  | 'not_found'
  /** Hors du mode complet, aucune pesée ne s'écrit sur l'appareil. */
  | 'mode'
  /** Poids hors de 30 à 250 kg, ou pas au pas de 100 g. */
  | 'weight'
  /** Date impossible ou dans le futur (Paris). */
  | 'date';

export class WeighInError extends Error {
  readonly code: WeighInErrorCode;

  constructor(code: WeighInErrorCode) {
    super(`weigh_in_${code}`);
    this.name = 'WeighInError';
    this.code = code;
  }
}

export interface WeighInView {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  weightG: number;
}

export interface WeighInsRepo {
  /**
   * Pesée du jour `date` : l'éventuelle pesée vivante de cette date est supprimée et une neuve (identifiant neuf)
   * est créée, en une transaction ; rend son identifiant. Refuse un accord santé absent (`HealthConsentRequiredError`).
   */
  save(input: { date: string; weightG: number }): Promise<string>;
  /** Corrige le poids seul (`not_found` pour une pesée absente ou supprimée). */
  correct(id: string, weightG: number): Promise<void>;
  remove(id: string): Promise<void>;
  /** Pesées vivantes, la plus récente d'abord. */
  list(): Promise<WeighInView[]>;
}

function assertWeight(weightG: number): void {
  const ok =
    Number.isInteger(weightG) &&
    weightG >= MIN_WEIGHT_G &&
    weightG <= MAX_WEIGHT_G &&
    weightG % WEIGHT_STEP_G === 0;
  if (!ok) throw new WeighInError('weight');
}

function isCalendarDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  );
}

export function createWeighInRepo(s: AppServices): WeighInsRepo {
  const { db } = s;
  const nowIso = () => new Date(s.now()).toISOString();

  async function writer() {
    const userId = await currentUserId(db);
    if (userId === null) throw new WeighInError('not_signed_in');
    if ((await localNutritionMode(db)) !== 'full') throw new WeighInError('mode');
    const ctx = {
      userId,
      now: nowIso,
      newOpId: () => s.newOpId(),
      healthConsentActive: await healthConsentCached(db),
    };
    return {
      userId,
      put: async (change: LocalChange) => {
        await writeLocal(db, change, ctx);
      },
    };
  }

  const tx = <T>(fn: () => Promise<T>): Promise<T> => db.transaction('rw', db.outbox, db.mirror(ENTITY), fn);

  const viewOf = (row: { id: string; date?: unknown; weightG?: unknown }): WeighInView => ({
    id: row.id,
    date: String(row.date),
    weightG: Number(row.weightG),
  });

  async function owned(id: string, userId: string) {
    const row = await db.mirror(ENTITY).get(id);
    if (!row || !isLive(row) || row.ownerId !== userId) throw new WeighInError('not_found');
    return row;
  }

  return {
    async save({ date, weightG }) {
      assertWeight(weightG);
      if (!isCalendarDate(date) || date > parisDate(new Date(s.now()))) throw new WeighInError('date');
      const w = await writer();
      const id = s.newOpId();
      await tx(async () => {
        const taken = (await ownedRows(db, ENTITY, w.userId)).filter((r) => r.date === date);
        for (const row of taken) await w.put({ entity: ENTITY, id: row.id, kind: 'delete', fields: {} });
        await w.put({ entity: ENTITY, id, kind: 'create', fields: { date, weightG } });
      });
      return id;
    },
    async correct(id, weightG) {
      assertWeight(weightG);
      const w = await writer();
      await tx(async () => {
        await owned(id, w.userId);
        await w.put({ entity: ENTITY, id, kind: 'patch', fields: { weightG } });
      });
    },
    async remove(id) {
      const w = await writer();
      await tx(async () => {
        await owned(id, w.userId);
        await w.put({ entity: ENTITY, id, kind: 'delete', fields: {} });
      });
    },
    async list() {
      const rows = await ownedRows(db, ENTITY, await currentUserId(db));
      return rows.map(viewOf).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    },
  };
}

const cache = new WeakMap<AppServices, WeighInsRepo>();

/** Le même dépôt pour les écrans et les hooks d'un même `AppServices`. */
export function weighInRepoFor(s: AppServices): WeighInsRepo {
  let repo = cache.get(s);
  if (!repo) {
    repo = createWeighInRepo(s);
    cache.set(s, repo);
  }
  return repo;
}

/** Pesées vivantes, observées ; `undefined` tant que la base n'a pas répondu. */
export function useWeighIns(): WeighInView[] | undefined {
  const services = useServices();
  const repo = useMemo(() => weighInRepoFor(services), [services]);
  return useLive(() => repo.list(), [repo]);
}
