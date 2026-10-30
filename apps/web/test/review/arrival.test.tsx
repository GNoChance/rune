import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type MeResponse,
  REVIEW_QUEUES,
  type ReviewListItem,
  type ReviewListResponse,
  type ReviewQueue,
} from '@rune/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { type GuardResult, resolveGuard } from '../../src/App';
import { getMeta, setMeta } from '../../src/local-db/meta';
import { settle } from '../support/auth';
import { parseCssBlocks } from '../support/css-blocks';
import { createFakeApi, createFakeSyncEngine, type FakeApi, type FakeReply } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { makeMe, renderApp } from '../support/render';
import { until } from '../support/wait';

// Arrivée des relectrices (spec brique 2 §4.4, plan Task 15) : carte d'accueil en ligne seulement, ligne du Profil,
// garde de /review…, rôle perdu en pleine session (Review Focus 4), « Comment relire » au premier passage et
// depuis Aide.

const reviewer = (o: Partial<MeResponse> = {}) => makeMe({ catalogReviewer: true, ...o });
const healthReviewer = (o: Partial<MeResponse> = {}) => reviewer({ healthProfessional: true, ...o });
const admin = (o: Partial<MeResponse> = {}) => makeMe({ role: 'admin', ...o });
/** `meta.me` gardé par une version d'avant la brique 2 : ni `catalogReviewer` ni `healthProfessional`. */
function oldCachedMe(o: Partial<MeResponse> = {}): MeResponse {
  const { catalogReviewer: _c, healthProfessional: _h, ...rest } = makeMe(o);
  return rest as MeResponse;
}

function item(id: string, queues: ReviewQueue[], o: Partial<ReviewListItem> = {}): ReviewListItem {
  return {
    id,
    name: `Fiche ${id}`,
    status: 'reviewed',
    batch: 'A',
    revision: 2,
    movementPattern: 'squat',
    level: 1,
    notForMinors: false,
    stressedJoints: [],
    sensitive: false,
    openComments: 0,
    greenLight: 'missing',
    validatedByMe: false,
    illustrationCount: 0,
    queues,
    ...o,
  };
}

function listBody(items: ReviewListItem[]): ReviewListResponse {
  const counts = Object.fromEntries(
    REVIEW_QUEUES.map((q) => [q, items.filter((i) => i.queues.includes(q)).length]),
  ) as ReviewListResponse['counts'];
  return { items, counts, progress: [{ batch: 'A', published: 0, total: items.length }] };
}

const LIST = '/api/review/exercises';
const reviewApi = (reply: FakeReply | (() => FakeReply)): FakeApi => createFakeApi().on('GET', LIST, reply);
const listCalls = (api: FakeApi) => api.calls.filter((c) => c.path === LIST);

/** Carte de l'accueil, par son texte entier (« Relecture : … »). */
const card = () => screen.queryByRole('link', { name: /^Relecture : / });

/** Accueil d'un relecteur (« Comment relire » déjà vu), attendu jusqu'au titre et aux lectures faites. */
async function openHome(o: {
  me: MeResponse;
  api?: FakeApi;
  sync?: ReturnType<typeof createFakeSyncEngine>;
}) {
  const db = createTestLocalDb();
  const view = await renderApp({ path: '/', me: o.me, api: o.api, sync: o.sync, db });
  await screen.findByRole('heading', { level: 1 });
  await settle();
  return view;
}

beforeEach(() => {
  localStorage.clear();
});

describe('carte d’accueil « Relecture : N fiches t’attendent » (§4.4)', () => {
  it('relectrice en ligne : N = fiches à relire, la carte ouvre la relecture', async () => {
    const api = reviewApi({
      status: 200,
      body: listBody([
        item('a', ['to_review']),
        item('b', ['to_review', 'mine']),
        item('c', ['to_review']),
        item('d', ['drafts'], { status: 'draft' }),
        item('e', ['ready_to_publish'], { validatedByMe: true }),
      ]),
    });
    await openHome({ me: reviewer(), api });
    const link = await screen.findByRole('link', { name: "Relecture : 3 fiches t'attendent" });
    expect(link.getAttribute('href')).toBe('/review/exercises');
    expect(listCalls(api)).toHaveLength(1);
  });

  it('une seule fiche : « Relecture : 1 fiche t’attend »', async () => {
    await openHome({
      me: reviewer(),
      api: reviewApi({ status: 200, body: listBody([item('a', ['to_review'])]) }),
    });
    expect(await screen.findByRole('link', { name: "Relecture : 1 fiche t'attend" })).toBeTruthy();
  });

  it('relectrice santé : N compte aussi « Feu vert santé » et « À revalider », chaque fiche une seule fois', async () => {
    const items = [
      item('a', ['to_review', 'health_pending'], { sensitive: true }),
      item('b', ['to_review']),
      item('c', ['revalidate'], { status: 'published', sensitive: true }),
      item('d', ['health_pending'], { sensitive: true, validatedByMe: true }),
      item('e', ['drafts'], { status: 'draft' }),
    ];
    const view = await openHome({
      me: healthReviewer(),
      api: reviewApi({ status: 200, body: listBody(items) }),
    });
    expect(await screen.findByRole('link', { name: "Relecture : 4 fiches t'attendent" })).toBeTruthy();
    view.unmount();
    // Sans le drapeau santé (ou admin, jamais relecteur santé), seules les fiches à relire comptent.
    await openHome({
      me: admin({ healthProfessional: true }),
      api: reviewApi({ status: 200, body: listBody(items) }),
    });
    expect(await screen.findByRole('link', { name: "Relecture : 2 fiches t'attendent" })).toBeTruthy();
  });

  it('N = 0 : pas de carte, une fois la réponse reçue', async () => {
    const body = listBody([item('d', ['drafts'], { status: 'draft' }), item('e', ['mine'])]);
    const api = reviewApi({ status: 200, body });
    await openHome({ me: healthReviewer(), api });
    await until(() => listCalls(api).length === 1);
    await settle();
    expect(card()).toBeNull();
  });

  it('hors ligne ou appel en échec : pas de carte', async () => {
    const offline = reviewApi({ status: 200, body: listBody([item('a', ['to_review'])]) });
    offline.setOffline('reject');
    const first = await openHome({ me: reviewer(), api: offline });
    expect(card()).toBeNull();
    first.unmount();
    const failing = reviewApi({ status: 500, body: { error: 'internal' } });
    await openHome({ me: reviewer(), api: failing });
    await until(() => listCalls(failing).length === 1);
    await settle();
    expect(card()).toBeNull();
  });

  it('jamais depuis un cache : vue en ligne, puis accueil rouvert hors ligne sur la même base, pas de carte', async () => {
    const db = createTestLocalDb();
    const api = reviewApi({ status: 200, body: listBody([item('a', ['to_review'])]) });
    const online = await renderApp({ path: '/', me: reviewer(), api, db });
    await screen.findByRole('link', { name: "Relecture : 1 fiche t'attend" });
    online.unmount();
    api.setOffline('reject');
    await renderApp({ path: '/', me: reviewer(), api, db });
    await screen.findByRole('heading', { level: 1 });
    await settle();
    expect(card()).toBeNull();
  });

  it('connexion perdue : la carte part et rien n’est demandé ; retrouvée : la liste est relue', async () => {
    const sync = createFakeSyncEngine({ connection: 'offline' });
    const api = reviewApi({ status: 200, body: listBody([item('a', ['to_review'])]) });
    await openHome({ me: reviewer(), api, sync });
    expect(listCalls(api)).toHaveLength(0);
    expect(card()).toBeNull();
    sync.set({ connection: 'online' });
    await screen.findByRole('link', { name: "Relecture : 1 fiche t'attend" });
    sync.set({ connection: 'offline' });
    await until(() => card() === null);
    expect(listCalls(api)).toHaveLength(1);
  });

  it('membre, ou profil en cache sans drapeaux : ni requête de relecture ni carte', async () => {
    const api = reviewApi({ status: 200, body: listBody([item('a', ['to_review'])]) });
    const member = await openHome({ me: makeMe(), api });
    expect(card()).toBeNull();
    member.unmount();
    await openHome({ me: oldCachedMe(), api });
    expect(card()).toBeNull();
    expect(listCalls(api)).toHaveLength(0);
  });

  it('accès perdu depuis le dernier profil lu : pas de carte, profil relu, l’accueil reste affiché', async () => {
    // Profil du lancement illisible (404 : le cache reste) ; ensuite, le serveur dit « plus relectrice ».
    let meReads = 0;
    const api = createFakeApi()
      .on('GET', LIST, { status: 403, body: { error: 'forbidden' } })
      .on('GET', '/api/me', () =>
        ++meReads === 1 ? { status: 404, body: { error: 'not_found' } } : { status: 200, body: makeMe() },
      );
    const view = await openHome({ me: reviewer(), api });
    await until(() => meReads >= 3);
    await settle();
    expect((await getMeta(view.db, 'me'))?.catalogReviewer).toBe(false);
    expect(card()).toBeNull();
    expect(view.visits()).toEqual(['/']);
    expect(listCalls(api)).toHaveLength(1);
  });
});

describe('Profil › Cercle › « Relecture des exercices » (§4.4)', () => {
  /** Libellé de chaque lien du groupe `title`. */
  const rowLabels = (title: string) => {
    const section = screen.getByRole('heading', { level: 2, name: title }).closest('section');
    if (!section) throw new Error(`aucun groupe ${title}`);
    return within(section)
      .getAllByRole('link')
      .map((a) => document.getElementById(a.getAttribute('aria-labelledby') ?? '')?.textContent);
  };
  const description = (el: Element) =>
    (el.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
  const reviewRow = () => screen.queryByRole('link', { name: 'Relecture des exercices' });

  async function openProfile(me: MeResponse) {
    const view = await renderApp({ path: '/profile', me });
    await screen.findByRole('heading', { level: 1, name: 'Profil' });
    return view;
  }

  it('relectrice : groupe Cercle, une seule ligne, vers /review/exercises', async () => {
    await openProfile(reviewer());
    expect(rowLabels('Cercle')).toEqual(['Relecture des exercices']);
    const row = reviewRow();
    expect(row?.getAttribute('href')).toBe('/review/exercises');
    expect(description(row as Element)).toBe('Commenter et valider les fiches');
  });

  it('relectrice santé : la ligne dit son feu vert santé (elle voit ses propres drapeaux)', async () => {
    await openProfile(healthReviewer());
    expect(description(reviewRow() as Element)).toBe('Commenter, donner le feu vert santé');
  });

  it('admin : Administration puis Relecture des exercices', async () => {
    await openProfile(admin());
    expect(rowLabels('Cercle')).toEqual(['Administration', 'Relecture des exercices']);
    expect(description(reviewRow() as Element)).toBe('Corriger, valider et publier les fiches');
  });

  it('membre, drapeau santé seul, ou profil en cache sans drapeaux : ni groupe Cercle ni ligne', async () => {
    for (const me of [makeMe(), makeMe({ healthProfessional: true }), oldCachedMe()]) {
      const view = await openProfile(me);
      expect(screen.queryByRole('heading', { level: 2, name: 'Cercle' })).toBeNull();
      expect(reviewRow()).toBeNull();
      view.unmount();
    }
  });
});

describe('garde web de /review… (comme /admin)', () => {
  const RENDER: GuardResult = { kind: 'render' };
  const NOT_FOUND: GuardResult = { kind: 'not_found' };
  const ROWS: [string, MeResponse, GuardResult][] = [
    ['/review/exercises', makeMe(), NOT_FOUND],
    ['/review', makeMe(), NOT_FOUND],
    ['/review/exercises/push-up', makeMe({ healthProfessional: true }), NOT_FOUND],
    ['/Review/Exercises', makeMe(), NOT_FOUND],
    ['/review/exercises', oldCachedMe(), NOT_FOUND],
    ['/review/exercises', oldCachedMe({ role: 'admin' }), RENDER],
    ['/review/exercises', reviewer(), RENDER],
    ['/review/exercises/push-up', healthReviewer(), RENDER],
    ['/review', admin(), RENDER],
    ['/reviews', makeMe(), RENDER],
    ['/review/exercises', reviewer({ onboardingCompletedAt: null }), { kind: 'redirect', to: '/onboarding' }],
  ];
  it.each(ROWS)('%s', (path, me, expected) => {
    expect(resolveGuard({ path, loaded: true, me, connection: 'online' })).toEqual(expected);
  });

  it('membre sur /review/exercises : page introuvable, aucune requête de relecture', async () => {
    const api = reviewApi({ status: 200, body: listBody([]) });
    await renderApp({ path: '/review/exercises', me: makeMe(), api });
    expect(await screen.findByRole('heading', { level: 1, name: 'Page introuvable' })).toBeTruthy();
    await settle();
    expect(listCalls(api)).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('relectrice : page « Relecture » (provisoire, en attendant l’écran de relecture)', async () => {
    const db = createTestLocalDb();
    await setMeta(db, 'reviewIntroSeen', 'u-1');
    const api = reviewApi({ status: 200, body: listBody([]) });
    const view = await renderApp({ path: '/review', me: reviewer(), api, db });
    expect(await screen.findByRole('heading', { level: 1, name: 'Relecture' })).toBeTruthy();
    expect(view.location()).toBe('/review/exercises');
  });
});

describe('rôle perdu en pleine session (Review Focus 4)', () => {
  it('403 : « Tu n’as plus accès à la relecture. », retour au Profil, profil relu, sans boucle', async () => {
    let revoked = false;
    const api = createFakeApi()
      .on('GET', '/api/me', () => ({ status: 200, body: revoked ? makeMe() : reviewer() }))
      .on('GET', LIST, () =>
        revoked
          ? { status: 403, body: { error: 'forbidden' } }
          : { status: 200, body: listBody([item('a', ['to_review'])]) },
      );
    const db = createTestLocalDb();
    await setMeta(db, 'reviewIntroSeen', 'u-1');
    const view = await renderApp({ path: '/', me: reviewer(), api, db });
    const homeCard = await screen.findByRole('link', { name: "Relecture : 1 fiche t'attend" });

    // L'admin retire le drapeau ; la relectrice touche la carte.
    revoked = true;
    fireEvent.click(homeCard);
    await until(() => view.location() === '/profile?reason=review_access_lost');
    const notice = await screen.findByText("Tu n'as plus accès à la relecture.");
    expect(notice.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Profil' })).toBeTruthy();

    // Profil relu : la ligne de relecture disparaît ; rien ne renvoie vers /review.
    await until(() => screen.queryByRole('link', { name: 'Relecture des exercices' }) === null);
    expect((await getMeta(db, 'me'))?.catalogReviewer).toBe(false);
    await settle();
    expect(view.location()).toBe('/profile?reason=review_access_lost');
    expect(view.visits().filter((v) => v.startsWith('/review'))).toEqual(['/review/exercises']);
    expect(view.visits().at(-1)).toBe('/profile?reason=review_access_lost');
    expect(listCalls(api)).toHaveLength(2);
  });

  it('le Profil sans raison n’affiche pas le message', async () => {
    await renderApp({ path: '/profile', me: reviewer() });
    await screen.findByRole('heading', { level: 1, name: 'Profil' });
    expect(screen.queryByText("Tu n'as plus accès à la relecture.")).toBeNull();
  });
});

describe('« Comment relire » (§4.4) : premier passage, une fois par compte, et depuis Aide', () => {
  const TERMS = ['Version', 'Sensible', 'Feu vert santé', 'À revalider', 'Prête à publier'];
  /** Les 5 mots expliqués, chacun suivi de sa phrase. */
  function explainedTerms(dialog: HTMLElement): string[] {
    const terms = [...dialog.querySelectorAll('dt')];
    for (const term of terms) {
      const definition = term.nextElementSibling;
      expect(definition?.tagName).toBe('DD');
      expect(definition?.textContent?.trim().endsWith('.')).toBe(true);
    }
    return terms.map((t) => t.textContent ?? '');
  }

  it('premier passage sur la relecture : la feuille s’ouvre avec les 5 mots, puis plus jamais pour ce compte', async () => {
    const db = createTestLocalDb();
    const api = reviewApi({ status: 200, body: listBody([]) });
    const first = await renderApp({ path: '/review/exercises', me: reviewer(), api, db });
    const dialog = await screen.findByRole('dialog', { name: 'Comment relire' });
    expect(explainedTerms(dialog)).toEqual(TERMS);
    expect(dialog.textContent).toContain('chaque modification crée une nouvelle version');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fermer' }));
    await until(() => screen.queryByRole('dialog') === null);
    expect(await getMeta(db, 'reviewIntroSeen')).toBe('u-1');
    first.unmount();

    await renderApp({ path: '/review/exercises', me: reviewer(), api, db });
    await screen.findByRole('heading', { level: 1, name: 'Relecture' });
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('un autre compte sur le même appareil : la feuille s’ouvre pour lui', async () => {
    const db = createTestLocalDb();
    await setMeta(db, 'reviewIntroSeen', 'u-1');
    await renderApp({ path: '/review/exercises', me: reviewer({ id: 'u-2', username: 'zoe' }), db });
    expect(await screen.findByRole('dialog', { name: 'Comment relire' })).toBeTruthy();
  });

  it('pas ailleurs que sur la relecture (accueil)', async () => {
    await openHome({ me: reviewer(), api: reviewApi({ status: 200, body: listBody([]) }) });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('depuis Aide : « Comment relire » rouvre la feuille pour un relecteur', async () => {
    const db = createTestLocalDb();
    await setMeta(db, 'reviewIntroSeen', 'u-1');
    await renderApp({ path: '/help', me: reviewer(), db });
    await screen.findByRole('heading', { level: 1, name: 'Aide' });
    fireEvent.click(await screen.findByRole('button', { name: 'Comment relire' }));
    const dialog = await screen.findByRole('dialog', { name: 'Comment relire' });
    expect(explainedTerms(dialog)).toEqual(TERMS);
  });

  it('Aide d’un membre ou sans session : pas de « Comment relire »', async () => {
    const member = await renderApp({ path: '/help', me: makeMe() });
    await screen.findByRole('heading', { level: 1, name: 'Aide' });
    await settle();
    expect(screen.queryByRole('button', { name: 'Comment relire' })).toBeNull();
    member.unmount();
    await renderApp({ path: '/help', me: null });
    await screen.findByRole('heading', { level: 1, name: 'Aide' });
    await settle();
    expect(screen.queryByRole('button', { name: 'Comment relire' })).toBeNull();
  });
});

describe('feuille de la relecture (review.module.css)', () => {
  const css = readFileSync(
    resolve(import.meta.dirname, '../../src/features/review/review.module.css'),
    'utf8',
  );

  it('couleurs prises dans les jetons : ni hexadécimal, ni rgb() en dur, hors ombres', () => {
    const withoutShadows = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/box-shadow:[^;]*;/g, '');
    expect(
      withoutShadows.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi) ?? [],
    ).toEqual([]);
  });

  it('carte d’accueil : cible d’au moins 44 px de haut', () => {
    const block = parseCssBlocks(css).find((b) => b.media === null && b.selector === '.homeCard');
    expect(Number.parseFloat(block?.declarations.get('min-height') ?? '')).toBeGreaterThanOrEqual(44);
  });
});
