import { describe, expect, it } from 'vitest';
import { HealthScreeningRequest, LimitationInput, LimitationPatch } from '../src/api/consent';
import {
  AI_COACH_CONSENT_TEXT,
  CURRENT_CONSENT_TEXTS,
  HEALTH_CONSENT_TEXT,
  HEALTH_QUESTIONNAIRE,
} from '../src/texts';

describe('HealthScreeningRequest', () => {
  it('attend exactement une réponse par question de HEALTH_QUESTIONNAIRE', () => {
    const n = HEALTH_QUESTIONNAIRE.questions.length;
    const answers = (k: number) => Array.from({ length: k }, () => false);
    const parse = (k: number) =>
      HealthScreeningRequest.safeParse({ answers: answers(k), questionnaireVersion: '1.0' }).success;
    expect(parse(n)).toBe(true);
    expect(parse(n - 1)).toBe(false);
    expect(parse(n + 1)).toBe(false);
  });
});

describe('note de limitation', () => {
  it('une note vide ou faite d’espaces devient null', () => {
    const base = { bodyArea: 'knee', side: 'left', severity: 'mild' } as const;
    expect(LimitationInput.parse({ ...base, note: '   ' }).note).toBeNull();
    expect(LimitationInput.parse({ ...base, note: '' }).note).toBeNull();
    expect(LimitationInput.parse({ ...base, note: '  gêne  ' }).note).toBe('gêne');
    expect(LimitationPatch.parse({ note: ' \t ' }).note).toBeNull();
  });
});

describe('accord ai_coach (spec brique 4 §14.1)', () => {
  it('texte v1.0, mot pour mot', () => {
    expect(AI_COACH_CONSENT_TEXT).toEqual({
      version: '1.0',
      text: "J'accepte que mes messages au coach IA et les informations utiles soient envoyés à Anthropic, la société qui fournit l'IA Claude : ma tranche d'âge, mon objectif, mon niveau, mon matériel, mon programme, mon historique des 4 dernières semaines, mes records et, seulement si j'ai donné l'accord santé, mes limitations et mes douleurs signalées. Mon pseudo, ma date de naissance et le nom de ma salle ne sont jamais envoyés. Le traitement a lieu aux États-Unis (région « global » d'Anthropic), encadré par des clauses contractuelles types via Anthropic Ireland. Anthropic n'entraîne pas ses modèles sur ces données et les efface sous 30 jours, sauf si ses filtres de sécurité signalent un échange : il peut alors le garder jusqu'à 2 ans. Rune garde mes conversations 90 jours après le dernier message, et je peux les supprimer à tout moment. L'administrateur a un accès technique au serveur, mais il ne lit pas mes conversations dans l'appli, sauf un échange que je signale moi-même. Je peux retirer cet accord à tout moment : mes conversations seront supprimées de Rune, mais pas ce qu'Anthropic a déjà reçu.",
    });
  });

  it('texte en vigueur de chaque accord', () => {
    expect(CURRENT_CONSENT_TEXTS).toEqual({ health: HEALTH_CONSENT_TEXT, ai_coach: AI_COACH_CONSENT_TEXT });
  });
});
