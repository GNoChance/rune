import { readFileSync } from 'node:fs';
import { createFakeAiClient, type FakeChatTurn, fakeText, fakeToolUse } from '../../../server/src/ai';
import { main, startServer } from '../../../server/src/main';
import { STARTUP_TASKS, type StartupTask } from '../../../server/src/startup';

/*
 * Point d'entrée de test du serveur pour les E2E du coach (spec brique 4 §19.5) : le `main` de `src/main.ts` avec le
 * faux client IA à la place du vrai. Seul ce fichier l'injecte ; il n'est dans aucun bundle (`dist/server.mjs`), et
 * `E2E_COACH_SCRIPT` n'existe que pour lui. Le coach est activé avant l'écoute (sans cela, `coach_state.enabled = 0`
 * rend `coach_unavailable`) ; la combinaison n'étant pas évaluée, l'environnement pose `COACH_DEV_ALLOW_UNEVALUATED=1`
 * (origine `http://localhost`) : le mode dev est actif.
 */

/** Un tour du scénario, joué à l'appel de même rang ; `delayMs` retient la fin du tour (les phrases arrivent une à une). */
type CoachScriptTurn =
  | { kind: 'text'; text: string; delayMs?: number }
  | { kind: 'tool_use'; id: string; name: string; input: unknown };

function readScript(path: string | undefined): readonly CoachScriptTurn[] {
  if (path === undefined || path === '') throw new Error('E2E_COACH_SCRIPT : chemin du scénario absent');
  const turns: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(turns)) throw new Error('E2E_COACH_SCRIPT : un tableau de tours est attendu');
  return turns as CoachScriptTurn[];
}

function toTurn(turn: CoachScriptTurn): FakeChatTurn {
  if (turn.kind === 'tool_use') return fakeToolUse(turn.id, turn.name, turn.input);
  const delay = turn.delayMs;
  return fakeText(
    turn.text,
    delay === undefined ? {} : { gate: new Promise<void>((resolve) => setTimeout(resolve, delay)) },
  );
}

/** Pose `coach_state.enabled = 1` : l'admin n'a pas à allumer l'interrupteur avant le parcours. */
const ENABLE_COACH: StartupTask = {
  name: 'e2e-coach-enabled',
  async run(deps) {
    await deps.db
      .updateTable('coachState')
      .set({ enabled: 1, updatedAt: deps.clock.now().toISOString() })
      .where('id', '=', 1)
      .execute();
  },
};

const script = readScript(process.env.E2E_COACH_SCRIPT);

main([], (env) =>
  startServer(env, {
    ai: createFakeAiClient([], {
      model: env.COACH_MODEL || 'claude-opus-5-5',
      // Le tour est choisi à l'appel : le gate d'un tour ne démarre qu'à son rang.
      chat: (_req, call) => {
        const turn = script[call];
        if (turn === undefined)
          throw new Error(`Scénario du coach épuisé : aucun tour pour l'appel ${call + 1}.`);
        return toTurn(turn);
      },
    }),
    thinkingBinding: 'error',
    startupTasks: [...STARTUP_TASKS, ENABLE_COACH],
  }),
).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
