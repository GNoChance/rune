import { type CatalogContext, type CatalogSheet, compareIds, isUsable } from './usable';

const byLevelThenId = (a: CatalogSheet, b: CatalogSheet) => a.level - b.level || compareIds(a, b);

/**
 * Membres d'une chaîne du plus facile au plus dur (R-CH-5) : on part du membre sans voisin plus facile et on suit
 * `harder_id`. Une chaîne valide (R-CH-1 et R-CH-2, vérifiées par le validateur) donne un seul chemin.
 *
 * Sinon le résultat reste total et déterministe, chaque membre une seule fois : les morceaux (par exemple un
 * catalogue servi aux téléphones à qui manque un brouillon du milieu) sont mis bout à bout par niveau puis `id` de
 * leur tête (le niveau ne baisse pas le long d'une chaîne, R-CH-4), puis les membres d'un cycle par `id`.
 */
function orderChain<S extends CatalogSheet>(members: readonly S[]): S[] {
  const sorted = [...members].sort(compareIds);
  const byId = new Map(sorted.map((m) => [m.id, m]));
  const heads = sorted.filter((m) => m.easier_id === undefined || !byId.has(m.easier_id)).sort(byLevelThenId);
  const seen = new Set<string>();
  const out: S[] = [];
  for (const start of [...heads, ...sorted]) {
    let m: S | undefined = start;
    while (m !== undefined && !seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
      m = m.harder_id === undefined ? undefined : byId.get(m.harder_id);
    }
  }
  return out;
}

/**
 * Chaînes du catalogue (04 §5), par `chain_id` en ordre binaire, chacune de la variante la plus facile à la plus
 * dure. Une fiche retirée sort de sa chaîne (R-CH-6) ; les brouillons y restent (catalogue du serveur).
 */
export function buildChains<S extends CatalogSheet>(catalog: readonly S[]): Map<string, S[]> {
  const groups = new Map<string, S[]>();
  for (const sheet of catalog) {
    if (sheet.chain_id === undefined || sheet.status === 'retired') continue;
    const group = groups.get(sheet.chain_id);
    if (group === undefined) groups.set(sheet.chain_id, [sheet]);
    else group.push(sheet);
  }
  const chainIds = [...groups.keys()].sort(); // tri par défaut des chaînes : ordre binaire
  return new Map(chainIds.map((chainId) => [chainId, orderChain(groups.get(chainId) ?? [])]));
}

/** `chain_rank` (R-CH-5, calculé, jamais stocké) : position dans sa chaîne à partir de 1, `null` hors chaîne. */
export function chainRank(
  ex: Pick<CatalogSheet, 'id' | 'chain_id'>,
  chains: ReadonlyMap<string, readonly { id: string }[]>,
): number | null {
  if (ex.chain_id === undefined) return null;
  const index = chains.get(ex.chain_id)?.findIndex((m) => m.id === ex.id) ?? -1;
  return index === -1 ? null : index + 1;
}

/**
 * 04 §6.3 : membres utilisables (`isUsable`) de la chaîne, dans l'ordre de `chain_rank`. En profil prudent, la
 * chaîne s'arrête avant sa première variante `not_for_minors`, même si une variante plus dure ne l'est pas. Le
 * niveau ne compte pas : l'avancée dans une chaîne se mérite par la performance (04 §3.5).
 */
export function usableChainSteps<S extends CatalogSheet>(chainId: string, ctx: CatalogContext<S>): S[] {
  const steps = buildChains(ctx.catalog.filter((s) => s.chain_id === chainId)).get(chainId) ?? [];
  const stop = ctx.cautious ? steps.findIndex((s) => s.not_for_minors) : -1;
  return (stop === -1 ? steps : steps.slice(0, stop)).filter((s) => isUsable(s, ctx));
}
