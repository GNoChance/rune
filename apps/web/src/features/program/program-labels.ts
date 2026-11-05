import type {
  ChangeAuthor,
  ChangeErrorCode,
  ChangeStatus,
  InstanceChangeOperation,
  ProgramTemplate,
  SlotSpec,
} from '@rune/contracts';
import { type PlannedLoad, type ProgramState, workSetCount } from '@rune/domain';
import { formatDate, formatKg } from '../../ui';

/*
 * Textes de Mon programme et de « Choisir un programme » (spec brique 3 §7.7, §7.8) : tutoiement, apostrophe
 * droite, à relire par le propriétaire. Ceux que partagent E8 et le Profil sont dans `recommendation-labels.ts`.
 */

/** Un message par code de refus d'une opération (422 `invalid_change`, et le même contrôle côté téléphone). */
export const CHANGE_ERROR_MESSAGES: Record<ChangeErrorCode, string> = {
  slot_unknown: "Cet exercice n'est plus dans ton programme.",
  workout_unknown: "Cette séance n'est plus dans ton programme.",
  exercise_unusable: "Cet exercice n'est faisable dans aucun de tes lieux.",
  pattern_mismatch: 'Cet exercice ne travaille pas le même mouvement.',
  sets_out_of_bounds: 'Un exercice garde entre 1 et 5 séries.',
  reps_out_of_bounds: 'Cette fourchette de répétitions sort des limites.',
  rir_out_of_bounds: "Cet effort visé n'est pas possible pour cet exercice.",
  rest_out_of_bounds: 'Le repos va de 30 secondes à 5 minutes.',
  coverage_lost: 'Ce changement laisserait un groupe de mouvements sans exercice.',
  volume_out_of_range: 'Ce changement sort du volume conseillé pour ce programme.',
  slot_limit: 'Une séance garde entre 1 et 8 exercices.',
  forbidden_for_author: "Ce changement ne t'est pas ouvert.",
  forbidden_cautious: 'Le profil prudent ne permet pas ce changement.',
  days_out_of_range: "Ce nombre de jours n'est pas possible pour ce programme.",
  template_unavailable: "Ce programme n'est pas disponible pour le moment.",
  template_unchanged: 'Tu suis déjà ce programme.',
  not_suspended: "Cet exercice n'est pas suspendu.",
  already_suspended: 'Cet exercice est déjà suspendu.',
};

/** 409 `stale_revision` : le programme a changé depuis l'affichage ; une proposition reste en attente. */
export const STALE_MESSAGE = 'Le programme a changé : vérifie et recommence.';

/**
 * Proposition que le validateur du téléphone refuse (ruling R41) : avertissement seulement, « Accepter » reste actif et
 * le serveur décide.
 */
export const localRefusal = (reason: string): string =>
  `Ton téléphone n'est peut-être pas à jour : ${reason}`;

/** Journal : qui a fait le changement. */
export const AUTHOR_LABELS: Record<ChangeAuthor, string> = {
  user: 'Toi',
  engine: 'Rune',
  coach: 'Coach IA',
};

/** Titre d'une proposition en attente, par auteur (les changements de l'utilisateur sont acceptés d'emblée). */
export const PROPOSAL_TITLES: Record<ChangeAuthor, string> = {
  user: 'Ta proposition',
  engine: 'Proposition de Rune',
  coach: 'Proposition du coach IA',
};

export const STATUS_LABELS: Record<ChangeStatus, string> = {
  proposed: 'En attente',
  accepted: 'Accepté',
  rejected: 'Refusé',
  expired: 'Expiré',
};

/** Avertissement d'un changement de programme ou de version (spec §7.7, §7.8). */
export const SWITCH_WARNING =
  "Ton programme actuel s'arrête. Chaque exercice repart en calibration, avec ta dernière charge comme point de départ.";

export const NEW_VERSION_TEXT = 'Une nouvelle version de ton programme existe.';
export const NEW_VERSION_ACTION = 'Passer à la nouvelle version';
/** Profil prudent : « Ajouter un exercice » n'apparaît pas (05 §14, §15). */
export const CAUTIOUS_NO_ADD = "Profil prudent : pas d'ajout d'exercice, pour garder un volume adapté.";
export const DELOAD_TEXT = 'Tes séances de la semaine à venir seront plus légères, pour récupérer.';
export const REMOVE_TEXT = 'Cet exercice ne fera plus partie de la séance.';

/** Repos : « 45 s », « 2 min », « 1 min 30 ». */
export function formatRest(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${String(rest).padStart(2, '0')}`;
}

const range = (r: { min: number; max: number }) => (r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`);

/** Premier groupe de séries de travail : celui qui porte les cibles du slot. */
export const workSet = (slot: SlotSpec) => slot.sets.find((s) => s.kind === 'work') ?? slot.sets[0];

/** Séries × répétitions (« 3 × 8–12 ») ou séries × durée (« 3 × 30–45 s »). */
export function setsSummary(slot: SlotSpec): string {
  const set = workSet(slot);
  const count = workSetCount(slot);
  if (set?.durationS) return `${count} × ${range(set.durationS)} s`;
  return set?.reps ? `${count} × ${range(set.reps)}` : `${count}`;
}

/** « 3 × 6 · repos 3 min ». */
export function slotSummary(slot: SlotSpec): string {
  const rest = workSet(slot)?.restS;
  return rest === undefined ? setsSummary(slot) : `${setsSummary(slot)} · repos ${formatRest(rest)}`;
}

/** « Semaine 3 », et « · bloc 3 / 5 » pour un modèle planifié. */
export function weekLabel(state: ProgramState, template: ProgramTemplate): string {
  const week = `Semaine ${state.weekIndex + 1}`;
  const { block } = template;
  return block.mode === 'planned' && state.blockWeek !== null
    ? `${week} · bloc ${state.blockWeek} / ${block.weeks}`
    : week;
}

export const daysLabel = (days: number): string => `${days} jours par semaine`;

/** « 2 jours par semaine · depuis le 01/09/2026 ». */
export const programFacts = (days: number, startedAt: string): string =>
  `${daysLabel(days)} · depuis le ${formatDate(startedAt)}`;

export const expiryLabel = (iso: string): string => `Jusqu'au ${formatDate(iso)}`;

export const repsInReserve = (n: number) => `${n} ${n < 2 ? 'répétition' : 'répétitions'} en réserve`;

/** Noms lus par les résumés : exercice d'un slot (ou d'une fiche), séance, modèle. */
export interface ProgramNames {
  slot(slotId: string): string;
  exercise(exerciseId: string): string;
  workout(workoutId: string): string;
  template(templateId: string): string;
}

/** Résumé d'une opération pour le journal (« Squat barre : repos 2 min 30 »). */
export function operationSummary(op: InstanceChangeOperation, names: ProgramNames): string {
  switch (op.op) {
    case 'replace_exercise':
      return `Remplacé par ${names.exercise(op.exercise)}`;
    case 'change_sets':
      return `${names.slot(op.slot)} : ${op.delta > 0 ? 'une série de plus' : 'une série de moins'}`;
    case 'set_rep_range':
      return `${names.slot(op.slot)} : ${range(op)} répétitions`;
    case 'set_target_rir':
      return `${names.slot(op.slot)} : ${repsInReserve(op.value)}`;
    case 'set_rest':
      return `${names.slot(op.slot)} : repos ${formatRest(op.seconds)}`;
    case 'lighten_exercise':
      return `${names.slot(op.slot)} : plus léger la prochaine fois`;
    case 'start_deload':
      return 'Semaine allégée';
    case 'suspend_slot':
      return `${names.slot(op.slot)} : suspendu`;
    case 'resume_slot':
      return `${names.slot(op.slot)} : repris`;
    case 'remove_slot':
      return `${names.slot(op.slot)} : retiré de la séance`;
    case 'add_slot':
      return `${names.workout(op.workout)} : ${op.exercises[0] ? names.exercise(op.exercises[0]) : ''} ajouté`;
    case 'set_days_per_week':
      return daysLabel(op.days);
    case 'switch_template':
      return `Nouveau programme : ${names.template(op.templateId)}`;
  }
}

export const changeSummary = (ops: readonly InstanceChangeOperation[], names: ProgramNames): string =>
  ops.map((op) => operationSummary(op, names)).join(' ; ');

/** Proposition du coach IA (spec brique 4 §16.5) : mention sous le titre, lien, états de la carte compacte. */
export const AI_NOTE = "Proposé par l'IA, vérifié par l'appli";
export const SEE_CONVERSATION = 'Voir la conversation';
/** Carte du flux dont la ligne n'est pas encore arrivée par le pull : rien à accepter. */
export const PREPARING = 'en préparation';
export const DECIDED_LABELS = { accepted: 'Acceptée', rejected: 'Refusée', expired: 'Expirée' } as const;

/** Un remplacement ne préremplit jamais de charge : la personne choisira la sienne (spec brique 4 §12.4). */
export const CALIBRATION_LINE = 'Calibration : tu choisiras ta charge';

/**
 * Ligne « Charge » d'une proposition, de la charge prévue avant et après (`changePreview`) : « 40 kg → 35 kg » ; une
 * calibration le dit ; une charge qui apparaît sans avoir été visée avant est annoncée « Charge prévue ». Rien quand
 * la charge ne bouge pas, quand le slot disparaît ou n'a pas de charge.
 */
export function loadLine(before: PlannedLoad | null, after: PlannedLoad | null): string | null {
  if (after?.kind === 'calibration') return CALIBRATION_LINE;
  if (after?.kind !== 'load') return null;
  if (before?.kind !== 'load') return `Charge prévue : ${formatKg(after.loadG)}`;
  return before.loadG === after.loadG ? null : `${formatKg(before.loadG)} → ${formatKg(after.loadG)}`;
}
