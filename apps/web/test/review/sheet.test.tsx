import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { settle } from '../support/auth';
import {
  admin,
  callsTo,
  ok,
  openReview,
  REVIEW_SHEET,
  reviewApi,
  reviewComment,
  reviewer,
  reviewSheetPath,
  revokeOn,
  sheetResponse,
} from '../support/review';
import { until } from '../support/wait';

// Fiche de la relecture (spec brique 2 §4.5, §3.3, plan Task 16) : aperçu de la vue membre, valeurs de la
// sensibilité écrites en clair, « Commenter » sur chaque partie, commentaires ouverts au libellé des onglets,
// commentaires en texte brut, « Traité », différentiel depuis la validation, aucun outil de l'admin.

const PATH = '/review/exercises/goblet-squat';
const SHEET_API = reviewSheetPath('goblet-squat');

/** Texte lu par un lecteur d'écran : ce qui est caché (`aria-hidden`) en moins, espaces resserrés. */
function spoken(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const region = (name: string) => screen.getByRole('region', { name });
/** Lignes d'une section de faits (Sensibilité, Caractéristiques), sans leurs boutons ni commentaires. */
const facts = (name: string) => [...region(name).querySelectorAll('[data-fact]')].map((el) => spoken(el));
/** Noms des boutons « Commenter : <partie> » visibles, dans l'ordre de la page. */
const commentButtons = (root: HTMLElement = document.body) =>
  within(root)
    .queryAllByRole('button', { name: /^(Commenter|Reprendre le commentaire) : / })
    .map((b) => b.getAttribute('aria-label'));
const tab = (name: string | RegExp) => screen.getByRole('tab', { name });
/** Pastilles de l'en-tête « État de la fiche », chacune lue à part. */
const statePills = () =>
  within(screen.getByRole('list', { name: 'État de la fiche' }))
    .getAllByRole('listitem')
    .map(spoken)
    .join(' ');

function openSheet(o: Parameters<typeof sheetResponse>[0] = {}, me = reviewer()) {
  const api = reviewApi({ sheets: { 'goblet-squat': ok(sheetResponse(o)) } });
  return openReview(PATH, { api, me }).then((view) => ({ ...view, api }));
}

beforeEach(() => {
  localStorage.clear();
});

describe('aperçu et valeurs de la sensibilité en clair (§4.5)', () => {
  it('fiche sensible : nom, état, version, puis niveau, mineurs et articulations écrits en toutes lettres', async () => {
    await openSheet({
      sheet: { level: 2, not_for_minors: true, stressed_joints: ['knees', 'lower_back'] },
      sensitive: true,
      greenLight: 'missing',
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Squat goblet' })).toBeTruthy();
    expect(statePills()).toBe('Relue Version 4');
    expect(facts('Sensibilité')).toEqual([
      'Fiche sensible · Feu vert santé : manquant',
      'Niveau 2 sur 3, intermédiaire',
      'Déconseillé aux mineurs : oui',
      'Articulations sollicitées : Genoux, Bas du dos',
    ]);
    // L'aperçu de la vue membre : pastilles, onglets, encadré Sécurité.
    expect(screen.getByRole('list', { name: "Caractéristiques de l'exercice" })).toBeTruthy();
    expect(screen.getByRole('tabpanel').textContent).toContain(
      'Arrête la série si tu ressens une douleur vive.',
    );
  });

  it('fiche non sensible ; feu vert à jour ou à refaire', async () => {
    const view = await openSheet();
    expect(facts('Sensibilité')).toEqual([
      'Fiche non sensible',
      'Niveau 1 sur 3, débutant',
      'Déconseillé aux mineurs : non',
      'Articulations sollicitées : Genoux, Hanches',
    ]);
    view.unmount();
    const stale = await openSheet({ sheet: { level: 3 }, sensitive: true, greenLight: 'stale' });
    expect(facts('Sensibilité')[0]).toBe('Fiche sensible · Feu vert santé : à refaire');
    stale.unmount();
    await openSheet({ sheet: { stressed_joints: [] }, sensitive: true, greenLight: 'ok' });
    expect(facts('Sensibilité')).toContain('Articulations sollicitées : aucune');
    expect(facts('Sensibilité')[0]).toBe('Fiche sensible · Feu vert santé : à jour');
  });

  it('caractéristiques : nom, muscles, matériel et illustrations', async () => {
    await openSheet({
      sheet: { illustrations: [{ illustration_id: 'goblet-squat-start', role: 'start' }] },
    });
    expect(facts('Caractéristiques')).toEqual([
      'Nom : Squat goblet',
      'Muscles principaux : Quadriceps, Fessiers',
      'Muscles secondaires : Adducteurs, Abdominaux',
      'Matériel : Haltères fixes ou réglables, ou Kettlebell',
      'Illustrations : 1 pose',
    ]);
  });

  it('brouillon (squelette) : champs pas encore rédigés annoncés, pas de validation', async () => {
    const {
      aliases: _a,
      primary_muscles: _p,
      secondary_muscles: _s,
      stressed_joints: _j,
      ...base
    } = REVIEW_SHEET;
    const { instructions: _i, key_points: _k, mistakes: _m, safety: _sa, breathing: _b, ...skeleton } = base;
    const { illustrations: _il, setup: _se, easier_tip: _e, ...rest } = skeleton;
    const api = reviewApi({
      sheets: {
        'goblet-squat': ok({
          ...sheetResponse({ queues: ['drafts'] }),
          sheet: { ...rest, status: 'draft', revision: 1 },
        }),
      },
    });
    await openReview(PATH, { api });
    expect(statePills()).toBe('Brouillon Version 1');
    expect(facts('Sensibilité')).toContain('Articulations sollicitées : pas encore renseignées');
    expect(facts('Caractéristiques')).toContain('Muscles principaux : pas encore renseignés');
    expect(facts('Caractéristiques')).toContain('Illustrations : aucune');
    expect(screen.queryByRole('button', { name: /J'ai relu|Sécurité vérifiée/ })).toBeNull();
    expect(commentButtons()).toContain('Commenter : Étapes');
  });

  it('notes de rédaction lisibles par la relectrice', async () => {
    await openSheet({ sheet: { review_notes: 'Vérifier la position des talons.' } });
    expect(region('Notes pour la relecture').textContent).toContain('Vérifier la position des talons.');
  });

  it('Retour vers la liste, avec le filtre actif', async () => {
    const api = reviewApi({ sheets: { 'goblet-squat': ok(sheetResponse()) } });
    await openReview(`${PATH}?queue=health_pending`, { api });
    expect(screen.getByRole('link', { name: 'Retour' }).getAttribute('href')).toBe(
      '/review/exercises?queue=health_pending',
    );
  });
});

describe('« Commenter » sur chaque partie (§4.5)', () => {
  it('hors onglets, puis dans chaque onglet ; l’onglet change l’adresse par remplacement', async () => {
    const view = await openSheet();
    expect(commentButtons(region('Sensibilité'))).toEqual([
      'Commenter : Niveau',
      'Commenter : Déconseillé aux mineurs',
      'Commenter : Articulations sollicitées',
    ]);
    expect(commentButtons(region('Caractéristiques'))).toEqual([
      'Commenter : Nom',
      'Commenter : Muscles',
      'Commenter : Matériel',
      'Commenter : Illustrations',
    ]);
    expect(commentButtons(region('Toute la fiche'))).toEqual(['Commenter : Toute la fiche']);
    expect(commentButtons(screen.getByRole('tabpanel'))).toEqual([
      'Commenter : Sécurité',
      'Commenter : Étapes',
      'Commenter : Points clés',
      'Commenter : Respiration',
      'Commenter : Réglage',
    ]);
    fireEvent.click(tab('Erreurs'));
    await until(() => view.location() === `${PATH}?tab=mistakes`);
    expect(commentButtons(screen.getByRole('tabpanel'))).toEqual([
      'Commenter : Sécurité',
      'Commenter : Erreurs',
    ]);
    fireEvent.click(tab('Variantes'));
    await until(() => view.location() === `${PATH}?tab=variants`);
    const variants = screen.getByRole('tabpanel');
    expect(commentButtons(variants)).toEqual(['Commenter : Sécurité', 'Commenter : Variantes']);
    expect(variants.textContent).toContain('Descends sur une chaise derrière toi.');
    expect(view.visits().filter((v) => v.startsWith(PATH))).toEqual([
      PATH,
      `${PATH}?tab=mistakes`,
      `${PATH}?tab=variants`,
    ]);
  });

  it('fiche retirée : on ne la commente plus, ses commentaires restent lisibles', async () => {
    await openSheet({
      sheet: { status: 'retired' },
      queues: [],
      comments: [reviewComment('c1', 'safety', { body: 'Avis resté ouvert.' })],
    });
    expect(commentButtons()).toEqual([]);
    expect(screen.getByText('Avis resté ouvert.')).toBeTruthy();
    expect(statePills()).toBe('Retirée Version 4');
  });
});

describe('commentaires : onglets, texte brut, « Traité » (§3.3, §4.5)', () => {
  const COMMENTS = [
    reviewComment('c-name', 'name', { body: 'Nom à revoir.', mine: true }),
    reviewComment('c-steps', 'instructions', { body: '<b>Trop</b> long\nDeuxième ligne', authorName: null }),
    reviewComment('c-key-open', 'key_points', { body: 'Point clé flou.' }),
    reviewComment('c-key-done', 'key_points', {
      body: 'Déjà traité.',
      resolvedAt: '2026-10-05T09:00:00.000Z',
      mine: true,
    }),
    reviewComment('c-mistakes', 'mistakes', { body: 'Correction trop vague.', revision: 3 }),
    reviewComment('c-safety', 'safety', { body: 'Ajouter la douleur au genou.' }),
  ];

  it('libellé de chaque onglet : nombre de commentaires ouverts de ses parties (« Erreurs · 1 commentaire »)', async () => {
    await openSheet({ comments: COMMENTS });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Comment faire · 2 commentaires',
      'Erreurs · 1 commentaire',
      'Variantes',
    ]);
  });

  it('commentaires sous leur partie, en texte brut : un <b> tapé s’affiche tel quel', async () => {
    await openSheet({ comments: COMMENTS });
    const steps = screen.getByRole('list', { name: 'Commentaires : Étapes' });
    const body = within(steps).getByText((_, el) => el?.textContent === '<b>Trop</b> long\nDeuxième ligne');
    expect(body.querySelector('b')).toBeNull();
    expect(body.innerHTML).toBe('&lt;b&gt;Trop&lt;/b&gt; long\nDeuxième ligne');
    expect(document.querySelector('[data-comment] b')).toBeNull();
    expect(spoken(within(steps).getByRole('listitem'))).toContain('Ancien relecteur · version 4');
    // Une révision dépassée est rappelée.
    fireEvent.click(tab(/^Erreurs/));
    await until(() => screen.queryByRole('list', { name: 'Commentaires : Erreurs' }) !== null);
    const mistakes = screen.getByRole('list', { name: 'Commentaires : Erreurs' });
    expect(spoken(mistakes)).toContain('zoe · version 3 · 05/10/2026 à 10:30');
  });

  it('relectrice : « Traité » sur ses commentaires ouverts seulement ; un traité porte la mention « Traité »', async () => {
    await openSheet({ comments: COMMENTS });
    const keyPoints = screen.getByRole('list', { name: 'Commentaires : Points clés' });
    const [open, done] = within(keyPoints).getAllByRole('listitem');
    expect(within(open as HTMLElement).queryByRole('button', { name: 'Traité' })).toBeNull();
    expect(within(done as HTMLElement).queryByRole('button', { name: 'Traité' })).toBeNull();
    expect(spoken(done as HTMLElement)).toContain('Traité');
    const name = screen.getByRole('list', { name: 'Commentaires : Nom' });
    expect(within(name).getByRole('button', { name: 'Traité' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Traité' })).toHaveLength(1);
  });

  it('admin : « Traité » sur tous les commentaires ouverts', async () => {
    await openSheet({ comments: COMMENTS }, admin());
    // Ouverts hors onglet (nom, sécurité) et de l'onglet Comment faire (étapes, point clé ouvert).
    expect(screen.getAllByRole('button', { name: 'Traité' })).toHaveLength(4);
  });

  it('« Traité » envoie un corps vide puis relit la fiche', async () => {
    let resolved = false;
    const resolvedAt = '2026-10-06T12:00:00.000Z';
    const current = () =>
      sheetResponse({
        comments: [
          reviewComment('c-name', 'name', {
            body: 'Nom à revoir.',
            mine: true,
            resolvedAt: resolved ? resolvedAt : null,
          }),
        ],
      });
    const api = reviewApi({ sheets: { 'goblet-squat': () => ok(current()) } }).on(
      'POST',
      '/api/review/comments/c-name/resolve',
      () => {
        resolved = true;
        return ok(reviewComment('c-name', 'name', { body: 'Nom à revoir.', mine: true, resolvedAt }));
      },
    );
    await openReview(PATH, { api });
    fireEvent.click(screen.getByRole('button', { name: 'Traité' }));
    await until(() => screen.queryByRole('button', { name: 'Traité' }) === null);
    const call = callsTo(api, '/api/review/comments/c-name/resolve', 'POST');
    expect(call).toHaveLength(1);
    expect(call[0]?.body).toEqual({});
    expect(callsTo(api, SHEET_API)).toHaveLength(2);
    expect(spoken(screen.getByRole('list', { name: 'Commentaires : Nom' }))).toContain('Traité');
  });
});

describe('ce qui a changé depuis ta validation (§3.2)', () => {
  it('chaque clé changée, avant et maintenant', async () => {
    await openSheet({
      sheet: { level: 2 },
      diff: ['level', 'safety'],
      diffBase: { revision: 3, values: { level: 1, safety: ['Ancienne consigne.'] } },
    });
    const changes = region('Modifié depuis ta validation');
    expect(changes.textContent).toContain('Version 3 validée, version 4 affichée.');
    expect([...changes.querySelectorAll('li')].map((li) => [...li.children].map(spoken).join(' '))).toEqual([
      'Niveau Avant : 1 Maintenant : 2',
      'Sécurité Avant : Ancienne consigne. Maintenant : Arrête la série si tu ressens une douleur vive.',
    ]);
  });

  it('rien à montrer sans validation ou sans changement', async () => {
    const view = await openSheet({ diff: [], diffBase: { revision: 4, values: {} }, validatedByMe: true });
    expect(screen.queryByRole('region', { name: 'Modifié depuis ta validation' })).toBeNull();
    expect(statePills()).toBe('Relue Version 4 Validée par toi');
    view.unmount();
    await openSheet({ diff: null });
    expect(screen.queryByRole('region', { name: 'Modifié depuis ta validation' })).toBeNull();
  });
});

describe('lecture de la fiche', () => {
  it('fiche inconnue : « Fiche introuvable. »', async () => {
    const api = reviewApi({ sheets: { 'goblet-squat': { status: 404, body: { error: 'not_found' } } } });
    await openReview(PATH, { api });
    expect(await screen.findByText('Fiche introuvable.')).toBeTruthy();
  });

  it('hors ligne : « Nécessite le réseau » et « Réessayer »', async () => {
    const api = reviewApi({ sheets: { 'goblet-squat': ok(sheetResponse()) } });
    api.setOffline('reject');
    await openReview(PATH, { api });
    expect((await screen.findByRole('alert')).textContent).toContain('Nécessite le réseau');
    api.setOffline(false);
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await screen.findByRole('heading', { level: 1, name: 'Squat goblet' });
  });

  it('403 d’un compte qui n’est plus relecteur : retour au Profil, sans boucle (Review Focus 4)', async () => {
    const api = revokeOn(reviewApi({}), 'GET', SHEET_API);
    const view = await openReview(PATH, { api });
    await until(() => view.location() === '/profile?reason=review_access_lost');
    expect(await screen.findByText("Tu n'as plus accès à la relecture.")).toBeTruthy();
    await settle();
    expect(view.visits().filter((v) => v.startsWith('/review'))).toEqual([PATH]);
    expect(callsTo(api, SHEET_API)).toHaveLength(1);
  });
});

describe('outils de l’admin absents pour une relectrice (§4.5)', () => {
  it('ni « Modifier » ni « Publier »', async () => {
    await openSheet({ queues: ['ready_to_publish'], validatedByMe: true });
    expect(screen.queryByRole('button', { name: /Modifier|Publier/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Modifier|Publier/ })).toBeNull();
  });
});
