import {
  ILLUSTRATION_LICENSE_LABELS,
  ILLUSTRATION_LICENSES,
  ILLUSTRATION_ROLES,
  ILLUSTRATION_SOURCE_LABELS,
  ILLUSTRATION_SOURCES,
  type IllustrationEntry,
  type IllustrationLicense,
  type IllustrationRole,
  type IllustrationSource,
} from '@rune/contracts';

/** Ce que les crédits lisent d'une fiche : son nom, son statut et ses illustrations. */
export type CreditSheet = {
  id: string;
  name: string;
  status: string;
  illustrations?: readonly { illustration_id: string; role: IllustrationRole }[];
};

/** Une illustration montrée par une fiche, avec sa pose. */
export type IllustrationUse = { exerciseId: string; exerciseName: string; role: IllustrationRole };

/** Un fichier crédité : son entrée de manifeste, sa ligne de crédit et les fiches qui le montrent. */
export type IllustrationCredit = { entry: IllustrationEntry; line: string; uses: IllustrationUse[] };

/** Dépôt source figé à un commit (04 §12, règle 1). */
export type FrozenSource = { repository: string; commit: string };

/** Crédits d'une source : créateurs, licences et commits figés de ses fichiers utilisés, puis ces fichiers. */
export type SourceCredit = {
  source: IllustrationSource;
  label: string;
  creators: string[];
  licenses: IllustrationLicense[];
  frozen: FrozenSource[];
  files: IllustrationCredit[];
};

/**
 * Fiches dont les illustrations sont créditées : celles que les téléphones affichent. Une fiche retirée reste
 * lisible depuis l'historique (spec brique 2 §4.2) et montre encore ses illustrations : elle garde ses crédits.
 */
const CREDITED_STATUSES: ReadonlySet<string> = new Set(['published', 'retired']);

const collator = new Intl.Collator('fr');
const roleRank = (role: IllustrationRole) => ILLUSTRATION_ROLES.indexOf(role);
const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Ordre des usages : nom de la fiche (collation française), puis `id`, puis pose (départ, milieu, fin). */
function compareUses(a: IllustrationUse, b: IllustrationUse): number {
  return (
    collator.compare(a.exerciseName, b.exerciseName) ||
    binary(a.exerciseId, b.exerciseId) ||
    roleRank(a.role) - roleRank(b.role)
  );
}

/**
 * Ligne de crédit d'une illustration (04 §12, « Attribution ») : créateurs, licence, puis « modifiée » quand le
 * manifeste décrit des modifications. Ex. « Illustration : Greg Priday · CC BY-SA 4.0 · modifiée ».
 */
export function illustrationCreditLine(
  entry: Pick<IllustrationEntry, 'creators' | 'license' | 'modifications'>,
): string {
  const parts = [`Illustration : ${entry.creators.join(', ')}`, ILLUSTRATION_LICENSE_LABELS[entry.license]];
  if (entry.modifications !== undefined) parts.push('modifiée');
  return parts.join(' · ');
}

const GITHUB = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw|tree)\/([0-9a-f]{40})(?:\/|$)/;
const GITHUB_RAW = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([0-9a-f]{40})\//;

/**
 * Dépôt et commit d'une URL source figée (GitHub, commit complet de 40 caractères) ; null pour une URL qui ne
 * désigne pas un commit (branche, commit abrégé, autre hôte).
 */
export function frozenSource(sourceUrl: string): FrozenSource | null {
  const match = GITHUB.exec(sourceUrl) ?? GITHUB_RAW.exec(sourceUrl);
  if (match === null) return null;
  const [, owner, repo, commit] = match;
  return { repository: `https://github.com/${owner}/${repo}`, commit: commit ?? '' };
}

/** Valeurs distinctes, dans l'ordre de leur première apparition. */
function distinctBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const k = key(value);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Crédits de la page Crédits (04 §12 ; §13, critère 12) : chaque illustration de chaque fiche publiée (ou
 * retirée, encore affichée), groupée par source dans l'ordre de `ILLUSTRATION_SOURCES`. Les fichiers d'une
 * source sont triés par leur premier usage (`compareUses`), puis par `id` ; les créateurs (collation
 * française), les licences (ordre de `ILLUSTRATION_LICENSES`) et les commits figés sont dédoublonnés. Un
 * fichier du manifeste qu'aucune de ces fiches ne montre n'apparaît pas ; un id absent du manifeste est ignoré.
 */
export function illustrationCredits(
  sheets: readonly CreditSheet[],
  manifest: readonly IllustrationEntry[],
): SourceCredit[] {
  const entries = new Map(manifest.map((entry) => [entry.id, entry]));
  const uses = new Map<string, IllustrationUse[]>();
  for (const sheet of sheets) {
    if (!CREDITED_STATUSES.has(sheet.status)) continue;
    for (const { illustration_id: id, role } of sheet.illustrations ?? []) {
      if (!entries.has(id)) continue;
      const list = uses.get(id) ?? [];
      list.push({ exerciseId: sheet.id, exerciseName: sheet.name, role });
      uses.set(id, list);
    }
  }

  const files: IllustrationCredit[] = [];
  for (const [id, list] of uses) {
    const entry = entries.get(id);
    if (entry === undefined) continue;
    files.push({ entry, line: illustrationCreditLine(entry), uses: [...list].sort(compareUses) });
  }
  files.sort((a, b) => {
    const [first, second] = [a.uses[0], b.uses[0]];
    const byUse = first && second ? compareUses(first, second) : 0;
    return byUse || binary(a.entry.id, b.entry.id);
  });

  return ILLUSTRATION_SOURCES.flatMap((source): SourceCredit[] => {
    const own = files.filter((file) => file.entry.source === source);
    if (own.length === 0) return [];
    const creators = [...new Set(own.flatMap((file) => file.entry.creators))].sort(collator.compare);
    const licenses = ILLUSTRATION_LICENSES.filter((license) => own.some((f) => f.entry.license === license));
    const frozen = distinctBy(
      own.flatMap((file) => frozenSource(file.entry.source_url) ?? []),
      (f) => `${f.repository} ${f.commit}`,
    ).sort((a, b) => binary(a.repository, b.repository) || binary(a.commit, b.commit));
    return [{ source, label: ILLUSTRATION_SOURCE_LABELS[source], creators, licenses, frozen, files: own }];
  });
}
