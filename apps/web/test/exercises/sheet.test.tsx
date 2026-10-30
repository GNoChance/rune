import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IllustrationEntry, MeResponse } from '@rune/contracts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { App } from '../../src/App';
import { ServicesProvider } from '../../src/app-services';
import styles from '../../src/features/exercises/exercises.module.css';
import { settle } from '../support/auth';
import {
  chain,
  illustrationEntry,
  seedCatalog,
  seedGarage,
  seedTrainingProfile,
  served,
} from '../support/catalog';
import { declarationsOf, parseCssBlocks } from '../support/css-blocks';
import { createFakeSyncEngine } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { createTestServices, makeMe, renderApp } from '../support/render';
import { until } from '../support/wait';

// Fiche d'un exercice (spec brique 2 §4.2, 04 §4 et §12) : en-tête, illustrations et crédits, onglets Comment
// faire · Erreurs · Variantes avec l'encadré Sécurité sur les trois, onglet dans l'URL par remplacement,
// bandeaux de la fiche non utilisable et de la fiche retirée, mention « Pas faisable : <lieu> ».

const EXERCISES_CSS = resolve(import.meta.dirname, '../../src/features/exercises/exercises.module.css');
const TOKENS_CSS = resolve(import.meta.dirname, '../../src/ui/theme/tokens.css');

const NOT_USABLE = "Cet exercice n'est pas proposé avec tes réglages actuels.";
const RETIRED = "Cet exercice n'est plus proposé.";
const NO_SUBSTITUTE = "Aucun exercice proche pour l'instant.";
const PENDING_ILLUSTRATION = 'Illustration disponible après synchronisation';
const CREDIT_LINE = 'Illustration : Greg Priday · CC BY-SA 4.0 · modifiée';

/**
 * Catalogue d'essai. Au Garage (haltères, banc réglable) : le squat goblet est faisable, le tirage vertical non.
 * La pompe archer, au bout de la chaîne des pompes, est `not_for_minors`. Le squat sauté est retiré avec des
 * exercices proches ; la vieille extension mollets, retirée, n'en a aucun.
 */
const CATALOG = [
  ...chain('squat', [
    served({
      id: 'bodyweight-squat',
      name: 'Squat au poids du corps',
      aliases: ['Air squat'],
      load_mode: 'bodyweight',
      equipment_options: [[]],
    }),
    served({
      id: 'goblet-squat',
      easier_tip: 'Descends sur une chaise derrière toi.',
      harder_tip: 'Marque une pause de 2 secondes en bas.',
      // Dans le désordre : la page range les poses (départ, milieu, fin).
      illustrations: [
        { illustration_id: 'goblet-squat-end', role: 'end' },
        { illustration_id: 'goblet-squat-start', role: 'start' },
      ],
    }),
    served({
      id: 'back-squat',
      name: 'Squat barre',
      aliases: ['Back squat'],
      load_mode: 'barbell',
      equipment_options: [['barbell', 'squat_rack']],
      level: 2,
    }),
  ]),
  served({
    id: 'jump-squat',
    status: 'retired',
    name: 'Squat sauté',
    aliases: [],
    load_mode: 'bodyweight',
    equipment_options: [[]],
  }),
  served({
    id: 'old-calf-raise',
    status: 'retired',
    name: 'Extension mollets ancienne',
    aliases: [],
    movement_pattern: 'calf_raise',
    mechanics: 'isolation',
    load_mode: 'bodyweight',
    primary_muscles: ['calves'],
    secondary_muscles: [],
    equipment_options: [[]],
    stressed_joints: ['ankles'],
  }),
  ...chain(
    'push-up',
    [
      { id: 'wall-push-up', name: 'Pompe contre le mur', level: 1 as const, not_for_minors: false },
      { id: 'push-up', name: 'Pompe', level: 1 as const, not_for_minors: false },
      { id: 'archer-push-up', name: 'Pompe archer', level: 3 as const, not_for_minors: true },
    ].map((o) =>
      served({
        ...o,
        aliases: [],
        movement_pattern: 'horizontal_push',
        load_mode: 'bodyweight',
        primary_muscles: ['chest'],
        secondary_muscles: ['triceps'],
        equipment_options: [[]],
        stressed_joints: ['shoulders', 'wrists'],
        instructions: [
          `${o.name} : place tes mains au sol.`,
          'Descends la poitrine.',
          'Pousse pour remonter.',
        ],
        safety: [`${o.name} : arrête si ton épaule fait mal.`],
      }),
    ),
  ),
  served({
    id: 'lat-pulldown',
    name: 'Tirage vertical',
    aliases: ['Lat pulldown'],
    movement_pattern: 'vertical_pull',
    load_mode: 'machine',
    primary_muscles: ['lats'],
    secondary_muscles: ['biceps'],
    equipment_options: [['lat_pulldown']],
    stressed_joints: ['shoulders'],
    setup: 'Règle le boudin pour bloquer tes cuisses.',
  }),
];

const ENTRIES: IllustrationEntry[] = [
  illustrationEntry('goblet-squat-start'),
  illustrationEntry('goblet-squat-end'),
];

const MINOR = makeMe({ ageBand: 'minor', birthDate: '2011-01-01', cautious: true });

interface Open {
  me?: MeResponse;
  /** Lieu principal « Garage » (par défaut) ; faux : aucun lieu. */
  place?: boolean;
  /** Fiches du magasin `exercises` ; null : catalogue jamais téléchargé. */
  catalog?: unknown[] | null;
  illustrations?: IllustrationEntry[];
  connection?: 'online' | 'offline';
}

async function seed(o: Open) {
  const db = createTestLocalDb();
  await seedTrainingProfile(db);
  if (o.place !== false) await seedGarage(db);
  if (o.catalog !== null) await seedCatalog(db, o.catalog ?? CATALOG, o.illustrations ?? ENTRIES);
  return db;
}

/** L'appli entière au chemin `path`, base locale remplie ; attend que la page ait lu le catalogue. */
async function open(path: string, o: Open = {}) {
  const db = await seed(o);
  const sync = createFakeSyncEngine({ connection: o.connection ?? 'online' });
  const r = await renderApp({ path, db, me: o.me, sync });
  // Chaque état de la page (fiche, catalogue absent, fiche inconnue) a son titre de niveau 1.
  await screen.findByRole('heading', { level: 1 });
  await settle();
  return r;
}

/** Texte lu par un lecteur d'écran : ce qui est caché (`aria-hidden`) en moins, espaces resserrés. */
function spoken(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const tab = (name: string) => screen.getByRole('tab', { name });
const panel = () => screen.getByRole('tabpanel');

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('en-tête : nom, pastilles, illustrations et crédits (spec brique 2 §4.2, 04 §12)', () => {
  it('nom en titre, pastilles niveau, muscles principaux et matériel de la première option faisable', async () => {
    await open('/exercises/goblet-squat');
    expect(screen.getByRole('heading', { level: 1, name: 'Squat goblet' })).toBeTruthy();
    const pills = screen.getByRole('list', { name: "Caractéristiques de l'exercice" });
    expect(within(pills).getAllByRole('listitem').map(spoken)).toEqual([
      'Niveau 1 sur 3, débutant',
      'Quadriceps',
      'Fessiers',
      'Haltères fixes ou réglables',
    ]);
  });

  it('poses côte à côte dans l’ordre départ puis fin, texte alternatif « <nom> : position de … », crédit et lien Crédits', async () => {
    await open('/exercises/goblet-squat');
    const images = screen.getAllByRole('img').filter((img) => img.tagName === 'IMG');
    expect(images.map((img) => img.getAttribute('alt'))).toEqual([
      'Squat goblet : position de départ',
      'Squat goblet : position de fin',
    ]);
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      '/illustrations/goblet-squat-start.0a1b2c3d.svg',
      '/illustrations/goblet-squat-end.0a1b2c3d.svg',
    ]);
    // Une seule source par fiche (04 §12, règle 4) : une seule ligne de crédit pour les deux poses.
    expect(screen.getAllByText(CREDIT_LINE)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Crédits des illustrations' }).getAttribute('href')).toBe(
      '/credits',
    );
    expect(screen.queryByText(PENDING_ILLUSTRATION)).toBeNull();
  });

  it('sans illustration : ni carte, ni crédit, ni lien Crédits', async () => {
    await open('/exercises/push-up');
    expect(screen.getByRole('heading', { level: 1, name: 'Pompe' })).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryByText(/^Illustration/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Crédits des illustrations' })).toBeNull();
  });

  it('illustration pas en cache (image qui ne charge pas) : la carte affiche « Illustration disponible après synchronisation »', async () => {
    await open('/exercises/goblet-squat');
    const start = screen.getByRole('img', { name: 'Squat goblet : position de départ' });
    act(() => {
      fireEvent.error(start);
    });
    expect(screen.queryByRole('img', { name: 'Squat goblet : position de départ' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Squat goblet : position de fin' })).toBeTruthy();
    expect(screen.getAllByText(PENDING_ILLUSTRATION)).toHaveLength(1);
  });

  it('entrée du manifeste absente de la base locale : même message, sans image ni crédit', async () => {
    await open('/exercises/goblet-squat', { illustrations: [] });
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getAllByText(PENDING_ILLUSTRATION)).toHaveLength(2);
    expect(screen.queryByText(CREDIT_LINE)).toBeNull();
  });
});

describe('onglets et encadré Sécurité (spec brique 2 §4.2)', () => {
  it('trois onglets ; l’encadré Sécurité (titre et icône) est en tête de chacun, sous la barre d’onglets', async () => {
    await open('/exercises/goblet-squat');
    const tablist = screen.getByRole('tablist');
    expect(
      within(tablist)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Comment faire', 'Erreurs', 'Variantes']);
    for (const name of ['Comment faire', 'Erreurs', 'Variantes']) {
      fireEvent.click(tab(name));
      expect(tab(name).getAttribute('aria-selected')).toBe('true');
      const current = panel();
      const safety = within(current).getByRole('region', { name: 'Sécurité' });
      // En tête du panneau : premier titre, et rien n'est écrit avant lui.
      expect(within(current).getAllByRole('heading')[0], name).toBe(
        within(safety).getByRole('heading', { name: 'Sécurité' }),
      );
      expect(current.textContent?.trim().startsWith('Sécurité'), name).toBe(true);
      // La barre d'onglets vient avant l'encadré dans le document (et donc à l'écran).
      expect(tablist.compareDocumentPosition(safety) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const title = within(safety).getByRole('heading', { name: 'Sécurité' });
      expect(title.querySelector('svg[aria-hidden="true"]'), `icône (${name})`).not.toBeNull();
      expect(within(safety).getByText('Arrête la série si tu ressens une douleur vive.')).toBeTruthy();
    }
  });

  it('Comment faire : étapes numérotées, points clés, respiration ; le réglage seulement s’il existe', async () => {
    const { unmount } = await open('/exercises/goblet-squat');
    const how = panel();
    const steps = within(how).getByRole('list', { name: 'Étapes' });
    expect(steps.tagName).toBe('OL');
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Tiens un haltère contre ta poitrine.',
      'Descends en poussant les hanches en arrière.',
      'Remonte en poussant dans tout le pied.',
    ]);
    const keyPoints = within(how).getByRole('list', { name: 'Points clés' });
    expect(within(keyPoints).getAllByRole('listitem')).toHaveLength(2);
    expect(within(how).getByRole('heading', { name: 'Respiration' })).toBeTruthy();
    expect(within(how).getByText('Inspire en descendant, souffle en remontant.')).toBeTruthy();
    expect(within(how).queryByRole('heading', { name: 'Réglage' })).toBeNull();
    unmount();

    await open('/exercises/lat-pulldown');
    expect(within(panel()).getByRole('heading', { name: 'Réglage' })).toBeTruthy();
    expect(within(panel()).getByText('Règle le boudin pour bloquer tes cuisses.')).toBeTruthy();
  });

  it('?tab=mistakes ouvre Erreurs ; une valeur inconnue ouvre Comment faire', async () => {
    const { unmount } = await open('/exercises/goblet-squat?tab=mistakes');
    expect(tab('Erreurs').getAttribute('aria-selected')).toBe('true');
    expect(within(panel()).getByText('Les genoux rentrent.', { exact: false })).toBeTruthy();
    unmount();

    await open('/exercises/goblet-squat?tab=bogus');
    expect(tab('Comment faire').getAttribute('aria-selected')).toBe('true');
    expect(within(panel()).getByRole('list', { name: 'Étapes' })).toBeTruthy();
  });

  it('Erreurs : chaque erreur puis sa correction, préfixées « Erreur : » et « Correction : » pour les lecteurs d’écran', async () => {
    await open('/exercises/goblet-squat?tab=mistakes');
    const list = within(panel()).getByRole('list', { name: 'Erreurs et corrections' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map(spoken)).toEqual([
      "Erreur : Les genoux rentrent. Correction : Pousse les genoux vers l'extérieur.",
      'Erreur : Les talons décollent. Correction : Descends moins bas.',
    ]);
    for (const item of items) {
      // ✕ et ✓ dessinés et tus ; les préfixes ne sont lus que par les lecteurs d'écran.
      expect(item.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
      const prefixes = [...item.querySelectorAll(`.${styles.srOnly}`)].map((el) => el.textContent?.trim());
      expect(prefixes).toEqual(['Erreur :', 'Correction :']);
    }
  });

  it('changer d’onglet remplace l’entrée d’historique (history.replaceState, jamais pushState)', async () => {
    const db = await seed({});
    window.history.replaceState(null, '', '/exercises/goblet-squat');
    const { services } = await createTestServices({ db, path: '/exercises/goblet-squat' });
    render(
      <Router>
        <ServicesProvider services={services}>
          <App />
        </ServicesProvider>
      </Router>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Squat goblet' });
    await settle();
    const length = window.history.length;
    const replace = vi.spyOn(window.history, 'replaceState');
    const push = vi.spyOn(window.history, 'pushState');

    fireEvent.click(tab('Erreurs'));
    await settle();
    expect(replace).toHaveBeenCalledWith(null, '', '/exercises/goblet-squat?tab=mistakes');
    expect(window.location.search).toBe('?tab=mistakes');
    expect(tab('Erreurs').getAttribute('aria-selected')).toBe('true');

    // Au clavier aussi (flèche droite : Variantes).
    fireEvent.keyDown(tab('Erreurs'), { key: 'ArrowRight' });
    await settle();
    expect(window.location.search).toBe('?tab=variants');
    expect(push).not.toHaveBeenCalled();
    expect(window.history.length).toBe(length);
  });
});

describe('Variantes (spec brique 2 §4.2, Review Focus 2)', () => {
  it('adulte sans lieu : voisins plus facile et plus dur de la chaîne, conseils, puis les exercices proches', async () => {
    // Sans lieu principal : tout le matériel, le squat barre (barre et rack) est proposé.
    await open('/exercises/goblet-squat?tab=variants', { place: false });
    const variants = panel();
    const easier = within(variants).getByRole('region', { name: 'Plus facile' });
    expect(within(easier).getByText('Descends sur une chaise derrière toi.')).toBeTruthy();
    expect(within(easier).getByRole('link', { name: 'Squat au poids du corps' }).getAttribute('href')).toBe(
      '/exercises/bodyweight-squat',
    );
    const harder = within(variants).getByRole('region', { name: 'Plus difficile' });
    expect(within(harder).getByText('Marque une pause de 2 secondes en bas.')).toBeTruthy();
    expect(within(harder).getByRole('link', { name: 'Squat barre' })).toBeTruthy();
    const near = within(variants).getByRole('region', { name: 'Exercices proches' });
    expect(within(near).getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('profil prudent : aucune fiche not_for_minors dans les variantes (voisin de chaîne ni exercice proche)', async () => {
    const { unmount } = await open('/exercises/push-up?tab=variants');
    expect(within(panel()).getByRole('link', { name: 'Pompe archer' })).toBeTruthy();
    unmount();

    await open('/exercises/push-up?tab=variants', { me: MINOR });
    const variants = panel();
    const easier = within(variants).getByRole('region', { name: 'Plus facile' });
    expect(within(easier).getByRole('link', { name: 'Pompe contre le mur' })).toBeTruthy();
    expect(within(variants).queryByRole('region', { name: 'Plus difficile' })).toBeNull();
    expect(screen.queryByText(/Pompe archer/)).toBeNull();
  });

  it('un toucher sur une variante ouvre sa fiche, sur l’onglet Comment faire', async () => {
    const r = await open('/exercises/goblet-squat?tab=variants', { place: false });
    const harder = within(panel()).getByRole('region', { name: 'Plus difficile' });
    fireEvent.click(within(harder).getByRole('link', { name: 'Squat barre' }));
    await screen.findByRole('heading', { level: 1, name: 'Squat barre' });
    expect(r.location()).toBe('/exercises/back-squat');
    expect(tab('Comment faire').getAttribute('aria-selected')).toBe('true');
  });
});

describe('fiche non utilisable, retirée ou infaisable (spec brique 2 §4.2)', () => {
  it('profil prudent, fiche not_for_minors ouverte par URL : bandeau, aucun contenu, exercices proches utilisables', async () => {
    await open('/exercises/archer-push-up?tab=mistakes', { me: MINOR });
    expect(screen.getByText(NOT_USABLE)).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Sécurité' })).toBeNull();
    expect(screen.queryByText(/Pompe archer : /)).toBeNull();
    expect(screen.queryByText('Descends la poitrine.')).toBeNull();
    expect(screen.queryByRole('list', { name: "Caractéristiques de l'exercice" })).toBeNull();
    const near = screen.getByRole('region', { name: 'Exercices proches' });
    expect(within(near).getByRole('link', { name: 'Pompe' })).toBeTruthy();
    expect(within(near).queryByRole('link', { name: 'Pompe archer' })).toBeNull();
  });

  it('fiche not_for_minors retirée en profil prudent : le bandeau des réglages l’emporte sur celui du retrait', async () => {
    const catalog = [
      ...CATALOG,
      served({ id: 'box-jump', name: 'Box jump', status: 'retired', not_for_minors: true }),
    ];
    await open('/exercises/box-jump', { me: MINOR, catalog });
    expect(screen.getByText(NOT_USABLE)).toBeTruthy();
    expect(screen.queryByText(RETIRED)).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('adulte : la même fiche s’affiche entière, sans bandeau', async () => {
    await open('/exercises/archer-push-up');
    expect(screen.queryByText(NOT_USABLE)).toBeNull();
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(within(panel()).getByText('Descends la poitrine.')).toBeTruthy();
  });

  it('fiche retirée : bandeau, contenu en lecture, « Voir des exercices proches » ouvre Variantes sur la liste', async () => {
    await open('/exercises/jump-squat');
    expect(screen.getByText(RETIRED)).toBeTruthy();
    expect(within(panel()).getByRole('list', { name: 'Étapes' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Voir des exercices proches' }));
    await settle();
    expect(tab('Variantes').getAttribute('aria-selected')).toBe('true');
    const heading = within(panel()).getByRole('heading', { name: 'Exercices proches' });
    await until(() => document.activeElement === heading);
    expect(screen.queryByText(NO_SUBSTITUTE)).toBeNull();
  });

  it('fiche retirée sans exercice proche : « Aucun exercice proche pour l’instant. » à la place du lien', async () => {
    await open('/exercises/old-calf-raise');
    expect(screen.getByText(RETIRED)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Voir des exercices proches' })).toBeNull();
    expect(screen.getAllByText(NO_SUBSTITUTE).length).toBeGreaterThan(0);
  });

  it('infaisable au lieu principal : mention « Pas faisable : <lieu> », contenu affiché normalement', async () => {
    const { unmount } = await open('/exercises/lat-pulldown');
    expect(screen.getByText('Pas faisable : Garage')).toBeTruthy();
    expect(screen.queryByText(NOT_USABLE)).toBeNull();
    expect(within(panel()).getByRole('list', { name: 'Étapes' })).toBeTruthy();
    // Aucune option faisable : la pastille de matériel montre la première.
    expect(screen.getByText('Tirage vertical', { selector: 'li' })).toBeTruthy();
    unmount();

    const feasible = await open('/exercises/goblet-squat');
    expect(screen.queryByText(/^Pas faisable/)).toBeNull();
    feasible.unmount();

    await open('/exercises/lat-pulldown', { place: false });
    expect(screen.queryByText(/^Pas faisable/)).toBeNull();
  });
});

describe('catalogue absent ou fiche inconnue', () => {
  it('catalogue jamais téléchargé : « Le catalogue arrive… » en ligne, la phrase du Système hors ligne', async () => {
    const { unmount } = await open('/exercises/goblet-squat', { catalog: null });
    expect(screen.getByText('Le catalogue arrive…')).toBeTruthy();
    unmount();

    await open('/exercises/goblet-squat', { catalog: null, connection: 'offline' });
    expect(screen.getByText('Connecte-toi une fois pour récupérer les exercices.')).toBeTruthy();
    expect(screen.queryByText('Le catalogue arrive…')).toBeNull();
  });

  it('id inconnu du catalogue local : « Exercice introuvable. »', async () => {
    await open('/exercises/unknown-sheet');
    expect(screen.getByText('Exercice introuvable.')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});

describe('exercises.module.css : jetons, carte claire, cibles de 44 px (spec refonte §4, 04 §12)', () => {
  const css = () => readFileSync(EXERCISES_CSS, 'utf8');
  const blocks = () => parseCssBlocks(css());

  it('aucune couleur écrite en dur : chaque couleur vient de tokens.css', () => {
    const literals =
      css()
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi) ?? [];
    expect(literals).toEqual([]);
  });

  it('carte des illustrations claire dans tous les thèmes : --illustration-bg, déclaré sur :root seulement', () => {
    expect(declarationsOf(blocks(), '.illustrationCard')?.get('background')).toBe('var(--illustration-bg)');
    const tokens = parseCssBlocks(readFileSync(TOKENS_CSS, 'utf8'));
    expect(declarationsOf(tokens, ':root')?.get('--illustration-bg')).toBe('#ffffff');
    const redefined = tokens.filter((b) => b.selector !== ':root' && b.declarations.has('--illustration-bg'));
    expect(redefined.map((b) => b.selector)).toEqual([]);
  });

  it('liens de la fiche (Crédits des illustrations, Voir des exercices proches) : au moins 44 px de haut', () => {
    /** Déclarations des règles hors media query dont la liste de sélecteurs contient `cls`. */
    const rule = (cls: string) =>
      new Map(
        blocks()
          .filter((b) => b.media === null && b.selector.split(',').some((s) => s.trim() === cls))
          .flatMap((b) => [...b.declarations]),
      );
    for (const cls of ['.creditsLink', '.bannerLink']) {
      expect(rule(cls).get('min-height'), cls).toBe('44px');
    }
  });
});
