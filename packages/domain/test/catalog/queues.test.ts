import type { DraftSheet, ExerciseSheet, ExerciseStatus } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import {
  CORE_BATCHES,
  progressByBatch,
  type ReviewQueueFlags,
  type ReviewQueuesInput,
  reviewQueues,
} from '../../src/catalog/queues';
import type { ReviewerState, Validation } from '../../src/catalog/review';
import { reviewer, revisionRow, sheet } from '../fixtures/catalog';

const ADMIN = reviewer('admin', { role: 'admin', catalogReviewer: false });
const NURSE = reviewer('nurse', { healthProfessional: true });
const READER = reviewer('reader');
const USERS: ReadonlyMap<string, ReviewerState> = new Map([ADMIN, NURSE, READER].map((u) => [u.id, u]));
const MANIFEST: ReadonlySet<string> = new Set(['goblet-squat-start', 'goblet-squat-end']);

/** Champs d'une fiche non sensible : niveau 1, pas `not_for_minors`, articulations hors `SENSITIVE_JOINTS`. */
const CALM: Partial<ExerciseSheet> = { level: 1, not_for_minors: false, stressed_joints: ['hips'] };

/** Aucune file, pas prête à publier. */
const NONE: ReviewQueueFlags = {
  to_review: false,
  drafts: false,
  health_pending: false,
  revalidate: false,
  mine: false,
  readyToPublish: false,
};

/** Files de `s` vues par la relectrice simple `reader` ; une seule révision, enregistrée par l'admin. */
function queues(s: DraftSheet, overrides: Partial<ReviewQueuesInput> = {}): ReviewQueueFlags {
  return reviewQueues({
    sheet: s,
    callerId: 'reader',
    revisions: [revisionRow(s, 'admin')],
    validations: [],
    comments: [],
    users: USERS,
    manifestIds: MANIFEST,
    ...overrides,
  });
}

const at = (status: ExerciseStatus, revision: number, overrides: Partial<ExerciseSheet> = {}) =>
  sheet({ status, revision, ...overrides });

describe('reviewQueues (spec §3.8)', () => {
  describe('to_review et drafts', () => {
    it("un draft n'est jamais dans to_review ; il est dans drafts", () => {
      expect(queues(at('draft', 1))).toEqual({ ...NONE, drafts: true });
      expect(queues(at('draft', 1, CALM), { callerId: 'nurse' })).toEqual({ ...NONE, drafts: true });
    });

    it("reviewed que l'appelant n'a pas validée : to_review", () => {
      expect(queues(at('reviewed', 1, CALM)).to_review).toBe(true);
    });

    it("reviewed dont l'appelant a validé le contenu courant, même avant des transitions : hors to_review", () => {
      const v1 = at('reviewed', 1, CALM);
      const v3 = at('reviewed', 3, CALM);
      const revisions = [
        revisionRow(v1, 'admin'),
        revisionRow(at('draft', 2, CALM), 'admin'),
        revisionRow(v3, 'admin'),
      ];
      const validations: Validation[] = [{ reviewerId: 'reader', revision: 1, health: false }];
      expect(queues(v3, { revisions, validations }).to_review).toBe(false);
      expect(queues(v3, { revisions, validations, callerId: 'nurse' }).to_review).toBe(true);
    });

    it("contenu modifié depuis la validation de l'appelant : de nouveau dans to_review", () => {
      const v1 = at('reviewed', 1, CALM);
      const v2 = at('reviewed', 2, { ...CALM, name: 'Squat gobelet' });
      const revisions = [revisionRow(v1, 'admin'), revisionRow(v2, 'admin')];
      const validations: Validation[] = [{ reviewerId: 'reader', revision: 1, health: false }];
      expect(queues(v2, { revisions, validations }).to_review).toBe(true);
    });

    it.each<ExerciseStatus>(['published', 'retired'])('%s : ni to_review ni drafts', (status) => {
      const flags = queues(at(status, 1, CALM));
      expect(flags.to_review).toBe(false);
      expect(flags.drafts).toBe(false);
    });
  });

  describe('health_pending', () => {
    it('reviewed sensible sans feu vert santé', () => {
      expect(queues(at('reviewed', 1)).health_pending).toBe(true);
    });

    it('reviewed sensible avec feu vert santé à jour : hors file', () => {
      const validations: Validation[] = [{ reviewerId: 'nurse', revision: 1, health: true }];
      expect(queues(at('reviewed', 1), { validations }).health_pending).toBe(false);
    });

    it('reviewed non sensible : hors file', () => {
      expect(queues(at('reviewed', 1, CALM)).health_pending).toBe(false);
    });

    it('draft sensible : hors file', () => {
      expect(queues(at('draft', 1)).health_pending).toBe(false);
    });
  });

  describe('revalidate', () => {
    it('publiée sensible corrigée après le feu vert : à revalider', () => {
      const v1 = at('published', 1);
      const v2 = at('published', 2, { breathing: 'Souffle en remontant.' });
      const validations: Validation[] = [{ reviewerId: 'nurse', revision: 1, health: true }];
      expect(queues(v1, { validations }).revalidate).toBe(false);
      expect(
        queues(v2, { validations, revisions: [revisionRow(v1, 'admin'), revisionRow(v2, 'admin')] }),
      ).toEqual({
        ...NONE,
        revalidate: true,
      });
    });

    it('une fiche publiée passée du niveau 1 au niveau 2 entre dans revalidate', () => {
      const v1 = at('published', 1, CALM);
      const v2 = at('published', 2, { ...CALM, level: 2 });
      expect(queues(v1).revalidate).toBe(false);
      expect(queues(v2, { revisions: [revisionRow(v1, 'admin'), revisionRow(v2, 'admin')] }).revalidate).toBe(
        true,
      );
    });

    it('reviewed sensible sans feu vert : health_pending, pas revalidate', () => {
      const flags = queues(at('reviewed', 1));
      expect(flags.health_pending).toBe(true);
      expect(flags.revalidate).toBe(false);
    });

    it('retirée sensible : hors file', () => {
      expect(queues(at('retired', 1)).revalidate).toBe(false);
    });
  });

  describe('mine', () => {
    const open = (authorId: string | null) => ({ authorId, resolvedAt: null });

    it("au moins un commentaire ouvert écrit par l'appelant", () => {
      expect(queues(at('draft', 1), { comments: [open('nurse'), open('reader')] }).mine).toBe(true);
    });

    it("commentaire de l'appelant traité, ou ouvert par une autre, ou d'un ancien relecteur : hors file", () => {
      const comments = [
        { authorId: 'reader', resolvedAt: '2026-10-28T10:00:00.000Z' },
        open('nurse'),
        open(null),
      ];
      expect(queues(at('published', 1), { comments }).mine).toBe(false);
    });
  });

  describe('readyToPublish', () => {
    it('reviewed sans aucun blocage de reviewed → published', () => {
      expect(queues(at('reviewed', 1, CALM)).readyToPublish).toBe(true);
    });

    it('un commentaire ouvert, une illustration hors manifeste : pas prête', () => {
      expect(
        queues(at('reviewed', 1, CALM), { comments: [{ authorId: null, resolvedAt: null }] }).readyToPublish,
      ).toBe(false);
      expect(queues(at('reviewed', 1, CALM), { manifestIds: new Set() }).readyToPublish).toBe(false);
    });

    it('sensible : prête seulement avec le feu vert santé à jour', () => {
      const validations: Validation[] = [{ reviewerId: 'nurse', revision: 1, health: true }];
      expect(queues(at('reviewed', 1)).readyToPublish).toBe(false);
      expect(queues(at('reviewed', 1), { validations }).readyToPublish).toBe(true);
    });

    it.each<ExerciseStatus>(['draft', 'published', 'retired'])('%s : jamais prête à publier', (status) => {
      expect(queues(at(status, 1, CALM)).readyToPublish).toBe(false);
    });
  });

  it('fixture de la liste (tâche 8) : chaque fiche dans exactement ses files', () => {
    const draft = at('draft', 1, CALM);
    const calmReviewed = at('reviewed', 1, CALM);
    const sensitiveReviewed = at('reviewed', 1);
    const published1 = at('published', 1);
    const published2 = at('published', 2, { breathing: 'Souffle en remontant.' });
    const nurseOn1: Validation[] = [{ reviewerId: 'nurse', revision: 1, health: true }];
    expect(queues(draft)).toEqual({ ...NONE, drafts: true });
    expect(queues(calmReviewed)).toEqual({ ...NONE, to_review: true, readyToPublish: true });
    expect(queues(sensitiveReviewed)).toEqual({ ...NONE, to_review: true, health_pending: true });
    expect(
      queues(published2, {
        validations: nurseOn1,
        revisions: [revisionRow(published1, 'admin'), revisionRow(published2, 'admin')],
      }),
    ).toEqual({ ...NONE, revalidate: true });
  });
});

describe('progressByBatch (spec §2 et §3.8)', () => {
  const s = (id: string, batch: string, status: ExerciseStatus) => sheet({ id, batch, status });

  it('par lot : fiches publiées et fiches non retirées (brouillons compris)', () => {
    const catalog = [
      s('a1', 'A', 'published'),
      s('a2', 'A', 'published'),
      s('a3', 'A', 'reviewed'),
      s('a4', 'A', 'draft'),
      s('a5', 'A', 'retired'),
      s('b1', 'B', 'draft'),
      s('e1', 'E1', 'published'),
      s('e2', 'E1', 'retired'),
    ];
    expect(progressByBatch(catalog)).toEqual([
      { batch: 'A', published: 2, total: 4 },
      { batch: 'B', published: 0, total: 1 },
      { batch: 'E1', published: 1, total: 1 },
    ]);
  });

  it('A et B toujours présents (le cœur), même vides', () => {
    expect(progressByBatch([])).toEqual([
      { batch: 'A', published: 0, total: 0 },
      { batch: 'B', published: 0, total: 0 },
    ]);
  });

  it("lots d'extension dans l'ordre de leur numéro (E2 avant E10), quel que soit l'ordre du catalogue", () => {
    const catalog = [
      s('x', 'E10', 'draft'),
      s('y', 'E2', 'draft'),
      s('z', 'E1', 'published'),
      s('w', 'B', 'draft'),
    ];
    const batches = ['A', 'B', 'E1', 'E2', 'E10'];
    expect(progressByBatch(catalog).map((r) => r.batch)).toEqual(batches);
    expect(progressByBatch([...catalog].reverse()).map((r) => r.batch)).toEqual(batches);
  });

  it("un lot d'extension dont toutes les fiches sont retirées n'a pas de ligne", () => {
    expect(progressByBatch([s('x', 'E3', 'retired')]).map((r) => r.batch)).toEqual(['A', 'B']);
  });

  it('le cœur, « Cœur · n / m publiées », est la somme des lots A et B', () => {
    expect(CORE_BATCHES).toEqual(['A', 'B']);
  });
});
