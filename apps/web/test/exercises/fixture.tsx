import type { IllustrationEntry, MeResponse } from '@rune/contracts';
import { render, screen } from '@testing-library/react';
import { Router } from 'wouter';
import { App } from '../../src/App';
import { ServicesProvider } from '../../src/app-services';
import type { AppDb } from '../../src/local-db/db';
import { settle } from '../support/auth';
import {
  chain,
  illustrationEntry,
  seedCatalog,
  seedGarage,
  seedTrainingProfile,
  served,
} from '../support/catalog';
import { createFakeSyncEngine } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { createTestServices, makeMe, renderApp } from '../support/render';

/*
 * Catalogue d'essai de l'onglet Exercices (spec brique 2 §4.1, critère 11 : une tuile change de nombre avec le
 * filtre, une autre passe à 0). Lieu principal « Garage » : haltères et banc réglable (qui vaut un banc plat).
 * - Quadriceps : 6 fiches faisables au Garage, 7 sans filtre (le squat barre demande barre et cage) ;
 * - Dos : le tirage vertical seul, infaisable au Garage (0 avec le filtre, 1 sans) ;
 * - Pectoraux : la chaîne des pompes, dont la pompe archer `not_for_minors` (3 en adulte, 2 en profil prudent) ;
 * - Mollets, Ischios… : aucune fiche ; le squat sauté est retiré (jamais compté).
 */

const quad = (o: Parameters<typeof served>[0]) =>
  served({
    aliases: [],
    load_mode: 'bodyweight',
    primary_muscles: ['quadriceps'],
    secondary_muscles: ['glutes'],
    equipment_options: [[]],
    illustrations: [],
    ...o,
  });

export const CATALOG = [
  served({
    id: 'goblet-squat',
    illustrations: [
      // Dans le désordre : la vignette est la position de départ.
      { illustration_id: 'goblet-squat-end', role: 'end' },
      { illustration_id: 'goblet-squat-start', role: 'start' },
    ],
  }),
  served({
    id: 'bodyweight-squat',
    name: 'Squat au poids du corps',
    aliases: ['Air squat'],
    load_mode: 'bodyweight',
    equipment_options: [[]],
  }),
  served({
    id: 'back-squat',
    name: 'Squat barre',
    aliases: ['Back squat'],
    load_mode: 'barbell',
    equipment_options: [['barbell', 'squat_rack']],
    level: 2,
  }),
  served({
    id: 'bulgarian-split-squat',
    name: 'Fente bulgare',
    aliases: [],
    load_mode: 'dumbbell',
    equipment_options: [['dumbbells', 'flat_bench']],
    level: 2,
  }),
  quad({ id: 'wall-sit', name: 'Chaise contre le mur' }),
  quad({ id: 'heel-raise-squat', name: 'Élévation sur pointes en squat' }),
  quad({ id: 'static-lunge', name: 'fente statique' }),
  served({
    id: 'jump-squat',
    status: 'retired',
    name: 'Squat sauté',
    aliases: [],
    load_mode: 'bodyweight',
    equipment_options: [[]],
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
  }),
];

export const ENTRIES: IllustrationEntry[] = [
  illustrationEntry('goblet-squat-start'),
  illustrationEntry('goblet-squat-end'),
];

export const MINOR = makeMe({ ageBand: 'minor', birthDate: '2011-01-01', cautious: true });

export interface Open {
  me?: MeResponse;
  /** Lieu principal « Garage » (par défaut) ; faux : aucun lieu. */
  place?: boolean;
  /** Fiches du magasin `exercises` ; null : catalogue jamais téléchargé. */
  catalog?: unknown[] | null;
  connection?: 'online' | 'offline';
}

export async function seed(o: Open = {}): Promise<AppDb> {
  const db = createTestLocalDb();
  await seedTrainingProfile(db);
  if (o.place !== false) await seedGarage(db);
  if (o.catalog !== null) await seedCatalog(db, o.catalog ?? CATALOG, ENTRIES);
  return db;
}

/** L'appli entière au chemin `path` (routeur en mémoire), base locale remplie ; attend le titre de la page. */
export async function open(path: string, o: Open = {}) {
  const db = await seed(o);
  const sync = createFakeSyncEngine({ connection: o.connection ?? 'online' });
  const r = await renderApp({ path, db, me: o.me, sync });
  await screen.findByRole('heading', { level: 1 });
  await settle();
  return r;
}

/**
 * L'appli entière sur l'historique du navigateur (celui de happy-dom), comme en production : le retour arrière
 * (`history.back()`) et l'état posé par la navigation y sont réels.
 */
export async function openInBrowser(path: string, o: Open = {}) {
  const db = await seed(o);
  window.history.replaceState(null, '', path);
  const { services } = await createTestServices({ db, me: o.me, path });
  const r = render(
    <Router>
      <ServicesProvider services={services}>
        <App />
      </ServicesProvider>
    </Router>,
  );
  await screen.findByRole('heading', { level: 1 });
  await settle();
  return r;
}

/** Texte lu par un lecteur d'écran : ce qui est caché (`aria-hidden`) en moins, espaces resserrés. */
export function spoken(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** L'interrupteur « Faisable : <lieu> ». */
export const feasibleSwitch = (place = 'Garage') =>
  screen.getByRole('switch', { name: `Faisable : ${place}` });
