import type { ReviewListResponse, ReviewSheetResponse, ReviewValidationView } from '@rune/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { settle } from '../support/auth';
import { illustrationEntry, seedCatalog } from '../support/catalog';
import type { FakeApi, FakeReply } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import {
  admin,
  callsTo,
  ok,
  openReview,
  REVIEW_LIST,
  REVIEW_SHEET,
  reviewApi,
  reviewComment,
  reviewer,
  reviewItem,
  reviewList,
  reviewSheetPath,
  sheetResponse,
} from '../support/review';
import { until } from '../support/wait';

// Outils de l'admin dans la relecture (spec brique 2 §4.5, §3.6, §3.8, plan Task 17) : « Publier » désactivé avec
// les messages du §3.6 dessous, boutons de statut du circuit (`EXERCISE_TRANSITIONS`), bandeau « Publiée, feu vert
// santé à refaire », validations nominatives et version exportée ; dans la liste, filtres par type de mouvement et
// sans illustration, compteurs « à exporter » et « à remplacer avant publication », « Exporter le catalogue ».

const PATH = '/review/exercises/goblet-squat';
const SHEET_API = reviewSheetPath('goblet-squat');
const TRANSITION_API = '/api/admin/exercises/goblet-squat/transition';

/** Squat goblet relu, version 4, non sensible (hanches seulement) : vue de l'admin. */
function adminView(o: Parameters<typeof sheetResponse>[0] = {}): ReviewSheetResponse {
  const { sheet, ...rest } = o;
  return sheetResponse({
    validations: [],
    exportedRevision: 4,
    ...rest,
    sheet: { stressed_joints: ['hips'], ...sheet },
  });
}

/** L'admin sur la fiche : le faux serveur répond `view` (ou la fonction) à la lecture. */
async function openAsAdmin(
  view: ReviewSheetResponse | (() => FakeReply),
  o: { api?: FakeApi; db?: ReturnType<typeof createTestLocalDb> } = {},
) {
  const api = o.api ?? reviewApi({});
  api.on('GET', SHEET_API, typeof view === 'function' ? view : ok(view));
  const rendered = await openReview(PATH, { me: admin(), api, db: o.db });
  return { ...rendered, api };
}

const adminRegion = () => screen.getByRole('region', { name: 'Administration' });
const adminButtons = () =>
  within(adminRegion())
    .getAllByRole('button')
    .map((b) => b.textContent);
const publishButton = () =>
  within(adminRegion()).getByRole('button', { name: 'Publier' }) as HTMLButtonElement;
const blockers = (root: HTMLElement, name: string) =>
  within(within(root).getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);
const dialog = () => screen.getByRole('dialog');
const statePills = () =>
  within(screen.getByRole('list', { name: 'État de la fiche' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)
    .join(' ');

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('« Publier » et ses blocages (§4.5, §3.6)', () => {
  it('fiche relue prête à publier : « Publier » actif, rien d’écrit dessous', async () => {
    await openAsAdmin(adminView({ queues: ['ready_to_publish'] }));
    expect(publishButton().disabled).toBe(false);
    expect(within(adminRegion()).queryByRole('list', { name: 'Blocages de la publication' })).toBeNull();
  });

  it('blocages : « Publier » désactivé, messages du §3.6 écrits dessous dans l’ordre fixe', async () => {
    await openAsAdmin(
      adminView({
        sheet: {
          stressed_joints: ['knees'],
          illustrations: [{ illustration_id: 'goblet-squat-start', role: 'start' }],
        },
        sensitive: true,
        greenLight: 'stale',
        queues: ['health_pending'],
        comments: [
          reviewComment('c-1', 'safety'),
          reviewComment('c-2', 'general', { resolvedAt: '2026-10-05T09:00:00.000Z' }),
          reviewComment('c-3', 'mistakes'),
        ],
      }),
    );
    expect(publishButton().disabled).toBe(true);
    // Le manifeste local est lu juste après la fiche.
    await until(() => blockers(adminRegion(), 'Blocages de la publication').length === 3);
    expect(blockers(adminRegion(), 'Blocages de la publication')).toEqual([
      '2 commentaires ne sont pas traités.',
      'Il manque le feu vert santé sur cette version.',
      "Une illustration n'est pas dans le manifeste.",
    ]);
    // Les messages décrivent le bouton.
    const describedBy = publishButton().getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.getAttribute('aria-label')).toBe(
      'Blocages de la publication',
    );
  });

  it('un seul commentaire ouvert ; illustration présente dans le manifeste local : pas de message sur les illustrations', async () => {
    const db = createTestLocalDb();
    await seedCatalog(db, [], [illustrationEntry('goblet-squat-start')]);
    await openAsAdmin(
      adminView({
        sheet: { illustrations: [{ illustration_id: 'goblet-squat-start', role: 'start' }] },
        queues: [],
        comments: [reviewComment('c-1', 'safety')],
      }),
      { db },
    );
    expect(blockers(adminRegion(), 'Blocages de la publication')).toEqual([
      "1 commentaire n'est pas traité.",
    ]);
  });

  it('le serveur la dit bloquée sans cause visible ici : seule reste l’illustration absente du manifeste', async () => {
    await openAsAdmin(adminView({ queues: [] }));
    expect(publishButton().disabled).toBe(true);
    expect(blockers(adminRegion(), 'Blocages de la publication')).toEqual([
      "Une illustration n'est pas dans le manifeste.",
    ]);
  });

  it('« Publier » : feuille qui rappelle la version, POST transition {to, baseRevision}, fiche mise à jour depuis la réponse', async () => {
    const published = adminView({ sheet: { status: 'published', revision: 5 }, queues: [] });
    const api = reviewApi({}).on('POST', TRANSITION_API, ok(published));
    await openAsAdmin(adminView({ queues: ['ready_to_publish'] }), { api });
    fireEvent.click(publishButton());
    expect(dialog().getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Publier la version 4' })).toBeTruthy();
    expect(dialog().textContent).toContain(
      'Les membres recevront la version 4 à leur prochaine synchronisation.',
    );
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Publier' }));
    await until(() => screen.queryByRole('dialog') === null);
    expect(callsTo(api, TRANSITION_API, 'POST').map((c) => c.body)).toEqual([
      { to: 'published', baseRevision: 4 },
    ]);
    expect(statePills()).toBe('Publiée Version 5');
    expect(await screen.findByText('Statut enregistré : Publiée.')).toBeTruthy();
    expect(adminButtons()).toEqual(['Modifier', 'Retirer']);
    // La réponse suffit : pas de seconde lecture de la fiche.
    expect(callsTo(api, SHEET_API)).toHaveLength(1);
  });

  it('422 transition_blocked : messages du serveur écrits dans la feuille, fiche relue', async () => {
    const api = reviewApi({}).on('POST', TRANSITION_API, {
      status: 422,
      body: { error: 'transition_blocked', blockers: ['health_validation_missing'] },
    });
    let reads = 0;
    await openAsAdmin(
      () => {
        reads += 1;
        return ok(adminView({ queues: reads === 1 ? ['ready_to_publish'] : ['health_pending'] }));
      },
      { api },
    );
    fireEvent.click(publishButton());
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Publier' }));
    await until(() => within(dialog()).queryByRole('list', { name: 'Blocages' }) !== null);
    expect(blockers(dialog(), 'Blocages')).toEqual(['Il manque le feu vert santé sur cette version.']);
    await until(() => reads === 2);
  });

  it('409 revision_conflict : feuille fermée, « La fiche a changé depuis que tu l’as ouverte. », fiche relue', async () => {
    const current = sheetResponse({ sheet: { revision: 5 } }).sheet;
    const api = reviewApi({}).on('POST', TRANSITION_API, {
      status: 409,
      body: { error: 'revision_conflict', current },
    });
    let reads = 0;
    await openAsAdmin(
      () => {
        reads += 1;
        return ok(adminView({ sheet: { revision: 3 + reads }, queues: ['ready_to_publish'] }));
      },
      { api },
    );
    fireEvent.click(publishButton());
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Publier' }));
    expect(await screen.findByText("La fiche a changé depuis que tu l'as ouverte.")).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await until(() => statePills() === 'Relue Version 5 Prête à publier');
  });

  it('hors ligne : « Nécessite le réseau » dans la feuille, qui reste ouverte', async () => {
    const { api } = await openAsAdmin(adminView({ queues: ['ready_to_publish'] }));
    fireEvent.click(publishButton());
    api.setOffline('reject');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Publier' }));
    expect(await within(dialog()).findByText('Nécessite le réseau')).toBeTruthy();
  });
});

describe('changements de statut du circuit (04 §8, EXERCISE_TRANSITIONS)', () => {
  it('« Modifier », puis un bouton par transition permise depuis le statut de la fiche', async () => {
    const cases = [
      { status: 'draft', buttons: ['Modifier', 'Marquer relue', 'Retirer'] },
      { status: 'reviewed', buttons: ['Modifier', 'Publier', 'Renvoyer en brouillon', 'Retirer'] },
      { status: 'published', buttons: ['Modifier', 'Retirer'] },
      { status: 'retired', buttons: ['Modifier', 'Réactiver'] },
    ] as const;
    for (const c of cases) {
      const view = await openAsAdmin(adminView({ sheet: { status: c.status }, queues: [] }));
      expect(adminButtons()).toEqual(c.buttons);
      view.unmount();
    }
  });

  it('brouillon → relue : deux cases à cocher, leurs messages tant qu’elles ne le sont pas, puis reviewChecked et minorsConfirmed envoyés', async () => {
    const reviewed = adminView({ sheet: { status: 'reviewed', revision: 5 }, queues: ['to_review'] });
    const api = reviewApi({}).on('POST', TRANSITION_API, ok(reviewed));
    await openAsAdmin(adminView({ sheet: { status: 'draft' }, queues: ['drafts'] }), { api });
    fireEvent.click(within(adminRegion()).getByRole('button', { name: 'Marquer relue' }));
    expect(screen.getByRole('dialog', { name: 'Marquer la version 4 relue' })).toBeTruthy();
    const confirm = within(dialog()).getByRole('button', { name: 'Marquer relue' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(blockers(dialog(), 'Blocages')).toEqual([
      'Coche « Consignes et sécurité vérifiées ».',
      'Confirme le réglage « Déconseillé aux mineurs ».',
    ]);
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Consignes et sécurité vérifiées' }));
    expect(blockers(dialog(), 'Blocages')).toEqual(['Confirme le réglage « Déconseillé aux mineurs ».']);
    fireEvent.click(
      within(dialog()).getByRole('checkbox', {
        name: 'Réglage « Déconseillé aux mineurs » confirmé : non',
      }),
    );
    expect(within(dialog()).queryByRole('list', { name: 'Blocages' })).toBeNull();
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await until(() => screen.queryByRole('dialog') === null);
    expect(callsTo(api, TRANSITION_API, 'POST').map((c) => c.body)).toEqual([
      { to: 'reviewed', baseRevision: 4, reviewChecked: true, minorsConfirmed: true },
    ]);
    expect(statePills()).toBe('Relue Version 5');
  });

  it('brouillon incomplet : « Des champs obligatoires sont vides. » et « Marquer relue » inactif, même cases cochées', async () => {
    const { safety: _s, breathing: _b, ...skeleton } = REVIEW_SHEET;
    const api = reviewApi({});
    api.on(
      'GET',
      SHEET_API,
      ok({ ...adminView({ queues: ['drafts'] }), sheet: { ...skeleton, status: 'draft' } }),
    );
    await openReview(PATH, { me: admin(), api });
    fireEvent.click(within(adminRegion()).getByRole('button', { name: 'Marquer relue' }));
    for (const box of within(dialog()).getAllByRole('checkbox')) fireEvent.click(box);
    expect(blockers(dialog(), 'Blocages')).toEqual(['Des champs obligatoires sont vides.']);
    expect(
      (within(dialog()).getByRole('button', { name: 'Marquer relue' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('« Retirer » refusé (422 chain_break, referenced_by_template) : messages du serveur dans la feuille', async () => {
    const api = reviewApi({}).on('POST', TRANSITION_API, {
      status: 422,
      body: { error: 'transition_blocked', blockers: ['referenced_by_template', 'chain_break'] },
    });
    await openAsAdmin(adminView({ sheet: { status: 'published' }, queues: [] }), { api });
    fireEvent.click(within(adminRegion()).getByRole('button', { name: 'Retirer' }));
    expect(screen.getByRole('dialog', { name: 'Retirer « Squat goblet »' })).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Retirer' }));
    await until(() => within(dialog()).queryByRole('list', { name: 'Blocages' }) !== null);
    expect(blockers(dialog(), 'Blocages')).toEqual([
      'Un modèle de programme utilise cette fiche.',
      'Retirer cette fiche couperait sa chaîne.',
    ]);
    expect(callsTo(api, TRANSITION_API, 'POST').map((c) => c.body)).toEqual([
      { to: 'retired', baseRevision: 4 },
    ]);
  });

  it('« Réactiver » une fiche retirée au plafond : « Le catalogue a atteint 300 fiches. »', async () => {
    const api = reviewApi({}).on('POST', TRANSITION_API, {
      status: 422,
      body: { error: 'transition_blocked', blockers: ['catalog_full'] },
    });
    await openAsAdmin(adminView({ sheet: { status: 'retired' }, queues: [] }), { api });
    fireEvent.click(within(adminRegion()).getByRole('button', { name: 'Réactiver' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Réactiver' }));
    await until(() => within(dialog()).queryByRole('list', { name: 'Blocages' }) !== null);
    expect(blockers(dialog(), 'Blocages')).toEqual(['Le catalogue a atteint 300 fiches.']);
  });
});

describe('ce que seul l’admin voit sur la fiche (§3.1, §3.6)', () => {
  it('fiche publiée à revalider : bandeau « Publiée, feu vert santé à refaire » ; pas pour une relectrice', async () => {
    const view = adminView({
      sheet: { status: 'published', stressed_joints: ['knees'] },
      sensitive: true,
      greenLight: 'stale',
      queues: ['revalidate'],
    });
    const rendered = await openAsAdmin(view);
    expect(screen.getByText('Publiée, feu vert santé à refaire')).toBeTruthy();
    rendered.unmount();
    const { validations: _v, exportedRevision: _e, ...asReviewer } = view;
    await openReview(PATH, {
      me: reviewer(),
      api: reviewApi({ sheets: { 'goblet-squat': ok(asReviewer) } }),
    });
    expect(screen.queryByText('Publiée, feu vert santé à refaire')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Administration' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Validations' })).toBeNull();
  });

  it('validations nominatives : qui, quelle version, relecture ou feu vert santé, et s’il compte encore', async () => {
    const validation = (o: Partial<ReviewValidationView>): ReviewValidationView => ({
      id: 'v',
      reviewerId: 'u-2',
      reviewerName: 'zoe',
      revision: 4,
      health: false,
      standing: true,
      createdAt: '2026-10-05T08:30:00.000Z',
      ...o,
    });
    await openAsAdmin(
      adminView({
        validations: [
          validation({ id: 'v-1' }),
          validation({ id: 'v-2', reviewerId: 'u-3', reviewerName: 'ines', health: true, revision: 3 }),
          validation({ id: 'v-3', reviewerId: null, reviewerName: null, health: true, standing: false }),
        ],
      }),
    );
    const items = within(screen.getByRole('region', { name: 'Validations' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([
      'zoe · version 4 · relecture · 05/10/2026 à 10:30',
      'ines · version 3 · feu vert santé · 05/10/2026 à 10:30',
      'Ancien relecteur · version 4 · feu vert santé, ne compte plus · 05/10/2026 à 10:30',
    ]);
  });

  it('aucune validation ; version exportée : jamais, à jour, ou en retard', async () => {
    const cases = [
      { exportedRevision: null, text: 'Jamais exportée.' },
      { exportedRevision: 4, text: 'Version 4 exportée.' },
      { exportedRevision: 2, text: 'Version 2 exportée, version 4 à exporter.' },
    ];
    for (const c of cases) {
      const view = await openAsAdmin(adminView({ exportedRevision: c.exportedRevision }));
      expect(within(adminRegion()).getByText(c.text)).toBeTruthy();
      expect(
        within(screen.getByRole('region', { name: 'Validations' })).getByText(
          "Aucune validation pour l'instant.",
        ),
      ).toBeTruthy();
      view.unmount();
    }
  });
});

describe('liste : outils de l’admin (§4.5)', () => {
  // Dans l'ordre du serveur : par nom, collation française.
  const ITEMS = [
    reviewItem('glute-bridge', ['drafts'], {
      name: 'Pont fessier',
      status: 'draft',
      movementPattern: 'hip_hinge',
      illustrationCount: 1,
    }),
    reviewItem('romanian-deadlift', ['to_review'], {
      name: 'Soulevé de terre roumain',
      movementPattern: 'hip_hinge',
    }),
    reviewItem('back-squat', ['to_review'], { name: 'Squat barre' }),
    reviewItem('goblet-squat', ['to_review'], { name: 'Squat goblet', illustrationCount: 2 }),
  ];
  const withAdmin = (items = ITEMS, toExport = 3, replaceBeforePublic = 1): ReviewListResponse => ({
    ...reviewList(items),
    admin: { toExport, replaceBeforePublic },
  });
  const rowNames = () =>
    within(screen.getByRole('list', { name: 'Fiches' }))
      .queryAllByRole('link')
      .map((a) => document.getElementById(a.getAttribute('aria-labelledby') ?? '')?.textContent ?? '');
  const tools = () => screen.getByRole('region', { name: 'Administration' });
  const chip = (name: RegExp) => screen.getByRole('radio', { name });

  let clicks: { download: string; href: string }[] = [];
  let blobs: Blob[] = [];
  let createUrl: MockInstance<typeof URL.createObjectURL>;

  beforeEach(() => {
    clicks = [];
    blobs = [];
    createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return `blob:test/${blobs.length}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.getAttribute('href') ?? '' });
    });
  });

  it('compteurs « N fiches à exporter » et « N fichiers à remplacer avant publication », sous les filtres', async () => {
    const first = await openReview('/review/exercises', {
      me: admin(),
      api: reviewApi({ list: ok(withAdmin()) }),
    });
    expect(within(tools()).getByText('3 fiches à exporter')).toBeTruthy();
    expect(within(tools()).getByText('1 fichier à remplacer avant publication')).toBeTruthy();
    const filters = screen.getByRole('group', { name: 'Filtrer les fiches' });
    expect(filters.compareDocumentPosition(tools()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    first.unmount();
    await openReview('/review/exercises', {
      me: admin(),
      api: reviewApi({ list: ok(withAdmin(ITEMS, 1, 0)) }),
    });
    expect(within(tools()).getByText('1 fiche à exporter')).toBeTruthy();
    expect(within(tools()).getByText('0 fichier à remplacer avant publication')).toBeTruthy();
  });

  it('« Exporter le catalogue » : GET export, exercises-export.json téléchargé tel que reçu, liste relue', async () => {
    const file = [
      { ...REVIEW_SHEET, id: 'back-squat' },
      { ...REVIEW_SHEET, id: 'goblet-squat' },
    ];
    let reads = 0;
    const api = reviewApi({
      list: () => {
        reads += 1;
        return ok(withAdmin(ITEMS, reads === 1 ? 3 : 0));
      },
    }).on('GET', '/api/admin/exercises/export', ok(file));
    await openReview('/review/exercises', { me: admin(), api });
    fireEvent.click(within(tools()).getByRole('button', { name: 'Exporter le catalogue' }));
    expect(await screen.findByText('Catalogue exporté : exercises-export.json.')).toBeTruthy();
    expect(clicks).toEqual([{ download: 'exercises-export.json', href: 'blob:test/1' }]);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await (blobs[0] as Blob).text())).toEqual(file);
    await until(() => within(tools()).queryByText('0 fiche à exporter') !== null);
    expect(callsTo(api, REVIEW_LIST)).toHaveLength(2);
  });

  it('« Exporter le catalogue » hors ligne : « Nécessite le réseau », rien de téléchargé', async () => {
    const api = reviewApi({ list: ok(withAdmin()) });
    await openReview('/review/exercises', { me: admin(), api });
    api.setOffline('reject');
    fireEvent.click(within(tools()).getByRole('button', { name: 'Exporter le catalogue' }));
    expect(await within(tools()).findByText('Nécessite le réseau')).toBeTruthy();
    expect(clicks).toEqual([]);
  });

  it('filtres « Type de mouvement » et « Sans illustration » : liste et compteurs filtrés, gardés dans l’adresse', async () => {
    const view = await openReview('/review/exercises?queue=to_review', {
      me: admin(),
      api: reviewApi({ list: ok(withAdmin()) }),
    });
    expect(rowNames()).toEqual(['Soulevé de terre roumain', 'Squat barre', 'Squat goblet']);
    const pattern = within(tools()).getByRole('combobox', { name: 'Type de mouvement' }) as HTMLSelectElement;
    expect([...pattern.options].map((o) => o.text)).toEqual([
      'Tous les types',
      'Charnière de hanche',
      'Squat',
    ]);
    fireEvent.change(pattern, { target: { value: 'hip_hinge' } });
    expect(rowNames()).toEqual(['Soulevé de terre roumain']);
    expect(chip(/^À relire/).parentElement?.textContent).toBe('À relire · 1');
    expect(chip(/^Brouillons/).parentElement?.textContent).toBe('Brouillons à commenter · 1');
    expect(view.location()).toBe('/review/exercises?queue=to_review&pattern=hip_hinge');
    fireEvent.change(pattern, { target: { value: '' } });
    fireEvent.click(within(tools()).getByRole('switch', { name: 'Sans illustration' }));
    expect(rowNames()).toEqual(['Soulevé de terre roumain', 'Squat barre']);
    expect(view.location()).toBe('/review/exercises?queue=to_review&illustrations=none');
    // Le lien de chaque fiche garde les filtres : Retour depuis la fiche les retrouve.
    expect(screen.getByRole('link', { name: 'Squat barre' }).getAttribute('href')).toBe(
      '/review/exercises/back-squat?queue=to_review&illustrations=none',
    );
  });

  it('fiche ouverte depuis un filtre de l’admin : Retour ramène la liste avec ses filtres', async () => {
    const api = reviewApi({ sheets: { 'goblet-squat': ok(adminView()) } });
    await openReview(`${PATH}?queue=all&pattern=squat&illustrations=none`, { me: admin(), api });
    await settle();
    expect(screen.getByRole('link', { name: 'Retour' }).getAttribute('href')).toBe(
      '/review/exercises?queue=all&pattern=squat&illustrations=none',
    );
  });

  it('une relectrice : ni compteurs, ni filtres de l’admin, même avec les filtres dans l’adresse', async () => {
    await openReview('/review/exercises?queue=to_review&pattern=hip_hinge&illustrations=none', {
      me: reviewer(),
      api: reviewApi({ list: ok(reviewList(ITEMS)) }),
    });
    expect(screen.queryByRole('region', { name: 'Administration' })).toBeNull();
    expect(screen.queryByText(/à exporter/)).toBeNull();
    expect(rowNames()).toEqual(['Soulevé de terre roumain', 'Squat barre', 'Squat goblet']);
  });
});
