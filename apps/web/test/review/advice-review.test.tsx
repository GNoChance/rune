import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeApi, type FakeApi } from '../support/fake-api';
import {
  admin,
  callsTo,
  ok,
  openReview,
  REVIEW_LIST,
  reviewer,
  reviewItem,
  reviewList,
} from '../support/review';
import { until } from '../support/wait';

/* Segment « Fiches conseils » de la relecture (spec brique 5 §10.2, D9) : admin seul. */

const LIST = '/api/review/advice';
const SHEET = '/api/review/advice/protein-basics';

const summary = (o: Record<string, unknown> = {}) => ({
  id: 'protein-basics',
  title: 'Les protéines au quotidien',
  status: 'draft',
  version: 1,
  audience: 'adults',
  ...o,
});
const detail = (o: Record<string, unknown> = {}) => ({
  ...summary(),
  body_md: '## Pourquoi\n\nDes **protéines** à chaque repas.\n\n- Œufs\n- Légumineuses',
  visible_modes: ['qualitative'],
  tags: [],
  sources: [{ title: 'ANSES', url: 'https://www.anses.fr/', accessed_on: '2026-11-01' }],
  reviewed_at: null,
  published_at: null,
  retired_at: null,
  ...o,
});

function advice(): FakeApi {
  return createFakeApi()
    .on('GET', REVIEW_LIST, ok(reviewList([reviewItem('push-up', ['to_review'], { name: 'Pompe' })])))
    .on('GET', LIST, ok([summary(), summary({ id: 'hydration', title: 'Boire assez', status: 'published' })]))
    .on('GET', SHEET, ok(detail()));
}

beforeEach(() => localStorage.clear());

describe('segment « Fiches conseils »', () => {
  it('absent pour une relectrice', async () => {
    const api = advice();
    await openReview('/review/exercises', { api, me: reviewer() });
    expect(screen.queryByRole('radio', { name: 'Fiches conseils' })).toBeNull();
    expect(callsTo(api, LIST)).toHaveLength(0);
  });

  it('présent pour l’admin : la liste des fiches avec leur statut', async () => {
    const api = advice();
    await openReview('/review/exercises', { api, me: admin() });
    fireEvent.click(screen.getByRole('radio', { name: 'Fiches conseils' }));
    const list = await screen.findByRole('list', { name: 'Fiches conseils' });
    const rows = within(list).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Les protéines au quotidien');
    expect(rows[0]?.textContent).toContain('Brouillon');
    expect(rows[1]?.textContent).toContain('Publiée');
    // La liste des exercices n'est plus affichée.
    expect(screen.queryByRole('list', { name: 'Fiches' })).toBeNull();
  });

  async function openSheet(api: FakeApi) {
    await openReview('/review/exercises', { api, me: admin() });
    fireEvent.click(screen.getByRole('radio', { name: 'Fiches conseils' }));
    fireEvent.click(await screen.findByRole('button', { name: /Les protéines au quotidien/ }));
    await screen.findByRole('heading', { name: 'Les protéines au quotidien' });
  }

  it('une fiche : le texte rendu en Markdown restreint, les sources', async () => {
    await openSheet(advice());
    expect(screen.getByRole('heading', { level: 2, name: 'Pourquoi' })).toBeTruthy();
    expect(screen.getByText('protéines').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      expect.arrayContaining(['Œufs', 'Légumineuses', 'ANSES']),
    );
  });

  it('« Marquer relue » appelle POST /review et suit le statut', async () => {
    const api = advice().on('POST', `${SHEET}/review`, ok(detail({ status: 'reviewed' })));
    await openSheet(api);
    fireEvent.click(screen.getByRole('button', { name: 'Marquer relue' }));
    await screen.findByRole('button', { name: 'Publier' });
    expect(callsTo(api, `${SHEET}/review`, 'POST')).toHaveLength(1);
    expect(screen.getByText('Relue')).toBeTruthy();
  });

  it('un refus 422 affiche les contrôles refusés (issues) et garde le statut', async () => {
    const api = advice().on('POST', `${SHEET}/review`, {
      status: 422,
      body: {
        error: 'transition_blocked',
        issues: [
          { code: 'no_source', detail: 'aucune source' },
          { code: 'numbers_not_allowed', detail: '2 g' },
        ],
      },
    });
    await openSheet(api);
    fireEvent.click(screen.getByRole('button', { name: 'Marquer relue' }));
    const issues = await screen.findByRole('list', { name: 'La fiche ne peut pas passer à cette étape' });
    expect(
      within(issues)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Aucune source : aucune source', 'Nombre avec unité non permis dans cette fiche : 2 g']);
    expect(screen.getByText('Brouillon')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Marquer relue' })).toBeTruthy();
  });

  it('« Modifier » envoie PUT { title, body_md } et la fiche repasse en brouillon', async () => {
    const api = advice()
      .on('GET', SHEET, ok(detail({ status: 'reviewed' })))
      .on('PUT', SHEET, ok(detail({ title: 'Protéines', status: 'draft', version: 2 })));
    await openSheet(api);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Protéines' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await until(() => callsTo(api, SHEET, 'PUT').length === 1);
    expect(callsTo(api, SHEET, 'PUT')[0]?.body).toMatchObject({ title: 'Protéines' });
    expect(callsTo(api, SHEET, 'PUT')[0]?.body).toHaveProperty('body_md');
    await screen.findByRole('heading', { name: 'Protéines' });
    expect(screen.getByText('Brouillon')).toBeTruthy();
    expect(screen.getByText('Version 2')).toBeTruthy();
  });
});
