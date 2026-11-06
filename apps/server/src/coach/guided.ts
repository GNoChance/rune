import {
  type AgeBand,
  composeGuidedMessage,
  GuidedInvalidError,
  type GuidedRequest,
  guidedExerciseChoices,
} from '@rune/contracts';
import {
  currentChainExercise,
  findState,
  parisDate,
  replayInstance,
  UnknownRulesVersionError,
} from '@rune/domain';
import { traitsOn } from '../auth/me';
import { currentCatalog } from '../catalog/bundle';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { loadReplayInput } from './brief-input';
import { currentThread } from './threads';

/*
 * Message d'un parcours guidé (spec brique 4.1 §4.2) : le texte est recomposé par le serveur à partir des identifiants
 * (la table de `contracts`), avec les noms du catalogue servi ; le texte du client est ignoré. Un identifiant inconnu,
 * un nombre de choix faux, un parcours que le public n'a pas ou un exercice qui n'est pas au programme courant donnent
 * 400 `validation`. Le résultat est un message de la personne comme un autre : mêmes gardes, limite et filtre.
 */

/**
 * Identifiants des fiches du programme courant : la liste de chaque slot ; pour un slot à chaîne, l'exercice courant
 * de la chaîne (la variante que le rejeu vise, la première sans état), jamais l'identifiant de la chaîne. Vide sans
 * programme rejouable.
 */
async function programExerciseIds(deps: AppDeps, userId: string, cautious: boolean): Promise<Set<string>> {
  const input = await loadReplayInput(deps.db, deps, userId);
  if (input === null) return new Set();
  try {
    const { program, slotStates } = replayInstance(input);
    return new Set(
      program.template.workouts.flatMap((w) =>
        w.slots.flatMap((s) => {
          if (s.chain === undefined) return s.exercises ?? [];
          const step = currentChainExercise(
            input.catalog,
            s.chain,
            cautious,
            findState(slotStates, s.id, s.chain),
          );
          return step === undefined ? [] : [step.id];
        }),
      ),
    );
  } catch (error) {
    if (error instanceof UnknownRulesVersionError) return new Set();
    throw error;
  }
}

/** Texte composé de `guided` pour `userId` à l'instant `now` ; 400 `validation` s'il n'est pas valide. */
export async function composeForUser(
  deps: AppDeps,
  userId: string,
  guided: GuidedRequest,
  now: Date,
): Promise<string> {
  const today = parisDate(now);
  const traits = await traitsOn(deps.db, userId, today);
  const { cautious } = traits;
  // Le plus strict gagne : mineur si le profil ou le fil ouvert du jour le dit (même règle que l'écran).
  const thread = await currentThread(deps, userId, today);
  const audience: AgeBand =
    traits.audience === 'minor' || (thread?.isOpen === 1 && thread.audience === 'minor') ? 'minor' : 'adult';
  try {
    const exerciseIds = guidedExerciseChoices(guided.flow, guided.choices, audience);
    const inProgram = exerciseIds.length === 0 ? null : await programExerciseIds(deps, userId, cautious);
    const catalog = exerciseIds.length === 0 ? null : (await currentCatalog(deps, deps.db)).exercises;
    return composeGuidedMessage(
      guided.flow,
      guided.choices,
      (id) => (inProgram?.has(id) ? (catalog?.find((e) => e.id === id)?.name ?? null) : null),
      audience,
    );
  } catch (error) {
    if (error instanceof GuidedInvalidError) throw httpError('validation');
    throw error;
  }
}
