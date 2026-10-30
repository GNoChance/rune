import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { settle } from '../support/auth';
import {
  admin,
  callsTo,
  healthReviewer,
  ok,
  openReview,
  REVIEW_LIST,
  reviewApi,
  reviewer,
  reviewItem,
  reviewList,
  revokeOn,
} from '../support/review';
import { until } from '../support/wait';

// Liste de la relecture (spec brique 2 §4.5 et §3.8, plan Task 16) : avancement par lot, filtres et compteurs,
// pastilles de chaque fiche, file vide, échec de lecture.

/** Texte lu par un lecteur d'écran : ce qui est caché (`aria-hidden`) en moins, espaces resserrés. */
function spoken(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Description d'un élément (`aria-describedby`), comme l'entend un lecteur d'écran. */
const description = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => {
      const target = document.getElementById(id);
      return target ? spoken(target) : '';
    })
    .join(' ')
    .trim();

/** Liens des fiches affichées, dans l'ordre. */
const rows = () => within(screen.getByRole('list', { name: 'Fiches' })).queryAllByRole('link');
const rowNames = () =>
  rows().map((a) => document.getElementById(a.getAttribute('aria-labelledby') ?? '')?.textContent ?? '');
const row = (name: string) => screen.getByRole('link', { name });
const filter = (name: RegExp) => screen.getByRole('radio', { name });

const ITEMS = [
  reviewItem('back-squat', ['to_review', 'health_pending'], {
    name: 'Squat barre',
    level: 2,
    stressedJoints: ['knees', 'lower_back', 'hips'],
    sensitive: true,
    openComments: 2,
    queues: ['to_review', 'health_pending', 'mine'],
  }),
  reviewItem('goblet-squat', ['to_review'], { name: 'Squat goblet' }),
  reviewItem('push-up', ['drafts'], { name: 'Pompe', status: 'draft', revision: 1 }),
  reviewItem('front-plank', ['revalidate'], {
    name: 'Gainage ventral',
    status: 'published',
    notForMinors: true,
    sensitive: true,
    greenLight: 'stale',
    validatedByMe: true,
  }),
  reviewItem('glute-bridge', ['ready_to_publish'], {
    name: 'Pont fessier',
    validatedByMe: true,
    greenLight: 'ok',
  }),
];

beforeEach(() => {
  localStorage.clear();
});

describe('avancement par lot (§3.8)', () => {
  it('« Cœur · n / m publiées » pour A et B réunis, puis une ligne par lot d’extension', async () => {
    const api = reviewApi({
      list: ok(
        reviewList(ITEMS, [
          { batch: 'A', published: 3, total: 10 },
          { batch: 'B', published: 1, total: 5 },
          { batch: 'E1', published: 0, total: 4 },
        ]),
      ),
    });
    await openReview('/review/exercises', { api });
    const progress = screen.getByRole('region', { name: 'Avancement' });
    expect(within(progress).getAllByRole('listitem').map(spoken)).toEqual([
      'Cœur · 4 / 15 publiées',
      'Lot E1 · 0 / 4 publiées',
    ]);
  });
});

describe('filtres et compteurs (§4.5)', () => {
  it('« À relire » par défaut ; chaque filtre porte son compteur ; une seule lecture', async () => {
    const api = reviewApi({ list: ok(reviewList(ITEMS)) });
    const view = await openReview('/review/exercises', { api });
    const group = screen.getByRole('group', { name: 'Filtrer les fiches' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.closest('label')?.textContent),
    ).toEqual([
      'À relire · 2',
      'Brouillons à commenter · 1',
      'Feu vert santé · 1',
      'À revalider · 1',
      'Mes commentaires · 1',
      'Toutes · 5',
    ]);
    expect((filter(/^À relire/) as HTMLInputElement).checked).toBe(true);
    expect(rowNames()).toEqual(['Squat barre', 'Squat goblet']);
    expect(view.location()).toBe('/review/exercises');
    expect(callsTo(api, REVIEW_LIST)).toHaveLength(1);
    expect(callsTo(api, REVIEW_LIST)[0]?.query.toString()).toBe('');
  });

  it('changer de filtre remplace l’adresse et filtre les lignes sans relire le serveur', async () => {
    const api = reviewApi({ list: ok(reviewList(ITEMS)) });
    const view = await openReview('/review/exercises', { api });
    fireEvent.click(filter(/^Brouillons à commenter/));
    await until(() => view.location() === '/review/exercises?queue=drafts');
    expect(rowNames()).toEqual(['Pompe']);
    fireEvent.click(filter(/^Feu vert santé/));
    await until(() => rowNames().join() === 'Squat barre');
    fireEvent.click(filter(/^Toutes/));
    await until(() => rowNames().length === 5);
    expect(view.visits().filter((v) => v.startsWith('/review/exercises?'))).toEqual([
      '/review/exercises?queue=drafts',
      '/review/exercises?queue=health_pending',
      '/review/exercises?queue=all',
    ]);
    expect(view.location()).toBe('/review/exercises?queue=all');
    expect(callsTo(api, REVIEW_LIST)).toHaveLength(1);
  });

  it('filtre lu dans l’adresse ; une valeur inconnue revient à « À relire »', async () => {
    const api = reviewApi({ list: ok(reviewList(ITEMS)) });
    const first = await openReview('/review/exercises?queue=mine', { api });
    expect((filter(/^Mes commentaires/) as HTMLInputElement).checked).toBe(true);
    expect(rowNames()).toEqual(['Squat barre']);
    first.unmount();
    await openReview('/review/exercises?queue=nimporte', { api });
    expect((filter(/^À relire/) as HTMLInputElement).checked).toBe(true);
  });
});

describe('une ligne par fiche, avec ses pastilles (§4.5)', () => {
  it('nom du lien, pastilles d’état en description, lien vers la fiche avec le filtre actif', async () => {
    const api = reviewApi({ list: ok(reviewList(ITEMS)) });
    await openReview('/review/exercises?queue=all', { api });
    const squat = row('Squat barre');
    expect(squat.getAttribute('href')).toBe('/review/exercises/back-squat?queue=all');
    expect(description(squat)).toBe('Relue Sensible : niveau 2, genoux, bas du dos 2 commentaires ouverts');
    expect(description(row('Pompe'))).toBe('Brouillon');
    expect(description(row('Gainage ventral'))).toBe(
      'Publiée Sensible : déconseillée aux mineurs Validée par toi À revalider',
    );
    expect(description(row('Pont fessier'))).toBe('Relue Validée par toi Prête à publier');
    expect(description(row('Squat goblet'))).toBe('Relue');
  });

  it('un seul commentaire ouvert : « 1 commentaire ouvert »', async () => {
    const api = reviewApi({
      list: ok(reviewList([reviewItem('a', ['to_review'], { name: 'Fente', openComments: 1 })])),
    });
    await openReview('/review/exercises', { api });
    expect(description(row('Fente'))).toBe('Relue 1 commentaire ouvert');
  });
});

describe('file vide', () => {
  it('« Ta file est vide. Merci ! » quand le filtre actif n’a aucune fiche', async () => {
    const api = reviewApi({ list: ok(reviewList(ITEMS.filter((i) => !i.queues.includes('to_review')))) });
    await openReview('/review/exercises', { api });
    expect(screen.getByText('Ta file est vide. Merci !')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Fiches' })).toBeNull();
    fireEvent.click(filter(/^Brouillons à commenter/));
    await until(() => screen.queryByText('Ta file est vide. Merci !') === null);
    expect(rowNames()).toEqual(['Pompe']);
  });
});

describe('lecture impossible', () => {
  it('hors ligne : « Nécessite le réseau », puis « Réessayer » relit la liste', async () => {
    const api = reviewApi({ list: ok(reviewList(ITEMS)) });
    api.setOffline('reject');
    await openReview('/review/exercises', { api });
    expect((await screen.findByRole('alert')).textContent).toContain('Nécessite le réseau');
    expect(screen.queryByRole('list', { name: 'Fiches' })).toBeNull();
    api.setOffline(false);
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await until(() => screen.queryByRole('list', { name: 'Fiches' }) !== null);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('403 d’un compte qui n’est plus relecteur : retour au Profil avec le message', async () => {
    const api = revokeOn(reviewApi({}), 'GET', REVIEW_LIST);
    const view = await openReview('/review/exercises', { api });
    await until(() => view.location() === '/profile?reason=review_access_lost');
    expect(await screen.findByText("Tu n'as plus accès à la relecture.")).toBeTruthy();
  });
});

describe('outils de l’admin absents pour une relectrice (§4.5, §7 critère 11)', () => {
  it('ni « Modifier », ni « Publier », ni « Exporter le catalogue »', async () => {
    for (const me of [reviewer(), healthReviewer()]) {
      const api = reviewApi({ list: ok(reviewList(ITEMS)) });
      const view = await openReview('/review/exercises?queue=all', { me, api });
      expect(screen.queryByRole('button', { name: /Modifier|Publier|Exporter/ })).toBeNull();
      expect(screen.queryByRole('link', { name: /Modifier|Publier|Exporter/ })).toBeNull();
      view.unmount();
    }
  });

  it('l’admin lit la même liste', async () => {
    const api = reviewApi({ list: ok(reviewList(ITEMS)) });
    await openReview('/review/exercises', { me: admin(), api });
    expect(rowNames()).toEqual(['Squat barre', 'Squat goblet']);
    await settle();
  });
});
