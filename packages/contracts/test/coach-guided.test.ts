import { describe, expect, it } from 'vitest';
import { CoachMessageRequest } from '../src/coach';
import {
  composeGuidedMessage,
  GUIDED_FLOW_IDS,
  GUIDED_FLOWS,
  GuidedInvalidError,
  guidedFlowsFor,
} from '../src/coach-guided';

const names = (id: string): string | null => ({ 'squat-barre': 'Squat avec barre' })[id] ?? null;
const compose = (flow: string, choices: string[], audience: 'adult' | 'minor' = 'adult') =>
  composeGuidedMessage(flow, choices, names, audience);

describe('table des parcours guidés', () => {
  it('compose le texte exact de chaque parcours (spec 4.1 §2.2)', () => {
    expect(compose('next_session', [])).toBe(
      'Explique-moi ma prochaine séance : les exercices, les charges prévues et pourquoi.',
    );
    expect(compose('new_session', ['legs', 'medium'])).toBe(
      'Je voudrais une nouvelle séance : jambes, environ 40 minutes, avec le matériel de mon lieu principal.',
    );
    expect(compose('new_session', ['full_body', 'short'])).toBe(
      'Je voudrais une nouvelle séance : tout le corps, environ 20 minutes, avec le matériel de mon lieu principal.',
    );
    expect(compose('loads', ['squat-barre', 'too_heavy'])).toBe(
      'À propos de Squat avec barre : je la trouve trop lourde.',
    );
    expect(compose('loads', ['squat-barre', 'why'])).toBe(
      'À propos de Squat avec barre : pourquoi cette charge ?',
    );
    expect(compose('recovery', ['sleep'])).toBe('Conseille-moi sur mon sommeil.');
    expect(compose('nutrition', ['protein'])).toBe('Donne-moi des repères de nutrition : les protéines.');
    expect(compose('adjust_program', ['fewer_days'])).toBe(
      'Je voudrais ajuster mon programme : moins de jours.',
    );
  });

  it('un mineur a une seule puce de nutrition, sans étapes, et aucune puce adulte', () => {
    expect(compose('nutrition', [], 'minor')).toBe(
      'Donne-moi des conseils généraux pour bien manger quand on fait du sport.',
    );
    expect(() => compose('nutrition', ['protein'], 'minor')).toThrow(GuidedInvalidError);
    expect(() => compose('nutrition', [], 'adult')).toThrow(GuidedInvalidError);
    const minor = guidedFlowsFor('minor');
    expect(minor.filter((f) => f.id === 'nutrition')).toHaveLength(1);
    expect(minor.find((f) => f.id === 'nutrition')?.steps).toHaveLength(0);
    expect(minor.every((f) => f.audience !== 'adult')).toBe(true);
    expect(guidedFlowsFor('adult').every((f) => f.audience !== 'minor')).toBe(true);
    expect(new Set(guidedFlowsFor('minor').map((f) => f.id))).toEqual(new Set(GUIDED_FLOW_IDS));
  });

  it('lève une erreur sur un identifiant inconnu ou un nombre de choix faux', () => {
    expect(() => compose('inconnu', [])).toThrow(GuidedInvalidError);
    expect(() => compose('new_session', ['legs', 'enorme'])).toThrow(GuidedInvalidError);
    expect(() => compose('new_session', ['legs'])).toThrow(GuidedInvalidError);
    expect(() => compose('recovery', ['sleep', 'sleep'])).toThrow(GuidedInvalidError);
    expect(() => compose('next_session', ['x'])).toThrow(GuidedInvalidError);
    expect(() => compose('loads', ['exercice-inconnu', 'why'])).toThrow(GuidedInvalidError);
    expect(() => compose('loads', ['Pas un slug', 'why'])).toThrow(GuidedInvalidError);
  });

  it("« Mes charges » prend le nom de l'exercice par `names`", () => {
    const seen: string[] = [];
    const text = composeGuidedMessage(
      'loads',
      ['squat-barre', 'start'],
      (id) => {
        seen.push(id);
        return 'Mon nom';
      },
      'adult',
    );
    expect(seen).toEqual(['squat-barre']);
    expect(text).toBe('À propos de Mon nom : quelle charge pour commencer ?');
  });

  it('les puces de suite suivent la spec §2.3', () => {
    const labels = (id: string) => GUIDED_FLOWS.find((f) => f.id === id)?.followUps.map((f) => f.label);
    expect(labels('new_session')).toEqual(["L'ajouter à mon programme", 'Une autre idée', 'Plus courte']);
    expect(labels('loads')).toEqual(["D'autres questions sur cet exercice", 'Un autre exercice']);
    expect(labels('adjust_program')).toEqual([]);
  });

  it('le schéma `guided` de la requête est strict', () => {
    const base = { clientMessageId: '01890a5d-ac96-7ab2-80e2-4536629c90de', text: '' };
    expect(
      CoachMessageRequest.safeParse({ ...base, guided: { flow: 'new_session', choices: ['legs', 'short'] } })
        .success,
    ).toBe(true);
    expect(CoachMessageRequest.safeParse(base).success).toBe(true);
    for (const guided of [
      { flow: 'autre', choices: [] },
      { flow: 'recovery', choices: ['a', 'b', 'c'] },
      { flow: 'recovery', choices: [''] },
      { flow: 'recovery', choices: ['sleep'], extra: 1 },
      { flow: 'recovery' },
    ]) {
      expect(CoachMessageRequest.safeParse({ ...base, guided }).success).toBe(false);
    }
  });
});
