import {
  type DraftSheet,
  DraftSheetSchema,
  type ExerciseStatus,
  type IllustrationEntry,
  type PublishBlocker,
  type ReviewSheetResponse,
  type SaveSheetRequest,
  SHEET_SYSTEM_KEYS,
  type TransitionRequest,
} from '@rune/contracts';
import {
  type CatalogError,
  type CatalogErrorCode,
  canonicalJson,
  EXERCISES_DIR,
  healthGreenLight,
  isExerciseTransition,
  sheetForTransition,
  type TransitionInput,
  templateExerciseIds,
  transitionBlockers,
  validateCatalog,
} from '@rune/domain';
import type { SessionUser } from '../app-env';
import { getServedCatalog, rebuildCatalog, servedSheetOf } from '../catalog/bundle';
import { rowToEntry, rowToSheet, updateSheet } from '../catalog/repo';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { loadReviewData, type ReviewData, reviewSheet } from './review';

/*
 * Édition des fiches par l'admin (spec brique 2 §3.5 à §3.7, 04 §8 et §10) : enregistrement (`PUT`), transitions
 * et export. Une écriture se fait dans une transaction `BEGIN IMMEDIATE` (pilote SQLite), dans cet ordre :
 * 1. fiche absente : 404 ;
 * 2. `baseRevision` différente de la révision en base : 409 `revision_conflict` avec la fiche courante, avant tout
 *    autre contrôle ;
 * 3. transition hors du circuit de 04 §8 : 400 ; blocages (tableau §3.6, plus les règles d'écriture ci-dessous) :
 *    422 `transition_blocked` ;
 * 4. `UPDATE … WHERE id = ? AND revision = ?`, ligne `exercise_revision`, puis reconstruction du bloc servi
 *    (`rebuildCatalog`, en dernier) : la version ne change que si le contenu servi change (§3.7).
 * La réponse est la fiche vue par l'admin après l'écriture (`ReviewSheetResponse`).
 */

const SYSTEM_KEYS: ReadonlySet<string> = new Set(SHEET_SYSTEM_KEYS);

/**
 * Codes du validateur du catalogue (04 §13, critère 1) qu'un enregistrement ne doit pas ajouter : chacun se corrige
 * sur la fiche enregistrée seule. Les règles de chaîne (réciprocité, ramification, cycle, continuité, muscles,
 * groupe, niveau, pointeur hors chaîne) ne bloquent pas : une chaîne se modifie une fiche à la fois et passe par
 * des états intermédiaires ; `pnpm data:validate` les contrôle sur l'export. Le plafond et les modèles ont leurs
 * blocages (`catalog_full`, `referenced_by_template`).
 */
const SAVE_RULES: ReadonlySet<CatalogErrorCode> = new Set([
  'duplicate_alias',
  'load_mode_mismatch',
  'illustration_unknown',
  'illustration_sources_mixed',
]);

/** Une fiche `retired` déjà publiée reste servie (spec brique 2 §3.6) : elle doit rester complète. */
const isServed = (sheet: Pick<DraftSheet, 'status' | 'published_at'>) =>
  sheet.status === 'published' || (sheet.status === 'retired' && sheet.published_at !== undefined);

/** 422 `transition_blocked` ; `blockers` déjà dans l'ordre de `PUBLISH_BLOCKERS` (`transitionBlockers`). */
const blocked = (blockers: readonly PublishBlocker[]) => httpError('transition_blocked', { blockers });

/** Lecture avant écriture : la fiche, ce que la relecture en sait, et le contrôle de la révision de départ. */
async function readForWrite(
  trx: DbExecutor,
  id: string,
  baseRevision: number,
): Promise<{ data: ReviewData; current: DraftSheet }> {
  const data = await loadReviewData(trx, id);
  const row = data.rows[0];
  if (row === undefined) throw httpError('not_found');
  const current = rowToSheet(row);
  if (row.revision !== baseRevision) throw httpError('revision_conflict', { current });
  return { data, current };
}

/** Toutes les fiches de la base, tous statuts, triées par `id`. */
async function readCatalog(trx: DbExecutor): Promise<DraftSheet[]> {
  return (await trx.selectFrom('exercise').selectAll().orderBy('id').execute()).map(rowToSheet);
}

/**
 * Fiche validée par le schéma de son statut, ou null : `DraftSheetSchema` (fiche complète en `reviewed` et
 * `published`), et pour une fiche servie le schéma de la fiche servie (`servedSheetOf`) : une fiche retirée déjà
 * publiée doit rester complète, sans quoi `rebuildCatalog` l'écarterait du bloc sans bruit.
 */
function parseForStatus(record: Readonly<Record<string, unknown>>): DraftSheet | null {
  const parsed = DraftSheetSchema.safeParse(record);
  if (!parsed.success) return null;
  return isServed(parsed.data) && servedSheetOf(parsed.data) === null ? null : parsed.data;
}

const errorKey = (e: CatalogError) => `${e.file}\n${e.code}\n${e.message}`;

/**
 * Vrai si remplacer la fiche `next` dans `catalog` ajoute au validateur du catalogue une erreur de `SAVE_RULES`
 * (sur n'importe quelle fiche : un alias en double est signalé sur la seconde dans l'ordre des fichiers), ou si un
 * pointeur `easier_id` / `harder_id` vise une fiche absente de la base (la clé étrangère refuserait le commit).
 * Une erreur déjà présente avant l'enregistrement ne bloque pas.
 */
function breaksCatalog(
  catalog: readonly DraftSheet[],
  next: DraftSheet,
  manifest: readonly IllustrationEntry[],
): boolean {
  const known = new Set(catalog.map((s) => s.id));
  if ([next.easier_id, next.harder_id].some((target) => target !== undefined && !known.has(target)))
    return true;
  const errors = (sheets: readonly DraftSheet[]) =>
    validateCatalog({
      sheets: sheets.map((json) => ({ file: `${EXERCISES_DIR}/${json.id}.json`, json })),
      manifest,
      templates: [],
    }).errors.filter((e) => SAVE_RULES.has(e.code));
  const before = new Set(errors(catalog).map(errorKey));
  return errors(catalog.map((s) => (s.id === next.id ? next : s))).some((e) => !before.has(errorKey(e)));
}

/**
 * Écrit `next` à la place de la révision `baseRevision`, puis reconstruit le bloc servi (dernière étape de la
 * transaction) et rend la fiche vue par l'admin.
 */
async function write(
  trx: DbExecutor,
  deps: AppDeps,
  caller: SessionUser,
  next: DraftSheet,
  baseRevision: number,
): Promise<ReviewSheetResponse> {
  const saved = await updateSheet(trx, next, {
    baseRevision,
    savedAt: next.updated_at ?? deps.clock.now().toISOString(),
    savedBy: caller.id,
  });
  if (!saved) {
    // Garde de l'UPDATE : la lecture du début de transaction l'a déjà vérifié sous `BEGIN IMMEDIATE`.
    const row = await trx.selectFrom('exercise').selectAll().where('id', '=', next.id).executeTakeFirst();
    if (row === undefined) throw httpError('not_found');
    throw httpError('revision_conflict', { current: rowToSheet(row) });
  }
  await rebuildCatalog(trx, deps);
  return reviewSheet(trx, caller, next.id);
}

/** Entrée de `transitionBlockers` pour la fiche `sheet` de `data`, vers `to`. */
function transitionInput(
  deps: AppDeps,
  data: ReviewData,
  sheet: DraftSheet,
  to: ExerciseStatus,
  catalog: readonly DraftSheet[],
  boxes: Pick<TransitionRequest, 'reviewChecked' | 'minorsConfirmed'>,
): TransitionInput {
  const validations = data.validations.get(sheet.id) ?? [];
  return {
    sheet,
    to,
    comments: data.comments.get(sheet.id) ?? [],
    greenLight: healthGreenLight(sheet, data.revisions.get(sheet.id) ?? [], validations, data.users),
    reviewChecked: boxes.reviewChecked ?? false,
    minorsConfirmed: boxes.minorsConfirmed ?? false,
    manifestIds: data.manifestIds,
    // Modèles de programmes gardés par le dernier bloc construit (chargeur), chaînes développées.
    templateRefs: templateExerciseIds(
      (getServedCatalog(deps)?.programTemplates ?? []).map((served) => served.template),
      catalog,
    ),
    catalog,
  };
}

/**
 * `PUT /api/admin/exercises/:id` (spec brique 2 §3.5, 04 §8 étape 4) : la fiche reçue remplace la fiche en base,
 * champs système repris de la base (`SHEET_SYSTEM_KEYS`) ; `revision` + 1 et `updated_at` ; une fiche `reviewed`
 * ou `published` reste à son statut avec `reviewed_by` et `reviewed_at` mis à jour (04 §8 : « modification d'une
 * fiche published »). Blocage : `invalid_sheet` seul, si la fiche ne passe pas le schéma de son statut
 * (`transitionBlockers` avec `to` = statut actuel pour une fiche relue ou publiée), ou si elle ajoute une erreur
 * entre fiches (`breaksCatalog`). À appeler dans une transaction.
 */
export async function saveSheet(
  trx: DbExecutor,
  deps: AppDeps,
  caller: SessionUser,
  id: string,
  req: SaveSheetRequest,
): Promise<ReviewSheetResponse> {
  const { data, current } = await readForWrite(trx, id, req.baseRevision);
  const now = deps.clock.now().toISOString();
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req.sheet)) if (!SYSTEM_KEYS.has(key)) record[key] = value;
  for (const key of SHEET_SYSTEM_KEYS) record[key] = current[key];
  record.revision = current.revision + 1;
  record.updated_at = now;
  if (current.status === 'reviewed' || current.status === 'published') {
    record.reviewed_by = caller.id;
    record.reviewed_at = now;
  }

  const next = parseForStatus(record);
  if (next === null) throw blocked(['invalid_sheet']);
  const catalog = await readCatalog(trx);
  // Enregistrement : `to` = statut actuel ; seul `invalid_sheet` peut s'y appliquer (fiche relue ou publiée).
  const blockers = transitionBlockers(transitionInput(deps, data, next, next.status, catalog, {}));
  if (blockers.length > 0) throw blocked(blockers);
  const manifest = (await trx.selectFrom('illustration').selectAll().orderBy('id').execute()).map(rowToEntry);
  if (breaksCatalog(catalog, next, manifest)) throw blocked(['invalid_sheet']);
  return write(trx, deps, caller, next, req.baseRevision);
}

/**
 * Fiche après la transition `current.status → to` (04 §8) : contenu inchangé, `revision` + 1, `updated_at` ;
 * entrée en `reviewed` (depuis `draft` ou `retired`) : `reviewed_by` et `reviewed_at`, `retired_at` effacé à la
 * réactivation ; publication : `published_at` ; retrait : `retired_at`.
 */
function moved(
  current: DraftSheet,
  to: ExerciseStatus,
  callerId: string,
  now: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...current,
    status: to,
    revision: current.revision + 1,
    updated_at: now,
  };
  if (to === 'reviewed') {
    next.reviewed_by = callerId;
    next.reviewed_at = now;
    delete next.retired_at;
  } else if (to === 'published') {
    next.published_at = now;
  } else if (to === 'retired') {
    next.retired_at = now;
  }
  return next;
}

/**
 * `POST /api/admin/exercises/:id/transition` (04 §8, spec brique 2 §3.6) : transition du circuit seulement (sinon
 * 400 sur `to`), blocages de `transitionBlockers` dans l'ordre fixe. Garde finale, quand rien d'autre ne bloque :
 * la fiche écrite passe le schéma de son statut (une fiche servie ne sort jamais du bloc sans bruit), sinon
 * `invalid_sheet` ; elle ne joue qu'au retrait d'un brouillon incomplet déjà publié une fois (publiée, retirée,
 * réactivée, renvoyée en rédaction puis vidée). À appeler dans une transaction.
 */
export async function transitionSheet(
  trx: DbExecutor,
  deps: AppDeps,
  caller: SessionUser,
  id: string,
  req: TransitionRequest,
): Promise<ReviewSheetResponse> {
  const { data, current: stored } = await readForWrite(trx, id, req.baseRevision);
  const current = sheetForTransition(stored, req.to);
  if (!isExerciseTransition(current.status, req.to)) {
    throw httpError('validation', {
      issues: [
        { path: 'to', message: `Transition absente du circuit (04 §8) : ${current.status} → ${req.to}.` },
      ],
    });
  }
  const catalog = await readCatalog(trx);
  const blockers = transitionBlockers(transitionInput(deps, data, current, req.to, catalog, req));
  if (blockers.length > 0) throw blocked(blockers);
  const next = parseForStatus(moved(current, req.to, caller.id, deps.clock.now().toISOString()));
  if (next === null) throw blocked(['invalid_sheet']);
  return write(trx, deps, caller, next, req.baseRevision);
}

/**
 * Fichier d'export (04 §10) : toutes les fiches, tous statuts, triées par `id`, en tableau JSON dont chaque fiche
 * a la forme canonique (`canonicalJson` : clés de 04 §4, 2 espaces, LF final), sans `exported_revision`.
 */
function exportText(sheets: readonly DraftSheet[]): string {
  return `${JSON.stringify(
    sheets.map((sheet) => JSON.parse(canonicalJson(sheet))),
    null,
    2,
  )}\n`;
}

/**
 * `GET /api/admin/exercises/export` : rend le fichier d'export et met `exported_revision` = `revision` sur chaque
 * fiche (compteur « à exporter »). Le catalogue servi ne change pas. À appeler dans une transaction.
 */
export async function exportCatalog(trx: DbExecutor): Promise<string> {
  const sheets = await readCatalog(trx);
  await trx
    .updateTable('exercise')
    .set((eb) => ({ exportedRevision: eb.ref('revision') }))
    .execute();
  return exportText(sheets);
}
