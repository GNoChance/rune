import { COACH_STREAM_ERROR_CODES, FORBIDDEN_TERMS, HELP_PHONE_DIGITS } from '@rune/contracts';
import { type AllowedValues, type FilterContext, normalizeForTerms, outputFilterText } from '@rune/domain';
import { describe, expect, it } from 'vitest';
import {
  AI_BANNER,
  budgetText,
  counterText,
  DEV_BANNER,
  ERROR_TEXTS,
  PROGRAM_PREFILL,
  remainingText,
  STATE_TEXTS,
  SUGGESTIONS,
  TOOL_LABELS,
  WELCOME,
} from '../../src/features/coach/coach-texts';

const allowed = (percent: string[] = []): AllowedValues => ({
  mass: new Set(),
  percent: new Set(percent),
  nutrition: new Set(),
});

const contexts = (percent: string[] = []): FilterContext[] =>
  (['adult', 'minor'] as const).map((audience) => ({
    audience,
    nutritionMode: 'none',
    allowed: allowed(percent),
  }));

/** Chaque texte de l'appli, avec les valeurs qu'il cite déclarées autorisées. */
const TEXTS: [string, string, string[]][] = [
  ['AI_BANNER', AI_BANNER, []],
  ['WELCOME', WELCOME, []],
  ['PROGRAM_PREFILL', PROGRAM_PREFILL, []],
  ['DEV_BANNER', DEV_BANNER, []],
  ...SUGGESTIONS.map((t, i): [string, string, string[]] => [`SUGGESTIONS[${i}]`, t, []]),
  ...Object.entries(STATE_TEXTS).map(([k, t]): [string, string, string[]] => [`STATE_TEXTS.${k}`, t, []]),
  ...Object.entries(TOOL_LABELS).map(([k, t]): [string, string, string[]] => [`TOOL_LABELS.${k}`, t, []]),
  ['budgetText(80)', budgetText(80), ['80']],
  ['budgetText(100)', budgetText(100), ['100']],
  ['remainingText(1)', remainingText(1), []],
  ['remainingText(5)', remainingText(5), []],
  ['counterText(1950)', counterText(1950), []],
];

describe('coach-texts', () => {
  it('AI_BANNER : le texte de 06 §14, mot pour mot', () => {
    expect(AI_BANNER).toBe(
      "Tu échanges avec une intelligence artificielle (Claude, d'Anthropic), pas avec un humain. Ses conseils sont généraux et ne remplacent pas un professionnel de santé. En cas d'urgence : 15 ou 112.",
    );
  });

  it('les numéros du bandeau sont ceux que le filtre admet (HELP_RESOURCES)', () => {
    expect(HELP_PHONE_DIGITS).toEqual(expect.arrayContaining(['15', '112']));
  });

  it('textes fixes et formats', () => {
    expect(WELCOME).toBe('Pose-moi une question sur ton programme, ta technique ou ta récupération.');
    expect(SUGGESTIONS).toEqual([
      'Explique ma prochaine séance',
      'Pourquoi ma charge ne monte pas ?',
      'Ajuster mon programme',
    ]);
    expect(PROGRAM_PREFILL).toBe('Je voudrais ajuster mon programme : ');
    expect(DEV_BANNER).toBe('Mode dev : combinaison non évaluée');
    expect(TOOL_LABELS).toEqual({
      read_training: 'Le coach consulte ton historique…',
      search_exercises: 'Le coach cherche des exercices…',
      propose_program_change: 'Le coach prépare une proposition…',
      refer_to_help: "Le coach prépare une carte d'aide…",
    });
    expect(counterText(1950)).toBe('1 950 / 2 000');
    expect(remainingText(5)).toBe("Il te reste 5 messages aujourd'hui");
    expect(remainingText(1)).toBe("Il te reste 1 message aujourd'hui");
    expect(budgetText(80)).toBe('Tu as utilisé 80 % de ton budget du mois');
  });

  it('STATE_TEXTS : le tableau de la spec §16.2, mot pour mot', () => {
    expect(STATE_TEXTS).toEqual({
      consentMissing: 'Le coach IA a besoin de ton accord.',
      consentActivate: 'Activer le coach',
      consentChanged: "Le texte de l'accord a changé.",
      paused: 'Le coach est en pause pour le cercle.',
      suspended: "Le coach est en pause pour tout le cercle jusqu'au 1er du mois.",
      dailyLimit: "Tu as envoyé 30 messages aujourd'hui. Le coach revient demain.",
      monthlyBudget: 'Tu as atteint la limite du mois pour le coach. Il revient le 1er.',
      threadClosed: 'Ta conversation du jour est close. Reviens demain.',
      previousThreads: 'Conversations précédentes',
      inProgress: 'Le coach termine une réponse…',
      offline: 'Hors ligne : le coach a besoin du réseau.',
      offlineEmpty: 'Connecte-toi pour parler au coach.',
      unavailable: 'Coach indisponible, réessaie plus tard.',
      retry: 'Réessayer',
      refusal: 'Le coach ne peut pas répondre à cette demande.',
    });
  });

  it('ERROR_TEXTS couvre chaque code du flux, thread_closed compris', () => {
    expect(Object.keys(ERROR_TEXTS).sort()).toEqual([...COACH_STREAM_ERROR_CODES].sort());
    expect(ERROR_TEXTS.thread_closed).toBe(STATE_TEXTS.threadClosed);
    for (const text of Object.values(ERROR_TEXTS)) expect(Object.values(STATE_TEXTS)).toContain(text);
  });

  it.each(TEXTS)(
    '%s passe le filtre de sortie (adulte et mineur) et les termes interdits',
    (_name, text, percent) => {
      for (const ctx of contexts(percent)) {
        expect(outputFilterText(text, ctx), `${ctx.audience} : ${text}`).toEqual({ ok: true });
      }
      const haystack = ` ${normalizeForTerms(text)} `;
      for (const t of [...FORBIDDEN_TERMS.all, ...FORBIDDEN_TERMS.minor]) {
        for (const form of [t.term, ...t.forms]) {
          expect(haystack, `terme « ${form} » dans « ${text} »`).not.toContain(
            ` ${normalizeForTerms(form)} `,
          );
        }
      }
    },
  );

  it('le filtre refuse un pourcentage non déclaré (le test de budgetText a donc un sens)', () => {
    const [adult] = contexts([]);
    expect(outputFilterText(budgetText(80), adult as FilterContext).ok).toBe(false);
  });
});
