import type { ReviewCommentView } from '@rune/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { settle } from '../support/auth';
import { createTestLocalDb } from '../support/local-db';
import {
  callsTo,
  ok,
  openReview,
  reviewApi,
  reviewComment,
  reviewSheetPath,
  revokeOn,
  sheetResponse,
} from '../support/review';
import { until } from '../support/wait';

// Feuille de commentaire (spec brique 2 §3.3 et §4.5, plan Task 16) : compteur « n / 1000 » sur le texte
// nettoyé, phrase de prudence sous le champ, envoi avec la révision affichée, brouillon gardé sur l'appareil
// jusqu'à l'envoi (une coupure ne le perd pas).

const PATH = '/review/exercises/goblet-squat';
const SHEET_API = reviewSheetPath('goblet-squat');
const COMMENTS_API = `${SHEET_API}/comments`;
const DRAFT_KEY = 'rune.review.draft.u-1.goblet-squat';
const CAUTION = "Parle de la fiche, pas de ta santé ni de celle d'un membre.";

const dialog = () => screen.getByRole('dialog');
const textarea = () =>
  within(dialog()).getByRole('textbox', { name: 'Ton commentaire' }) as HTMLTextAreaElement;
const send = () => within(dialog()).getByRole('button', { name: 'Envoyer' }) as HTMLButtonElement;
const counter = () => within(dialog()).getByText(/\/ 1000/);
const type = (value: string) => fireEvent.change(textarea(), { target: { value } });

async function openComment(part: string) {
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`^(Commenter|Reprendre le commentaire) : ${part}$`) }),
  );
  return screen.findByRole('dialog', { name: `Commenter : ${part}` });
}

/** Serveur : la fiche (avec les commentaires reçus), et l'envoi d'un commentaire. */
function commentingApi() {
  const received: ReviewCommentView[] = [];
  const api = reviewApi({
    sheets: { 'goblet-squat': () => ok(sheetResponse({ comments: [...received] })) },
  }).on('POST', COMMENTS_API, (req) => {
    const body = req.body as { part: ReviewCommentView['part']; body: string; baseRevision: number };
    const created = reviewComment(`c-${received.length + 1}`, body.part, {
      body: body.body,
      revision: body.baseRevision,
      authorName: 'lea',
      mine: true,
    });
    received.push(created);
    return { status: 201, body: created };
  });
  return { api, received };
}

beforeEach(() => {
  localStorage.clear();
});

describe('feuille de commentaire (§4.5)', () => {
  it('titre de la partie, champ, phrase de prudence et compteur en description, Envoyer inactif à vide', async () => {
    const { api } = commentingApi();
    await openReview(PATH, { api });
    const sheet = await openComment('Niveau');
    expect(within(sheet).getByText(CAUTION)).toBeTruthy();
    const described = (textarea().getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual([CAUTION, '0 / 1000']);
    expect(send().disabled).toBe(true);
  });

  it('« n / 1000 » compte le texte nettoyé, en caractères (un émoji compte pour un)', async () => {
    const { api } = commentingApi();
    await openReview(PATH, { api });
    await openComment('Niveau');
    type('Bonjour 💪');
    expect(counter().textContent).toBe('9 / 1000');
    type('  ab‮ \r\n ');
    expect(counter().textContent).toBe('2 / 1000');
    type('   ');
    expect(counter().textContent).toBe('0 / 1000');
    expect(send().disabled).toBe(true);
  });

  it('au-delà de 1000 : compteur « trop long », champ invalide, Envoyer inactif', async () => {
    const { api } = commentingApi();
    await openReview(PATH, { api });
    await openComment('Niveau');
    type('a'.repeat(1000));
    expect(counter().textContent).toBe('1000 / 1000');
    expect(send().disabled).toBe(false);
    type('a'.repeat(1001));
    expect(counter().textContent).toBe('1001 / 1000 · trop long');
    expect(textarea().getAttribute('aria-invalid')).toBe('true');
    expect(send().disabled).toBe(true);
  });

  it('Envoyer : partie, texte et révision affichée ; la fiche est relue, le brouillon effacé, le texte reste brut', async () => {
    const { api } = commentingApi();
    await openReview(PATH, { api });
    await openComment('Niveau');
    type('<b>Trop</b> dur pour un niveau 1');
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    fireEvent.click(send());
    await until(() => screen.queryByRole('dialog') === null);
    const calls = callsTo(api, COMMENTS_API, 'POST');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      part: 'level',
      body: '<b>Trop</b> dur pour un niveau 1',
      baseRevision: 4,
    });
    await until(() => callsTo(api, SHEET_API).length === 2);
    const list = await screen.findByRole('list', { name: 'Commentaires : Niveau' });
    expect(within(list).getByText('<b>Trop</b> dur pour un niveau 1').querySelector('b')).toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: 'Commenter : Niveau' })).toBeTruthy();
  });

  it('Annuler garde le brouillon : la même partie le retrouve', async () => {
    const { api } = commentingApi();
    await openReview(PATH, { api });
    await openComment('Niveau');
    type('À revoir');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Annuler' }));
    await until(() => screen.queryByRole('dialog') === null);
    expect(callsTo(api, COMMENTS_API, 'POST')).toHaveLength(0);
    await openComment('Niveau');
    expect(textarea().value).toBe('À revoir');
  });
});

describe('brouillon gardé sur l’appareil (§4.5)', () => {
  it('coupure à l’envoi : « Nécessite le réseau », saisie gardée ; appli rouverte : brouillon restauré pour la même partie', async () => {
    const { api } = commentingApi();
    const db = createTestLocalDb();
    const first = await openReview(PATH, { api, db });
    await openComment('Niveau');
    type('Les talons décollent souvent.');
    api.setOffline('reject');
    fireEvent.click(send());
    expect((await within(dialog()).findByRole('alert')).textContent).toContain('Nécessite le réseau');
    expect(textarea().value).toBe('Les talons décollent souvent.');
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')).toEqual({
      part: 'level',
      body: 'Les talons décollent souvent.',
    });
    first.unmount();

    // Réseau revenu, appli rouverte : la partie du brouillon le signale et le rend.
    api.setOffline(false);
    await openReview(PATH, { api, db });
    expect(screen.getByRole('button', { name: 'Reprendre le commentaire : Niveau' })).toBeTruthy();
    await openComment('Niveau');
    expect(textarea().value).toBe('Les talons décollent souvent.');
    expect(counter().textContent).toBe('29 / 1000');
    fireEvent.click(send());
    await until(() => screen.queryByRole('dialog') === null);
    expect(callsTo(api, COMMENTS_API, 'POST').at(-1)?.body).toEqual({
      part: 'level',
      body: 'Les talons décollent souvent.',
      baseRevision: 4,
    });
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('une autre partie part d’un champ vide ; y écrire remplace le brouillon (un seul par fiche)', async () => {
    const { api } = commentingApi();
    await openReview(PATH, { api });
    await openComment('Niveau');
    type('Brouillon du niveau');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Annuler' }));
    await until(() => screen.queryByRole('dialog') === null);
    await openComment('Nom');
    expect(textarea().value).toBe('');
    // Rien n'est écrit tant que rien n'est tapé.
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')?.part).toBe('level');
    type('Nom trop long');
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')).toEqual({
      part: 'name',
      body: 'Nom trop long',
    });
    // Champ vidé : plus de brouillon.
    type('');
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('brouillon d’un autre compte du même appareil : pas restauré', async () => {
    localStorage.setItem(
      'rune.review.draft.u-2.goblet-squat',
      JSON.stringify({ part: 'level', body: 'Autre' }),
    );
    const { api } = commentingApi();
    await openReview(PATH, { api });
    expect(screen.getByRole('button', { name: 'Commenter : Niveau' })).toBeTruthy();
    await openComment('Niveau');
    expect(textarea().value).toBe('');
  });
});

describe('refus à l’envoi', () => {
  it('403 d’un compte qui n’est plus relecteur : retour au Profil avec le message', async () => {
    const api = revokeOn(
      reviewApi({ sheets: { 'goblet-squat': ok(sheetResponse()) } }),
      'POST',
      COMMENTS_API,
    );
    const view = await openReview(PATH, { api });
    await openComment('Niveau');
    type('Encore là ?');
    fireEvent.click(send());
    await until(() => view.location() === '/profile?reason=review_access_lost');
    expect(await screen.findByText("Tu n'as plus accès à la relecture.")).toBeTruthy();
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('fiche retirée entre-temps (409 not_reviewable) : message dans la feuille, saisie gardée', async () => {
    const api = reviewApi({ sheets: { 'goblet-squat': ok(sheetResponse()) } }).on('POST', COMMENTS_API, {
      status: 409,
      body: { error: 'not_reviewable' },
    });
    await openReview(PATH, { api });
    await openComment('Niveau');
    type('Trop tard ?');
    fireEvent.click(send());
    expect((await within(dialog()).findByRole('alert')).textContent).toContain(
      "Cette fiche n'est pas ouverte à la relecture dans son état actuel.",
    );
    expect(textarea().value).toBe('Trop tard ?');
  });
});
