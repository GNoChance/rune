import { type SessionRecord, tonnageG, workSetUnits } from '@rune/domain';
import { plural } from '../../ui';

const TIME_ZONE = 'Europe/Paris';

const dayFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const monthFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, month: 'long', year: 'numeric' });
const monthKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
});
const kgFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const tonFormat = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Au-delà de 10 000 kg soulevés, on parle en tonnes (spec brique 3 §8.3). */
const TONNES_ABOVE_G = 10_000_000;

/** « mar. 28 oct. », à l'heure de Paris. */
export const dayLabel = (ms: number): string => dayFormat.format(new Date(ms));

/** « Octobre 2025 ». */
export function monthLabel(ms: number): string {
  const label = monthFormat.format(new Date(ms));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Clé de regroupement du mois civil de Paris (« 2025-10 »). */
export const monthKey = (ms: number): string => monthKeyFormat.format(new Date(ms));

/** « 3 200 kg » ; « 12,4 t » au-delà de 10 000 kg. Charges en grammes entiers. */
export function liftedLabel(grams: number): string {
  if (grams > TONNES_ABOVE_G) return `${tonFormat.format(grams / 1_000_000)} t`;
  return `${kgFormat.format(grams / 1000)} kg`;
}

/** « Séance A » pour une séance de programme, « Séance libre » sans programme (D7). */
export const sessionName = (s: Pick<SessionRecord, 'workoutId'>): string =>
  s.workoutId === null ? 'Séance libre' : `Séance ${s.workoutId}`;

export const setsLabel = (n: number): string => `${n} ${plural(n, 'série', 'séries')}`;

/** Durée en minutes pleines (au moins 1) ; null sans heure de fin. */
export function minutesOf(s: Pick<SessionRecord, 'startedAt' | 'endedAt'>): number | null {
  if (s.endedAt === null) return null;
  return Math.max(1, Math.round((s.endedAt - s.startedAt) / 60_000));
}

export interface SessionTotals {
  sets: number;
  liftedG: number;
}

/** Séries de travail faites (une paire gauche/droite compte pour une) et charge × répétitions. */
export function totalsOf(s: SessionRecord): SessionTotals {
  return { sets: s.exercises.reduce((n, e) => n + workSetUnits(e), 0), liftedG: tonnageG([s]) };
}
