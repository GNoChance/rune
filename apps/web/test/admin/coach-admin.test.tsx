import {
  COACH_COUNTER_KINDS,
  type CoachAdminView,
  type CoachReportDetail,
  type CoachReportSummary,
  FORBIDDEN_TERMS,
} from '@rune/contracts';
import { type FilterContext, normalizeForTerms, outputFilterText } from '@rune/domain';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdminCoachPage } from '../../src/features/admin/AdminCoachPage';
import { COACH_ADMIN_TEXTS } from '../../src/features/coach/coach-texts';
import { createFakeApi, type FakeApi, type FakeReply } from '../support/fake-api';
import { makeMe, renderApp, renderWithServices } from '../support/render';
import { until } from '../support/wait';

// Admin › Coach (spec brique 4 §17.1). Les signalements sont la seule donnée C3 lisible ; coûts et compteurs
// sont agrégés, jamais un nombre de messages par personne. Couper le coach pour tous et Classer demandent une
// confirmation, comme les autres actions dangereuses de l'administration.

const ADMIN = makeMe({ id: 'u-1', username: 'bastien', role: 'admin' });
const COACH = '/api/admin/coach';

const VIEW: CoachAdminView = {
  state: {
    enabled: true,
    suspendedUntil: null,
    configured: true,
    notConfiguredCause: null,
    catalogChanged: false,
  },
  month: '2026-10',
  totalUsd: 4.56,
  workspaceLimitUsd: 20,
  members: [
    { username: 'lea', costUsd: 1.23, budgetUsd: 3 },
    { username: 'ines.m', costUsd: 0, budgetUsd: 3 },
  ],
  counters: [
    { month: '2026-10', kind: 'refusal', count: 3 },
    { month: '2026-05', kind: 'help_pain', count: 2 },
  ],
  openReports: 2,
};

const withState = (patch: Partial<CoachAdminView['state']>): CoachAdminView => ({
  ...VIEW,
  state: { ...VIEW.state, ...patch },
});

const REPORT_A: CoachReportSummary = {
  id: 'r-1',
  createdAt: '2026-10-05T08:30:00.000Z',
  category: 'unsafe',
  username: 'ines.m',
  minor: true,
};
const REPORT_B: CoachReportSummary = {
  id: 'r-2',
  createdAt: '2026-10-04T18:00:00.000Z',
  category: 'inaccurate',
  username: 'lea',
  minor: false,
};
const DETAIL_A: CoachReportDetail = {
  ...REPORT_A,
  exchangeText: 'Toi : je me sens mal.\nCoach : repose-toi.',
  comment: 'Réponse sèche.',
};

interface Served {
  view?: CoachAdminView;
  reports?: CoachReportSummary[];
}

function serve(o: Served = {}): FakeApi {
  let reports = o.reports ?? [REPORT_A, REPORT_B];
  let view = o.view ?? VIEW;
  const ok = (body?: unknown): FakeReply => ({ status: 200, body });
  return createFakeApi()
    .on('GET', COACH, () => ok({ ...view, openReports: reports.length }))
    .on('GET', `${COACH}/reports`, () => ok(reports))
    .on('GET', `${COACH}/reports/:id`, (r) =>
      r.path.endsWith('r-1') ? ok(DETAIL_A) : { status: 404, body: { error: 'not_found' } },
    )
    .on('PUT', `${COACH}/state`, (r) => {
      view = withEnabled(view, (r.body as { enabled: boolean }).enabled);
      return { status: 204 };
    })
    .on('POST', `${COACH}/resume`, () => {
      view = withState({ suspendedUntil: null });
      return { status: 204 };
    })
    .on('DELETE', `${COACH}/reports/:id`, (r) => {
      reports = reports.filter((x) => !r.path.endsWith(x.id));
      return { status: 204 };
    });
}

const withEnabled = (v: CoachAdminView, enabled: boolean): CoachAdminView => ({
  ...v,
  state: { ...v.state, enabled },
});

async function openAdmin(api: FakeApi = serve()) {
  const view = await renderWithServices(<AdminCoachPage />, { api, me: ADMIN });
  await screen.findByRole('switch', { name: 'Coach IA pour le cercle' });
  return { ...view, api };
}

const sent = (api: FakeApi, method: string, path: string) =>
  api.calls.filter((c) => c.method === method && c.path === path).map((c) => c.body);
const region = (name: string) => within(screen.getByRole('region', { name }));
const dialog = () => within(screen.getByRole('dialog'));
const THE_REMINDER =
  "Si l'échange enfreint la politique d'Anthropic, signale-le à Anthropic avant de le classer.";

describe('Admin › Coach : état', () => {
  it('actif : interrupteur en marche, « Coach actif », ni avertissement ni « Relancer le coach »', async () => {
    await openAdmin();
    const sw = screen.getByRole('switch', { name: 'Coach IA pour le cercle' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(region('État').getByText('Coach actif')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Relancer le coach' })).toBeNull();
    expect(screen.queryByText(/Le catalogue a changé/)).toBeNull();
  });

  it('coupé : « Coach coupé » ; rallumer envoie PUT {enabled: true} sans confirmation', async () => {
    const api = await openAdmin(serve({ view: withEnabled(VIEW, false) })).then((v) => v.api);
    const sw = screen.getByRole('switch', { name: 'Coach IA pour le cercle' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(region('État').getByText('Coach coupé')).toBeTruthy();
    fireEvent.click(sw);
    await until(() => sent(api, 'PUT', `${COACH}/state`).length === 1);
    expect(sent(api, 'PUT', `${COACH}/state`)).toEqual([{ enabled: true }]);
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Coach IA pour le cercle' }).getAttribute('aria-checked'),
      ).toBe('true'),
    );
  });

  it('couper par l’interrupteur demande confirmation ; annuler n’envoie rien', async () => {
    const { api } = await openAdmin();
    fireEvent.click(screen.getByRole('switch', { name: 'Coach IA pour le cercle' }));
    expect(screen.getByRole('dialog', { name: 'Couper le coach pour tous' })).toBeTruthy();
    fireEvent.click(dialog().getByRole('button', { name: 'Annuler' }));
    expect(sent(api, 'PUT', `${COACH}/state`)).toEqual([]);
    fireEvent.click(screen.getByRole('switch', { name: 'Coach IA pour le cercle' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Couper le coach pour tous' }));
    await until(() => sent(api, 'PUT', `${COACH}/state`).length === 1);
    expect(sent(api, 'PUT', `${COACH}/state`)).toEqual([{ enabled: false }]);
  });

  it('suspendu : la date, « Relancer le coach » et la consigne ; relancer envoie POST /resume', async () => {
    const api = serve({ view: withState({ suspendedUntil: '2026-10-31T23:00:00.000Z' }) });
    await openAdmin(api);
    expect(region('État').getByText("Coach suspendu jusqu'au 01/11/2026")).toBeTruthy();
    expect(
      region('État').getByText("Relève d'abord la limite du workspace dans la Console Claude."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Relancer le coach' }));
    await until(() => sent(api, 'POST', `${COACH}/resume`).length === 1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Relancer le coach' })).toBeNull());
  });

  it.each([
    ['no_key', 'clé absente'],
    ['model_not_allowed', 'modèle hors liste'],
    ['not_evaluated', 'combinaison non évaluée'],
  ] as const)('non configuré (%s) : la raison « %s »', async (cause, reason) => {
    await openAdmin(serve({ view: withState({ configured: false, notConfiguredCause: cause }) }));
    expect(region('État').getByText(`Non configuré : ${reason}`)).toBeTruthy();
  });

  it('catalogue changé : l’avertissement de la spec', async () => {
    await openAdmin(serve({ view: withState({ catalogChanged: true }) }));
    expect(
      screen.getByText(
        "Le catalogue a changé depuis l'évaluation : relance la campagne avant la prochaine mise en service.",
      ),
    ).toBeTruthy();
  });
});

describe('Admin › Coach : coûts du mois', () => {
  it('total, limite du workspace, une ligne par membre ; jamais de nombre de messages', async () => {
    await openAdmin();
    const costs = region('Coûts du mois');
    expect(costs.getByText('Total du mois : 4,56 $')).toBeTruthy();
    expect(costs.getByText('Limite du workspace : 20 $')).toBeTruthy();
    const rows = costs.getAllByRole('listitem').map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['lea 1,23 $ sur 3 $', 'ines.m 0,00 $ sur 3 $']);
    expect(document.body.textContent).not.toMatch(/message/i);
  });
});

describe('Admin › Coach : signalements', () => {
  it('liste : date, catégorie, pseudo et « Mineur » ; rappel de la politique', async () => {
    await openAdmin();
    const reports = region('Signalements');
    const rows = reports.getAllByRole('button').map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['05/10/2026 à 10:30 Dangereux ines.m Mineur', '04/10/2026 à 20:00 Inexact lea']);
  });

  it('lecture des signalements en échec : l’erreur et « Réessayer » dans la section, le reste reste', async () => {
    const api = serve();
    let fail = true;
    api.on('GET', `${COACH}/reports`, () =>
      fail ? { status: 500, body: { error: 'internal' } } : { status: 200, body: [REPORT_B] },
    );
    await openAdmin(api);
    const reports = region('Signalements');
    await reports.findByRole('button', { name: 'Réessayer' });
    expect(screen.getByRole('switch', { name: 'Coach IA pour le cercle' })).toBeTruthy();
    fail = false;
    fireEvent.click(reports.getByRole('button', { name: 'Réessayer' }));
    await reports.findByRole('button', { name: /lea/ });
    expect(reports.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  });

  it('l’échange est rendu comme du texte, jamais comme du HTML', async () => {
    const api = serve();
    api.on('GET', `${COACH}/reports/:id`, { status: 200, body: { ...DETAIL_A, exchangeText: '<b>x</b>' } });
    await openAdmin(api);
    fireEvent.click(region('Signalements').getByRole('button', { name: /ines.m/ }));
    const detail = await screen.findByRole('region', { name: 'Signalement' });
    expect(within(detail).getByText('<b>x</b>')).toBeTruthy();
    expect(detail.querySelector('b')).toBeNull();
  });

  it('aucun signalement : le dit', async () => {
    await openAdmin(serve({ reports: [] }));
    expect(region('Signalements').getByText('Aucun signalement à lire.')).toBeTruthy();
  });

  it('détail : l’échange, le commentaire, le rappel, « Classer » et « Couper le coach pour tous »', async () => {
    const { api } = await openAdmin();
    fireEvent.click(region('Signalements').getByRole('button', { name: /ines\.m/ }));
    const detail = await screen.findByRole('region', { name: 'Signalement' });
    expect(within(detail).getByText(/je me sens mal/).textContent).toContain('Coach : repose-toi.');
    expect(within(detail).getByText('Réponse sèche.')).toBeTruthy();
    expect(within(detail).getByText(THE_REMINDER)).toBeTruthy();
    expect(within(detail).getByRole('button', { name: 'Classer' })).toBeTruthy();
    expect(within(detail).getByRole('button', { name: 'Couper le coach pour tous' })).toBeTruthy();
    expect(sent(api, 'GET', `${COACH}/reports/r-1`)).toHaveLength(1);
  });

  it('« Classer » demande confirmation, puis envoie DELETE et relit la liste', async () => {
    const { api } = await openAdmin();
    fireEvent.click(region('Signalements').getByRole('button', { name: /ines\.m/ }));
    const detail = await screen.findByRole('region', { name: 'Signalement' });
    fireEvent.click(within(detail).getByRole('button', { name: 'Classer' }));
    expect(screen.getByRole('dialog', { name: 'Classer ce signalement' })).toBeTruthy();
    expect(dialog().getByText(THE_REMINDER)).toBeTruthy();
    fireEvent.click(dialog().getByRole('button', { name: 'Annuler' }));
    expect(sent(api, 'DELETE', `${COACH}/reports/r-1`)).toEqual([]);
    fireEvent.click(within(detail).getByRole('button', { name: 'Classer' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Classer' }));
    await until(() => sent(api, 'DELETE', `${COACH}/reports/r-1`).length === 1);
    await waitFor(() => expect(region('Signalements').queryByRole('button', { name: /ines\.m/ })).toBeNull());
    expect(screen.queryByRole('region', { name: 'Signalement' })).toBeNull();
    expect(region('Signalements').getByRole('button', { name: /lea/ })).toBeTruthy();
  });

  it('« Couper le coach pour tous » demande confirmation, puis envoie PUT {enabled: false}', async () => {
    const { api } = await openAdmin();
    fireEvent.click(region('Signalements').getByRole('button', { name: /ines\.m/ }));
    const detail = await screen.findByRole('region', { name: 'Signalement' });
    fireEvent.click(within(detail).getByRole('button', { name: 'Couper le coach pour tous' }));
    expect(sent(api, 'PUT', `${COACH}/state`)).toEqual([]);
    fireEvent.click(dialog().getByRole('button', { name: 'Couper le coach pour tous' }));
    await until(() => sent(api, 'PUT', `${COACH}/state`).length === 1);
    expect(sent(api, 'PUT', `${COACH}/state`)).toEqual([{ enabled: false }]);
  });
});

describe('Admin › Coach : compteurs anonymes', () => {
  it('12 mois × nature : un tableau, zéro quand rien', async () => {
    await openAdmin();
    const table = region('Compteurs anonymes').getByRole('table');
    const rows = within(table).getAllByRole('row');
    // En-tête + 12 mois, du plus ancien au courant.
    expect(rows).toHaveLength(13);
    expect(within(rows[0] as HTMLElement).getAllByRole('columnheader')).toHaveLength(
      COACH_COUNTER_KINDS.length + 1,
    );
    const months = rows.slice(1).map((r) => within(r).getAllByRole('rowheader')[0]?.textContent);
    expect(months[0]).toBe('11/2025');
    expect(months[11]).toBe('10/2026');
    const cells = (i: number) =>
      within(rows[i] as HTMLElement)
        .getAllByRole('cell')
        .map((c) => c.textContent);
    expect(cells(12)).toEqual(['0', '0', '0', '0', '0', '0', '0', '3']);
    expect(cells(7)).toEqual(['0', '2', '0', '0', '0', '0', '0', '0']);
  });
});

describe('Admin › Coach : sous-navigation', () => {
  it('Membres · Invitations · Salles · Coach · Serveur, « Coach » courant', async () => {
    const api = serve();
    await renderApp({ path: '/admin/coach', me: ADMIN, api });
    await screen.findByRole('switch', { name: 'Coach IA pour le cercle' }, { timeout: 10_000 });
    const nav = within(screen.getByRole('navigation', { name: 'Administration' }));
    expect(nav.getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Membres', '/admin/members'],
      ['Invitations', '/admin/invitations'],
      ['Salles', '/admin/gyms'],
      ['Coach', '/admin/coach'],
      ['Serveur', '/admin/health'],
    ]);
    expect(
      nav
        .getAllByRole('link')
        .filter((l) => l.getAttribute('aria-current') === 'page')
        .map((l) => l.textContent),
    ).toEqual(['Coach']);
  });
});

describe('textes de l’administration du coach', () => {
  const contexts: FilterContext[] = (['adult', 'minor'] as const).map((audience) => ({
    audience,
    nutritionMode: 'none',
    allowed: { mass: new Set(), percent: new Set(), nutrition: new Set() },
  }));

  const TEXTS: [string, string][] = [
    ['catalogChanged', COACH_ADMIN_TEXTS.catalogChanged],
    ['resumeHelp', COACH_ADMIN_TEXTS.resumeHelp],
    ['anthropicReminder', COACH_ADMIN_TEXTS.anthropicReminder],
    ['homeSuspended', COACH_ADMIN_TEXTS.homeSuspended],
    ['homeReports(2)', COACH_ADMIN_TEXTS.homeReports(2)],
    ['cutAllWarning', COACH_ADMIN_TEXTS.cutAllWarning],
    ['classifyWarning', COACH_ADMIN_TEXTS.classifyWarning],
  ];

  it('rappel et avertissements, mot pour mot', () => {
    expect(COACH_ADMIN_TEXTS.anthropicReminder).toBe(THE_REMINDER);
    expect(COACH_ADMIN_TEXTS.resumeHelp).toBe(
      "Relève d'abord la limite du workspace dans la Console Claude.",
    );
    expect(COACH_ADMIN_TEXTS.catalogChanged).toBe(
      "Le catalogue a changé depuis l'évaluation : relance la campagne avant la prochaine mise en service.",
    );
    expect(COACH_ADMIN_TEXTS.homeSuspended).toBe('Coach suspendu : limite de dépense atteinte');
    expect(COACH_ADMIN_TEXTS.homeReports(3)).toBe('Signalements du coach : 3 à lire');
  });

  it.each(TEXTS)('%s passe le filtre de sortie et les termes interdits', (_name, text) => {
    for (const ctx of contexts) expect(outputFilterText(text, ctx), text).toEqual({ ok: true });
    const haystack = ` ${normalizeForTerms(text)} `;
    for (const t of [...FORBIDDEN_TERMS.all, ...FORBIDDEN_TERMS.minor]) {
      for (const form of [t.term, ...t.forms]) {
        expect(haystack, `terme « ${form} » dans « ${text} »`).not.toContain(` ${normalizeForTerms(form)} `);
      }
    }
  });
});
