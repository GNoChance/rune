import { readFileSync } from 'node:fs';
import { CoachReportRequest, ProposeProgramChangeInput, ReadTrainingInput } from '@rune/contracts';
import { COACH_CONFIG } from '@rune/domain';
import { describe, expect, it } from 'vitest';

/*
 * Les bornes des schémas des contrats et celles de `COACH_CONFIG.limits` ne doivent pas diverger : le modèle, le
 * serveur et l'écran lisent la même limite (spec brique 4 §5.2, §10).
 */

const { limits } = COACH_CONFIG;
const OPERATION = { op: 'set_rest', slot: 'A1', seconds: 90 };

describe('bornes des contrats = COACH_CONFIG.limits', () => {
  it('motif d’une proposition : reasonChars', () => {
    const reason = (n: number) =>
      ProposeProgramChangeInput.safeParse({
        base_revision: 0,
        operations: [OPERATION],
        reason: 'a'.repeat(n),
      });
    expect(reason(limits.reasonChars).success).toBe(true);
    expect(reason(limits.reasonChars + 1).success).toBe(false);
  });

  it('commentaire d’un signalement : reportCommentChars', () => {
    const comment = (n: number) =>
      CoachReportRequest.safeParse({
        threadId: 't',
        messageSeq: 1,
        category: 'other',
        comment: 'a'.repeat(n),
      });
    expect(comment(limits.reportCommentChars).success).toBe(true);
    expect(comment(limits.reportCommentChars + 1).success).toBe(false);
  });

  it('since_days de read_training : readTrainingMaxDays', () => {
    const days = (n: number) => ReadTrainingInput.safeParse({ since_days: n });
    expect(days(limits.readTrainingMaxDays).success).toBe(true);
    expect(days(limits.readTrainingMaxDays + 1).success).toBe(false);
  });

  it('texte d’un message : la constante de l’écran vaut messageChars', () => {
    const texts = readFileSync(
      new URL('../../../web/src/features/coach/coach-texts.ts', import.meta.url),
      'utf8',
    );
    const match = /export const MESSAGE_CHARS = ([\d_]+);/.exec(texts);
    expect(Number(match?.[1]?.replaceAll('_', ''))).toBe(limits.messageChars);
  });
});
