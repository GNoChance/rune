import {
  type ChangeErrorCode,
  type InstanceChangeOperation,
  ProposeProgramChangeInput,
} from '@rune/contracts';
import {
  currentRules,
  extendSlotAliases,
  outputFilterText,
  resolveSlotAlias,
  validateChange,
} from '@rune/domain';
import { currentCatalog } from '../../catalog/bundle';
import { changeValidationInput, instanceProgram } from '../../program/changes';
import { activeInstance } from '../../program/enroll';
import { parseSnapshot } from '../../program/replay-service';
import { nutritionFilterOf, safetyPauseOf, storedThreadNutritionMode } from '../nutrition-mode';
import { checkCoachLoad } from '../proposals';
import { frozenSlotAliases } from '../threads';
import { defineTool, type ToolContext, type ToolOutcome } from './types';

/*
 * `propose_program_change` (spec brique 4 §10, §12.2, choix C3 à C7). Le schéma (étape 1) est revalidé par `runTool`,
 * qui tient aussi la limite des corrections ; le gestionnaire fait les étapes 2 à 7 dans l'ordre, la première qui
 * échoue rend ses erreurs. Une proposition validée n'existe qu'en mémoire, dans l'état de la tentative : rien n'est
 * écrit en base avant l'enregistrement de l'échange (`insertCoachProposal`, §12.3), pas même l'expiration des
 * propositions périmées de l'étape 4, faite à l'écriture (une proposition en attente ne change ni la révision ni le
 * programme effectif). Rien du contenu n'entre dans les journaux.
 */

export type ProposalErrorCode =
  | ChangeErrorCode
  | 'one_proposal_per_message'
  | 'no_active_program'
  | 'stale_revision'
  | 'coach_load_increase'
  | 'load_unverifiable'
  | 'reason_blocked'
  | 'corrections_exhausted';

/**
 * Messages rendus au modèle, en français : chacun dit quoi corriger. `{revision}` : la révision courante ; `{slots}` :
 * « (A1, A-x1) », les slots sous leurs références du dossier, ou rien si aucun n'en a. Aucun ne porte de nombre suivi
 * d'une unité : les résultats d'outils du fil alimentent les valeurs autorisées du filtre (C8).
 */
export const PROPOSAL_ERROR_MESSAGES: Record<ProposalErrorCode, string> = {
  slot_unknown:
    "Ce slot n'existe pas dans le programme : cite un slot par son identifiant du dossier ou de read_training.",
  workout_unknown:
    "Cette séance n'existe pas dans le programme : cite une séance par son identifiant du dossier ou de read_training.",
  exercise_unusable:
    "Cette fiche n'est pas utilisable : choisis une fiche publiée, faisable dans au moins un lieu de la personne et à son niveau (search_exercises).",
  pattern_mismatch:
    'Cette fiche ne travaille pas le type de mouvement du slot : choisis une fiche du même movement_pattern (search_exercises).',
  sets_out_of_bounds:
    "Le nombre de séries sortirait des bornes permises : garde-le, ou change-le dans l'autre sens.",
  reps_out_of_bounds:
    "Cette fourchette de répétitions sort des bornes permises : propose une fourchette plus proche de l'actuelle.",
  rir_out_of_bounds: "Ce RIR visé sort des bornes permises : propose une valeur plus proche de l'actuelle.",
  rest_out_of_bounds: "Ce repos sort des bornes permises : propose une durée plus proche de l'actuelle.",
  coverage_lost:
    "Le programme ne couvrirait plus tous les groupes de mouvements : remplace l'exercice plutôt que de retirer le slot.",
  volume_out_of_range:
    'Le volume de la semaine sortirait de la plage permise : change moins de séries à la fois.',
  slot_limit:
    'Cette séance ne peut pas recevoir de slot de plus : un seul ajout par séance et par changement, sous la limite de la séance.',
  forbidden_for_author: "Cette opération n'est pas ouverte au coach : propose une autre opération.",
  forbidden_cautious:
    'Profil prudent : ni ajout de slot, ni série en plus, ni RIR plus bas, ni fiche réservée aux adultes. Propose un changement plus doux.',
  days_out_of_range:
    'Ce nombre de jours sort des bornes du modèle : choisis un nombre de jours permis par le modèle.',
  template_unavailable:
    "Ce modèle n'est pas disponible : choisis un modèle de la liste des modèles disponibles du dossier.",
  template_unchanged:
    "C'est déjà le modèle suivi, dans sa version : propose un autre modèle ou une autre opération.",
  not_suspended: "Ce slot n'est pas suspendu : retire cette opération.",
  already_suspended: 'Ce slot est déjà suspendu : retire cette opération.',
  one_proposal_per_message:
    "Une proposition est déjà prête dans ce message, et il n'en faut qu'une : présente-la sans en proposer d'autre.",
  no_active_program:
    'La personne ne suit aucun programme : invite-la à en choisir un dans « Choisir un programme », sans proposer de changement.',
  stale_revision:
    'Le programme a changé : sa révision est maintenant {revision}. Relis-le avec read_training, puis propose de nouveau avec base_revision {revision}.',
  coach_load_increase:
    'Ce changement ferait monter une charge prévue{slots}, à la prochaine séance ou à la reprise : le coach ne propose jamais de hausse de charge. Propose un changement qui la garde ou la baisse.',
  load_unverifiable:
    "L'appli ne peut pas vérifier les charges prévues pour le moment : ne propose pas de changement maintenant, et dis simplement à la personne de réessayer plus tard.",
  reason_blocked:
    "Le motif contient un chiffre, un numéro ou un mot que l'appli ne peut pas vérifier : reformule-le en une ou deux phrases simples, sans chiffre absent du dossier.",
  corrections_exhausted:
    "Trop de propositions refusées dans ce message : n'en propose plus. Explique simplement que tu n'as pas pu préparer ce changement.",
};

const DESCRIPTION = [
  "Propose un changement du programme en cours, que la personne acceptera ou refusera dans l'appli. base_revision :",
  'la révision lue dans le dossier ou par read_training. operations : de 1 à 5 opérations, slots et séances cités par',
  'leurs identifiants du dossier. reason : le motif, adressé à la personne en une ou deux phrases, 300 caractères au',
  'plus. Une seule proposition par message. Le code refuse toute opération qui ferait monter une charge prévue,',
  'lèverait une suspension ou sortirait des bornes du profil ; un refus dit quoi corriger (errors : op, code, message),',
  "et après trois refus dans le message, il n'est plus possible de proposer. Succès : change_id et expires_in_days.",
].join(' ');

/** Erreur rendue au modèle : `op` = index de l'opération, -1 pour le changement entier. */
interface ProposalError {
  op: number;
  code: ProposalErrorCode;
  message: string;
}

const failure = (errors: ProposalError[]): ToolOutcome => ({ isError: true, result: { errors } });

/** Erreur d'un changement entier ; `fill` remplit les marques `{revision}` et `{slots}` du message. */
function wholeChange(code: ProposalErrorCode, fill: Record<string, string> = {}): ProposalError {
  const message = Object.entries(fill).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    PROPOSAL_ERROR_MESSAGES[code],
  );
  return { op: -1, code, message };
}

/**
 * Limite des corrections (§12.2) : après `maxPatchCorrections` corrections échouées, soit un appel invalide de plus
 * (schéma ou validateur, un seul compteur, P10), tout appel rend `corrections_exhausted`. `runTool` la lit avant même
 * le schéma ; null tant qu'elle n'est pas atteinte.
 */
export function correctionsExhausted(ctx: ToolContext): ToolOutcome | null {
  return ctx.state.invalidProposals > ctx.deps.coachConfig.limits.maxPatchCorrections
    ? failure([wholeChange('corrections_exhausted')])
    : null;
}

/** Refus du gestionnaire : compté dans `invalidProposals`, comme un refus du schéma. */
function refuse(ctx: ToolContext, errors: ProposalError[]): ToolOutcome {
  ctx.state.invalidProposals += 1;
  return failure(errors);
}

/** Références de slot du modèle retraduites en identifiants réels ; une référence inconnue reste telle quelle. */
const resolved = (operations: readonly InstanceChangeOperation[], aliases: ReadonlyMap<string, string>) =>
  operations.map(
    (op): InstanceChangeOperation =>
      'slot' in op ? { ...op, slot: resolveSlotAlias(op.slot, aliases) } : op,
  );

/**
 * Références du dossier des slots `slotIds`, pour un message au modèle : l'alias d'un slot ajouté (`aliases` : alias
 * → identifiant réel), l'identifiant d'un slot du modèle (`modelSlots`). Un slot qui n'a ni l'un ni l'autre n'est pas
 * nommé : jamais d'identifiant réel dans un résultat d'outil.
 */
export function slotRefs(
  slotIds: readonly string[],
  aliases: ReadonlyMap<string, string>,
  modelSlots: ReadonlySet<string>,
): string[] {
  const sent = new Map([...aliases].map(([alias, slotId]) => [slotId, alias]));
  return slotIds.flatMap((id) => {
    const ref = sent.get(id) ?? (modelSlots.has(id) ? id : undefined);
    return ref === undefined ? [] : [ref];
  });
}

/**
 * Référence d'une proposition rendue au modèle, `P-<n>` : n = 1 + propositions déjà écrites par le fil + propositions
 * de la tentative. L'identifiant de la ligne à écrire (`PendingProposal.id`) n'entre jamais dans le fil.
 */
async function proposalRef(ctx: ToolContext): Promise<string> {
  const written = await ctx.db
    .selectFrom('instanceChange')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('ownerId', '=', ctx.userId)
    .where('coachThreadId', '=', ctx.thread.id)
    .executeTakeFirstOrThrow();
  return `P-${1 + Number(written.count) + ctx.state.proposals.length}`;
}

export const proposeProgramChange = defineTool({
  name: 'propose_program_change',
  description: DESCRIPTION,
  input: ProposeProgramChangeInput,
  async run(input, ctx) {
    // Étape 2 : une seule proposition réussie par message (C4).
    if (ctx.state.proposals.length >= ctx.deps.coachConfig.limits.maxProposalsPerMessage) {
      return refuse(ctx, [wholeChange('one_proposal_per_message')]);
    }
    // Étape 3 : instance active.
    const instance = await activeInstance(ctx.db, ctx.userId);
    if (instance === undefined) return refuse(ctx, [wholeChange('no_active_program')]);
    // Étape 4 : révision courante.
    if (input.base_revision !== instance.revision) {
      return refuse(ctx, [wholeChange('stale_revision', { revision: String(instance.revision) })]);
    }
    // Étape 5 : validateur, auteur coach, sur les identifiants réels (table figée du fil étendue au programme).
    const program = await instanceProgram(ctx.db, instance);
    const aliases = extendSlotAliases(program, await frozenSlotAliases(ctx.db, ctx.userId, ctx.thread.id));
    const operations = resolved(input.operations, aliases);
    const change = {
      id: ctx.deps.ids.uuidv7(),
      author: 'coach' as const,
      baseRevision: instance.revision,
      operations,
    };
    const catalog = await currentCatalog(ctx.deps, ctx.db);
    const validation = validateChange(
      await changeValidationInput(ctx.db, instance, program, change, catalog, ctx.now),
    );
    if (!validation.ok) {
      return refuse(
        ctx,
        validation.errors.map((e) => ({ op: e.op, code: e.code, message: PROPOSAL_ERROR_MESSAGES[e.code] })),
      );
    }
    // Étape 6 : aucune charge prévue ne monte, dans aucun lieu vivant, suspensions levées (C6). Sans rejeu
    // possible, la garde ne peut pas conclure : refus compté, sans faire échouer l'échange.
    const check = await checkCoachLoad(ctx.db, ctx.deps, ctx.userId, change, ctx.now);
    if (!check.verifiable) return refuse(ctx, [wholeChange('load_unverifiable')]);
    if (check.increases.length > 0) {
      const model = new Set(
        parseSnapshot(instance.snapshot)?.workouts.flatMap((w) => w.slots.map((s) => s.id)),
      );
      const refs = slotRefs(check.increases, aliases, model);
      const slots = refs.length === 0 ? '' : ` (${refs.join(', ')})`;
      return refuse(ctx, [wholeChange('coach_load_increase', { slots })]);
    }
    // Étape 7 : le motif, de plusieurs phrases s'il le faut, passe le filtre du flux (pause de sécurité comprise, R15).
    const verdict = outputFilterText(input.reason, {
      audience: ctx.thread.audience,
      nutritionMode: nutritionFilterOf(
        ctx.thread.audience,
        await storedThreadNutritionMode(ctx.db, ctx.userId, ctx.thread.id),
      ).nutritionMode,
      allowed: ctx.allowed,
      safetyPause: await safetyPauseOf(ctx.db, ctx.userId),
    });
    if (!verdict.ok) return refuse(ctx, [wholeChange('reason_blocked')]);

    const ref = await proposalRef(ctx);
    ctx.state.proposals.push({
      id: change.id,
      instanceId: instance.id,
      baseRevision: instance.revision,
      operations,
      reason: input.reason,
      model: null,
      expiresAt: null,
    });
    return {
      isError: false,
      result: { ok: true, change_id: ref, expires_in_days: currentRules().proposalValidDays },
    };
  },
});
