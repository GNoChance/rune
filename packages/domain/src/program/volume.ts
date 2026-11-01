import {
  type EquipmentCode,
  type Muscle,
  PATTERN_GROUPS,
  type PatternGroup,
  type ProgramTemplate,
  patternGroup,
  REFERENCE_PROFILES,
  type SlotSpec,
} from '@rune/contracts';
import { buildChains } from '../catalog/chains';
import { expandEquipment, feasible } from '../catalog/equipment';
import type { CatalogSheet } from '../catalog/usable';
import { workSetCount } from './effective';

/*
 * Volume et couverture d'un modèle par semaine de programme (05 §5, règles 4 et 6). Une semaine de programme compte
 * N séances, N étant le nombre de jours ; la rotation reprend les séances dans l'ordre. Le cycle complet compte
 * ppcm(nombre de séances du modèle, N) séances, soit ppcm / N semaines.
 */

/** Groupes de volume contrôlés (05 §5, règle 6), en codes `MUSCLES`. */
export const VOLUME_GROUPS = {
  quadriceps: ['quadriceps'],
  hamstrings: ['hamstrings'],
  glutes: ['glutes'],
  chest: ['chest'],
  lats: ['lats'],
  delts: ['front_delts', 'side_delts', 'rear_delts'],
} as const satisfies Record<string, readonly Muscle[]>;
export type VolumeGroup = keyof typeof VOLUME_GROUPS;

const GROUPS = Object.keys(VOLUME_GROUPS) as VolumeGroup[];

/** Séries de travail par groupe et par semaine (bornes comprises) : débutant, intermédiaire, et tout modèle `sport`. */
export const VOLUME_RANGES = {
  beginner: [6, 12],
  intermediate: [10, 20],
  sport: [4, 10],
} as const satisfies Record<string, readonly [number, number]>;

/** Fourchette de volume d'un modèle : celle de `sport` pour ce contexte, sinon celle de son niveau. */
export function volumeRange(template: Pick<ProgramTemplate, 'context' | 'level'>): readonly [number, number] {
  return template.context === 'sport' ? VOLUME_RANGES.sport : VOLUME_RANGES[template.level];
}

/** Profil de référence du contexte (05 §5, règle 6) : `gym_reference` pour `gym`, sinon `home_bodyweight`. */
export function referenceEquipment(context: ProgramTemplate['context']): Set<EquipmentCode> {
  return expandEquipment(
    context === 'gym' ? REFERENCE_PROFILES.gym_reference : REFERENCE_PROFILES.home_bodyweight,
  );
}

/** Matériel de la maison sans matériel (`home_bodyweight`), déjà étendu. */
export const HOME_BODYWEIGHT: ReadonlySet<EquipmentCode> = referenceEquipment('home');

/**
 * Fiches candidates d'un slot, dans l'ordre : sa liste, ou les membres de sa chaîne du plus facile au plus dur.
 * Seules les fiches présentes et non retirées comptent (une fiche retirée n'est jamais proposée).
 */
export function slotCandidates(
  slot: Pick<SlotSpec, 'exercises' | 'chain'>,
  catalog: readonly CatalogSheet[],
  chains: ReadonlyMap<string, readonly CatalogSheet[]> = buildChains(catalog),
): CatalogSheet[] {
  if (slot.chain !== undefined) return [...(chains.get(slot.chain) ?? [])];
  const byId = new Map(catalog.map((s) => [s.id, s]));
  return (slot.exercises ?? []).flatMap((id) => {
    const sheet = byId.get(id);
    return sheet === undefined || sheet.status === 'retired' ? [] : [sheet];
  });
}

/** Poids d'une série pour un groupe : 1 si un muscle du groupe est principal, 0,5 s'il est secondaire, sinon 0. */
function groupWeight(sheet: CatalogSheet, muscles: readonly Muscle[]): number {
  if (sheet.primary_muscles.some((m) => muscles.includes(m))) return 1;
  if (sheet.secondary_muscles.some((m) => muscles.includes(m))) return 0.5;
  return 0;
}

/**
 * Volume par semaine de programme (05 §5, règle 6) : moyenne sur le cycle de ppcm(séances, jours) séances, au nombre
 * de jours par défaut du modèle, en comptage fractionnel. Chaque slot compte ses séries de travail sur son premier
 * exercice faisable avec `equipment` (déjà étendu) ; un slot sans exercice faisable ne compte pas. Chaque séance
 * revenant ppcm / séances fois dans le cycle de ppcm / jours semaines, la moyenne vaut somme × jours / séances.
 */
export function weeklyVolume(
  program: ProgramTemplate,
  catalog: readonly CatalogSheet[],
  equipment: ReadonlySet<EquipmentCode>,
): Record<VolumeGroup, number> {
  const chains = buildChains(catalog);
  const total = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<VolumeGroup, number>;
  for (const slot of program.workouts.flatMap((w) => w.slots)) {
    const sheet = slotCandidates(slot, catalog, chains).find((s) => feasible(s, equipment));
    if (sheet === undefined) continue;
    const sets = workSetCount(slot);
    for (const group of GROUPS) total[group] += sets * groupWeight(sheet, VOLUME_GROUPS[group]);
  }
  const days = program.daysPerWeek.default;
  const workouts = program.workouts.length;
  for (const group of GROUPS) total[group] = (total[group] * days) / workouts;
  return total;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

/** Semaines du cycle : pour chaque semaine, les index des séances faites (rotation dans l'ordre de `workouts`). */
export function programWeeks(workoutCount: number, days: number): number[][] {
  const sessions = lcm(workoutCount, days);
  return Array.from({ length: sessions / days }, (_, week) =>
    Array.from({ length: days }, (_, i) => (week * days + i) % workoutCount),
  );
}

/** Groupes de couverture (05 §5, règle 4) : ceux de `PATTERN_GROUPS`. */
export const COVERAGE_GROUPS = Object.keys(PATTERN_GROUPS) as PatternGroup[];

/** Trou de couverture : semaine (à partir de 1) d'un cycle à `days` jours sans le groupe, ou sans lui au poids du corps. */
export type CoverageGap = {
  group: PatternGroup;
  days: number;
  week: number;
  code: 'coverage_missing' | 'coverage_needs_bodyweight';
};

/**
 * Règle 4 de 05 §5, vérifiée pour chaque nombre de jours permis par le modèle et sur chaque semaine du cycle :
 * chaque groupe de couverture a au moins un slot ; pour un modèle `home` ou `sport`, au moins un de ces slots a un
 * exercice faisable avec `home_bodyweight`. La suspension d'un slot n'y entre pas.
 */
export function coverageGaps(template: ProgramTemplate, catalog: readonly CatalogSheet[]): CoverageGap[] {
  const chains = buildChains(catalog);
  const needsBodyweight = template.context !== 'gym';
  const gaps: CoverageGap[] = [];
  for (let days = template.daysPerWeek.min; days <= template.daysPerWeek.max; days += 1) {
    programWeeks(template.workouts.length, days).forEach((sessions, index) => {
      const slots = [...new Set(sessions)].flatMap((i) => template.workouts[i]?.slots ?? []);
      for (const group of COVERAGE_GROUPS) {
        const inGroup = slots.filter((s) => patternGroup(s.movementPattern) === group);
        const code =
          inGroup.length === 0
            ? 'coverage_missing'
            : needsBodyweight &&
                !inGroup.some((s) =>
                  slotCandidates(s, catalog, chains).some((c) => feasible(c, HOME_BODYWEIGHT)),
                )
              ? 'coverage_needs_bodyweight'
              : null;
        if (code !== null) gaps.push({ group, days, week: index + 1, code });
      }
    });
  }
  return gaps;
}
