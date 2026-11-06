import { COACH_IDS, type CoachId, FORBIDDEN_TERMS } from '@rune/contracts';
import { type FilterContext, normalizeForTerms, outputFilterText } from '@rune/domain';
import { describe, expect, it } from 'vitest';
import { COACHES, coachLine, coachText } from '../../src/features/coach/coach-lines';

// Moment `session_end` (spec brique 3 §7.4) : la bulle de la fin de séance, trois textes écrits à l'avance par coach
// (spec refonte §8), relus par le propriétaire. Ce ne sont pas des réponses d'IA.

/** Textes de la tâche 20, mot pour mot, avant remplacement de {pseudo}. */
const SESSION_END: Record<CoachId, readonly string[]> = {
  ombre: [
    'Travail noté. Récupère : la suite se gagne.',
    'Une séance de plus. Le rang suit la régularité.',
    "Discipline prouvée aujourd'hui. Recommence à la prochaine séance.",
  ],
  skald: [
    'Un chapitre de plus dans ta saga, {pseudo}. Repose-toi : le récit continue.',
    'Belle séance, {pseudo}. Chaque série notée ajoute une ligne à ta saga.',
    'Le chapitre du jour est écrit. Les grandes sagas se bâtissent séance après séance.',
  ],
  scribe: [
    'Séance consignée. Ton bilan est à jour.',
    'Tout est noté. La récupération fait aussi partie du plan.',
    'Bilan enregistré. La régularité compte plus que tout le reste.',
  ],
};

describe('moment session_end (coach-lines)', () => {
  it('trois textes par coach, mot pour mot', () => {
    for (const id of COACH_IDS) expect(COACHES[id].sessionEnd).toEqual(SESSION_END[id]);
  });

  it('coachLine : jour civil de Paris modulo 3, {pseudo} remplacé', () => {
    // 2026-10-16 à Paris : jour 20742 depuis le 1970-01-01, 20742 % 3 = 0.
    const day16 = new Date('2026-10-16T10:00:00Z');
    expect(coachLine('skald', 'session_end', day16, 'lea')).toBe(
      'Un chapitre de plus dans ta saga, lea. Repose-toi : le récit continue.',
    );
    expect(coachLine('skald', 'session_end', new Date('2026-10-17T10:00:00Z'), 'lea')).toBe(
      'Belle séance, lea. Chaque série notée ajoute une ligne à ta saga.',
    );
    expect(coachLine('scribe', 'session_end', new Date('2026-10-18T10:00:00Z'), 'lea')).toBe(
      'Bilan enregistré. La régularité compte plus que tout le reste.',
    );
    // 2026-10-16 22:30 UTC = 00:30 à Paris, le 17 : jamais le jour UTC.
    expect(coachLine('ombre', 'session_end', new Date('2026-10-16T22:30:00Z'), 'lea')).toBe(
      'Une séance de plus. Le rang suit la régularité.',
    );
  });

  it('la ligne du jour ne change pas : session_end lit ses propres textes', () => {
    const day16 = new Date('2026-10-16T10:00:00Z');
    expect(coachLine('ombre', 'daily', day16, 'lea', 3)).toBe(COACHES.ombre.daily[0]);
    expect(coachLine('ombre', 'session_end', day16, 'lea')).toBe(SESSION_END.ombre[0]);
  });

  it('garde-fous (refonte §8) : aucun chiffre de charge ni de quoi pousser à forcer, rien de prescriptif', () => {
    const days = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(2026, 9, 16 + i, 10)));
    const lines = COACH_IDS.flatMap((id) => days.map((d) => coachLine(id, 'session_end', d, 'lea')));
    expect(new Set(lines).size).toBe(9);
    for (const line of lines) {
      // Aucun chiffre du tout : ni charge, ni XP, ni record.
      expect(line).not.toMatch(/\d/);
      expect(line).not.toMatch(/\b(?:kg|kilos?|grammes?|kcal)\b|%/i);
      // La gamification ne récompense ni la charge, ni l'échec, ni un record (D8), ni la douleur.
      expect(line).not.toMatch(/record|charge|lourd|échec|douleur|forcer|prescri/i);
      expect(line).not.toMatch(/[{}]/);
      expect(line).not.toMatch(/[’‘]/);
    }
  });
});

// Présentation de chaque coach (« Message d'accueil ») : le coach IA existe, l'intro n'annonce plus qu'il viendra.
const INTROS: Record<CoachId, string> = {
  ombre:
    "Je suis L'Ombre. Je fixe tes quêtes, tu les accomplis. Active le coach IA dans Mon coach : je répondrai à tes questions, sans détour.",
  skald:
    "Je suis le Skald. Je raconterai ta saga, séance après séance, et je t'expliquerai chaque étape. Active le coach IA dans Mon coach : nous pourrons parler de ton programme.",
  scribe:
    'Je suis le Scribe. Je prépare un plan clair et je note chaque série pour faire le point avec toi. Active le coach IA dans Mon coach : je répondrai à tes questions.',
};

describe('intros des coachs (tâche 27)', () => {
  it('trois textes, mot pour mot', () => {
    for (const id of COACH_IDS) expect(COACHES[id].intro).toBe(INTROS[id]);
  });

  it("n'annoncent plus une conversation à venir et n'ont aucun chiffre", () => {
    for (const id of COACH_IDS) {
      const intro = coachText(id, 'intro', 'lea');
      expect(intro).not.toMatch(/plus tard|viendr|d'ici là|pour l'instant/i);
      expect(intro).not.toMatch(/[0-9]/);
      expect(intro).not.toMatch(/[{}]/);
      expect(intro).not.toMatch(/[’‘]/);
    }
  });

  it('passent le filtre de sortie (adulte et mineur) et les termes interdits', () => {
    for (const id of COACH_IDS) {
      const text = COACHES[id].intro;
      for (const audience of ['adult', 'minor'] as const) {
        const ctx: FilterContext = {
          audience,
          nutritionMode: 'none',
          allowed: { mass: new Set(), percent: new Set(), nutrition: new Set(), volume: new Set() },
        };
        expect(outputFilterText(text, ctx), `${audience} : ${text}`).toEqual({ ok: true });
      }
      const haystack = ` ${normalizeForTerms(text)} `;
      for (const t of [...FORBIDDEN_TERMS.all, ...FORBIDDEN_TERMS.minor]) {
        for (const form of [t.term, ...t.forms]) {
          expect(haystack, `terme « ${form} » dans « ${text} »`).not.toContain(
            ` ${normalizeForTerms(form)} `,
          );
        }
      }
    }
  });
});
