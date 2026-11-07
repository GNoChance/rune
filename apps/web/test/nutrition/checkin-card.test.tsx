import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb } from '../../src/local-db/db';
import { createFakeSyncEngine } from '../support/fake-api';
import { FULL_STATE, LAZY, openNutritionAt, RAW } from './full-setup';

const opened: AppDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});
async function open(o: Parameters<typeof openNutritionAt>[1] = {}) {
  const view = await openNutritionAt('/nutrition', o);
  opened.push(view.db);
  await screen.findByRole('region', { name: 'Bilan de la semaine' }, LAZY);
  return view;
}

const checkin = (over: Record<string, unknown> = {}) => ({
  weekStart: '2026-09-28',
  weighInCount: 4,
  meanWeightG: 72_400,
  changePct: -0.3,
  representative: true,
  decision: 'in_band',
  position: 'in',
  proposedDeltaKcal: null,
  response: null,
  ...over,
});

const SHEET = {
  id: 'weight-fluctuations',
  title: 'Pourquoi mon poids varie',
  body_md: 'Le poids bouge.',
  audience: 'all',
  visible_modes: ['full', 'qualitative'],
  tags: [],
  sources: [],
  version: 1,
  reviewed_at: '2026-09-01',
};

const card = () => screen.getByRole('region', { name: 'Bilan de la semaine' });

describe('bilan : une phrase par décision', () => {
  it.each([
    [{ decision: 'insufficient_data', position: null }, /Pas assez de pesées cette semaine/],
    [{ decision: 'non_representative_week' }, /Semaine mise de côté/],
    [{ decision: 'in_band' }, /Ta tendance est dans la fourchette visée\. Rien à changer\./],
    [{ decision: 'out_of_band_pending', position: 'above' }, /au-dessus de la fourchette visée/],
    [{ decision: 'out_of_band_pending', position: 'below' }, /en dessous de la fourchette visée/],
    [{ decision: 'limit_reached', position: 'above', proposedDeltaKcal: -100 }, /On ne descend pas plus/],
    [{ decision: 'limit_reached', position: 'below', proposedDeltaKcal: 100 }, /On ne monte pas plus/],
    [{ decision: 'safety_pause', position: 'above' }, /Pas de baisse proposée pour l'instant/],
    [{ decision: 'safety_pause', position: null, changePct: null }, /Ton objectif passe au maintien/],
  ])('%j', async (over, line) => {
    await open({ checkins: [checkin(over)] });
    expect(await within(card()).findByText(line, {}, LAZY)).toBeTruthy();
    expect(within(card()).queryByRole('button', { name: 'Accepter' })).toBeNull();
    expect(within(card()).queryByRole('button', { name: 'Garder mes repères' })).toBeNull();
  });

  it('semaine, moyenne et variation à une décimale, lues dans le bilan', async () => {
    await open({ checkins: [checkin()] });
    expect(await within(card()).findByText(/28 septembre 2026/, {}, LAZY)).toBeTruthy();
    expect(within(card()).getByText(/72,4 kg/)).toBeTruthy();
    expect(within(card()).getByText(/−0,3 %/)).toBeTruthy();
  });

  it('proposition : les deux valeurs viennent de la cible et du bilan', async () => {
    await open({ checkins: [checkin({ decision: 'proposal', position: 'above', proposedDeltaKcal: -100 })] });
    expect(
      await within(card()).findByText(
        "Proposition : ton repère d'énergie passe de 2 200 à 2 100 kcal.",
        RAW,
        LAZY,
      ),
    ).toBeTruthy();
  });

  it('perte rapide : la phrase et le sens inverse', async () => {
    await open({
      checkins: [
        checkin({ decision: 'rapid_loss', position: 'below', proposedDeltaKcal: 100, changePct: -1.8 }),
      ],
    });
    expect(
      await within(card()).findByText(
        "Ton poids baisse plus vite que prévu. Proposition : ton repère d'énergie passe de 2 200 à 2 300 kcal.",
        RAW,
        LAZY,
      ),
    ).toBeTruthy();
  });
});

describe('bilan : actions', () => {
  const proposal = checkin({ decision: 'proposal', position: 'above', proposedDeltaKcal: -100 });
  const NOT_REPRESENTATIVE = /Cette semaine n'était pas représentative/;

  it('« Accepter » et « Garder mes repères » seulement sur le bilan à traiter', async () => {
    await open({ checkins: [proposal] });
    expect(await within(card()).findByRole('button', { name: 'Accepter' }, LAZY)).toBeTruthy();
    expect(within(card()).getByRole('button', { name: 'Garder mes repères' })).toBeTruthy();
    expect(within(card()).getByRole('button', { name: NOT_REPRESENTATIVE })).toBeTruthy();
  });

  it.each([
    ['Accepter', 'accepted'],
    ['Garder mes repères', 'declined'],
  ])('« %s » envoie %s', async (name, response) => {
    const { api } = await open({ checkins: [proposal] });
    api.on('POST', '/api/nutrition/checkins/:week/respond', { status: 200, body: FULL_STATE });
    fireEvent.click(await within(card()).findByRole('button', { name }, LAZY));
    await waitFor(() => {
      const call = api.calls.find((c) => c.path === '/api/nutrition/checkins/2026-09-28/respond');
      expect(call?.body).toEqual({ response });
    });
  });

  it('« pas représentative » relance l’affichage avec la nouvelle décision', async () => {
    const { api } = await open({ checkins: [proposal] });
    api.on('POST', '/api/nutrition/checkins/:week/non-representative', {
      status: 200,
      body: {
        ...FULL_STATE,
        last_checkin: {
          week_start: '2026-09-28',
          weigh_in_count: 4,
          mean_weight_g: 72_400,
          change_pct: -0.3,
          representative: false,
          decision: 'non_representative_week',
          position: 'above',
          proposed_delta_kcal: null,
          response: null,
        },
      },
    });
    fireEvent.click(await within(card()).findByRole('button', { name: NOT_REPRESENTATIVE }, LAZY));
    expect(await within(card()).findByText(/Semaine mise de côté/)).toBeTruthy();
    expect(within(card()).queryByRole('button', { name: 'Accepter' })).toBeNull();
  });

  it('hors ligne : boutons grisés, « Nécessite le réseau »', async () => {
    await open({ checkins: [proposal], sync: createFakeSyncEngine({ connection: 'offline' }) });
    await within(card()).findByRole('button', { name: 'Accepter' }, LAZY);
    expect(within(card()).getByText('Nécessite le réseau')).toBeTruthy();
    for (const name of ['Accepter', 'Garder mes repères', NOT_REPRESENTATIVE]) {
      expect((within(card()).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('un bilan plus ancien non traité est affiché « sans suite »', async () => {
    await open({
      checkins: [
        proposal,
        checkin({
          weekStart: '2026-09-21',
          decision: 'proposal',
          position: 'above',
          proposedDeltaKcal: -100,
        }),
        checkin({ weekStart: '2026-09-14', decision: 'in_band' }),
      ],
    });
    await within(card()).findByRole('button', { name: 'Accepter' }, LAZY);
    expect(within(card()).getAllByRole('button', { name: 'Accepter' })).toHaveLength(1);
    const old = within(card())
      .getByText(/21 septembre 2026/)
      .closest('li');
    expect(old?.textContent).toContain('sans suite');
    expect(within(card()).queryByText(/14 septembre 2026/)).toBeNull();
  });

  it('un bilan répondu : résumé sans boutons', async () => {
    await open({ checkins: [{ ...proposal, response: 'accepted' }] });
    expect(await within(card()).findByText(/28 septembre 2026/, {}, LAZY)).toBeTruthy();
    expect(within(card()).queryByRole('button', { name: 'Accepter' })).toBeNull();
  });
});

describe('bilan : lien vers la fiche', () => {
  it('« Pourquoi mon poids varie » quand la fiche est servie', async () => {
    await open({ checkins: [checkin()], sheets: [SHEET] });
    const link = await within(card()).findByRole('link', { name: 'Pourquoi mon poids varie' }, LAZY);
    expect(link.getAttribute('href')).toBe('/nutrition/sheets/weight-fluctuations');
  });

  it('aucun lien quand la fiche n’est pas servie', async () => {
    await open({ checkins: [checkin()], sheets: [{ ...SHEET, id: 'autre', title: 'Autre' }] });
    await within(card()).findByText(/28 septembre 2026/, {}, LAZY);
    await screen.findByText('Autre');
    expect(within(card()).queryByRole('link', { name: 'Pourquoi mon poids varie' })).toBeNull();
  });
});
