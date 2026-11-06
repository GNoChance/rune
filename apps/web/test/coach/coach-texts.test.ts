import {
  COACH_STREAM_ERROR_CODES,
  FORBIDDEN_TERMS,
  GUIDED_FLOWS,
  HELP_PHONE_DIGITS,
  HELP_RESOURCES,
  helpPhones,
} from '@rune/contracts';
import { type AllowedValues, type FilterContext, normalizeForTerms, outputFilterText } from '@rune/domain';
import { describe, expect, it } from 'vitest';
import {
  AI_BANNER,
  BRIEF_TEXTS,
  budgetText,
  CONSENT_TEXTS,
  callText,
  counterText,
  DEV_BANNER,
  ERROR_TEXTS,
  GUIDED_TEXTS,
  HELP_NOTES,
  HELP_OPEN,
  MY_COACH_TEXTS,
  PARENT_LINE,
  PROGRAM_PREFILL,
  REPORT_TEXTS,
  remainingText,
  STATE_TEXTS,
  THREAD_TEXTS,
  TOOL_LABELS,
  WELCOME,
} from '../../src/features/coach/coach-texts';
import {
  AI_NOTE,
  CALIBRATION_LINE,
  DECIDED_LABELS,
  loadLine,
  PREPARING,
  SEE_CONVERSATION,
} from '../../src/features/program/program-labels';
import { COACH_HELP_TEXTS } from '../../src/features/public/CoachHelpPage';
import { PRIVACY_SECTIONS } from '../../src/features/public/privacy-content';

/** Cellules du tableau « Coach et mineurs » de Confidentialité (§15). */
const MINORS_TABLE_TEXTS: string[] = PRIVACY_SECTIONS.flatMap((s) =>
  s.title === 'Coach et mineurs' && s.table ? s.table.rows.flat() : [],
);

const allowed = (percent: string[] = [], mass: string[] = []): AllowedValues => ({
  mass: new Set(mass),
  percent: new Set(percent),
  nutrition: new Set(),
  volume: new Set(),
});

const contexts = (percent: string[] = [], mass: string[] = []): FilterContext[] =>
  (['adult', 'minor'] as const).map((audience) => ({
    audience,
    nutritionMode: 'none',
    allowed: allowed(percent, mass),
  }));

/** Chaque texte de l'appli, avec les valeurs qu'il cite déclarées autorisées. */
const TEXTS: [string, string, string[], string[]?][] = [
  ['AI_BANNER', AI_BANNER, []],
  ['WELCOME', WELCOME, []],
  ['PROGRAM_PREFILL', PROGRAM_PREFILL, []],
  ['DEV_BANNER', DEV_BANNER, []],
  ...Object.entries(STATE_TEXTS).map(([k, t]): [string, string, string[]] => [`STATE_TEXTS.${k}`, t, []]),
  ...Object.entries(TOOL_LABELS).map(([k, t]): [string, string, string[]] => [`TOOL_LABELS.${k}`, t, []]),
  ['budgetText(80)', budgetText(80), ['80']],
  ['budgetText(100)', budgetText(100), ['100']],
  ['remainingText(1)', remainingText(1), []],
  ['remainingText(5)', remainingText(5), []],
  ['counterText(1950)', counterText(1950), []],
  ['PARENT_LINE', PARENT_LINE, []],
  ['HELP_OPEN', HELP_OPEN, []],
  ...Object.entries(HELP_NOTES).map(([k, t]): [string, string, string[]] => [`HELP_NOTES.${k}`, t, []]),
  ...HELP_RESOURCES.flatMap((r) =>
    helpPhones(r).map((p): [string, string, string[]] => [
      `callText(${r.id}, ${p.label})`,
      callText(p.label),
      [],
    ]),
  ),
  ...HELP_RESOURCES.map((r): [string, string, string[]] => [`HELP_RESOURCES.${r.id}.label`, r.label, []]),
  ['REPORT_TEXTS.warning', REPORT_TEXTS.warning, []],
  ['REPORT_TEXTS.thanks', REPORT_TEXTS.thanks, []],
  ['REPORT_TEXTS.tooLong', REPORT_TEXTS.tooLong, []],
  ['REPORT_TEXTS.failed', REPORT_TEXTS.failed, []],
  ['REPORT_TEXTS.title', REPORT_TEXTS.title, []],
  ['REPORT_TEXTS.categoryLegend', REPORT_TEXTS.categoryLegend, []],
  ['REPORT_TEXTS.send', REPORT_TEXTS.send, []],
  ['REPORT_TEXTS.close', REPORT_TEXTS.close, []],
  ['REPORT_TEXTS.commentLabel', REPORT_TEXTS.commentLabel, []],
  ...Object.entries(REPORT_TEXTS.categories).map(([k, t]): [string, string, string[]] => [
    `REPORT_TEXTS.categories.${k}`,
    t,
    [],
  ]),
  // Écrans de la tâche 27 : chaque texte, ceux de plusieurs phrases compris.
  ...Object.entries(CONSENT_TEXTS).map(([k, t]): [string, string, string[]] => [`CONSENT_TEXTS.${k}`, t, []]),
  ...Object.entries(MY_COACH_TEXTS).flatMap(([k, t]): [string, string, string[]][] =>
    typeof t === 'string' ? [[`MY_COACH_TEXTS.${k}`, t, []]] : [],
  ),
  ...MY_COACH_TEXTS.deactivateItems.map((t, i): [string, string, string[]] => [
    `MY_COACH_TEXTS.deactivateItems[${i}]`,
    t,
    [],
  ]),
  ...Object.entries(THREAD_TEXTS).flatMap(([k, t]): [string, string, string[]][] =>
    typeof t === 'string' ? [[`THREAD_TEXTS.${k}`, t, []]] : [],
  ),
  ['threadLabel(2025-10-28, 6)', THREAD_TEXTS.label('2025-10-28', 6, 'skald'), []],
  ['threadLabel(2025-10-27, 1)', THREAD_TEXTS.label('2025-10-27', 1, 'ombre'), []],
  ['threadLabel(2025-10-26, 2)', THREAD_TEXTS.label('2025-10-26', 2, 'scribe'), []],
  ...Object.entries(GUIDED_TEXTS).flatMap(([k, t]): [string, string, string[]][] =>
    typeof t === 'string' ? [[`GUIDED_TEXTS.${k}`, t, []]] : [],
  ),
  ...GUIDED_FLOWS.flatMap((f) => [
    [`GUIDED_FLOWS.${f.id}.${f.audience}.label`, f.label, []] as [string, string, string[]],
    ...f.steps.map((st): [string, string, string[]] => [
      `GUIDED_FLOWS.${f.id}.${st.id}.prompt`,
      st.prompt,
      [],
    ]),
    ...f.steps.flatMap((st) =>
      typeof st.chips === 'string'
        ? []
        : st.chips.map((c): [string, string, string[]] => [
            `GUIDED_FLOWS.${f.id}.${st.id}.${c.id}`,
            c.label,
            [],
          ]),
    ),
    ...f.followUps.map((u): [string, string, string[]] => [`GUIDED_FLOWS.${f.id}.${u.id}`, u.label, []]),
  ]),
  ...Object.entries(BRIEF_TEXTS).flatMap(([k, t]): [string, string, string[]][] =>
    typeof t === 'string' ? [[`BRIEF_TEXTS.${k}`, t, []]] : [],
  ),
  ...BRIEF_TEXTS.neverSent.map((t, i): [string, string, string[]] => [`BRIEF_TEXTS.neverSent[${i}]`, t, []]),
  ...COACH_HELP_TEXTS.map((t, i): [string, string, string[]] => [`COACH_HELP_TEXTS[${i}]`, t, []]),
  ...MINORS_TABLE_TEXTS.map((t, i): [string, string, string[]] => [`minors table[${i}]`, t, []]),
  ['AI_NOTE', AI_NOTE, []],
  ['SEE_CONVERSATION', SEE_CONVERSATION, []],
  ['PREPARING', PREPARING, []],
  ...Object.entries(DECIDED_LABELS).map(([k, t]): [string, string, string[]] => [
    `DECIDED_LABELS.${k}`,
    t,
    [],
  ]),
  ['CALIBRATION_LINE', CALIBRATION_LINE, []],
  [
    'loadLine(40 kg → 35 kg)',
    loadLine({ kind: 'load', loadG: 40_000 }, { kind: 'load', loadG: 35_000 }) ?? '',
    [],
    ['40', '35'],
  ],
  ['loadLine(→ 45 kg)', loadLine({ kind: 'calibration' }, { kind: 'load', loadG: 45_000 }) ?? '', [], ['45']],
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

  it('textes des parcours guidés, mot pour mot', () => {
    expect(GUIDED_TEXTS).toEqual({
      open: 'Parcours guidés',
      chosen: 'Choisi dans un parcours',
      back: 'Retour',
      cancel: 'Annuler',
      noProgram: "Choisis d'abord un programme",
    });
  });

  it('textes fixes et formats', () => {
    expect(WELCOME).toBe('Pose-moi une question sur ton programme, ta technique ou ta récupération.');
    expect(PROGRAM_PREFILL).toBe('Je voudrais ajuster mon programme : ');
    expect(DEV_BANNER).toBe('Mode dev : combinaison non évaluée');
    expect(TOOL_LABELS).toEqual({
      read_training: 'Le coach consulte ton historique…',
      search_exercises: 'Le coach cherche des exercices…',
      propose_program_change: 'Le coach prépare une proposition…',
      refer_to_help: "Le coach prépare une carte d'aide…",
      open_nutrition_screen: 'Le coach prépare un réglage nutrition…',
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

  it("textes de l'accord, de Mon coach et des conversations précédentes, mot pour mot", () => {
    expect(MY_COACH_TEXTS.deactivateItems).toEqual([
      'Tes conversations avec le coach.',
      'Tes signalements.',
      'Les propositions du coach encore en attente.',
    ]);
    expect(THREAD_TEXTS.label('2025-10-28', 6, 'skald')).toBe(
      'Conversation avec le Skald, du mar. 28 oct. · 6 messages',
    );
    expect(THREAD_TEXTS.label('2025-10-26', 2, 'scribe')).toBe(
      'Conversation avec le Scribe, du dim. 26 oct. · 2 messages',
    );
    expect(THREAD_TEXTS.label('2025-10-27', 1, 'ombre')).toBe(
      "Conversation avec l'Ombre, du lun. 27 oct. · 1 message",
    );
    expect(MY_COACH_TEXTS.nextTone).toBe(
      "Le nouveau ton s'applique dès ton prochain message. Ta conversation de ce jour restera dans Conversations précédentes.",
    );
  });

  it('ERROR_TEXTS couvre chaque code du flux, thread_closed compris', () => {
    expect(Object.keys(ERROR_TEXTS).sort()).toEqual([...COACH_STREAM_ERROR_CODES].sort());
    expect(ERROR_TEXTS.thread_closed).toBe(STATE_TEXTS.threadClosed);
    for (const text of Object.values(ERROR_TEXTS)) expect(Object.values(STATE_TEXTS)).toContain(text);
  });

  it.each(TEXTS)(
    '%s passe le filtre de sortie (adulte et mineur) et les termes interdits',
    (_name, text, percent, mass) => {
      expect(text).not.toBe('');
      for (const ctx of contexts(percent, mass)) {
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

  it('textes des cartes et de la feuille, mot pour mot', () => {
    expect(HELP_OPEN).toBe("Ouvrir l'aide");
    expect(callText('15')).toBe('Appeler le 15');
    expect(REPORT_TEXTS.categories).toEqual({
      inaccurate: 'Inexact',
      unsafe: 'Dangereux',
      inappropriate: 'Inapproprié',
      other: 'Autre',
    });
    expect(REPORT_TEXTS.warning).toBe(
      "L'admin pourra lire cet échange (ton message et la réponse) et saura qu'il vient de toi.",
    );
    expect(REPORT_TEXTS.thanks).toBe("Merci, l'admin le lira.");
    expect(AI_NOTE).toBe("Proposé par l'IA, vérifié par l'appli");
    expect(SEE_CONVERSATION).toBe('Voir la conversation');
    expect(PREPARING).toBe('en préparation');
    expect(DECIDED_LABELS).toEqual({ accepted: 'Acceptée', rejected: 'Refusée', expired: 'Expirée' });
    expect(CALIBRATION_LINE).toBe('Calibration : tu choisiras ta charge');
    expect(loadLine({ kind: 'load', loadG: 40_000 }, { kind: 'load', loadG: 35_000 })).toBe('40 kg → 35 kg');
  });

  it('loadLine : jamais de charge préremplie sans le dire, rien quand la charge ne bouge pas', () => {
    expect(loadLine({ kind: 'load', loadG: 40_000 }, { kind: 'calibration' })).toBe(CALIBRATION_LINE);
    expect(loadLine({ kind: 'calibration' }, { kind: 'calibration' })).toBe(CALIBRATION_LINE);
    expect(loadLine({ kind: 'load', loadG: 40_000 }, { kind: 'load', loadG: 40_000 })).toBeNull();
    expect(loadLine({ kind: 'load', loadG: 40_000 }, { kind: 'none' })).toBeNull();
    expect(loadLine({ kind: 'load', loadG: 40_000 }, null)).toBeNull();
    expect(loadLine(null, { kind: 'load', loadG: 45_000 })).toBe('Charge prévue : 45 kg');
    expect(loadLine({ kind: 'none' }, { kind: 'load', loadG: 45_000 })).toBe('Charge prévue : 45 kg');
  });

  it('le filtre refuse un pourcentage non déclaré (le test de budgetText a donc un sens)', () => {
    const [adult] = contexts([]);
    expect(outputFilterText(budgetText(80), adult as FilterContext).ok).toBe(false);
  });
});
