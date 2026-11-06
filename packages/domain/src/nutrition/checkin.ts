import type { CheckinDecision, CheckinPosition, NutritionGoal } from '@rune/contracts';
import { cmp, div, mul, type Q, q, roundHalfUpTo, sub } from './exact';
import { bmiBelow } from './targets';
import { addDays, mondayOf, type WeighIn, weekMean } from './weights';

export interface CheckinInput {
  /** Lundi de la semaine S. */
  weekStart: string;
  weighIns: WeighIn[];
  /** Point de départ : seules comptent les semaines dont le lundi est à cette date ou après. */
  startPoint: string;
  target: { effectiveGoal: NutritionGoal; refWeightG: number };
  /** Cible en vigueur à la fin de S-1, pour la bande de S-1 quand aucun bilan n'est stocké. */
  targetForPrevWeek: { effectiveGoal: NutritionGoal } | null;
  /** Bilan stocké de S-1, s'il existe. */
  previousCheckin: {
    meanWeightG: number | null;
    position: CheckinPosition | null;
    representative: boolean;
    countable: boolean;
  } | null;
  /** La semaine S est-elle représentative (calculée « oui » par défaut) ? */
  representative: boolean;
  heightCm: number;
  requestedGoal: NutritionGoal;
  safetyPause: boolean;
  /** Vrai si l'ajustement ± 100 laisserait la `kcal_target` inchangée. */
  limitReached: (delta: -100 | 100) => boolean;
}

export interface CheckinResult {
  decision: CheckinDecision;
  position: CheckinPosition | null;
  meanWeightG: number | null;
  changePct: number | null;
  weighInCount: number;
  /** Renseigné pour `proposal`, `rapid_loss` et `limit_reached` (sens du refus). */
  proposedDeltaKcal: -100 | 100 | null;
  recalibrate: boolean;
  lowBmiSafety: boolean;
}

/** Bandes de variation hebdomadaire en % (bornes incluses), 07 §5.7.3. */
const BANDS: Record<NutritionGoal, readonly [Q, Q]> = {
  lose: [q(-1), q(-1, 2)],
  maintain: [q(-1, 4), q(1, 4)],
  gain: [q(1, 4), q(1, 2)],
};

const RAPID_LOSS_PCT = q(-3, 2);
const RECALIBRATION_GAP_G = 2_000;

const positionIn = (v: Q, goal: NutritionGoal): CheckinPosition => {
  const [lo, hi] = BANDS[goal];
  return cmp(v, lo) < 0 ? 'below' : cmp(v, hi) > 0 ? 'above' : 'in';
};

/** v = 100 × (cur − prev) / prev, exact. */
const variation = (cur: number, prev: number): Q => mul(q(100), div(sub(q(cur), q(prev)), q(prev)));

/** 2 décimales, moitié en s'éloignant de zéro (−0,125 → −0,13). */
function roundPct(v: Q): number {
  const neg = v.n < 0n;
  const abs = q(neg ? -v.n : v.n, v.d);
  const scaled = Number(roundHalfUpTo(mul(abs, q(100)), 1n)) / 100;
  return neg ? -scaled : scaled;
}

/** Position de S-1 : bilan stocké, sinon calculée depuis les pesées avec la bande de la cible en vigueur. */
function previousPosition(i: CheckinInput, prevMonday: string): CheckinPosition | null {
  if (i.previousCheckin) return i.previousCheckin.position;
  if (!i.targetForPrevWeek) return null;
  const prevPrevMonday = addDays(prevMonday, -7);
  if (prevPrevMonday < i.startPoint) return null;
  const cur = weekMean(i.weighIns, prevMonday).meanG;
  const before = weekMean(i.weighIns, prevPrevMonday).meanG;
  if (cur === null || before === null) return null;
  return positionIn(variation(cur, before), i.targetForPrevWeek.effectiveGoal);
}

export function decideCheckin(i: CheckinInput): CheckinResult {
  const { count, meanG } = weekMean(i.weighIns, i.weekStart);
  const prevMonday = addDays(i.weekStart, -7);
  const out: CheckinResult = {
    decision: 'insufficient_data',
    position: null,
    meanWeightG: meanG,
    changePct: null,
    weighInCount: count,
    proposedDeltaKcal: null,
    recalibrate: false,
    lowBmiSafety: false,
  };

  // 1. recalibrage, acquis quoi qu'il arrive ensuite
  if (meanG !== null && Math.abs(meanG - i.target.refWeightG) >= RECALIBRATION_GAP_G) out.recalibrate = true;

  // 2. IMC trop bas en perte
  if (meanG !== null && i.requestedGoal === 'lose' && bmiBelow(i.heightCm, meanG, '18.5')) {
    out.lowBmiSafety = true;
    out.decision = 'safety_pause';
    return out;
  }

  // 3. v(S) : M(S) et M(S-1) définies, les deux semaines comptant
  const thisCounts = mondayOf(i.weekStart) >= i.startPoint;
  const prevCounts = i.previousCheckin ? i.previousCheckin.countable : prevMonday >= i.startPoint;
  const prevMean = i.previousCheckin ? i.previousCheckin.meanWeightG : weekMean(i.weighIns, prevMonday).meanG;
  if (meanG === null || prevMean === null || !thisCounts || !prevCounts) {
    return out;
  }
  const v = variation(meanG, prevMean);
  out.changePct = roundPct(v);
  const position = positionIn(v, i.target.effectiveGoal);
  out.position = position;

  // 4. semaine non représentative
  if (!i.representative) {
    out.decision = 'non_representative_week';
    return out;
  }

  // 5. perte rapide, quel que soit l'objectif
  if (cmp(v, RAPID_LOSS_PCT) < 0) {
    out.proposedDeltaKcal = 100;
    out.decision = i.limitReached(100) ? 'limit_reached' : 'rapid_loss';
    return out;
  }

  // 6. dans la bande
  if (position === 'in') {
    out.decision = 'in_band';
    return out;
  }

  // 7. première semaine hors bande de ce côté
  const prevRepresentative = i.previousCheckin ? i.previousCheckin.representative : true;
  if (!prevRepresentative || previousPosition(i, prevMonday) !== position) {
    out.decision = 'out_of_band_pending';
    return out;
  }

  // 8. deux semaines de suite du même côté
  const delta: -100 | 100 = position === 'above' ? -100 : 100;
  out.proposedDeltaKcal = delta;
  if (delta === -100 && i.safetyPause) {
    out.proposedDeltaKcal = null;
    out.decision = 'safety_pause';
  } else if (i.limitReached(delta)) {
    out.decision = 'limit_reached';
  } else {
    out.decision = 'proposal';
  }
  return out;
}
