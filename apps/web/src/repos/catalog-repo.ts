import {
  type EquipmentCode,
  type ExerciseLevel,
  ILLUSTRATION_ROLES,
  IllustrationEntry,
  type IllustrationRole,
  MUSCLE_GROUPS,
  type MuscleGroupCode,
  maxExerciseLevel,
  type ServedSheet,
  ServedSheetSchema,
} from '@rune/contracts';
import {
  buildChains,
  type CatalogContext,
  chainRank,
  computeCautious,
  expandEquipment,
  feasible,
  isUsable,
  normalize,
  substitutes,
  usableChainSteps,
  visibleWithoutPlace,
} from '@rune/domain';
import { useMemo } from 'react';
import { type AppServices, useLive, useServices } from '../app-services';
import { getMeta } from '../local-db/meta';
import { createConsentRepo } from './consent-repo';
import { createPlacesRepo } from './places-repo';
import { createProfileRepo } from './profile-repo';

/**
 * Lieu du filtre (le principal, sauf lieu demandé), matériel déjà passé par `expandEquipment` :
 * `feasible(sheet, place.equipment)` s'en sert tel quel.
 */
export interface CatalogPlace {
  id: string;
  name: string;
  equipment: Set<EquipmentCode>;
}

/** Ce que le membre voit du catalogue (spec brique 2 §4.1 et §4.2). */
export interface MemberCatalogContext {
  /** Null sans lieu principal (ou sans le lieu demandé) : pas de filtre Faisable, tout le matériel. */
  place: CatalogPlace | null;
  /** Profil prudent : mineur, mode prudent, ou questionnaire « prudence » avec l'accord santé actif. */
  cautious: boolean;
  /** `maxExerciseLevel` du profil d'entraînement (2 sans expérience connue) ; seuls les remplaçants le lisent. */
  maxLevel: ExerciseLevel;
}

export interface ExerciseGroupCount {
  code: MuscleGroupCode;
  label: string;
  /** Fiches visibles du groupe avec le filtre courant (une fiche compte dans le groupe de chaque muscle principal). */
  count: number;
}

export interface ExerciseView extends MemberCatalogContext {
  /** Les 9 groupes de `MUSCLE_GROUPS`, dans leur ordre. */
  groups: ExerciseGroupCount[];
}

export interface ExerciseFilter {
  /** Interrupteur « Faisable : <lieu> ». Sans lieu principal, il ne masque rien. */
  feasibleOnly: boolean;
  /**
   * Lieu du filtre (`searchExercises` seulement) : absent, le lieu principal ; donné, ce lieu-là (celui d'une séance
   * libre, spec brique 3 §7.5) ; null ou lieu inconnu (supprimé depuis), aucun : le filtre ne masque rien.
   */
  placeId?: string | null;
}

export interface ExerciseSearch {
  /** Fiches visibles dont le nom ou un alias contient chaque mot de la recherche, par nom puis `id`. */
  results: ServedSheet[];
  /** Fiches qui correspondent mais que seul le filtre Faisable masque (« N exercices masqués… · Les voir »). */
  hiddenByFeasible: number;
  /** Profil prudent et au moins une fiche publiée `not_for_minors` correspond (« Certains exercices sont masqués… »). */
  hiddenByCautious: boolean;
}

export interface SheetView {
  /** Fiche servie, publiée ou retirée (`sheet.status` : bandeau « Cet exercice n'est plus proposé. »). */
  sheet: ServedSheet;
  /**
   * Faux seulement en profil prudent pour une fiche `not_for_minors`, quels que soient son statut et le lieu : la page
   * montre alors le bandeau « Cet exercice n'est pas proposé avec tes réglages actuels. » et jamais le contenu
   * (Review Focus 2). Une fiche infaisable au lieu reste utilisable (`feasibleHere`).
   */
  usable: boolean;
  /** Faisable avec le matériel du lieu principal ; vrai sans lieu principal. */
  feasibleHere: boolean;
  /** Voisins immédiats dans la chaîne (`buildChains`), seulement s'ils sont dans `usableChainSteps`. */
  chain: { easier?: ServedSheet; harder?: ServedSheet };
  /** `substitutes` : au plus 5, utilisables au lieu principal (tout le matériel sans lieu), niveau ≤ `maxLevel`. */
  substitutes: ServedSheet[];
  /** Lieu principal (nom de « Pas faisable : <lieu> », matériel de la pastille) ; null sans lieu principal. */
  place: CatalogPlace | null;
  /** Poses de la fiche, rangées départ, milieu, fin (`sheetIllustrations`). */
  illustrations: SheetIllustration[];
}

/** Une pose d'une fiche et son entrée du manifeste (04 §12) : fichier servi, créateurs, licence. */
export interface SheetIllustration {
  illustration_id: string;
  role: IllustrationRole;
  /**
   * Entrée lue dans le magasin `illustrations` ; null si elle y manque ou est illisible (catalogue d'une version
   * précédente) : la carte dit alors « Illustration disponible après synchronisation ».
   */
  entry: IllustrationEntry | null;
}

/** Poses d'une fiche dans l'ordre départ, milieu, fin (côte à côte, 04 §12), chacune avec son entrée ou null. */
export function sheetIllustrations(
  uses: readonly { illustration_id: string; role: IllustrationRole }[],
  entries: ReadonlyMap<string, IllustrationEntry>,
): SheetIllustration[] {
  return [...uses]
    .sort((a, b) => ILLUSTRATION_ROLES.indexOf(a.role) - ILLUSTRATION_ROLES.indexOf(b.role))
    .map((use) => ({
      illustration_id: use.illustration_id,
      role: use.role,
      entry: entries.get(use.illustration_id) ?? null,
    }));
}

export interface CatalogRepo {
  /** Fiches servies valides en local (publiées et retirées), par `id` ; les fiches illisibles sont écartées. */
  sheets(): Promise<ServedSheet[]>;
  /** `placeId` : comme `ExerciseFilter.placeId` (absent : le lieu principal). */
  context(placeId?: string | null): Promise<MemberCatalogContext>;
  view(filter: ExerciseFilter): Promise<ExerciseView>;
  /** Fiches visibles d'un groupe, par niveau, nom (collation française) puis `id` ; null pour un code inconnu. */
  groupExercises(code: string, filter: ExerciseFilter): Promise<ServedSheet[] | null>;
  searchExercises(query: string, filter: ExerciseFilter): Promise<ExerciseSearch>;
  /** Null pour un id absent du catalogue local (ou catalogue absent). */
  getSheetView(id: string): Promise<SheetView | null>;
  /**
   * Entrées du manifeste en local pour ces ids d'illustration (magasin `illustrations`) ; un id absent ou une
   * entrée illisible n'est pas dans la carte rendue.
   */
  illustrationEntries(ids: readonly string[]): Promise<Map<string, IllustrationEntry>>;
}

const collator = new Intl.Collator('fr', { sensitivity: 'base' });
const compareIds = (a: ServedSheet, b: ServedSheet) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byName = (a: ServedSheet, b: ServedSheet) => collator.compare(a.name, b.name) || compareIds(a, b);
const byLevelThenName = (a: ServedSheet, b: ServedSheet) => a.level - b.level || byName(a, b);

const MUSCLES_BY_GROUP = new Map<string, readonly string[]>(
  MUSCLE_GROUPS.map((g) => [g.code, g.muscles] as const),
);

const inGroup = (sheet: ServedSheet, muscles: readonly string[]) =>
  sheet.primary_muscles.some((m) => muscles.includes(m));

/**
 * Ce qu'on voit (spec brique 2 §4.1) : interrupteur activé avec un lieu principal = `isUsable` avec son matériel ;
 * interrupteur coupé ou sans lieu = `visibleWithoutPlace` (publiée, et pas `not_for_minors` en profil prudent).
 */
function visibility(ctx: MemberCatalogContext, filter: ExerciseFilter): (sheet: ServedSheet) => boolean {
  const place = filter.feasibleOnly ? ctx.place : null;
  if (place === null) return (sheet) => visibleWithoutPlace(sheet, ctx.cautious);
  return (sheet) => isUsable(sheet, { equipment: place.equipment, cautious: ctx.cautious });
}

/** Chaque mot de la recherche (après `normalize`) apparaît dans le nom, ou dans un même alias. */
function matcher(query: string): ((sheet: ServedSheet) => boolean) | null {
  const words = normalize(query).split(' ').filter(Boolean);
  if (words.length === 0) return null;
  return (sheet) =>
    [sheet.name, ...sheet.aliases].some((text) => {
      const haystack = normalize(text);
      return words.every((w) => haystack.includes(w));
    });
}

const EMPTY_SEARCH: ExerciseSearch = { results: [], hiddenByFeasible: 0, hiddenByCautious: false };

export function createCatalogRepo(s: AppServices): CatalogRepo {
  const { db } = s;
  const profiles = createProfileRepo(s);
  const places = createPlacesRepo(s);
  const consent = createConsentRepo(s);

  async function sheets(): Promise<ServedSheet[]> {
    const rows = await db.table('exercises').toArray();
    return rows.flatMap((row) => {
      const parsed = ServedSheetSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async function context(placeId?: string | null): Promise<MemberCatalogContext> {
    const [me, profile, screening, all] = await Promise.all([
      getMeta(db, 'me'),
      profiles.get(),
      consent.screening(),
      places.list(),
    ]);
    // Le lieu principal, ou celui qu'on demande (null : aucun).
    const place = all.find((p) => (placeId === undefined ? p.isPrimary : p.id === placeId));
    // `me.cautious` vient du serveur ; on le recalcule aussi depuis les miroirs, qui peuvent être plus récents
    // (mode prudent, questionnaire). Prudent dès qu'une des deux sources le dit, et faute de savoir.
    const cautious =
      me === undefined ||
      me.cautious ||
      computeCautious({
        ageBand: me.ageBand,
        cautiousMode: profile?.cautiousMode ?? false,
        healthConsentActive: me.consents.health.active,
        caution: screening?.caution ?? null,
      });
    return {
      place: place ? { id: place.id, name: place.name, equipment: expandEquipment(place.equipment) } : null,
      cautious,
      maxLevel: maxExerciseLevel(profile?.experience),
    };
  }

  async function illustrationEntries(ids: readonly string[]): Promise<Map<string, IllustrationEntry>> {
    const out = new Map<string, IllustrationEntry>();
    if (ids.length === 0) return out;
    const rows: unknown[] = await db.table('illustrations').bulkGet([...ids]);
    for (const row of rows) {
      const parsed = IllustrationEntry.safeParse(row);
      if (parsed.success) out.set(parsed.data.id, parsed.data);
    }
    return out;
  }

  return {
    sheets,
    context,
    illustrationEntries,

    async view(filter) {
      const [all, ctx] = await Promise.all([sheets(), context()]);
      const shown = all.filter(visibility(ctx, filter));
      const groups = MUSCLE_GROUPS.map((g) => ({
        code: g.code,
        label: g.label,
        count: shown.filter((sheet) => inGroup(sheet, g.muscles)).length,
      }));
      return { ...ctx, groups };
    },

    async groupExercises(code, filter) {
      const muscles = MUSCLES_BY_GROUP.get(code);
      if (muscles === undefined) return null;
      const [all, ctx] = await Promise.all([sheets(), context()]);
      const visible = visibility(ctx, filter);
      return all.filter((sheet) => visible(sheet) && inGroup(sheet, muscles)).sort(byLevelThenName);
    },

    async searchExercises(query, filter) {
      const matches = matcher(query);
      if (matches === null) return EMPTY_SEARCH;
      const [all, ctx] = await Promise.all([sheets(), context(filter.placeId)]);
      const found = all.filter(matches);
      const visible = visibility(ctx, filter);
      const withoutFilter = visibility(ctx, { feasibleOnly: false });
      return {
        results: found.filter(visible).sort(byName),
        hiddenByFeasible: found.filter((sheet) => withoutFilter(sheet) && !visible(sheet)).length,
        hiddenByCautious: found.some(
          (sheet) => visibleWithoutPlace(sheet, false) && !visibleWithoutPlace(sheet, ctx.cautious),
        ),
      };
    },

    async getSheetView(id) {
      const [all, ctx] = await Promise.all([sheets(), context()]);
      const sheet = all.find((s) => s.id === id);
      if (sheet === undefined) return null;
      const catalogCtx: CatalogContext<ServedSheet> = {
        catalog: all,
        equipment: ctx.place?.equipment ?? 'all',
        maxLevel: ctx.maxLevel,
        cautious: ctx.cautious,
      };
      const chain: SheetView['chain'] = {};
      if (sheet.chain_id !== undefined) {
        // Voisins par rang (chaîne recollée par `buildChains` si un brouillon du milieu n'est pas servi), gardés
        // seulement s'ils sont utilisables : en profil prudent, rien au-delà de la première `not_for_minors`.
        const chains = buildChains(all);
        const members = chains.get(sheet.chain_id) ?? [];
        const rank = chainRank(sheet, chains);
        const usableIds = new Set(usableChainSteps(sheet.chain_id, catalogCtx).map((m) => m.id));
        const keep = (m: ServedSheet | undefined) => (m && usableIds.has(m.id) ? m : undefined);
        if (rank !== null) {
          const easier = keep(members[rank - 2]);
          const harder = keep(members[rank]);
          if (easier) chain.easier = easier;
          if (harder) chain.harder = harder;
        }
      }
      const entries = await illustrationEntries(sheet.illustrations.map((use) => use.illustration_id));
      return {
        sheet,
        usable: !(ctx.cautious && sheet.not_for_minors),
        feasibleHere: ctx.place === null || feasible(sheet, ctx.place.equipment),
        chain,
        substitutes: substitutes(sheet, catalogCtx),
        place: ctx.place,
        illustrations: sheetIllustrations(sheet.illustrations, entries),
      };
    },
  };
}

const repos = new WeakMap<AppServices, CatalogRepo>();

/**
 * Dépôt du catalogue de `services`, un seul par services : celui des hooks ci-dessous et `useRepos().catalog`
 * sont le même objet. (Les hooks ne passent pas par `./index`, qui importe ce module : pas de cycle.)
 */
export function catalogRepoFor(services: AppServices): CatalogRepo {
  let repo = repos.get(services);
  if (!repo) {
    repo = createCatalogRepo(services);
    repos.set(services, repo);
  }
  return repo;
}

function useCatalogRepo(): CatalogRepo {
  const services = useServices();
  return useMemo(() => catalogRepoFor(services), [services]);
}

export type CatalogState = 'missing' | 'loading' | 'ready';

export interface CatalogSnapshot {
  /**
   * `loading` : la base locale n'a pas encore répondu ; `missing` : aucune fiche publiée en local (catalogue jamais
   * téléchargé, ou vide) : l'écran affiche « Le catalogue arrive… » en ligne, « Connecte-toi une fois… » hors
   * ligne, jamais des tuiles à 0 (Review Focus 5) ; `ready` : au moins une fiche publiée.
   */
  state: CatalogState;
  /** Fiches servies (publiées et retirées), par `id` : filtrer sur `status === 'published'` pour tout ce qu'on propose. */
  sheets: ServedSheet[];
}

const LOADING: CatalogSnapshot = { state: 'loading', sheets: [] };

/** Catalogue local, observé (suit chaque téléchargement du catalogue). */
export function useCatalog(): CatalogSnapshot {
  const repo = useCatalogRepo();
  const sheets = useLive(() => repo.sheets(), [repo]);
  if (sheets === undefined) return LOADING;
  return { state: sheets.some((s) => s.status === 'published') ? 'ready' : 'missing', sheets };
}

/**
 * Tuiles de l'onglet Exercices et contexte du membre (lieu principal, profil prudent, niveau max), observés ;
 * `undefined` tant que la base locale n'a pas répondu (ne pas afficher de tuiles à 0 en attendant).
 */
export function useExerciseView(opts: ExerciseFilter): ExerciseView | undefined {
  const repo = useCatalogRepo();
  return useLive(() => repo.view({ feasibleOnly: opts.feasibleOnly }), [repo, opts.feasibleOnly]);
}
