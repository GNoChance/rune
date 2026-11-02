import type { MeResponse } from '@rune/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb, MirrorRow } from '../../src/local-db/db';
import { reposFor, type StartInput } from '../../src/repos';
import { dumpLocalDb } from '../support/local-db';
import { createTestServices, makeMe, renderApp } from '../support/render';
import { SQUAT, seedHealthConsent } from '../support/workout';
import { SWAP_START, SWAP_TEMPLATE, seedBase } from './seed';

// « Douleur ou gêne » en séance (05 §13.6 à §13.8, spec brique 3 §7.3) : avec l'accord santé, `painLevel` est
// gardé ; sans, seul l'ajustement neutre `nextAdjustment` est écrit, sans aucune trace de douleur. « Douleur »
// affiche le conseil de sécurité mot pour mot et propose aussitôt un autre exercice du même type de mouvement.

const ADVICE =
  "Arrête l'exercice si la douleur augmente ; si elle persiste, consulte un médecin ou un kiné ; douleur à la poitrine ou malaise : appelle le 15 ou le 112.";
const PARENT = 'Parles-en à un parent.';
const ADULT_NEARBY = 'Entraîne-toi avec un adulte expérimenté.';

const HEALTH = { active: true, textVersion: 'v1', at: '2026-10-01T10:00:00.000Z' };
const NO_AI = { active: false, textVersion: null, at: null };
const consenting = () => makeMe({ consents: { health: HEALTH, aiCoach: NO_AI } });

const opened: AppDb[] = [];
afterEach(async () => {
  localStorage.clear();
  for (const db of opened.splice(0)) await db.delete();
});

async function openSession(o: { me?: MeResponse; consent?: boolean; start?: Partial<StartInput> } = {}) {
  const db = await seedBase({ template: SWAP_TEMPLATE });
  opened.push(db);
  if (o.consent) await seedHealthConsent(db);
  const me = o.me ?? (o.consent ? consenting() : makeMe());
  const { services } = await createTestServices({ db, me });
  const id = await reposFor(services).workouts.start({ ...SWAP_START, ...o.start });
  const view = await renderApp({ path: `/workout/${id}`, db, me });
  // Premier rendu : l'écran de séance est chargé à la demande ; sous la charge de la suite complète, plus d'1 s.
  await screen.findByRole('heading', { level: 1, name: 'Séance A' }, { timeout: 5000 });
  return { ...view, id };
}

const card = (name: string) => screen.getByRole('region', { name });
const rowOf = async (db: AppDb, slotId: string): Promise<MirrorRow> => {
  const row = (await db.mirror('performed_exercise').toArray()).find(
    (r) => r.slotId === slotId && r.deletedAt == null,
  );
  if (!row) throw new Error(`exercice du slot ${slotId} absent`);
  return row;
};

/** « ⋯ » de la carte (focus posé dessus, comme un toucher), « Douleur ou gêne », puis `level`. */
async function report(name: string, level: 'Gêne' | 'Douleur') {
  const button = within(card(name)).getByRole('button', { name: `Options pour ${name}` });
  button.focus();
  fireEvent.click(button);
  fireEvent.click(
    within(await screen.findByRole('dialog', { name })).getByRole('button', { name: 'Douleur ou gêne' }),
  );
  const sheet = await screen.findByRole('dialog', { name: 'Douleur ou gêne' });
  fireEvent.click(within(sheet).getByRole('button', { name: level }));
}

/** Ni `painLevel` ni `swapReason: 'pain'` dans Dexie (miroir et outbox compris). */
async function expectNoPainTrace(db: AppDb) {
  const dump = await dumpLocalDb(db);
  expect(dump).not.toMatch(/"painLevel":"/);
  expect(dump).not.toMatch(/"swapReason":"pain"/);
  for (const op of await db.outbox.toArray()) {
    expect(op.fields, op.opId).not.toHaveProperty('painLevel');
    expect(op.fields.swapReason, op.opId).not.toBe('pain');
  }
}

describe('« Douleur » avec l’accord santé', () => {
  it('painLevel et nextAdjustment ; conseil mot pour mot ; changement vers le même type de mouvement, raison « douleur »', async () => {
    const { db } = await openSession({ consent: true });
    await report('Squat goblet', 'Douleur');
    const sheet = await screen.findByRole('dialog', { name: 'Douleur' });
    await waitFor(async () =>
      expect(await rowOf(db, 'A1')).toMatchObject({ painLevel: 'pain', nextAdjustment: 'lighten' }),
    );
    expect(within(sheet).getByText(ADVICE)).toBeTruthy();
    // Le conseil est lu avec le nom de la feuille.
    const described = (sheet.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).toContain(ADVICE);
    expect(within(sheet).queryByText(PARENT)).toBeNull();

    // Même type de mouvement que le squat goblet (squat) : pas le squat bulgare (fente), pourtant dans le slot.
    await within(sheet).findByRole('button', { name: 'Squat au poids du corps' });
    expect(within(sheet).queryByRole('button', { name: 'Squat bulgare' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Squat au poids du corps' }));
    await screen.findByRole('region', { name: 'Squat au poids du corps' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await rowOf(db, 'A1')).toMatchObject({
      exerciseId: 'bodyweight-squat',
      swapReason: 'pain',
      painLevel: 'pain',
      nextAdjustment: 'lighten',
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Options pour Squat au poids du corps' }),
      ),
    );
  });

  it('« Gêne » : painLevel « gêne » et « ne pas augmenter », sans conseil ni changement', async () => {
    const { db } = await openSession({ consent: true });
    await report('Squat goblet', 'Gêne');
    await within(card('Squat goblet')).findByText('La prochaine fois : ne pas augmenter');
    expect(await rowOf(db, 'A1')).toMatchObject({ painLevel: 'discomfort', nextAdjustment: 'hold' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText(ADVICE)).toBeNull();
  });
});

describe('« Douleur » sans l’accord santé (R-SYN-10)', () => {
  it('seulement nextAdjustment ; conseil affiché ; le changement ne garde aucune raison de santé', async () => {
    const { db } = await openSession();
    await report('Squat goblet', 'Douleur');
    const sheet = await screen.findByRole('dialog', { name: 'Douleur' });
    expect(within(sheet).getByText(ADVICE)).toBeTruthy();
    await waitFor(async () => expect((await rowOf(db, 'A1')).nextAdjustment).toBe('lighten'));
    expect((await rowOf(db, 'A1')).painLevel ?? null).toBeNull();

    fireEvent.click(await within(sheet).findByRole('button', { name: 'Squat au poids du corps' }));
    await screen.findByRole('region', { name: 'Squat au poids du corps' });
    expect(await rowOf(db, 'A1')).toMatchObject({ exerciseId: 'bodyweight-squat', swapReason: null });
    await expectNoPainTrace(db);
  });

  it('« Changer d’exercice » avec la raison « Douleur » : aucune trace non plus', async () => {
    const { db } = await openSession();
    fireEvent.click(within(card('Squat goblet')).getByRole('button', { name: 'Options pour Squat goblet' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Squat goblet' })).getByRole('button', {
        name: "Changer d'exercice",
      }),
    );
    const sheet = await screen.findByRole('dialog', { name: "Changer d'exercice" });
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Squat bulgare' }));
    fireEvent.click(
      within(await screen.findByRole('group', { name: 'Pourquoi ?' })).getByRole('button', {
        name: 'Douleur',
      }),
    );
    await screen.findByRole('region', { name: 'Squat bulgare' });
    expect(await rowOf(db, 'A1')).toMatchObject({ exerciseId: 'bulgarian-split-squat', swapReason: null });
    await expectNoPainTrace(db);
  });
});

describe('messages aux mineurs (05 §14)', () => {
  it('mineur, exercice à la barre : sur la carte, et avec le conseil « Parles-en à un parent. »', async () => {
    const me = makeMe({ ageBand: 'minor', birthDate: '2009-05-01' });
    await openSession({
      me,
      start: { plan: { ...SWAP_START.plan, exercises: [SQUAT] } as StartInput['plan'] },
    });
    expect(within(card('Squat barre')).getByText(ADULT_NEARBY)).toBeTruthy();
    await report('Squat barre', 'Douleur');
    const sheet = await screen.findByRole('dialog', { name: 'Douleur' });
    expect(within(sheet).getByText(ADVICE)).toBeTruthy();
    expect(within(sheet).getByText(PARENT)).toBeTruthy();
    expect(within(sheet).getByText(ADULT_NEARBY)).toBeTruthy();
  });

  it('mineur, sans barre : « Parles-en à un parent. » seulement ; adulte : ni l’un ni l’autre', async () => {
    await openSession({ me: makeMe({ ageBand: 'minor', birthDate: '2009-05-01' }) });
    expect(screen.queryByText(ADULT_NEARBY)).toBeNull();
    await report('Squat goblet', 'Douleur');
    const sheet = await screen.findByRole('dialog', { name: 'Douleur' });
    expect(within(sheet).getByText(PARENT)).toBeTruthy();
    expect(within(sheet).queryByText(ADULT_NEARBY)).toBeNull();
  });
});
