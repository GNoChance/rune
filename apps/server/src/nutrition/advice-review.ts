import {
  type AdviceSheetFile,
  AdviceSheetFileSchema,
  type AdviceStatus,
  type NutritionMode,
  type ServedAdviceSheet,
} from '@rune/contracts';
import { validateAdviceSheet } from '@rune/domain';
import type { Selectable } from 'kysely';
import type { SessionUser } from '../app-env';
import type { AdviceSheetTable, DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';

/*
 * Relecture des fiches conseils par l'admin (spec brique 5 §10.2, 07 §5.8). Cycle : `draft` → `reviewed` →
 * `published` → `retired`. Les contrôles de `validateAdviceSheet` s'appliquent à `reviewed` et à `published` (422
 * `transition_blocked` avec `issues`). Modifier le texte d'une fiche la remet à `draft` (nouvelle relecture), avec
 * `version` + 1. À appeler dans une transaction.
 */

type AdviceRow = Selectable<AdviceSheetTable>;

export type AdviceAction = 'review' | 'publish' | 'retire';

/** Statut d'origine exigé et statut d'arrivée de chaque action. */
const TRANSITIONS: Record<AdviceAction, { from: AdviceStatus; to: AdviceStatus }> = {
  review: { from: 'draft', to: 'reviewed' },
  publish: { from: 'reviewed', to: 'published' },
  retire: { from: 'published', to: 'retired' },
};

export type AdviceSummary = {
  id: string;
  title: string;
  status: AdviceStatus;
  version: number;
  audience: string;
};
export type AdviceDetail = AdviceSummary & {
  body_md: string;
  visible_modes: string[];
  tags: string[];
  sources: AdviceSheetFile['sources'];
  draft_origin: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  published_at: string | null;
  retired_at: string | null;
  updated_at: string;
};

const summaryOf = (r: AdviceRow): AdviceSummary => ({
  id: r.id,
  title: r.title,
  status: r.status,
  version: r.version,
  audience: r.audience,
});

const detailOf = (r: AdviceRow): AdviceDetail => ({
  ...summaryOf(r),
  body_md: r.bodyMd,
  visible_modes: JSON.parse(r.visibleModes) as string[],
  tags: JSON.parse(r.tags) as string[],
  sources: JSON.parse(r.sources) as AdviceSheetFile['sources'],
  draft_origin: r.draftOrigin,
  reviewed_by: r.reviewedBy,
  reviewed_at: r.reviewedAt,
  published_at: r.publishedAt,
  retired_at: r.retiredAt,
  updated_at: r.updatedAt,
});

/** La fiche dans la forme du fichier, pour `validateAdviceSheet`. */
function fileOf(r: AdviceRow): AdviceSheetFile {
  return AdviceSheetFileSchema.parse({
    id: r.id,
    title: r.title,
    body_md: r.bodyMd,
    audience: r.audience,
    visible_modes: JSON.parse(r.visibleModes),
    tags: JSON.parse(r.tags),
    sources: JSON.parse(r.sources),
    draft_origin: r.draftOrigin,
  });
}

async function rowOf(trx: DbExecutor, id: string): Promise<AdviceRow> {
  const row = await trx.selectFrom('adviceSheet').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw httpError('not_found');
  return row;
}

export async function listAdvice(db: DbExecutor): Promise<AdviceSummary[]> {
  const rows = await db.selectFrom('adviceSheet').selectAll().orderBy('id').execute();
  return rows.map(summaryOf);
}

export async function getAdvice(db: DbExecutor, id: string): Promise<AdviceDetail> {
  return detailOf(await rowOf(db, id));
}

/** Modification du texte (titre et corps) ; la fiche repasse en `draft`. */
export async function editAdviceText(
  trx: DbExecutor,
  deps: AppDeps,
  id: string,
  text: { title: string; body_md: string },
): Promise<AdviceDetail> {
  const row = await rowOf(trx, id);
  await trx
    .updateTable('adviceSheet')
    .set({
      title: text.title,
      bodyMd: text.body_md,
      status: 'draft',
      version: row.version + 1,
      reviewedBy: null,
      reviewedAt: null,
      publishedAt: null,
      retiredAt: null,
      updatedAt: deps.clock.now().toISOString(),
    })
    .where('id', '=', id)
    .execute();
  return getAdvice(trx, id);
}

export async function transitionAdvice(
  trx: DbExecutor,
  deps: AppDeps,
  admin: SessionUser,
  id: string,
  action: AdviceAction,
): Promise<AdviceDetail> {
  const row = await rowOf(trx, id);
  const { from, to } = TRANSITIONS[action];
  if (row.status !== from) throw httpError('conflict');
  const now = deps.clock.now().toISOString();
  if (action !== 'retire') {
    const verdict = validateAdviceSheet(fileOf(row), action === 'review' ? 'reviewed' : 'published');
    if (!verdict.ok) throw httpError('transition_blocked', { issues: verdict.issues });
  }
  await trx
    .updateTable('adviceSheet')
    .set({
      status: to,
      updatedAt: now,
      ...(action === 'review' ? { reviewedBy: admin.id, reviewedAt: now } : {}),
      ...(action === 'publish' ? { publishedAt: now } : {}),
      ...(action === 'retire' ? { retiredAt: now } : {}),
    })
    .where('id', '=', id)
    .execute();
  return getAdvice(trx, id);
}

/**
 * Fiches servies à une personne : celles qui visent son public (`adults`/`minors`/`all`) et son mode effectif ;
 * aucune en mode `disabled`. Filtre de `GET /api/nutrition/sheets`, partagé avec le dossier du coach.
 */
export function servedFor(
  published: { served: ServedAdviceSheet }[],
  age: number,
  mode: NutritionMode,
): ServedAdviceSheet[] {
  if (mode === 'disabled') return [];
  const audience = age < 18 ? 'minors' : 'adults';
  return published
    .map(({ served }) => served)
    .filter((s) => (s.audience === 'all' || s.audience === audience) && s.visible_modes.includes(mode));
}

/** Fiches publiées, au format servi, avec leur ligne. */
export async function publishedSheets(
  db: DbExecutor,
): Promise<{ row: AdviceRow; served: ServedAdviceSheet }[]> {
  const rows = await db
    .selectFrom('adviceSheet')
    .selectAll()
    .where('status', '=', 'published')
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    row,
    served: {
      id: row.id,
      title: row.title,
      body_md: row.bodyMd,
      audience: row.audience,
      visible_modes: JSON.parse(row.visibleModes) as ('full' | 'qualitative')[],
      tags: JSON.parse(row.tags) as string[],
      sources: JSON.parse(row.sources) as ServedAdviceSheet['sources'],
      version: row.version,
      reviewed_at: row.reviewedAt,
    },
  }));
}
