import type { EquipmentCode, ExerciseLevel, ExerciseSheet, SlotSpec } from '@rune/contracts';
import { buildChains, usableChainSteps } from '../catalog/chains';
import { substitutes } from '../catalog/substitutes';
import { type CatalogSheet, isUsable } from '../catalog/usable';
import { slotMeasure } from './primitives';
import type { PlaceContext, SlotState } from './types';

/*
 * Choix de l'exercice selon le lieu (05 §11, spec brique 3 §4.3.6) : l'exercice que la séance prévoit pour un slot au
 * lieu du jour, la raison du choix, et les candidats de « Changer d'exercice ».
 */

/**
 * Fiche telle que la préparation d'une séance la lit : celle du catalogue, plus sa mesure. Une fiche servie aux
 * téléphones (`ServedSheet`) l'a, comme une fiche complète.
 */
export type PlanSheet = CatalogSheet & Pick<ExerciseSheet, 'measure'>;

/**
 * Raison du choix : `planned`, l'exercice prévu par le programme ; `replaced_not_feasible`, un autre parce que le
 * prévu n'est pas utilisable ici ; `not_feasible_here`, rien d'utilisable, slot sauté sans pénalité ; `suspended`,
 * slot mis de côté (05 §13.7, §15).
 */
export type SlotResolutionKind = 'planned' | 'replaced_not_feasible' | 'not_feasible_here' | 'suspended';

export interface ResolveContext<S extends PlanSheet = PlanSheet> {
  catalog: readonly S[];
  place: PlaceContext;
  /** Profil prudent : fiches `not_for_minors` écartées, chaîne coupée avant la première d'entre elles (05 §14). */
  cautious: boolean;
  /** `maxExerciseLevel` : seul `substitutes` le lit (04 §6.4). */
  maxLevel: ExerciseLevel;
  /** État de la chaîne d'un slot `chain` (tenu par `chain_id`) : sa variante est la variante visée. Lu seulement là. */
  state: SlotState | null;
  suspended: boolean;
}

export interface SlotResolution<S extends PlanSheet = PlanSheet> {
  exercise: S | null;
  resolution: SlotResolutionKind;
  /**
   * Candidats de « Changer d'exercice » (05 §11.4) : exercices utilisables de la liste du slot (pour une chaîne, ses
   * variantes utilisables, dans l'ordre de `chain_rank`), puis remplaçants de la référence ; sans doublon, tous de
   * la mesure du slot.
   */
  candidates: S[];
  /**
   * Exercice prévu par le programme pour ce profil : tête de la liste du slot, ou variante visée de la chaîne. Jamais
   * une fiche `not_for_minors` en profil prudent : la première fiche permise de la liste en tient lieu (R28), et null
   * si le profil n'en permet aucune (liste entièrement `not_for_minors`, chaîne coupée dès sa première variante).
   */
  plannedExerciseId: string | null;
}

/**
 * Chaîne `chainId` telle qu'un profil la suit, dans l'ordre de `chain_rank`, jamais filtrée par le lieu : coupée avant
 * sa première variante `not_for_minors` en profil prudent (05 §14), comme le rejeu la passe au moteur.
 */
export function profileChain<S extends CatalogSheet>(
  catalog: readonly S[],
  chainId: string,
  cautious: boolean,
): S[] {
  const steps = buildChains(catalog.filter((s) => s.chain_id === chainId)).get(chainId) ?? [];
  const stop = cautious ? steps.findIndex((s) => s.not_for_minors) : -1;
  return stop === -1 ? steps : steps.slice(0, stop);
}

/** Rang visé (à partir de 1) dans `steps` : le `variantRank` de l'état, ramené dans la chaîne ; 1 sans état. */
function aimedRank(steps: readonly unknown[], variantRank: number | null): number {
  return Math.min(Math.max(variantRank ?? 1, 1), Math.max(steps.length, 1));
}

/**
 * Exercice courant d'un slot `chain` (celui que `chainPlan` vise) : la variante du rang de l'état, dans la chaîne du
 * profil ; `undefined` si la chaîne est vide ou coupée dès sa première variante (profil prudent).
 */
export function currentChainExercise<S extends CatalogSheet>(
  catalog: readonly S[],
  chainId: string,
  cautious: boolean,
  state: Pick<SlotState, 'variantRank'> | null,
): S | undefined {
  const steps = profileChain(catalog, chainId, cautious);
  return steps[aimedRank(steps, state?.variantRank ?? null) - 1];
}

/** Ce que le slot prévoit avant de regarder le lieu : la référence, l'ordre de préférence et ses exercices propres. */
interface SlotPlan<S extends PlanSheet> {
  plannedExerciseId: string | null;
  /** Référence des remplaçants (05 §11.2) ; absente si le catalogue ne la connaît pas. */
  reference: S | undefined;
  /** Exercices du slot à essayer, dans l'ordre. */
  preferred: S[];
  /** Exercices utilisables du slot, pour les candidats. */
  own: S[];
  /** Variantes de la chaîne du slot : jamais prises d'office parmi les remplaçants. */
  chained: ReadonlySet<string>;
}

/**
 * Slot `chain` (spec §4.3.6) : la variante de l'état (la première sans état), ramenée dans la chaîne du profil ; si
 * elle n'est pas utilisable, la plus difficile des variantes utilisables de rang inférieur, jamais une plus difficile.
 */
function chainPlan<S extends PlanSheet>(
  chainId: string,
  ctx: ResolveContext<S>,
  usable: (s: S) => boolean,
  equipment: Set<EquipmentCode>,
): SlotPlan<S> {
  const steps = profileChain(ctx.catalog, chainId, ctx.cautious);
  const full = ctx.cautious ? profileChain(ctx.catalog, chainId, false) : steps;
  const rank = aimedRank(steps, ctx.state?.variantRank ?? null);
  const aimed = steps[rank - 1];
  // Chaîne coupée dès sa première variante (prudent) : rien de prévu, mais les remplaçants partent de la variante.
  const reference = aimed ?? full[Math.min(rank, full.length) - 1];
  const catalogCtx = { catalog: [...ctx.catalog], equipment, maxLevel: ctx.maxLevel, cautious: ctx.cautious };
  return {
    plannedExerciseId: aimed?.id ?? (ctx.cautious ? null : chainId),
    reference,
    preferred: steps.slice(0, rank).reverse(),
    own: usableChainSteps(chainId, catalogCtx).filter(usable),
    chained: new Set(full.map((s) => s.id)),
  };
}

/**
 * Slot à liste (05 §11.1) : le premier exercice utilisable de la liste, la tête servant de référence. Fiche prévue :
 * la tête, ou en profil prudent la première fiche de la liste qui n'est pas `not_for_minors` (R28).
 */
function listPlan<S extends PlanSheet>(
  exercises: readonly string[],
  byId: ReadonlyMap<string, S>,
  usable: (s: S) => boolean,
  cautious: boolean,
): SlotPlan<S> {
  const listed = exercises.flatMap((id) => {
    const sheet = byId.get(id);
    return sheet === undefined ? [] : [sheet];
  });
  return {
    plannedExerciseId: exercises.find((id) => !(cautious && byId.get(id)?.not_for_minors === true)) ?? null,
    reference: listed[0],
    preferred: listed,
    own: listed.filter(usable),
    chained: new Set(),
  };
}

/**
 * Exercice du jour d'un slot (05 §11) : le premier exercice utilisable du slot — publié, faisable au lieu, pas
 * `not_for_minors` en profil prudent, de la mesure du slot —, sinon le premier remplaçant (`substitutes` de la
 * référence, de la même mesure ; pour une chaîne, hors de ses variantes), sinon rien : le slot est sauté. Un slot
 * suspendu ne prévoit rien.
 */
export function resolveSlot<S extends PlanSheet>(slot: SlotSpec, ctx: ResolveContext<S>): SlotResolution<S> {
  const measure = slotMeasure(slot);
  const equipment = new Set(ctx.place.equipment);
  const usable = (s: S) => s.measure === measure && isUsable(s, { equipment, cautious: ctx.cautious });
  const byId = new Map(ctx.catalog.map((s) => [s.id, s]));
  const p =
    slot.chain !== undefined
      ? chainPlan(slot.chain, ctx, usable, equipment)
      : listPlan(slot.exercises ?? [], byId, usable, ctx.cautious);
  if (ctx.suspended) {
    return {
      exercise: null,
      resolution: 'suspended',
      candidates: [],
      plannedExerciseId: p.plannedExerciseId,
    };
  }

  const near =
    p.reference === undefined
      ? []
      : substitutes(p.reference, {
          catalog: [...ctx.catalog],
          equipment,
          maxLevel: ctx.maxLevel,
          cautious: ctx.cautious,
        }).filter((s) => s.measure === measure && !p.chained.has(s.id));
  const exercise = p.preferred.find(usable) ?? near[0] ?? null;
  const candidates = [...new Map([...p.own, ...near].map((s) => [s.id, s])).values()];
  return {
    exercise,
    resolution:
      exercise === null
        ? 'not_feasible_here'
        : exercise.id === p.plannedExerciseId
          ? 'planned'
          : 'replaced_not_feasible',
    candidates,
    plannedExerciseId: p.plannedExerciseId,
  };
}
