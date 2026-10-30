import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IllustrationEntry } from '@rune/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPrivacySections } from '../../src/features/public/privacy-content';
import type { AppDb } from '../../src/local-db/db';
import { setMeta } from '../../src/local-db/meta';
import { declarationsOf, parseCssBlocks } from '../support/css-blocks';
import { createFakeApi, createFakeSyncEngine } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { makeMe, renderApp } from '../support/render';

/** Mention des textes (spec brique 2 §5.7), sur la page Crédits. */
const CREDITS_TEXTS =
  "Rédigés avec l'aide d'une IA (Claude), relus par l'administrateur et des relectrices, dont une professionnelle de santé pour les exercices sensibles.";
/** Catalogue jamais téléchargé sur l'appareil : les crédits des illustrations viennent avec lui. */
const CREDITS_MISSING =
  "Les crédits des illustrations arrivent avec le catalogue d'exercices : connecte-toi une fois pour le récupérer.";

/** Feuille des pages publiques, lue à plat. */
const publicCss = () =>
  parseCssBlocks(
    readFileSync(resolve(import.meta.dirname, '../../src/features/public/public.module.css'), 'utf8'),
  );

const privacyText = (owner: string | undefined) =>
  buildPrivacySections(owner)
    .flatMap((s) => s.items)
    .join('\n');

/**
 * Texte écrit dans `el`, morceau par morceau : pictogrammes (aria-hidden) retirés, et un aria-label n'y
 * compte pas (le nom d'un lien d'appel vient de son aria-label, pas de ce qui est affiché).
 */
const shownText = (el: Element) => {
  const parts: string[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('[aria-hidden="true"]')) parts.push(node.textContent ?? '');
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
};

/** Texte écrit après le titre `heading`, dans sa section (la page, ou la région d'Aide). */
const shownAfter = (heading: HTMLElement) => {
  const section = heading.closest('section');
  let block: Element | null = heading;
  while (block && block.parentElement !== section) block = block.parentElement;
  const parts: string[] = [];
  for (let next = block?.nextElementSibling; next; next = next.nextElementSibling)
    parts.push(shownText(next));
  return parts.join(' ');
};

describe('responsable des données (03 §1, §10.8)', () => {
  it.each([undefined, '', '   '])(
    'sans prénom (%j) : administrateur hébergeur, porteur du projet',
    (owner) => {
      const text = privacyText(owner);
      expect(text).toContain("hébergé chez l'administrateur");
      expect(text).toContain('Le responsable des données est le porteur du projet');
      expect(text).toContain('seul le porteur du projet en détient les clés');
      expect(text).toContain('adresse-toi directement au porteur du projet');
      expect(text).toContain('si le porteur du projet est indisponible longtemps');
    },
  );

  it('enveloppe de secours : clés du serveur et des sauvegardes, ouverte seulement pour exporter puis effacer (T45-F32, T14-F3)', () => {
    const text = privacyText('Bastien');
    expect(text).toContain('au quotidien, seul Bastien en détient les clés.');
    expect(text).toContain(
      "Une copie scellée des clés du serveur et des sauvegardes (l'enveloppe de secours) est confiée à une personne de confiance majeure. Elle n'est ouverte que si Bastien est indisponible longtemps : cette personne remet alors le serveur en marche, sans consulter tes données, pour que tu puisses les exporter, puis les sauvegardes sont effacées et le service arrêté.",
    );
    expect(text).not.toContain('copie scellée de ces clés');
  });

  it('avec prénom : le porteur est nommé partout', () => {
    const text = privacyText(' Bastien ');
    expect(text).toContain('hébergé chez Bastien.');
    expect(text).toContain('Le responsable des données est Bastien,');
    expect(text).toContain('seul Bastien en détient les clés');
    expect(text).toContain('adresse-toi directement à Bastien');
    expect(text).toContain(
      "L'administrateur a la main sur le serveur et peut techniquement lire la base. Il s'engage à ne faire aucune requête manuelle sur les données d'une personne sans son accord.",
    );
    expect(text).toContain(
      "L'administrateur voit l'adresse de ton compte Tailscale, une information gérée par Tailscale.",
    );
  });
});

describe('pages publiques', () => {
  it('/privacy reprend la fiche de traitement', async () => {
    await renderApp({ path: '/privacy', me: null });
    await screen.findByRole('heading', { level: 1, name: 'Confidentialité et règles' });
    const text = document.body.textContent ?? '';
    for (const expected of [
      'Version 1.0',
      'peut techniquement lire la base',
      "aucune requête manuelle sur les données d'une personne sans son accord",
      "l'adresse de ton compte Tailscale",
      '90 jours sans usage',
      '365 jours au maximum',
      '12 mois',
      '30 jours au plus',
      '7 jours',
      '24 h',
      '90 jours',
      'ne remplace pas un avis médical',
      'serveur à domicile en France',
      'États-Unis',
      'sauvegardes chiffrées hors du domicile',
      'copie scellée des clés du serveur et des sauvegardes',
      'sans consulter tes données',
    ]) {
      expect(text, expected).toContain(expected);
    }
    for (const expected of [
      "jusqu'à la déconnexion (si la file d'envoi est vide)",
      'consulte le journal de sécurité',
      'ton adresse IP',
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect(screen.getByRole('heading', { name: 'Règles pour les 16-17 ans' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Coach et mineurs' })).toBeTruthy();
    expect(text).not.toMatch(/’/);
  });

  it('/help : numéros cliquables et date de vérification', async () => {
    await renderApp({ path: '/help', me: null });
    await screen.findByRole('heading', { level: 1 });
    const tel = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => h.startsWith('tel:'));
    expect(tel).toEqual(['tel:15', 'tel:112', 'tel:0969325900', 'tel:0800152000', 'tel:3114']);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Numéros vérifiés le 06/10/2026');
    expect(text.split('Horaires :').length - 1).toBe(1);
    expect(text).not.toContain('gratuits et confidentiels');
  });

  it('/privacy/ avec barre finale reste publique', async () => {
    await renderApp({ path: '/privacy/', me: null });
    await screen.findByRole('heading', { level: 1, name: 'Confidentialité et règles' });
  });

  it('/credits sans requête : catalogue jamais téléchargé, la mention des textes et une invitation', async () => {
    const { api } = await renderApp({ path: '/credits', me: null });
    await screen.findByRole('heading', { level: 1, name: 'Crédits' });
    expect(await screen.findByText(CREDITS_MISSING)).toBeTruthy();
    expect(screen.getByText(CREDITS_TEXTS)).toBeTruthy();
    expect(api.calls).toEqual([]);
  });

  it('route inconnue → Page introuvable', async () => {
    await renderApp({ path: '/nulle-part' });
    await screen.findByText('Page introuvable');
  });
});

describe('Aide (maquette A05, spec refonte §10.6)', () => {
  it("l'encadré d'urgence (15, 112) d'abord, puis « Installer Rune », les numéros utiles et les Crédits", async () => {
    await renderApp({ path: '/help', me: null });
    await screen.findByRole('heading', { level: 1, name: 'Aide' });
    const emergency = screen.getByRole('region', { name: "En cas d'urgence, appelle le 15 ou le 112." });
    expect(within(emergency).getByRole('link', { name: 'Appeler le 15, SAMU' }).getAttribute('href')).toBe(
      'tel:15',
    );
    expect(
      within(emergency).getByRole('link', { name: 'Appeler le 112, numéro européen' }).getAttribute('href'),
    ).toBe('tel:112');
    // À l'écran, chaque bouton montre son numéro puis son nom (le nom lu, lui, vient de l'aria-label).
    expect(within(emergency).getAllByRole('link').map(shownText)).toEqual(['15 SAMU', '112 Numéro européen']);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Installer Rune',
      'Numéros utiles',
      'Crédits',
    ]);
    const install = screen.getByRole('region', { name: 'Installer Rune' });
    expect(emergency.compareDocumentPosition(install)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("« Installer Rune » : les étapes sur iPhone puis sur Android (consignes de l'invitation)", async () => {
    await renderApp({ path: '/help', me: null });
    const install = await screen.findByRole('region', { name: 'Installer Rune' });
    expect(
      within(install)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Sur iPhone', 'Sur Android']);
    // Texte relu par un lecteur d'écran : numéros et pictogrammes décoratifs (aria-hidden) retirés.
    const spoken = (el: Element) => {
      const copy = el.cloneNode(true) as Element;
      for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
      return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    };
    const steps = within(install).getAllByRole('listitem').map(spoken);
    expect(steps).toEqual([
      'Touche Partager',
      "Puis « Sur l'écran d'accueil »",
      "Ouvre ensuite Rune depuis l'écran d'accueil et colle le code.",
      'Ouvre le menu ⋮',
      "Puis « Installer l'application »",
    ]);
  });

  // Safari ôte la sémantique de liste d'une liste sans puces (list-style: none) : VoiceOver lirait des lignes
  // sans « liste, 3 éléments » ni position. Le rôle explicite la rend.
  it('étapes et numéros utiles : rôle « list » explicite, gardé par VoiceOver malgré les puces ôtées', async () => {
    await renderApp({ path: '/help', me: null });
    const install = await screen.findByRole('region', { name: 'Installer Rune' });
    const useful = screen.getByRole('region', { name: 'Numéros utiles' });
    const lists = [...within(install).getAllByRole('list'), ...within(useful).getAllByRole('list')];
    expect(lists.map((l) => [l.tagName, l.getAttribute('role')])).toEqual([
      ['OL', 'list'],
      ['OL', 'list'],
      ['UL', 'list'],
    ]);
  });

  it('numéros utiles : sans le 15 / 112 déjà en tête, un appel et une source (nouvel onglet) par numéro', async () => {
    await renderApp({ path: '/help', me: null });
    const useful = await screen.findByRole('region', { name: 'Numéros utiles' });
    expect(useful.textContent).toContain('Numéros vérifiés le 06/10/2026');
    expect(useful.textContent).not.toContain('Urgence vitale');
    // Ce qui est écrit, dans l'ordre (03 §13.7) : chaque libellé, son numéro, sa source, ses horaires ; les
    // deux consignes de santé sans numéro restent dans la liste.
    expect(within(useful).getAllByRole('listitem').map(shownText)).toEqual([
      'Douleur : consulte un médecin ou un kinésithérapeute',
      'Anorexie Boulimie Info Écoute (FFAB), appel non surtaxé 09 69 325 900 Source (nouvel onglet)',
      'Écoute Dopage 0 800 15 2000 Source (nouvel onglet)',
      'Grossesse ou allaitement : demande conseil à ton médecin ou à une sage-femme',
      'Prévention du suicide 3114 Source (nouvel onglet) Horaires : 24 h/24, gratuit',
    ]);
    expect(
      within(useful)
        .getAllByRole('link', { name: /^Appeler le / })
        .map((a) => [a.getAttribute('aria-label'), a.getAttribute('href')]),
    ).toEqual([
      ['Appeler le 09 69 325 900', 'tel:0969325900'],
      ['Appeler le 0 800 15 2000', 'tel:0800152000'],
      ['Appeler le 3114', 'tel:3114'],
    ]);
    const sources = within(useful).getAllByRole('link', { name: 'Source (nouvel onglet)' });
    expect(sources.map((a) => a.getAttribute('target'))).toEqual(['_blank', '_blank', '_blank']);
    expect(useful.textContent).toContain('Horaires : 24 h/24, gratuit');
  });

  it('Crédits dans Aide (P10), /credits reste servi avec le même contenu', async () => {
    const help = await renderApp({ path: '/help', me: null });
    const credits = await screen.findByRole('region', { name: 'Crédits' });
    await within(credits).findByText(CREDITS_MISSING);
    const inHelp = shownAfter(within(credits).getByRole('heading', { level: 2, name: 'Crédits' }));
    expect(inHelp).toBe(`Textes des exercices ${CREDITS_TEXTS} Illustrations ${CREDITS_MISSING}`);
    // Sous le h2 d'Aide, les titres des crédits descendent d'un niveau.
    expect(
      within(credits)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Textes des exercices', 'Illustrations']);
    help.unmount();
    await renderApp({ path: '/credits', me: null });
    const title = await screen.findByRole('heading', { level: 1, name: 'Crédits' });
    await screen.findByText(CREDITS_MISSING);
    expect(shownAfter(title)).toBe(inHelp);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Textes des exercices',
      'Illustrations',
    ]);
  });
});

describe('Crédits générés depuis le manifeste (04 §12, §13 critère 12)', () => {
  const COMMIT = '0123456789abcdef0123456789abcdef01234567';
  const url = (repo: string, path: string) => `https://github.com/${repo}/blob/${COMMIT}/${path}`;
  const entry = (id: string, o: Partial<IllustrationEntry> = {}): IllustrationEntry => ({
    id,
    file: `${id}.0a1b2c3d.svg`,
    sha256: `0a1b2c3d${'e'.repeat(56)}`,
    bytes: 2048,
    media_type: 'image/svg+xml',
    source: 'everkinetic',
    source_url: url('everkinetic/data', `svg/${id}.svg`),
    creators: ['Greg Priday'],
    license: 'CC-BY-SA-4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    modifications: 'Rune : nettoyage du SVG.',
    replace_before_public: false,
    ...o,
  });
  const { modifications: _, ...pikeBase } = entry('pike-start', {
    source: 'workout_guide',
    source_url: url('bryllim/workout-guide', 'images/pike-1.png'),
    file: 'pike-start.0a1b2c3d.png',
    media_type: 'image/png',
    creators: ['Bryl Lim'],
    replace_before_public: true,
  });
  const manifest = [entry('squat-start'), entry('squat-end'), pikeBase, entry('unused-start')];
  const exercises = [
    {
      id: 'goblet-squat',
      name: 'Squat goblet',
      status: 'published',
      illustrations: [
        { illustration_id: 'squat-start', role: 'start' },
        { illustration_id: 'squat-end', role: 'end' },
      ],
    },
    {
      id: 'pike-push-up',
      name: 'Pompe pike',
      status: 'published',
      illustrations: [{ illustration_id: 'pike-start', role: 'start' }],
    },
    { id: 'plank', name: 'Gainage', status: 'published', illustrations: [] },
  ];

  async function seededDb(sheets: unknown[] = exercises, entries: unknown[] = manifest): Promise<AppDb> {
    const db = createTestLocalDb();
    await db.table('exercises').bulkPut(sheets);
    await db.table('illustrations').bulkPut(entries);
    await setMeta(db, 'catalogVersion', 'cat-1');
    return db;
  }

  /** Bloc d'une source : son titre h3 (sur /credits), puis ce qui suit jusqu'à la source suivante. */
  const sourceBlock = (name: string) => {
    const block = screen.getByRole('heading', { level: 3, name }).closest('section');
    if (!block) throw new Error(`bloc ${name} introuvable`);
    return block as HTMLElement;
  };

  it('hors ligne, sans session : chaque illustration de chaque fiche publiée, la mention des textes', async () => {
    const api = createFakeApi();
    api.setOffline('reject');
    await renderApp({ path: '/credits', me: null, api, db: await seededDb() });
    await screen.findByRole('heading', { level: 3, name: 'Everkinetic' });
    expect(screen.getByText(CREDITS_TEXTS)).toBeTruthy();
    expect(
      screen.getByText(
        'Rune modifie les fichiers repris (nettoyage, optimisation, renommage) ; ces versions modifiées sont sous licence CC BY-SA 4.0.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Everkinetic',
      'workout-guide',
    ]);

    // Chaque fichier d'une fiche publiée : son usage et son lien source figé, rien de plus.
    const listed: [string, string | null][] = [];
    for (const summary of document.querySelectorAll('summary')) {
      fireEvent.click(summary);
      const files = summary.closest('details')?.querySelectorAll('li') ?? [];
      for (const li of files) {
        const use = li.querySelector('p')?.textContent ?? '';
        listed.push([use, li.querySelector('a')?.getAttribute('href') ?? null]);
      }
    }
    expect(listed).toEqual([
      ['Squat goblet : position de départ', url('everkinetic/data', 'svg/squat-start.svg')],
      ['Squat goblet : position de fin', url('everkinetic/data', 'svg/squat-end.svg')],
      ['Pompe pike : position de départ', url('bryllim/workout-guide', 'images/pike-1.png')],
    ]);
    expect(document.body.textContent).not.toContain('unused-start');
    expect(api.calls).toEqual([]);
  });

  it('par source : créateurs, licence (lien), copie figée au commit ; par fichier : crédit, modifications, marquage', async () => {
    await renderApp({ path: '/credits', me: null, db: await seededDb() });
    await screen.findByRole('heading', { level: 3, name: 'Everkinetic' });

    const everkinetic = sourceBlock('Everkinetic');
    expect(everkinetic.textContent).toContain('Créateurs : Greg Priday');
    const license = within(everkinetic).getByRole('link', { name: 'CC BY-SA 4.0 (nouvel onglet)' });
    expect(license.getAttribute('href')).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(license.getAttribute('target')).toBe('_blank');
    const frozen = within(everkinetic).getByRole('link', {
      name: 'github.com/everkinetic/data, commit 0123456 (nouvel onglet)',
    });
    expect(frozen.getAttribute('href')).toBe(`https://github.com/everkinetic/data/tree/${COMMIT}`);
    expect(within(everkinetic).getByText('2 illustrations')).toBeTruthy();
    const [squatStart] = within(everkinetic).getAllByRole('listitem', { hidden: true });
    expect(squatStart?.textContent).toContain('Illustration : Greg Priday · CC BY-SA 4.0 · modifiée');
    expect(squatStart?.textContent).toContain('Modifications : Rune : nettoyage du SVG.');
    expect(
      within(squatStart as HTMLElement)
        .getByRole('link', {
          hidden: true,
          name: 'Source (Squat goblet : position de départ, nouvel onglet)',
        })
        .getAttribute('target'),
    ).toBe('_blank');

    const workoutGuide = sourceBlock('workout-guide');
    expect(workoutGuide.textContent).toContain('Créateurs : Bryl Lim');
    expect(within(workoutGuide).getByText('1 illustration')).toBeTruthy();
    const [pike] = within(workoutGuide).getAllByRole('listitem', { hidden: true });
    expect(pike?.textContent).toContain('Illustration : Bryl Lim · CC BY-SA 4.0');
    expect(pike?.textContent).not.toContain('modifiée');
    expect(pike?.textContent).toContain('À remplacer avant publication : provenance non documentée.');
  });

  it('catalogue sans illustration : « Aucune illustration pour le moment. »', async () => {
    await renderApp({ path: '/credits', me: null, db: await seededDb([exercises[2]], []) });
    expect(await screen.findByText('Aucune illustration pour le moment.')).toBeTruthy();
    expect(screen.getByText(CREDITS_TEXTS)).toBeTruthy();
    expect(screen.queryByText(CREDITS_MISSING)).toBeNull();
  });

  it('Aide : les mêmes crédits, titres un niveau plus bas (h3 puis h4)', async () => {
    await renderApp({ path: '/help', me: null, db: await seededDb() });
    const credits = await screen.findByRole('region', { name: 'Crédits' });
    await within(credits).findByRole('heading', { level: 4, name: 'Everkinetic' });
    expect(
      within(credits)
        .getAllByRole('heading', { level: 4 })
        .map((h) => h.textContent),
    ).toEqual(['Everkinetic', 'workout-guide']);
  });
});

describe('pages publiques : cadre (maquettes A02 à A05)', () => {
  it.each(['/help', '/privacy', '/credits'])(
    "%s sans session : Retour vers la connexion, sans l'ancien en-tête « Rune »",
    async (path) => {
      await renderApp({ path, me: null });
      expect((await screen.findByRole('link', { name: 'Retour' })).getAttribute('href')).toBe('/login');
      // Le haut d'écran est celui de la page (Retour et titre) : plus de marque « Rune » de cadre au-dessus.
      expect(screen.queryByText('Rune')).toBeNull();
      expect(screen.queryByRole('link', { name: 'Rune' })).toBeNull();
      expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Crédits' })).toBeTruthy();
    },
  );

  it.each(['/help', '/privacy', '/credits'])(
    '%s en session : Retour vers le Profil, où vivent Aide et Confidentialité',
    async (path) => {
      await renderApp({ path, me: makeMe() });
      // Page publique rendue tout de suite, avant la lecture de la session locale : le Retour suit la session lue.
      await waitFor(() =>
        expect(screen.getByRole('link', { name: 'Retour' }).getAttribute('href')).toBe('/profile'),
      );
    },
  );

  it('hors ligne, sans session : Aide, Confidentialité et Crédits se lisent sans aucune requête', async () => {
    for (const [path, title] of [
      ['/help', 'Aide'],
      ['/privacy', 'Confidentialité et règles'],
      ['/credits', 'Crédits'],
    ] as const) {
      const api = createFakeApi();
      api.setOffline('reject');
      const view = await renderApp({ path, me: null, api });
      await screen.findByRole('heading', { level: 1, name: title });
      expect(api.calls).toEqual([]);
      view.unmount();
    }
  });
});

describe('404 : marque en tête (maquette A06, spec refonte §10)', () => {
  const DESKTOP = '(min-width: 900px)';
  const media = (...matching: string[]) =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: matching.includes(query),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('téléphone : logo et RUNE vers l’accueil, nommés « Rune », avant l’emblème et la fenêtre du Système', async () => {
    media();
    await renderApp({ path: '/nulle-part' });
    const panel = await screen.findByRole('group', { name: 'Page introuvable' });
    const brand = screen.getByRole('link', { name: 'Rune' });
    expect(brand.getAttribute('href')).toBe('/');
    // Le logo est décoratif : le nom du lien suffit, lu une fois.
    expect(brand.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(brand.textContent).toBe('RUNE');
    expect(brand.compareDocumentPosition(panel)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // En clair, le logo mono (cadre à l'accent) : sans dégradé ni lueur.
    expect(brand.querySelector('linearGradient')).toBeNull();
  });

  it('téléphone en sombre : le logo prend son dégradé et sa lueur, comme dans l’en-tête de l’accueil', async () => {
    media('(prefers-color-scheme: dark)');
    await renderApp({ path: '/nulle-part' });
    await screen.findByRole('group', { name: 'Page introuvable' });
    const brand = screen.getByRole('link', { name: 'Rune' });
    expect(brand.querySelector('linearGradient')).not.toBeNull();
    expect(brand.querySelector('filter')).not.toBeNull();
  });

  it('≥ 900 px : la marque une seule fois, dans la navigation latérale (un arrêt de tabulation)', async () => {
    media(DESKTOP);
    await renderApp({ path: '/nulle-part' });
    await screen.findByRole('group', { name: 'Page introuvable' });
    expect(screen.getAllByRole('link', { name: 'Rune' })).toHaveLength(1);
    expect(within(screen.getByTestId('side-nav')).getByRole('link', { name: 'Rune' })).toBeTruthy();
  });

  it('même allure que la marque de l’en-tête de l’accueil (taille, écart, encre, cadre à l’accent, 44 px)', () => {
    const shellCss = parseCssBlocks(
      readFileSync(resolve(import.meta.dirname, '../../src/ui/shell.module.css'), 'utf8'),
    );
    expect(declarationsOf(publicCss(), '.brand')).toEqual(declarationsOf(shellCss, '.brand'));
  });
});

describe('404 (maquette A06, spec refonte §10.7)', () => {
  const OFFLINE_TEXT =
    'Les pages Aide, Confidentialité et Crédits restent lisibles. La connexion nécessite le réseau.';

  it("« Page introuvable » dans la fenêtre du Système, « Zone inconnue. », lien vers l'accueil", async () => {
    await renderApp({ path: '/nulle-part' });
    const panel = await screen.findByRole('group', { name: 'Page introuvable' });
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'Page introuvable',
    ]);
    expect(within(panel).getByText('SYSTÈME')).toBeTruthy();
    expect(panel.textContent).toContain(
      "Zone inconnue. Cette page n'existe pas ou n'est pas encore disponible.",
    );
    expect(within(panel).getByRole('link', { name: "Retour à l'accueil" }).getAttribute('href')).toBe('/');
    expect(screen.queryByText(OFFLINE_TEXT)).toBeNull();
  });

  it('page admin pour un membre : la même 404', async () => {
    await renderApp({ path: '/admin/members' });
    expect(await screen.findByRole('group', { name: 'Page introuvable' })).toBeTruthy();
  });

  // Une région live créée avec son texte n'est souvent pas lue (NVDA, JAWS, VoiceOver) : elle est là, vide,
  // avant la coupure, et c'est son contenu qui change.
  it('région « Hors ligne » déjà là, vide, avant la coupure : le texte qui s’y ajoute est annoncé', async () => {
    const sync = createFakeSyncEngine({ connection: 'online' });
    await renderApp({ path: '/nulle-part', sync });
    await screen.findByRole('group', { name: 'Page introuvable' });
    const region = within(screen.getByRole('main')).getByRole('status');
    expect(region.textContent).toBe('');
    act(() => sync.set({ connection: 'offline' }));
    expect(within(screen.getByRole('main')).getByRole('status')).toBe(region);
    expect(region.textContent).toContain('Hors ligne');
    expect(region.textContent).toContain(OFFLINE_TEXT);
    act(() => sync.set({ connection: 'online' }));
    expect(region.isConnected).toBe(true);
    expect(region.textContent).toBe('');
  });

  it('région vide : elle rend l’écart qui la précède, la 404 reste centrée comme sans elle', () => {
    const css = publicCss();
    const gap = declarationsOf(css, '.notFound')?.get('gap');
    expect(gap).toMatch(/^\d+px$/);
    expect(declarationsOf(css, '.offlineSlot:empty')?.get('margin-top')).toBe(`-${gap}`);
  });

  it("hors ligne (l'état de connexion unique) : encadré « Hors ligne », qui part au retour du réseau", async () => {
    const sync = createFakeSyncEngine({ connection: 'offline' });
    await renderApp({ path: '/nulle-part', sync });
    const notice = (await screen.findByText(OFFLINE_TEXT)).closest('[role="status"]');
    expect(notice?.textContent).toContain('Hors ligne');
    const panel = screen.getByRole('group', { name: 'Page introuvable' });
    expect(panel.compareDocumentPosition(notice as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    act(() => sync.set({ connection: 'online' }));
    expect(screen.queryByText(OFFLINE_TEXT)).toBeNull();
  });

  // Les autres états où la 404 se voit (unauthenticated et account_deleted mènent à la connexion, par la garde).
  it.each(['unknown', 'protocol_unsupported'] as const)(
    "état de connexion « %s » : pas d'encadré « Hors ligne », que seul l'état offline montre",
    async (connection) => {
      await renderApp({ path: '/nulle-part', sync: createFakeSyncEngine({ connection }) });
      await screen.findByRole('group', { name: 'Page introuvable' });
      expect(screen.queryByText(OFFLINE_TEXT)).toBeNull();
    },
  );
});
