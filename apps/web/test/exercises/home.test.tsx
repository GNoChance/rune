import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MUSCLE_GROUPS } from '@rune/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settle } from '../support/auth';
import { parseCssBlocks } from '../support/css-blocks';
import { until } from '../support/wait';
import { CATALOG, feasibleSwitch, MINOR, open, openInBrowser, spoken } from './fixture';

// Onglet Exercices (spec brique 2 §4.1) : recherche, interrupteur « Faisable : <lieu> », 9 tuiles par groupe
// musculaire avec la pierre de rang et le nombre d'exercices visibles, catalogue absent (Review Focus 5),
// mode prudent (Review Focus 2), et retour d'une fiche qui restaure la recherche et le défilement.

const ARRIVING = 'Le catalogue arrive…';
const OFFLINE = 'Connecte-toi une fois pour récupérer les exercices.';
const NO_PLACE = 'Choisis ton lieu principal pour ne voir que ce que tu peux faire';
const NO_MATCH = 'Aucun exercice ne correspond.';
const CAUTIOUS = 'Certains exercices sont masqués par le mode prudent.';

const tiles = () => within(screen.getByRole('list', { name: 'Groupes musculaires' })).getAllByRole('link');
const tileNames = () => tiles().map((a) => a.getAttribute('aria-label'));
const search = () => screen.getByRole('searchbox', { name: 'Rechercher un exercice' });
const results = () => screen.queryByRole('list', { name: 'Résultats' });
const resultNames = () =>
  within(screen.getByRole('list', { name: 'Résultats' }))
    .getAllByRole('link')
    .map((a) => a.querySelector('[data-name]')?.textContent ?? '');

/** Recherche dont les résultats (ou l'état vide) sont affichés : `data-query` du bloc des résultats. */
const shownQuery = () => document.querySelector('[data-query]')?.getAttribute('data-query') ?? null;

/** Saisie dans la recherche, puis attente de ses résultats (la recherche part après un petit délai de saisie). */
async function type(text: string) {
  fireEvent.change(search(), { target: { value: text } });
  await waitFor(() => expect(shownQuery()).toBe(text), { timeout: 3000 });
  await settle();
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('tuiles des groupes musculaires (spec brique 2 §4.1 et §4.3)', () => {
  it('9 tuiles dans l’ordre de MUSCLE_GROUPS, chacune avec « Rang E » et le nombre d’exercices faisables au Garage', async () => {
    await open('/exercises');
    expect(screen.getByRole('heading', { level: 1, name: 'Exercices' })).toBeTruthy();
    expect(tileNames()).toEqual([
      'Pectoraux, rang E, 3 exercices',
      'Dos, rang E, 0 exercice',
      'Épaules, rang E, 0 exercice',
      'Bras, rang E, 0 exercice',
      'Abdos, rang E, 0 exercice',
      'Fessiers, rang E, 3 exercices',
      'Quadriceps, rang E, 6 exercices',
      'Ischios, rang E, 0 exercice',
      'Mollets, rang E, 0 exercice',
    ]);
    expect(tiles().map((a) => a.getAttribute('href'))).toEqual(
      MUSCLE_GROUPS.map((g) => `/exercises/group/${g.code}`),
    );
    for (const tile of tiles()) {
      expect(within(tile).getByRole('img', { name: 'Rang E' }), tile.textContent ?? '').toBeTruthy();
    }
    // Le libellé et le nombre sont écrits (pas la couleur seule), et le nom accessible commence par le libellé.
    const quads = screen.getByRole('link', { name: 'Quadriceps, rang E, 6 exercices' });
    expect(quads.textContent).toContain('Quadriceps');
    expect(quads.textContent).toContain('6 exercices');
  });

  it('interrupteur « Faisable : Garage » activé par défaut ; coupé, une tuile change de nombre, une autre quitte 0', async () => {
    await open('/exercises');
    expect(feasibleSwitch().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(feasibleSwitch());
    await until(() => tileNames().includes('Quadriceps, rang E, 7 exercices'));
    expect(feasibleSwitch().getAttribute('aria-checked')).toBe('false');
    expect(tileNames()).toContain('Dos, rang E, 1 exercice');
    expect(tileNames()).toContain('Fessiers, rang E, 4 exercices');
    expect(tileNames()).toContain('Mollets, rang E, 0 exercice');
  });

  it('l’état de l’interrupteur est gardé en entrant dans un groupe, et au retour', async () => {
    const r = await open('/exercises');
    fireEvent.click(feasibleSwitch());
    await until(() => tileNames().includes('Quadriceps, rang E, 7 exercices'));
    fireEvent.click(screen.getByRole('link', { name: 'Quadriceps, rang E, 7 exercices' }));
    await screen.findByRole('heading', { level: 1, name: 'Quadriceps' });
    expect(r.location()).toBe('/exercises/group/quads');
    await settle();
    expect(feasibleSwitch().getAttribute('aria-checked')).toBe('false');
    expect(within(screen.getByRole('list', { name: 'Exercices' })).getAllByRole('link')).toHaveLength(7);
    // Rallumé dans le groupe : l'accueil de l'onglet le retrouve allumé.
    fireEvent.click(feasibleSwitch());
    await until(
      () => within(screen.getByRole('list', { name: 'Exercices' })).queryAllByRole('link').length === 6,
    );
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', {
        name: 'Exercices',
      }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Exercices' });
    await settle();
    expect(feasibleSwitch().getAttribute('aria-checked')).toBe('true');
    expect(tileNames()).toContain('Quadriceps, rang E, 6 exercices');
  });

  it('sans lieu principal : pas d’interrupteur, une ligne vers Profil › Mes lieux, des nombres sans filtre', async () => {
    await open('/exercises', { place: false });
    expect(screen.queryByRole('switch')).toBeNull();
    const row = screen.getByRole('link', { name: NO_PLACE });
    expect(row.getAttribute('href')).toBe('/places');
    expect(tileNames()).toContain('Quadriceps, rang E, 7 exercices');
    expect(tileNames()).toContain('Dos, rang E, 1 exercice');
  });

  it('avec un lieu principal : pas de ligne « Choisis ton lieu principal… »', async () => {
    await open('/exercises');
    expect(screen.queryByText(NO_PLACE)).toBeNull();
  });

  it('une tuile à 0 reste touchable : « Rien de faisable à Garage dans ce groupe » et « Tout voir »', async () => {
    const r = await open('/exercises');
    const back = screen.getByRole('link', { name: 'Dos, rang E, 0 exercice' });
    // Contraste normal : aucune atténuation propre aux tuiles vides.
    expect(back.getAttribute('aria-disabled')).toBeNull();
    expect(back.hasAttribute('data-empty')).toBe(false);
    fireEvent.click(back);
    await screen.findByRole('heading', { level: 1, name: 'Dos' });
    expect(r.location()).toBe('/exercises/group/back');
    await settle();
    expect(screen.getByText('Rien de faisable à Garage dans ce groupe')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tout voir' }));
    const list = await screen.findByRole('list', { name: 'Exercices' });
    const pulldown = within(list).getByRole('link', { name: 'Tirage vertical' });
    expect(spoken(pulldown)).toContain('Pas faisable : Garage');
    expect(feasibleSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('profil prudent : la pompe archer (not_for_minors) n’est comptée nulle part', async () => {
    await open('/exercises', { me: MINOR });
    expect(tileNames()[0]).toBe('Pectoraux, rang E, 2 exercices');
    fireEvent.click(feasibleSwitch());
    await until(() => tileNames().includes('Quadriceps, rang E, 7 exercices'));
    expect(tileNames()[0]).toBe('Pectoraux, rang E, 2 exercices');
  });
});

describe('recherche (spec brique 2 §4.1)', () => {
  it('la saisie remplace les tuiles par les résultats, faisables au Garage, par nom (collation française)', async () => {
    const r = await open('/exercises');
    await type('squat');
    expect(screen.queryByRole('list', { name: 'Groupes musculaires' })).toBeNull();
    expect(resultNames()).toEqual([
      'Élévation sur pointes en squat',
      'Squat au poids du corps',
      'Squat goblet',
    ]);
    // Ni fiche retirée, ni le squat barre (barre et cage) avec le filtre.
    expect(screen.queryByText('Squat sauté')).toBeNull();
    expect(screen.queryByText('Squat barre')).toBeNull();
    expect(r.location()).toBe('/exercises?q=squat');
    // Recherche vidée : les tuiles reviennent.
    fireEvent.change(search(), { target: { value: '' } });
    await screen.findByRole('list', { name: 'Groupes musculaires' });
    expect(results()).toBeNull();
  });

  it('les alias comptent, sans accents ni majuscules (normalize)', async () => {
    await open('/exercises');
    await type('AIR');
    expect(resultNames()).toEqual(['Squat au poids du corps']);
    await type('elevation');
    expect(resultNames()).toEqual(['Élévation sur pointes en squat']);
  });

  it('filtre coupé : le squat barre apparaît avec la mention écrite « Pas faisable : Garage »', async () => {
    await open('/exercises');
    fireEvent.click(feasibleSwitch());
    await type('squat');
    expect(resultNames()).toContain('Squat barre');
    const list = screen.getByRole('list', { name: 'Résultats' });
    expect(spoken(within(list).getByRole('link', { name: 'Squat barre' }))).toContain(
      'Pas faisable : Garage',
    );
    expect(spoken(within(list).getByRole('link', { name: 'Squat goblet' }))).not.toContain('Pas faisable');
  });

  it('sans résultat : « Aucun exercice ne correspond. »', async () => {
    await open('/exercises');
    await type('zzz');
    expect(screen.getByText(NO_MATCH)).toBeTruthy();
    expect(screen.queryByText(/masqués? par le filtre Faisable/)).toBeNull();
    expect(screen.queryByText(CAUTIOUS)).toBeNull();
  });

  it('fiches masquées par le filtre : « 1 exercice masqué par le filtre Faisable · Les voir », qui coupe le filtre', async () => {
    await open('/exercises');
    await type('tirage');
    expect(screen.getByText(NO_MATCH)).toBeTruthy();
    const hidden = screen.getByText(/masqué par le filtre Faisable/).closest('p') as HTMLElement;
    expect(spoken(hidden)).toBe('1 exercice masqué par le filtre Faisable · Les voir');
    fireEvent.click(within(hidden).getByRole('button', { name: 'Les voir' }));
    await until(() => results() !== null);
    expect(resultNames()).toEqual(['Tirage vertical']);
    expect(feasibleSwitch().getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText(NO_MATCH)).toBeNull();
  });

  it('profil prudent : « Certains exercices sont masqués par le mode prudent. », jamais la pompe archer', async () => {
    await open('/exercises', { me: MINOR });
    await type('archer');
    expect(screen.getByText(NO_MATCH)).toBeTruthy();
    expect(screen.getByText(CAUTIOUS)).toBeTruthy();
    expect(screen.queryByText(/Pompe archer/)).toBeNull();
    // Avec d'autres résultats, la phrase reste.
    await type('pompe');
    expect(resultNames()).toEqual(['Pompe', 'Pompe contre le mur']);
    expect(screen.getByText(CAUTIOUS)).toBeTruthy();
  });

  it('une recherche dans l’adresse (?q=) est reprise à l’ouverture', async () => {
    await open('/exercises?q=squat');
    expect((search() as HTMLInputElement).value).toBe('squat');
    await until(() => results() !== null);
    expect(resultNames()).toEqual([
      'Élévation sur pointes en squat',
      'Squat au poids du corps',
      'Squat goblet',
    ]);
  });

  it('nombre de résultats annoncé (role="status")', async () => {
    await open('/exercises');
    await type('squat');
    expect(screen.getByRole('status').textContent).toBe('3 exercices trouvés');
    await type('zzz');
    expect(screen.getByRole('status').textContent).toContain(NO_MATCH);
  });
});

describe('catalogue pas encore téléchargé (Review Focus 5)', () => {
  it('en ligne : « Le catalogue arrive… », ni tuile ni recherche', async () => {
    await open('/exercises', { catalog: null });
    expect(screen.getByText(ARRIVING)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Groupes musculaires' })).toBeNull();
    expect(screen.queryByText(/rang E/)).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('hors ligne : « Connecte-toi une fois pour récupérer les exercices. », jamais 9 tuiles à 0', async () => {
    await open('/exercises', { catalog: null, connection: 'offline' });
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    expect(screen.queryByText(ARRIVING)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Groupes musculaires' })).toBeNull();
    expect(
      screen.queryAllByRole('link').filter((a) => /rang E/.test(a.getAttribute('aria-label') ?? '')),
    ).toEqual([]);
  });

  it('seulement des fiches retirées en local : même état (aucune fiche publiée)', async () => {
    const retired = CATALOG.filter((s) => s.status === 'retired');
    await open('/exercises', { catalog: retired, connection: 'offline' });
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Groupes musculaires' })).toBeNull();
  });
});

describe('Retour depuis une fiche (spec brique 2 §4.2)', () => {
  it('restaure la recherche et le défilement de la liste, par l’historique', async () => {
    await openInBrowser('/exercises');
    await type('squat');
    expect(window.location.search).toBe('?q=squat');
    act(() => window.scrollTo(0, 640));
    const scrolls: { y: number; withResults: boolean }[] = [];
    const scrollTo = window.scrollTo.bind(window);
    vi.spyOn(window, 'scrollTo').mockImplementation(((x: number, y: number) => {
      scrolls.push({ y, withResults: results() !== null });
      scrollTo(x, y);
    }) as typeof window.scrollTo);

    fireEvent.click(
      within(screen.getByRole('list', { name: 'Résultats' })).getByRole('link', { name: 'Squat goblet' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Squat goblet' });
    expect(window.location.pathname).toBe('/exercises/goblet-squat');
    // Un onglet de la fiche remplace son entrée : Retour revient quand même à la liste.
    fireEvent.click(screen.getByRole('tab', { name: 'Erreurs' }));
    await settle();
    const length = window.history.length;

    const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    await popped;
    await screen.findByRole('heading', { level: 1, name: 'Exercices' });
    await until(() => results() !== null);
    await settle();
    expect(window.location.pathname + window.location.search).toBe('/exercises?q=squat');
    // Retour arrière dans l'historique, pas une nouvelle entrée.
    expect(window.history.length).toBe(length);
    expect((search() as HTMLInputElement).value).toBe('squat');
    expect(resultNames()).toEqual([
      'Élévation sur pointes en squat',
      'Squat au poids du corps',
      'Squat goblet',
    ]);
    // Défilement rendu une fois les résultats affichés (la page est trop courte avant).
    expect(scrolls).toContainEqual({ y: 640, withResults: true });
    expect(window.scrollY).toBe(640);
  });

  it('fiche ouverte par son adresse : Retour mène à l’onglet Exercices', async () => {
    const r = await open('/exercises/goblet-squat');
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    await screen.findByRole('heading', { level: 1, name: 'Exercices' });
    expect(r.location()).toBe('/exercises');
  });
});

describe('cibles tactiles d’au moins 44 px (spec brique 2 §4.1)', () => {
  /** Déclarations des règles hors media query dont la liste de sélecteurs contient `cls`. */
  const rule = (file: string, cls: string) =>
    new Map(
      parseCssBlocks(readFileSync(resolve(import.meta.dirname, file), 'utf8'))
        .filter((b) => b.media === null && b.selector.split(',').some((s) => s.trim() === cls))
        .flatMap((b) => [...b.declarations]),
    );
  const px = (value: string | undefined) => Number.parseFloat(value ?? '0');

  it.each([
    ['../../src/features/exercises/exercises.module.css', '.tile'],
    ['../../src/features/exercises/exercises.module.css', '.exerciseRow'],
    ['../../src/features/exercises/exercises.module.css', '.textButton'],
    ['../../src/features/progression/progression.module.css', '.muscleLink'],
  ])('%s %s', (file, cls) => {
    expect(px(rule(file, cls).get('min-height'))).toBeGreaterThanOrEqual(44);
  });
});
