import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { LAZY, openNutritionAt, RAW } from './full-setup';

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});
async function open(...args: Parameters<typeof openNutritionAt>) {
  const view = await openNutritionAt(...args);
  opened.push(view.db);
  return view;
}

describe('repères du jour', () => {
  it('cas A : fourchette, repère central, grammes et eau, avec la mention d’estimation', async () => {
    await open('/nutrition');
    expect(await screen.findByText('2 100 à 2 300 kcal', RAW, LAZY)).toBeTruthy();
    expect(screen.getByText('repère : 2 200 kcal', RAW)).toBeTruthy();
    expect(screen.getByText('130 à 175 g')).toBeTruthy();
    expect(screen.getByText('au moins 50 g')).toBeTruthy();
    expect(screen.getByText('environ 310 g')).toBeTruthy();
    expect(screen.getByText('30 g')).toBeTruthy();
    expect(screen.getByText('2,5 L, aliments compris')).toBeTruthy();
    expect(screen.getByText('Une estimation, pas une consigne.')).toBeTruthy();
    expect(screen.queryByText('Ton objectif est réglé sur le maintien.')).toBeNull();
  });

  it('objectif demandé « perte », effectif « maintien » : la ligne neutre, sans explication', async () => {
    await open('/nutrition', { settings: { goal: 'lose' }, target: { effectiveGoal: 'maintain' } });
    expect(await screen.findByText('Ton objectif est réglé sur le maintien.', {}, LAZY)).toBeTruthy();
  });

  it('pas de cible locale : la mention et le lien restent, aucune valeur', async () => {
    await open('/nutrition', { target: null });
    expect(await screen.findByText('Une estimation, pas une consigne.', {}, LAZY)).toBeTruthy();
    expect(screen.queryByText(/kcal/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Comment sont calculés mes repères' })).toBeTruthy();
  });
});
