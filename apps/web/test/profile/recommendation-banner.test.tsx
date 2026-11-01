import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { getMeta, setMeta } from '../../src/local-db/meta';
import { settle } from '../support/auth';
import { createTestLocalDb } from '../support/local-db';
import { type ProgramSetup, seedProgram } from '../support/program';
import { makeMe, renderApp } from '../support/render';
import { until } from '../support/wait';

const BETTER = 'Un autre programme te correspond mieux';

/** Profil (`/profile`) du membre u-1 inscrit au modèle de salle débutant. */
async function openProfile(setup: ProgramSetup, seed?: (db: AppDb) => Promise<void>) {
  const db = createTestLocalDb();
  await seedProgram(db, setup);
  await seed?.(db);
  const rendered = await renderApp({ path: '/profile', db, me: makeMe() });
  await screen.findByRole('heading', { level: 1, name: 'Profil' });
  // La base locale a répondu : les lignes du Profil sont là.
  await screen.findByText('Basic Fit');
  await settle();
  return rendered;
}

/** Niveau intermédiaire, 4 jours : le modèle conseillé devient l'intermédiaire de la salle. */
const MOVED_ON = { profile: { experience: '6_to_24_months', daysPerWeek: 4 } };

describe('Profil : bandeau « Un autre programme te correspond mieux » (R-REC-7, spec §7.8)', () => {
  it('le modèle recommandé n’est plus celui suivi : bandeau vers /program/choose, sans rien changer seul', async () => {
    const { location, api } = await openProfile(MOVED_ON);
    const link = await screen.findByRole('link', { name: BETTER });
    expect(link.getAttribute('href')).toBe('/program/choose');
    // Jamais de changement d'inscription automatique.
    expect(api.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    fireEvent.click(link);
    await until(() => location() === '/program/choose');
  });

  it('« Masquer » : le bandeau part, et ne revient pas pour ce même modèle', async () => {
    const { db } = await openProfile(MOVED_ON);
    await screen.findByRole('link', { name: BETTER });
    fireEvent.click(screen.getByRole('button', { name: 'Masquer' }));
    await until(() => screen.queryByRole('link', { name: BETTER }) === null);
    expect(await getMeta(db, 'recommendationSeen')).toBe('gym-intermediate-upper-lower');
  });

  it('modèle recommandé déjà vu (choisi à l’inscription) : pas de bandeau', async () => {
    await openProfile(MOVED_ON, (db) => setMeta(db, 'recommendationSeen', 'gym-intermediate-upper-lower'));
    expect(screen.queryByRole('link', { name: BETTER })).toBeNull();
  });

  it('le modèle suivi est le modèle recommandé : pas de bandeau', async () => {
    await openProfile({});
    expect(screen.queryByRole('link', { name: BETTER })).toBeNull();
  });

  it('sans programme : pas de bandeau', async () => {
    await openProfile({ ...MOVED_ON, instance: false });
    expect(screen.queryByRole('link', { name: BETTER })).toBeNull();
  });
});
