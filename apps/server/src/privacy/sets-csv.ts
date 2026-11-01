import { parisDate } from '@rune/domain';
import { sql } from 'kysely';
import type { DbExecutor } from '../db/schema';
import { isHealthConsentActive } from './consent-state';

/** En-tête fixe du CSV des séries (spec brique 3 §5.6) ; `douleur` s'y ajoute avec le consentement santé. */
export const SETS_CSV_HEADER = [
  'date',
  'heure',
  'seance',
  'lieu',
  'exercice',
  'exercice_id',
  'position',
  'cote',
  'type',
  'charge_kg',
  'repetitions',
  'duree_s',
  'effort',
  'cible_reps_min',
  'cible_reps_max',
  'cible_duree_s',
  'cible_charge_kg',
  'cible_rir',
] as const;

const BOM = '﻿';
const EOL = '\r\n';
const FREE_SESSION = 'Séance libre';
const UNKNOWN_PLACE = 'Lieu inconnu';

const SIDES: Record<string, string> = { left: 'gauche', right: 'droite' };
const KINDS: Record<string, string> = { warmup: 'echauffement', work: 'travail' };
const EFFORTS: Record<string, string> = { easy: 'facile', ok: 'correct', hard: 'difficile', failed: 'echec' };
const PAIN: Record<string, string> = { none: 'aucune', discomfort: 'gene', pain: 'douleur' };

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parisTime(instant: Date): string {
  const p = Object.fromEntries(timeFormat.formatToParts(instant).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}

/** Grammes → kilos avec virgule décimale (`62500` → `62,5`, `60000` → `60`). */
function kilos(grams: number | null): string {
  if (grams === null) return '';
  return String(grams / 1000).replace('.', ',');
}

const num = (n: number | null): string => (n === null ? '' : String(n));

/** Guillemets si besoin ; une formule de tableur (`=`, `+`, `-`, `@`) est neutralisée par une apostrophe. */
function text(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

interface SetRow {
  loggedAt: string;
  position: number;
  kind: string;
  side: string | null;
  loadG: number | null;
  reps: number | null;
  durationS: number | null;
  effort: string | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationS: number | null;
  targetLoadG: number | null;
  targetRir: number | null;
  exerciseId: string;
  exerciseName: string | null;
  painLevel: string | null;
  workoutId: string | null;
  snapshot: string | null;
  placeName: string | null;
}

/** Nom de la séance dans la copie figée du modèle ; sinon « Séance libre ». */
function workoutName(cache: Map<string, Map<string, string>>, row: SetRow): string {
  if (row.workoutId === null || row.snapshot === null) return FREE_SESSION;
  let names = cache.get(row.snapshot);
  if (!names) {
    names = new Map();
    try {
      const parsed: unknown = JSON.parse(row.snapshot);
      const workouts = (parsed as { workouts?: unknown }).workouts;
      if (Array.isArray(workouts)) {
        for (const w of workouts as { id?: unknown; name?: unknown }[]) {
          if (typeof w.id === 'string' && typeof w.name === 'string') names.set(w.id, w.name);
        }
      }
    } catch {
      // copie illisible : séance libre
    }
    cache.set(row.snapshot, names);
  }
  return names.get(row.workoutId) ?? FREE_SESSION;
}

/**
 * CSV des séries faites du compte (`logged_at` renseigné, séances non supprimées), une ligne par série, heure de Paris.
 * UTF-8 avec BOM, `;` comme séparateur, fins de ligne `\r\n`. La colonne `douleur` suppose le consentement santé.
 */
export async function buildSetsCsv(db: DbExecutor, userId: string): Promise<string> {
  const withPain = await isHealthConsentActive(db, userId);
  const result = await sql<SetRow>`
    select s.logged_at, s.position, s.kind, s.side, s.load_g, s.reps, s.duration_s, s.effort,
      s.target_reps_min, s.target_reps_max, s.target_duration_s, s.target_load_g, s.target_rir,
      pe.exercise_id, e.name as exercise_name, pe.pain_level,
      ws.workout_id, pi.snapshot, coalesce(p.name, g.name) as place_name
    from performed_set s
      join performed_exercise pe on pe.id = s.performed_exercise_id
      join workout_session ws on ws.id = pe.session_id
      left join program_instance pi on pi.id = ws.instance_id and pi.owner_id = ${userId}
      left join place p on p.id = ws.place_id and p.owner_id = ${userId}
      left join gym g on g.id = p.gym_id
      left join exercise e on e.id = pe.exercise_id
    where s.owner_id = ${userId} and pe.owner_id = ${userId} and ws.owner_id = ${userId}
      and s.logged_at is not null
      and s.deleted_at is null and pe.deleted_at is null and ws.deleted_at is null
    order by s.logged_at, ws.id, pe.position, s.position, s.side, s.id`.execute(db);

  const header = [...SETS_CSV_HEADER, ...(withPain ? ['douleur'] : [])].join(';');
  const names = new Map<string, Map<string, string>>();
  const lines = result.rows.map((r) => {
    const at = new Date(r.loggedAt);
    const fields = [
      parisDate(at),
      parisTime(at),
      text(workoutName(names, r)),
      text(r.placeName ?? UNKNOWN_PLACE),
      text(r.exerciseName ?? ''),
      text(r.exerciseId),
      String(r.position),
      r.side === null ? '' : (SIDES[r.side] ?? ''),
      KINDS[r.kind] ?? '',
      kilos(r.loadG),
      num(r.reps),
      num(r.durationS),
      r.effort === null ? '' : (EFFORTS[r.effort] ?? ''),
      num(r.targetRepsMin),
      num(r.targetRepsMax),
      num(r.targetDurationS),
      kilos(r.targetLoadG),
      num(r.targetRir),
      ...(withPain ? [r.painLevel === null ? '' : (PAIN[r.painLevel] ?? '')] : []),
    ];
    return fields.join(';');
  });
  return BOM + [header, ...lines].join(EOL) + EOL;
}
