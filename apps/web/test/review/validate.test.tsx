import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
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
  reviewSheetPath,
  revokeOn,
  sheetResponse,
} from '../support/review';
import { until } from '../support/wait';

// Validation d'une fiche (spec brique 2 §3.4, §3.5 et §4.5, plan Task 16) : « J'ai relu, rien à redire » ou
// « Sécurité vérifiée », feuille de confirmation qui rappelle la version, puis « Fiche suivante » selon le filtre
// actif, ou « Ta file est vide. Merci ! ».

const PATH = '/review/exercises/goblet-squat';
const SHEET_API = reviewSheetPath('goblet-squat');
const VALIDATIONS_API = `${SHEET_API}/validations`;
const VALIDATED = { id: 'v-1', revision: 4, createdAt: '2026-10-06T12:00:00.000Z' };

const dialog = () => screen.getByRole('dialog');

/** Serveur : la fiche courante, la validation, la liste relue après la validation. */
function validatingApi(o: { items?: ReturnType<typeof reviewItem>[] } = {}) {
  let validated = false;
  const api = reviewApi({
    sheets: {
      'goblet-squat': () =>
        ok(sheetResponse({ validatedByMe: validated, queues: validated ? [] : ['to_review'] })),
      'front-plank': ok(sheetResponse({ sheet: { id: 'front-plank', name: 'Gainage ventral' } })),
    },
    list: () => ok(reviewList(o.items ?? [])),
  }).on('POST', VALIDATIONS_API, () => {
    validated = true;
    return { status: 201, body: VALIDATED };
  });
  return api;
}

beforeEach(() => {
  localStorage.clear();
});

describe('bouton de validation selon le compte (§3.1)', () => {
  it('relectrice : « J’ai relu, rien à redire » ; relectrice santé : « Sécurité vérifiée » ; admin : « J’ai relu »', async () => {
    const cases = [
      [reviewer(), "J'ai relu, rien à redire"],
      [healthReviewer(), 'Sécurité vérifiée'],
      [admin({ healthProfessional: true }), "J'ai relu"],
    ] as const;
    for (const [me, label] of cases) {
      const view = await openReview(PATH, { me, api: validatingApi() });
      const buttons = screen.getAllByRole('button', { name: /^(J'ai relu|Sécurité vérifiée)/ });
      expect(buttons.map((b) => b.textContent)).toEqual([label]);
      view.unmount();
    }
  });

  it('pas de validation pour un brouillon, une fiche retirée ou un contenu déjà validé par l’appelante', async () => {
    const cases = [
      sheetResponse({ sheet: { status: 'draft' }, queues: ['drafts'] }),
      sheetResponse({ sheet: { status: 'retired' }, queues: [] }),
      sheetResponse({ validatedByMe: true, queues: [] }),
    ];
    for (const body of cases) {
      const api = reviewApi({ sheets: { 'goblet-squat': ok(body) } });
      const view = await openReview(PATH, { me: healthReviewer(), api });
      expect(screen.queryByRole('button', { name: /^(J'ai relu|Sécurité vérifiée)/ })).toBeNull();
      view.unmount();
    }
  });

  it('une fiche publiée se valide (feu vert à refaire)', async () => {
    const api = reviewApi({
      sheets: {
        'goblet-squat': ok(
          sheetResponse({
            sheet: { status: 'published' },
            sensitive: true,
            greenLight: 'stale',
            queues: ['revalidate'],
          }),
        ),
      },
    });
    await openReview(PATH, { me: healthReviewer(), api });
    expect(screen.getByRole('button', { name: 'Sécurité vérifiée' })).toBeTruthy();
  });
});

describe('confirmation qui rappelle la version (§4.5)', () => {
  it('la feuille nomme la version et la fiche ; Annuler ne valide rien', async () => {
    const api = validatingApi();
    await openReview(PATH, { api });
    fireEvent.click(screen.getByRole('button', { name: "J'ai relu, rien à redire" }));
    const sheet = await screen.findByRole('dialog', { name: 'Valider la version 4' });
    expect(sheet.textContent).toContain('version 4 de « Squat goblet »');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Annuler' }));
    await until(() => screen.queryByRole('dialog') === null);
    expect(callsTo(api, VALIDATIONS_API, 'POST')).toHaveLength(0);
  });

  it('relectrice santé : la feuille dit que c’est son feu vert santé', async () => {
    await openReview(PATH, { me: healthReviewer(), api: validatingApi() });
    fireEvent.click(screen.getByRole('button', { name: 'Sécurité vérifiée' }));
    const sheet = await screen.findByRole('dialog', { name: 'Valider la version 4' });
    expect(sheet.textContent).toContain('feu vert santé');
  });

  it('valider envoie la révision affichée', async () => {
    const api = validatingApi();
    await openReview(PATH, { api });
    fireEvent.click(screen.getByRole('button', { name: "J'ai relu, rien à redire" }));
    await screen.findByRole('dialog', { name: 'Valider la version 4' });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Valider la version 4' }));
    await screen.findByRole('dialog', { name: 'Version 4 validée' });
    const calls = callsTo(api, VALIDATIONS_API, 'POST');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ baseRevision: 4 });
  });
});

describe('« Fiche suivante » selon le filtre actif (§4.5)', () => {
  async function validate(api: ReturnType<typeof validatingApi>, path = PATH) {
    const view = await openReview(path, { me: healthReviewer(), api });
    fireEvent.click(screen.getByRole('button', { name: 'Sécurité vérifiée' }));
    await screen.findByRole('dialog', { name: 'Valider la version 4' });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Valider la version 4' }));
    await screen.findByRole('dialog', { name: 'Version 4 validée' });
    return view;
  }

  it('la fiche qui suit dans la file du filtre (ici « Feu vert santé »), liste relue', async () => {
    const api = validatingApi({
      items: [
        reviewItem('back-squat', ['health_pending'], { name: 'A' }),
        reviewItem('goblet-squat', ['health_pending'], { name: 'B' }),
        reviewItem('lunge', ['to_review'], { name: 'C' }),
        reviewItem('front-plank', ['to_review', 'health_pending'], { name: 'D' }),
      ],
    });
    const view = await validate(api, `${PATH}?queue=health_pending`);
    expect(callsTo(api, REVIEW_LIST)).toHaveLength(1);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Fiche suivante' }));
    await until(() => view.location() === '/review/exercises/front-plank?queue=health_pending');
    await screen.findByRole('heading', { level: 1, name: 'Gainage ventral' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('après la dernière, on repart du début de la file ; sans filtre, « À relire »', async () => {
    const api = validatingApi({
      items: [
        reviewItem('front-plank', ['to_review'], { name: 'A' }),
        reviewItem('back-squat', ['health_pending'], { name: 'B' }),
        reviewItem('goblet-squat', [], { name: 'C' }),
      ],
    });
    const view = await validate(api);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Fiche suivante' }));
    await until(() => view.location() === '/review/exercises/front-plank?queue=to_review');
  });

  it('file vide : « Ta file est vide. Merci ! » et retour à la liste', async () => {
    const api = validatingApi({ items: [reviewItem('goblet-squat', ['ready_to_publish'])] });
    const view = await validate(api);
    expect(dialog().textContent).toContain('Ta file est vide. Merci !');
    expect(within(dialog()).queryByRole('button', { name: 'Fiche suivante' })).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Retour à la liste' }));
    await until(() => view.location() === '/review/exercises?queue=to_review');
  });

  it('Fermer reste sur la fiche, relue : « Validée par toi »', async () => {
    const api = validatingApi({ items: [] });
    await validate(api);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Fermer' }));
    await until(() => screen.queryByRole('dialog') === null);
    await until(
      () =>
        screen.getByRole('list', { name: 'État de la fiche' }).textContent?.includes('Validée par toi') ===
        true,
    );
    expect(screen.queryByRole('button', { name: 'Sécurité vérifiée' })).toBeNull();
  });
});

describe('fiche changée entre-temps (§3.5)', () => {
  it('409 revision_conflict : « La fiche a changé depuis que tu l’as ouverte. », fiche relue en version 5, rien de validé', async () => {
    let revision = 4;
    const api = reviewApi({
      sheets: { 'goblet-squat': () => ok(sheetResponse({ sheet: { revision } })) },
    }).on('POST', VALIDATIONS_API, () => {
      revision = 5;
      return {
        status: 409,
        body: { error: 'revision_conflict', current: sheetResponse({ sheet: { revision: 5 } }).sheet },
      };
    });
    await openReview(PATH, { api });
    fireEvent.click(screen.getByRole('button', { name: "J'ai relu, rien à redire" }));
    await screen.findByRole('dialog', { name: 'Valider la version 4' });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Valider la version 4' }));
    await until(() => screen.queryByRole('dialog') === null);
    const notice = await screen.findByText("La fiche a changé depuis que tu l'as ouverte.");
    expect(notice.closest('[role="status"]')).not.toBeNull();
    await until(
      () =>
        screen.getByRole('list', { name: 'État de la fiche' }).textContent?.includes('Version 5') === true,
    );
    fireEvent.click(screen.getByRole('button', { name: "J'ai relu, rien à redire" }));
    expect(await screen.findByRole('dialog', { name: 'Valider la version 5' })).toBeTruthy();
    expect(callsTo(api, VALIDATIONS_API, 'POST')).toHaveLength(1);
  });

  it('403 d’un compte qui n’est plus relecteur : retour au Profil', async () => {
    const api = revokeOn(
      reviewApi({ sheets: { 'goblet-squat': ok(sheetResponse()) } }),
      'POST',
      VALIDATIONS_API,
    );
    const view = await openReview(PATH, { api });
    fireEvent.click(screen.getByRole('button', { name: "J'ai relu, rien à redire" }));
    await screen.findByRole('dialog', { name: 'Valider la version 4' });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Valider la version 4' }));
    await until(() => view.location() === '/profile?reason=review_access_lost');
    expect(await screen.findByText("Tu n'as plus accès à la relecture.")).toBeTruthy();
  });
});
