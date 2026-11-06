import {
  composeGuidedMessage,
  GuidedInvalidError,
  type GuidedRequest,
  guidedExerciseChoices,
} from '@rune/contracts';
import { parisDate, replayInstance, UnknownRulesVersionError } from '@rune/domain';
import { traitsOn } from '../auth/me';
import { currentCatalog } from '../catalog/bundle';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { loadReplayInput } from './brief-input';

/*
 * Message d'un parcours guidé (spec brique 4.1 §4.2) : le texte est recomposé par le serveur à partir des identifiants
 * (la table de `contracts`), avec les noms du catalogue servi ; le texte du client est ignoré. Un identifiant inconnu,
 * un nombre de choix faux, un parcours que le public n'a pas ou un exercice qui n'est pas au programme courant donnent
 * 400 `validation`. Le résultat est un message de la personne comme un autre : mêmes gardes, limite et filtre.
 */

/** Identifiants des fiches du programme courant (liste de chaque slot, ou sa chaîne) ; vide sans programme rejouable. */
async function programExerciseIds(deps: AppDeps, userId: string): Promise<Set<string>> {
  const input = await loadReplayInput(deps.db, deps, userId);
  if (input === null) return new Set();
  try {
    const { program } = replayInstance(input);
    return new Set(
      program.template.workouts.flatMap((w) =>
        w.slots.flatMap((s) => (s.chain === undefined ? (s.exercises ?? []) : [s.chain])),
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
  const { audience } = await traitsOn(deps.db, userId, parisDate(now));
  try {
    const exerciseIds = guidedExerciseChoices(guided.flow, guided.choices, audience);
    const inProgram = exerciseIds.length === 0 ? null : await programExerciseIds(deps, userId);
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
