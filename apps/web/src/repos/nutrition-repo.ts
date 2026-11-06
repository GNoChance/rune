import {
  ACTIVITY_LEVELS,
  type ActivityLevel,
  CHECKIN_DECISIONS,
  CHECKIN_POSITIONS,
  type CheckinDecision,
  type CheckinPosition,
  type CheckinResponse,
  NUTRITION_GOALS,
  type NutritionGoal,
  type NutritionMode,
  type NutritionState,
  NutritionStateSchema,
  NutritionTargetsSchema,
  PROTOCOL_HEADER,
  type ScreenRequest,
  SEX_FOR_CALC,
  type ServedAdviceSheet,
  ServedAdviceSheetSchema,
  type SettingsChanges,
  type SexForCalc,
  SYNC_PROTOCOL,
  SYNC_TIMEOUT_MS,
  TARGET_REASONS,
  type TargetReason,
} from '@rune/contracts';
import { useMemo } from 'react';
import { z } from 'zod';
import { ApiError } from '../api/client';
import { type AppServices, useLive, useServices } from '../app-services';
import { deleteMeta, getMeta, setMeta } from '../local-db/meta';
import {
  clearIntent,
  intentSettledBy,
  localNutritionMode,
  type NutritionIntent,
  recordDescent,
} from '../local-db/nutrition';
import { fetchJsonWithTimeout, OfflineError } from '../sync/transport';
import { currentUserId, isLive, oneOf, sendThenPull } from './rows';

/*
 * Nutrition (spec brique 5 §6.4, §6.4 bis, §7, §15) : les écritures sont en ligne (classe E : `NetworkRequiredError`
 * hors ligne), sauf la descente de mode (`setMode`), qui agit tout de suite sur l'appareil et part au retour du
 * réseau. Les pesées, elles, sont dans `weigh-in-repo`. Hors du mode complet, aucune valeur chiffrée n'est lue.
 */

const NUTRITION_FLUSH_MS = 4000;

/** Cible en vigueur, copie locale du plus récent `nutrition_target`. */
export interface NutritionTargetView {
  validFrom: string;
  reason: TargetReason | null;
  effectiveGoal: NutritionGoal | null;
  kcalTarget: number;
  kcalMin: number;
  kcalMax: number;
  proteinGMin: number;
  proteinGMax: number;
  fatGMin: number;
  carbsG: number;
  fiberG: number;
  waterMl: number;
}

export interface NutritionCheckinView {
  weekStart: string;
  weighInCount: number;
  meanWeightG: number | null;
  changePct: number | null;
  representative: boolean;
  decision: CheckinDecision | null;
  position: CheckinPosition | null;
  proposedDeltaKcal: number | null;
  response: 'accepted' | 'declined' | null;
}

export interface NutritionSettingsView {
  sexForCalc: SexForCalc | null;
  heightCm: number | null;
  activityLevel: ActivityLevel | null;
  goal: NutritionGoal | null;
}

/** Ce que l'appareil sait de la nutrition, sans réseau. Hors du mode `full`, ni réglages, ni cible, ni bilans. */
export interface NutritionView {
  /** Le plus strict entre l'intention de descente en attente et le dernier mode lu. */
  mode: NutritionMode;
  /** Une descente attend son envoi. */
  descentPending: boolean;
  settings: NutritionSettingsView | null;
  target: NutritionTargetView | null;
  /** Du plus récent au plus ancien. */
  checkins: NutritionCheckinView[];
}

export interface NutritionRepo {
  /** `flushBefore` (les pesées récentes partent d'abord), puis `POST /api/nutrition/open`. */
  open(): Promise<NutritionState>;
  /** Écran de sécurité (`POST /screen`) ; l'intention de descente en attente part avant. La pesée de mise en place n'est pas écrite ici : le pull la rapporte. */
  screen(req: ScreenRequest): Promise<NutritionState>;
  /**
   * Descente de mode, hors ligne comprise (D11) : effet local tout de suite (copies purgées), intention gardée
   * jusqu'à son envoi (la plus restrictive l'emporte), un cycle de synchro demandé.
   */
  setMode(mode: NutritionIntent['mode']): Promise<void>;
  /** Cible qui résulterait des changements, sans écriture. */
  preview(changes: SettingsChanges): Promise<z.infer<typeof NutritionTargetsSchema>>;
  saveSettings(changes: SettingsChanges): Promise<NutritionState>;
  respond(weekStart: string, response: CheckinResponse['response']): Promise<NutritionState>;
  markNonRepresentative(weekStart: string): Promise<NutritionState>;
  deleteData(): Promise<NutritionState>;
  /** Fiches visibles dans le mode de l'appareil : réseau (ETag) quand il y en a, sinon la dernière copie. */
  sheets(): Promise<ServedAdviceSheet[]>;
  view(): Promise<NutritionView>;
}

const PreviewResponse = z.object({ target: NutritionTargetsSchema });
const ServedSheets = z.array(ServedAdviceSheetSchema);

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export function createNutritionRepo(s: AppServices): NutritionRepo {
  const { db } = s;
  const nowIso = () => new Date(s.now()).toISOString();
  const send = <T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, schema: z.ZodType<T>) =>
    sendThenPull(s, method, path, { body, schema });

  /** Envoie l'intention en attente (une montée exige le réseau : elle part avant l'appel). */
  async function flushIntent(): Promise<void> {
    const intent = await getMeta(db, 'nutritionPendingMode');
    if (!intent) return;
    try {
      await s.api.send('PUT', '/api/nutrition/mode', { mode: intent.mode });
    } catch (error) {
      if (!(error instanceof ApiError && intentSettledBy(error.status, error.code))) throw error;
    }
    await clearIntent(db, intent);
  }

  async function sheets(): Promise<ServedAdviceSheet[]> {
    const cached = async () => ServedSheets.safeParse(await db.table('nutritionSheets').toArray());
    const visible = async (list: ServedAdviceSheet[]) => {
      const mode = await localNutritionMode(db);
      return mode === 'full' || mode === 'qualitative'
        ? list.filter((sheet) => sheet.visible_modes.includes(mode))
        : [];
    };
    const etag = await getMeta(db, 'nutritionSheetsEtag');
    let reply: Awaited<ReturnType<typeof fetchJsonWithTimeout>>;
    try {
      reply = await fetchJsonWithTimeout(
        s.transport,
        '/api/nutrition/sheets',
        {
          method: 'GET',
          credentials: 'same-origin',
          headers: { [PROTOCOL_HEADER]: String(SYNC_PROTOCOL), ...(etag ? { 'If-None-Match': etag } : {}) },
        },
        SYNC_TIMEOUT_MS,
      );
    } catch (error) {
      if (!(error instanceof OfflineError)) throw error;
      s.sync.reportOffline();
      const copy = await cached();
      return copy.success ? visible(copy.data) : [];
    }
    s.sync.reportReachable();
    const parsed = reply.res.status === 200 ? ServedSheets.safeParse(reply.body) : null;
    if (parsed?.success) {
      const list = parsed.data;
      await db.transaction('rw', db.table('nutritionSheets'), db.meta, async () => {
        await db.table('nutritionSheets').clear();
        await db.table('nutritionSheets').bulkPut(list);
        const next = reply.res.headers.get('ETag');
        if (next) await setMeta(db, 'nutritionSheetsEtag', next);
        else await deleteMeta(db, 'nutritionSheetsEtag');
      });
      return visible(list);
    }
    // 304, ou réponse inutilisable : la dernière copie.
    const copy = await cached();
    return copy.success ? visible(copy.data) : [];
  }

  async function view(): Promise<NutritionView> {
    const mode = await localNutritionMode(db);
    const descentPending = (await getMeta(db, 'nutritionPendingMode')) !== undefined;
    const empty: NutritionView = { mode, descentPending, settings: null, target: null, checkins: [] };
    const userId = await currentUserId(db);
    if (mode !== 'full' || userId === null) return empty;
    const owned = (r: { deletedAt?: unknown; ownerId?: unknown }) =>
      r.deletedAt == null && r.ownerId === userId;
    const profile = await db.mirror('nutrition_profile').get(userId);
    const targets = (await db.mirror('nutrition_target').filter(owned).toArray()).sort((a, b) =>
      String(b.validFrom).localeCompare(String(a.validFrom)),
    );
    const checkins = (await db.mirror('nutrition_checkin').filter(owned).toArray()).sort((a, b) =>
      String(b.weekStart).localeCompare(String(a.weekStart)),
    );
    const t = targets[0];
    return {
      ...empty,
      settings:
        profile && isLive(profile)
          ? {
              sexForCalc: oneOf(SEX_FOR_CALC, profile.sexForCalc),
              heightCm: numOrNull(profile.heightCm),
              activityLevel: oneOf(ACTIVITY_LEVELS, profile.activityLevel),
              goal: oneOf(NUTRITION_GOALS, profile.goal),
            }
          : null,
      target: t
        ? {
            validFrom: String(t.validFrom),
            reason: oneOf(TARGET_REASONS, t.reason),
            effectiveGoal: oneOf(NUTRITION_GOALS, t.effectiveGoal),
            kcalTarget: num(t.kcalTarget),
            kcalMin: num(t.kcalMin),
            kcalMax: num(t.kcalMax),
            proteinGMin: num(t.proteinGMin),
            proteinGMax: num(t.proteinGMax),
            fatGMin: num(t.fatGMin),
            carbsG: num(t.carbsG),
            fiberG: num(t.fiberG),
            waterMl: num(t.waterMl),
          }
        : null,
      checkins: checkins.map((c) => ({
        weekStart: String(c.weekStart),
        weighInCount: num(c.weighInCount),
        meanWeightG: numOrNull(c.meanWeightG),
        changePct: numOrNull(c.changePct),
        representative: c.representative === true,
        decision: oneOf(CHECKIN_DECISIONS, c.decision),
        position: oneOf(CHECKIN_POSITIONS, c.position),
        proposedDeltaKcal: numOrNull(c.proposedDeltaKcal),
        response: c.response === 'accepted' || c.response === 'declined' ? c.response : null,
      })),
    };
  }

  return {
    async open() {
      await s.sync.flushBefore(NUTRITION_FLUSH_MS).catch(() => {});
      const state = await s.api.send('POST', '/api/nutrition/open', undefined, NutritionStateSchema);
      // Le serveur dit autre chose que ce que l'appareil a lu : un pull aligne les copies.
      if (state.effective_mode !== (await getMeta(db, 'nutritionEffectiveMode'))) {
        await s.sync.pullNow().catch(() => {});
      }
      return state;
    },
    async screen(req) {
      await flushIntent();
      return send('POST', '/api/nutrition/screen', req, NutritionStateSchema);
    },
    async setMode(mode) {
      await recordDescent(db, mode, nowIso());
      void s.sync.syncNow('manual').catch(() => {});
    },
    async preview(changes) {
      return (await s.api.send('POST', '/api/nutrition/settings/preview', { changes }, PreviewResponse))
        .target;
    },
    saveSettings: (changes) => send('PUT', '/api/nutrition/settings', changes, NutritionStateSchema),
    respond: (weekStart, response) =>
      send(
        'POST',
        `/api/nutrition/checkins/${encodeURIComponent(weekStart)}/respond`,
        { response },
        NutritionStateSchema,
      ),
    markNonRepresentative: (weekStart) =>
      send(
        'POST',
        `/api/nutrition/checkins/${encodeURIComponent(weekStart)}/non-representative`,
        undefined,
        NutritionStateSchema,
      ),
    deleteData: () => send('DELETE', '/api/nutrition/data', undefined, NutritionStateSchema),
    sheets,
    view,
  };
}

const cache = new WeakMap<AppServices, NutritionRepo>();

/** Le même dépôt pour les écrans et les hooks d'un même `AppServices`. */
export function nutritionRepoFor(s: AppServices): NutritionRepo {
  let repo = cache.get(s);
  if (!repo) {
    repo = createNutritionRepo(s);
    cache.set(s, repo);
  }
  return repo;
}

/** Vue locale de la nutrition, observée ; `undefined` tant que la base n'a pas répondu. */
export function useNutritionView(): NutritionView | undefined {
  const services = useServices();
  const repo = useMemo(() => nutritionRepoFor(services), [services]);
  return useLive(() => repo.view(), [repo]);
}
