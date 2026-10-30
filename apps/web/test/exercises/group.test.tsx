import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settle } from '../support/auth';
import { until } from '../support/wait';
import { CATALOG, feasibleSwitch, MINOR, open, openInBrowser, spoken } from './fixture';

// Liste d'un groupe (`/exercises/group/:code`, spec brique 2 §4.1 et §4.3) : vignette, nom, muscles principaux,
// matériel de la première option faisable, niveau en 3 barres avec « Niveau 1 sur 3, débutant » ; tri par niveau,
// puis par nom en collation française, puis par id ; code inconnu → `/exercises`.

const list = () => screen.getByRole('list', { name: 'Exercices' });
const rows = () => within(list()).getAllByRole('link');
const names = () => rows().map((a) => a.querySelector('[data-name]')?.textContent ?? '');

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('liste d’un groupe', () => {
  it('titre du groupe, interrupteur gardé, fiches faisables triées par niveau puis par nom (collation française)', async () => {
    await open('/exercises/group/quads');
    expect(screen.getByRole('heading', { level: 1, name: 'Quadriceps' })).toBeTruthy();
    expect(feasibleSwitch().getAttribute('aria-checked')).toBe('true');
    // Niveau 1 d'abord : « Élévation » avant « fente » et « Squat » (pas l'ordre binaire, ni la casse).
    expect(names()).toEqual([
      'Chaise contre le mur',
      'Élévation sur pointes en squat',
      'fente statique',
      'Squat au poids du corps',
      'Squat goblet',
      'Fente bulgare',
    ]);
    fireEvent.click(feasibleSwitch());
    await until(() => rows().length === 7);
    expect(names().slice(-2)).toEqual(['Fente bulgare', 'Squat barre']);
  });

  it('une ligne : nom (nom du lien), muscles principaux, matériel faisable, « Niveau 1 sur 3, débutant » et ses 3 barres', async () => {
    await open('/exercises/group/quads');
    const goblet = within(list()).getByRole('link', { name: 'Squat goblet' });
    expect(goblet.getAttribute('href')).toBe('/exercises/goblet-squat');
    expect(spoken(goblet)).toBe(
      'Squat goblet Quadriceps · Fessiers Haltères fixes ou réglables Niveau 1 sur 3, débutant',
    );
    expect(goblet.querySelectorAll('[aria-hidden="true"] [data-filled]')).toHaveLength(1);
    const bulgarian = within(list()).getByRole('link', { name: 'Fente bulgare' });
    expect(spoken(bulgarian)).toContain('Niveau 2 sur 3, intermédiaire');
    expect(bulgarian.querySelectorAll('[aria-hidden="true"] [data-filled]')).toHaveLength(2);
    // Description du lien : muscles, matériel et niveau (le nom seul le nomme).
    const described = (goblet.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain('Quadriceps · Fessiers');
    expect(described).toContain('Niveau 1 sur 3, débutant');
  });

  it('vignette : la position de départ de la fiche, sinon le pictogramme neutre, toujours en texte alternatif vide', async () => {
    await open('/exercises/group/quads');
    const goblet = within(list()).getByRole('link', { name: 'Squat goblet' });
    const img = goblet.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/illustrations/goblet-squat-start.0a1b2c3d.svg');
    expect(img?.getAttribute('alt')).toBe('');
    const chair = within(list()).getByRole('link', { name: 'Chaise contre le mur' });
    expect(chair.querySelector('img')).toBeNull();
    expect(chair.querySelector('svg[aria-hidden="true"][data-pictogram]')).not.toBeNull();
    // Image qui ne charge pas (pas en cache) : le pictogramme la remplace.
    fireEvent.error(img as HTMLImageElement);
    expect(goblet.querySelector('img')).toBeNull();
    expect(goblet.querySelector('svg[data-pictogram]')).not.toBeNull();
  });

  it('filtre coupé : « Pas faisable : Garage » sur la fiche infaisable, matériel de sa première option', async () => {
    await open('/exercises/group/quads');
    fireEvent.click(feasibleSwitch());
    await until(() => rows().length === 7);
    const backSquat = within(list()).getByRole('link', { name: 'Squat barre' });
    expect(spoken(backSquat)).toContain('Pas faisable : Garage');
    expect(spoken(backSquat)).toContain('Barre droite et disques + Cage ou supports à squat avec sécurités');
    expect(spoken(within(list()).getByRole('link', { name: 'Squat goblet' }))).not.toContain('Pas faisable');
  });

  it('sans lieu principal : ni interrupteur ni mention, toutes les fiches publiées du groupe', async () => {
    await open('/exercises/group/quads', { place: false });
    expect(screen.queryByRole('switch')).toBeNull();
    expect(rows()).toHaveLength(7);
    expect(screen.queryByText(/Pas faisable/)).toBeNull();
  });

  it('profil prudent : la pompe archer (not_for_minors) n’est pas listée, filtre coupé compris', async () => {
    await open('/exercises/group/chest', { me: MINOR });
    expect(names()).toEqual(['Pompe', 'Pompe contre le mur']);
    fireEvent.click(feasibleSwitch());
    await settle();
    expect(names()).toEqual(['Pompe', 'Pompe contre le mur']);
    expect(screen.queryByText(/Pompe archer/)).toBeNull();
  });

  it('un toucher sur une ligne ouvre la fiche ; son Retour revient au groupe, à la même position', async () => {
    await openInBrowser('/exercises/group/quads');
    act(() => window.scrollTo(0, 420));
    fireEvent.click(within(list()).getByRole('link', { name: 'Squat goblet' }));
    await screen.findByRole('heading', { level: 1, name: 'Squat goblet' });
    expect(window.location.pathname).toBe('/exercises/goblet-squat');
    act(() => window.scrollTo(0, 0));
    const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    await popped;
    await screen.findByRole('heading', { level: 1, name: 'Quadriceps' });
    await settle();
    expect(window.location.pathname).toBe('/exercises/group/quads');
    expect(screen.getByRole('list', { name: 'Exercices' })).toBeTruthy();
    expect(window.scrollY).toBe(420);
  });

  it('groupe ouvert par son adresse : Retour mène à l’onglet Exercices', async () => {
    const r = await open('/exercises/group/quads');
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    await screen.findByRole('heading', { level: 1, name: 'Exercices' });
    expect(r.location()).toBe('/exercises');
  });
});

describe('groupe vide', () => {
  it('rien de faisable au lieu : « Rien de faisable à Garage dans ce groupe » et « Tout voir », qui coupe le filtre', async () => {
    await open('/exercises/group/back');
    expect(screen.queryByRole('list', { name: 'Exercices' })).toBeNull();
    expect(screen.getByText('Rien de faisable à Garage dans ce groupe')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tout voir' }));
    await until(() => screen.queryByRole('list', { name: 'Exercices' }) !== null);
    expect(names()).toEqual(['Tirage vertical']);
    expect(feasibleSwitch().getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText('Rien de faisable à Garage dans ce groupe')).toBeNull();
  });

  it('aucune fiche dans le groupe, même sans filtre : pas de « Tout voir »', async () => {
    await open('/exercises/group/calves');
    expect(screen.getByRole('heading', { level: 1, name: 'Mollets' })).toBeTruthy();
    expect(screen.getByText("Aucun exercice dans ce groupe pour l'instant.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tout voir' })).toBeNull();
    expect(screen.queryByText(/Rien de faisable/)).toBeNull();
  });
});

describe('adresses du groupe', () => {
  it.each(['/exercises/group/unknown', '/exercises/group/Chest-x', '/exercises/group', '/exercises/group/'])(
    '%s → /exercises',
    async (path) => {
      const r = await open(path);
      await until(() => r.location() === '/exercises');
      expect(await screen.findByRole('heading', { level: 1, name: 'Exercices' })).toBeTruthy();
      expect(screen.queryByText('Exercice introuvable.')).toBeNull();
    },
  );

  it('catalogue absent : « Le catalogue arrive… » en ligne, la phrase du Système hors ligne, sans liste', async () => {
    const online = await open('/exercises/group/quads', { catalog: null });
    expect(screen.getByRole('heading', { level: 1, name: 'Quadriceps' })).toBeTruthy();
    expect(screen.getByText('Le catalogue arrive…')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Exercices' })).toBeNull();
    expect(screen.queryByText(/Rien de faisable|Aucun exercice dans ce groupe/)).toBeNull();
    online.unmount();

    await open('/exercises/group/quads', { catalog: null, connection: 'offline' });
    expect(screen.getByText('Connecte-toi une fois pour récupérer les exercices.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Exercices' })).toBeNull();
  });

  it('les fiches retirées ne sont jamais listées', async () => {
    await open('/exercises/group/quads', { place: false });
    expect(names()).not.toContain('Squat sauté');
    expect(CATALOG.some((s) => s.id === 'jump-squat' && s.status === 'retired')).toBe(true);
  });
});
