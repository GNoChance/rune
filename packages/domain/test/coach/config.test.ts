import { HELP_RESOURCES } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { COACH_CONFIG, isEvaluated, promptVariant } from '../../src/coach/config';

function isDeepFrozen(o: unknown): boolean {
  if (o === null || typeof o !== 'object') return true;
  return Object.isFrozen(o) && Object.values(o).every(isDeepFrozen);
}

describe('COACH_CONFIG', () => {
  it('valeurs de la table §5.2', () => {
    expect(COACH_CONFIG.defaultModel).toBe('claude-opus-5-5');
    expect(COACH_CONFIG.allowedModels).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
    expect(COACH_CONFIG.effort).toBe('low');
    expect(COACH_CONFIG.maxTokens).toBe(16_000);
    expect(COACH_CONFIG.limits).toEqual({
      messagesPerDay: 30,
      messageChars: 2000,
      personMonthlyBudgetUsd: 3,
      maxToolRounds: 4,
      maxPatchCorrections: 2,
      maxProposalsPerMessage: 1,
      reasonChars: 300,
      reportCommentChars: 500,
      readTrainingMaxDays: 28,
      searchLimit: 10,
      briefTargetTokens: 3000,
      briefMaxTokens: 4500,
      readTrainingMaxTokens: 4000,
      exchangeTimeoutMs: 180_000,
      callTimeoutMs: 120_000,
    });
    expect(COACH_CONFIG.promptVersion).toBe('coach-3');
    expect(COACH_CONFIG.toolsVersion).toBe('tools-2');
    expect(COACH_CONFIG.briefSchema).toBe('coach-brief/2');
    expect(COACH_CONFIG.retention).toEqual({ threadDays: 90, usageLogMonths: 12, reportDays: 90 });
    expect(COACH_CONFIG.workspaceMonthlyLimitUsd).toBe(20);
    expect(COACH_CONFIG.helpResources).toBe(HELP_RESOURCES);
  });

  it("evaluated est vide jusqu'à la campagne réelle", () => {
    expect(COACH_CONFIG.evaluated).toEqual([]);
  });

  it('allowedConstants : pourcentages fixes des règles, sans doublon', () => {
    expect(COACH_CONFIG.allowedConstants).toEqual([10, 20]);
  });

  it('gelé récursivement', () => {
    expect(isDeepFrozen(COACH_CONFIG)).toBe(true);
    expect(isDeepFrozen(COACH_CONFIG.limits)).toBe(true);
  });

  it('promptVariant', () => {
    expect(promptVariant('minor')).toBe('coach-3/minor');
    expect(promptVariant('adult')).toBe('coach-3/adult');
  });

  it('isEvaluated : combinaison exacte seulement', () => {
    const combo = {
      model: 'claude-opus-5-5',
      effort: 'low' as const,
      promptVersion: 'coach-2',
      toolsVersion: 'tools-1',
      briefSchema: 'coach-brief/1',
      catalogVersion: '7',
    };
    expect(isEvaluated(COACH_CONFIG, combo)).toBe(false);
    const cfg = { ...COACH_CONFIG, evaluated: [{ ...combo, report: 'r' }] };
    expect(isEvaluated(cfg, combo)).toBe(true);
    expect(isEvaluated(cfg, { ...combo, catalogVersion: '8' })).toBe(false);
    expect(isEvaluated(cfg, { ...combo, effort: 'medium' })).toBe(false);
    expect(isEvaluated(cfg, { ...combo, model: 'claude-sonnet-5-5' })).toBe(false);
    expect(isEvaluated(cfg, { ...combo, promptVersion: 'coach-1' })).toBe(false);
  });
});
