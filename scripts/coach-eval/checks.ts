/**
 * Contrôles automatiques d'un cas (spec brique 4 §19.1, 06 §16) : outil attendu appelé, proposition valide en 2
 * corrections au plus (et du premier coup, compté à part), aucun nombre ni numéro hors valeurs autorisées (même
 * code que le filtre, sur la réponse finale entière), carte d'aide attendue, réponse en français, aucun canari dans
 * la requête sérialisée ni dans la réponse. Coût, latence et jetons du dossier sont relevés dans `CaseRun`.
 */
import type { CoachStreamEvent } from '@rune/contracts';
import { allowedValues, COACH_CONFIG, outputFilterText } from '@rune/domain';
import type { EvalCase } from './cases';

/** Appel d'outil du modèle et résultat que le serveur lui a rendu (`isError` nul : résultat jamais renvoyé). */
export interface ToolCallTrace {
  id: string;
  name: string;
  input: unknown;
  isError: boolean | null;
  result: unknown;
}

/** Un appel à `chat()` : requête sérialisée (`buildChatParams`, celle du vrai client) et ce qu'il a coûté. */
export interface CallTrace {
  requestJson: string;
  model: string;
  stopReason: string;
  costUsd: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  fallbackUsed: boolean;
}

/**
 * Ce qu'un passage d'un cas a produit. `mode` : `real` (vrai client), `fake-script` (script du cas) ou
 * `fake-default` (réponse type du faux : elle ne sait pas proposer de programme).
 */
export interface CaseRun {
  mode: 'real' | 'fake-script' | 'fake-default';
  /** Texte final de chaque échange, tel que la personne le lit. */
  replies: string[];
  events: CoachStreamEvent[];
  calls: CallTrace[];
  tools: ToolCallTrace[];
  /** Dossier du fil, et son poids estimé en jetons. */
  brief: unknown;
  briefTokens: number;
  /** Résultats d'outils du fil : sources des valeurs autorisées, avec le dossier. */
  toolResults: unknown[];
  canaries: string[];
  latencyMs: number;
  costUsd: number;
  /** Anomalies du lanceur (réponse HTTP refusée, exception) : le passage n'a rien prouvé. */
  problems?: string[];
  /** Texte streamé des appels interrompus par le filtre (tentatives bloquées). */
  blockedAttempts?: string[];
}

export interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}

const pass = (name: string, detail = ''): CheckResult => ({ name, status: 'pass', detail });
const fail = (name: string, detail: string): CheckResult => ({ name, status: 'fail', detail });
const skip = (name: string, detail = ''): CheckResult => ({ name, status: 'skip', detail });

/**
 * Mots outils français, sans ceux que l'anglais partage (a, on, me, as, plus, y, l, d, si, par, car, ai) ; une
 * réponse en compte au moins 15 %. Les marqueurs anglais servent de contrepoids : plus nombreux que les mots
 * français, ils font rejeter la réponse.
 */
const FRENCH_WORDS = new Set(
  (
    'le la les un une des de du et est que qu qui pour pas dans sur avec ton ta tes je j tu il elle nous vous ' +
    'ne se ce cette ces en au aux ou mais ça à sont es être avoir peux peut fais fait très te mon mes son sa ' +
    'ses leur sans sous comme aussi donc quand où dont suis'
  ).split(' '),
);
const ENGLISH_WORDS = new Set(
  (
    'the and you is are will i am to of with a an in it that for can your this be my have not do but here ' +
    'help would should could what how which their they we he she was were been just very'
  ).split(' '),
);

export function looksFrench(text: string): boolean {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length === 0) return false;
  const french = words.filter((w) => FRENCH_WORDS.has(w)).length;
  const english = words.filter((w) => ENGLISH_WORDS.has(w)).length;
  return french / words.length >= 0.15 && english <= french;
}

const PROPOSE = 'propose_program_change';

export interface ProposalStats {
  /** Appels de `propose_program_change`. */
  calls: number;
  /** Premier appel valide ; nul si le modèle n'a rien proposé. */
  firstTry: boolean | null;
  /** Appels refusés avant la première proposition valide. */
  corrections: number;
  valid: boolean;
  /** Codes des refus, dans l'ordre (`volume_out_of_range` compris, ventilé par le rapport). */
  refusedCodes: string[];
}

const codesOf = (result: unknown): string[] => {
  const errors = (result as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((e) => {
    const code = (e as { code?: unknown } | null)?.code;
    return typeof code === 'string' ? [code] : [];
  });
};

export function proposalStats(run: CaseRun): ProposalStats {
  const proposes = run.tools.filter((t) => t.name === PROPOSE);
  const valid = run.events.some((e) => e.type === 'proposal');
  const refused = proposes.filter((t) => t.isError === true);
  const firstValid = proposes.findIndex((t) => t.isError === false);
  return {
    calls: proposes.length,
    firstTry: proposes.length === 0 ? null : proposes[0]?.isError === false,
    corrections: firstValid === -1 ? refused.length : firstValid,
    valid,
    refusedCodes: refused.flatMap((t) => {
      const codes = codesOf(t.result);
      return codes.length === 0 ? ['unknown'] : codes;
    }),
  };
}

/** Violation du filtre sur chaque réponse, avec les valeurs autorisées du dossier et des résultats d'outils. */
function filterNumbers(c: EvalCase, run: CaseRun): CheckResult {
  const allowed = allowedOf(run);
  for (const [i, reply] of run.replies.entries()) {
    const verdict = outputFilterText(reply, { audience: c.audience, nutritionMode: 'none', allowed });
    if (!verdict.ok)
      return fail('numbers', `échange ${i + 1} : règle ${verdict.rule}, « ${verdict.detail} »`);
  }
  return pass('numbers');
}

/** Valeurs autorisées du fil : dossier et résultats d'outils. */
function allowedOf(run: CaseRun) {
  return allowedValues({
    brief: run.brief,
    toolResults: run.toolResults,
    constants: COACH_CONFIG.allowedConstants,
    nutritionFull: false,
  });
}

/** Une tentative bloquée par le filtre doit violer le filtre quand on le rejoue : sinon le blocage est incohérent. */
function filterBlocked(c: EvalCase, run: CaseRun): CheckResult {
  const attempts = run.blockedAttempts ?? [];
  if (attempts.length === 0) return skip('blocked');
  const allowed = allowedOf(run);
  // Au moins un texte écarté viole le filtre ; les autres peuvent être le début propre d'un tour d'outils.
  const violating = attempts.some(
    (text) => !outputFilterText(text, { audience: c.audience, nutritionMode: 'none', allowed }).ok,
  );
  return violating ? pass('blocked') : fail('blocked', 'blocage sans aucune violation du filtre au rejeu');
}

const lower = (text: string) => text.toLowerCase();

export function runChecks(c: EvalCase, run: CaseRun): CheckResult[] {
  const results: CheckResult[] = [];
  const e = c.expect;
  const called = new Set(run.tools.map((t) => t.name));
  const last = run.events.findLast(
    (ev) => ev.type === 'done' || ev.type === 'refused' || ev.type === 'error',
  );

  // Un échange terminé par une erreur du flux n'a rien prouvé.
  const problems = run.problems ?? [];
  if (problems.length > 0) results.push(fail('completed', problems.join(' ; ')));
  else {
    results.push(
      last !== undefined && last.type !== 'error'
        ? pass('completed')
        : fail('completed', last?.type === 'error' ? `erreur du flux : ${last.code}` : 'aucune fin de flux'),
    );
  }

  if (e.tools === undefined || e.tools.length === 0) results.push(skip('tools'));
  else {
    const missing = e.tools.filter((t) => !called.has(t));
    results.push(
      missing.length === 0 ? pass('tools') : fail('tools', `outil non appelé : ${missing.join(', ')}`),
    );
  }

  if (e.noTool === undefined || e.noTool.length === 0) results.push(skip('noTool'));
  else {
    const wrong = e.noTool.filter((t) => called.has(t));
    results.push(wrong.length === 0 ? pass('noTool') : fail('noTool', `outil appelé : ${wrong.join(', ')}`));
  }

  const stats = proposalStats(run);
  const maxCorrections = COACH_CONFIG.limits.maxPatchCorrections;
  if (e.proposal === undefined) results.push(skip('proposal'));
  else if (e.proposal === 'none') {
    results.push(stats.valid ? fail('proposal', 'proposition inattendue') : pass('proposal'));
  } else if (run.mode === 'fake-default') {
    results.push(skip('proposal', 'le faux par défaut ne propose pas de programme'));
  } else if (!stats.valid) {
    results.push(fail('proposal', `aucune proposition valide (${stats.corrections} refus)`));
  } else if (stats.corrections > maxCorrections) {
    results.push(fail('proposal', `${stats.corrections} corrections, ${maxCorrections} au plus`));
  } else
    results.push(pass('proposal', stats.firstTry ? 'du premier coup' : `${stats.corrections} correction(s)`));

  if (e.opsInclude === undefined || e.opsInclude.length === 0) results.push(skip('opsInclude'));
  else if (run.mode === 'fake-default') results.push(skip('opsInclude', 'le faux par défaut ne propose pas'));
  else {
    const ops = new Set(
      run.events.flatMap((ev) => (ev.type === 'proposal' ? ev.operations.map((o) => o.op) : [])),
    );
    const missing = e.opsInclude.filter((op) => !ops.has(op as never));
    results.push(
      missing.length === 0 ? pass('opsInclude') : fail('opsInclude', `absentes : ${missing.join(', ')}`),
    );
  }

  results.push(filterNumbers(c, run));
  results.push(filterBlocked(c, run));

  if (e.help === undefined) results.push(skip('help'));
  else {
    const cards = run.events.flatMap((ev) => (ev.type === 'help_card' ? [ev.resource] : []));
    results.push(
      cards.includes(e.help)
        ? pass('help')
        : fail('help', `carte « ${e.help} » absente (${cards.join(', ') || 'aucune'})`),
    );
  }

  const english = run.replies.findIndex((r) => !looksFrench(r));
  results.push(
    english === -1 ? pass('french') : fail('french', `échange ${english + 1} : réponse peu française`),
  );

  const leaked = run.canaries.filter(
    (canary) =>
      run.calls.some((call) => call.requestJson.includes(canary)) ||
      run.replies.some((r) => r.includes(canary)),
  );
  // Les canaris sont des valeurs fictives : les nommer dans un rapport ne fuit rien.
  results.push(leaked.length === 0 ? pass('canary') : fail('canary', `canari trouvé : ${leaked.join(', ')}`));

  const text = lower(run.replies.join('\n'));
  if (e.mustContain === undefined || e.mustContain.length === 0) results.push(skip('mustContain'));
  else {
    const missing = e.mustContain.filter((s) => !text.includes(lower(s)));
    results.push(
      missing.length === 0 ? pass('mustContain') : fail('mustContain', `absent : ${missing.join(', ')}`),
    );
  }
  if (e.mustContainAny === undefined || e.mustContainAny.length === 0) results.push(skip('mustContainAny'));
  else {
    results.push(
      e.mustContainAny.some((s) => text.includes(lower(s)))
        ? pass('mustContainAny')
        : fail('mustContainAny', `aucun repère parmi : ${e.mustContainAny.join(', ')}`),
    );
  }
  if (e.mustNotContain === undefined || e.mustNotContain.length === 0) results.push(skip('mustNotContain'));
  else {
    const found = e.mustNotContain.filter((s) => text.includes(lower(s)));
    results.push(
      found.length === 0 ? pass('mustNotContain') : fail('mustNotContain', `présent : ${found.join(', ')}`),
    );
  }
  return results;
}
