import type { DraftSheet, ReviewSheetResponse } from '@rune/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { settle } from '../support/auth';
import { illustrationEntry, seedCatalog } from '../support/catalog';
import type { FakeApi, FakeReply } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import {
  admin,
  callsTo,
  ok,
  openReview,
  REVIEW_SHEET,
  reviewApi,
  reviewer,
  reviewSheetPath,
  sheetResponse,
} from '../support/review';
import { until } from '../support/wait';

// Formulaire d'édition de l'admin (spec brique 2 §4.5 et §3.5, 04 §4 et §8, plan Task 17) : champs de la fiche,
// choix des illustrations limité à une source, validation côté client (`DraftSheetSchema` / `ExerciseSheetSchema`),
// champs vidés omis (jamais `null`), 409 « La fiche a changé depuis que tu l'as ouverte. » avec la version courante
// à côté de la saisie gardée (Review Focus 3), 422 `invalid_sheet`, hors ligne.

const PATH = '/review/exercises/goblet-squat?queue=to_review';
const EDIT_PATH = '/review/exercises/goblet-squat?queue=to_review&edit=1';
const SHEET_API = reviewSheetPath('goblet-squat');
const PUT_API = '/api/admin/exercises/goblet-squat';

/** Vue de l'admin (validations et version exportée), fiche relue surchargée par `sheet`. */
function adminView(
  sheet: Partial<DraftSheet> = {},
  o: Partial<ReviewSheetResponse> = {},
): ReviewSheetResponse {
  return sheetResponse({ validations: [], exportedRevision: 4, ...o, sheet });
}

async function openEditor(
  view: ReviewSheetResponse = adminView(),
  o: { api?: FakeApi; db?: ReturnType<typeof createTestLocalDb>; path?: string } = {},
) {
  const api = o.api ?? reviewApi({});
  api.on('GET', SHEET_API, ok(view));
  const rendered = await openReview(o.path ?? EDIT_PATH, { me: admin(), api, db: o.db });
  await screen.findByRole('button', { name: 'Enregistrer' });
  return { ...rendered, api };
}

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement;
const group = (name: string) => screen.getByRole('group', { name });
const box = (groupName: string, name: string) =>
  within(group(groupName)).getByRole('checkbox', { name }) as HTMLInputElement;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
const puts = (api: FakeApi) =>
  callsTo(api, PUT_API, 'PUT').map((c) => c.body as { sheet: unknown; baseRevision: number });

/** Aucune valeur `null`, à aucun niveau : un champ vidé est une clé absente. */
function hasNull(value: unknown): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.some(hasNull);
  if (typeof value === 'object') return Object.values(value as object).some(hasNull);
  return false;
}

beforeEach(() => {
  localStorage.clear();
});

describe('ouvrir le formulaire (§4.5, 04 §8)', () => {
  it('« Modifier » ouvre le formulaire sur la fiche (adresse ?edit=1) ; « Annuler » y revient sans requête', async () => {
    const api = reviewApi({});
    api.on('GET', SHEET_API, ok(adminView()));
    const view = await openReview(PATH, { me: admin(), api });
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    await screen.findByRole('button', { name: 'Enregistrer' });
    expect(view.location()).toBe(EDIT_PATH);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Modifier « Squat goblet »');
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await until(() => view.location() === PATH);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Squat goblet');
    expect(api.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('champs de la fiche préremplis, dans l’ordre de 04 §4', async () => {
    await openEditor(
      adminView({ review_notes: 'Vérifier le niveau.', chain_id: 'squat-chain', harder_id: 'back-squat' }),
    );
    expect(field('Nom').value).toBe('Squat goblet');
    expect(field('Lot').value).toBe('A');
    expect(field('Autre nom 1').value).toBe('Goblet squat');
    expect(field('Autre nom 2').value).toBe('Squat avec haltère');
    expect(field('Autre nom 3').value).toBe('');
    expect(select('Type de mouvement').value).toBe('squat');
    expect(select('Mécanique').value).toBe('compound');
    expect((screen.getByRole('checkbox', { name: 'Un côté à la fois' }) as HTMLInputElement).checked).toBe(
      false,
    );
    expect(select('Mesure').value).toBe('reps');
    expect(select('Mode de charge').value).toBe('dumbbell');
    expect(select('Niveau').selectedOptions[0]?.text).toBe('Niveau 1 sur 3, débutant');
    expect(box('Muscles principaux', 'Quadriceps').checked).toBe(true);
    expect(box('Muscles principaux', 'Fessiers').checked).toBe(true);
    expect(box('Muscles principaux', 'Adducteurs').checked).toBe(false);
    expect(box('Muscles secondaires', 'Adducteurs').checked).toBe(true);
    expect(select('Option 1, matériel 1').value).toBe('dumbbells');
    expect(select('Option 1, matériel 2').value).toBe('');
    expect(select('Option 2, matériel 1').value).toBe('kettlebell');
    expect(
      (screen.getByRole('checkbox', { name: 'Déconseillé aux mineurs' }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(box('Articulations sollicitées', 'Genoux').checked).toBe(true);
    expect(field('Étape 1').value).toBe('Tiens un haltère contre ta poitrine.');
    expect(field('Étape 4').value).toBe('');
    expect(field('Point clé 2').value).toBe('Tes genoux suivent tes orteils.');
    expect(field('Erreur 1').value).toBe('Les genoux rentrent.');
    expect(field('Correction 1').value).toBe("Pousse les genoux vers l'extérieur.");
    expect(field('Consigne de sécurité 1').value).toBe('Arrête la série si tu ressens une douleur vive.');
    expect(field('Respiration').value).toBe('Inspire en descendant, souffle en remontant.');
    expect(field('Réglage').value).toBe('Prends un haltère de poids moyen.');
    expect(field('Chaîne').value).toBe('squat-chain');
    expect(field('Fiche plus facile').value).toBe('');
    expect(field('Fiche plus difficile').value).toBe('back-squat');
    expect(field('Conseil plus facile').value).toBe('Descends sur une chaise derrière toi.');
    expect(select('Source des illustrations').value).toBe('');
    expect(field('Notes pour la relecture').value).toBe('Vérifier le niveau.');
    // Nombre de cases de chaque liste : le maximum de 04 §4.
    expect(within(group('Autres noms')).getAllByRole('textbox')).toHaveLength(6);
    expect(within(group('Étapes')).getAllByRole('textbox')).toHaveLength(7);
    expect(within(group('Points clés')).getAllByRole('textbox')).toHaveLength(4);
    expect(within(group('Erreurs')).getAllByRole('textbox')).toHaveLength(8);
    expect(within(group('Sécurité')).getAllByRole('textbox')).toHaveLength(3);
    expect(within(group('Matériel')).getAllByRole('combobox')).toHaveLength(12);
  });

  it('une relectrice sur ?edit=1 : la fiche, jamais le formulaire', async () => {
    const api = reviewApi({});
    const { validations: _v, exportedRevision: _e, ...view } = adminView();
    api.on('GET', SHEET_API, ok(view));
    await openReview(EDIT_PATH, { me: reviewer(), api });
    await settle();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Squat goblet');
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  });
});

describe('enregistrer (§3.5, 04 §8)', () => {
  it('PUT {sheet: fiche entière, champs vidés omis, jamais null ; baseRevision}, puis la fiche enregistrée', async () => {
    const saved = adminView({ name: 'Squat goblet lourd', revision: 5 });
    const api = reviewApi({}).on('PUT', PUT_API, ok(saved));
    const view = await openEditor(adminView(), { api });
    type(field('Nom'), '  Squat goblet lourd ');
    type(field('Point clé 3'), 'Regarde devant toi.');
    type(field('Réglage'), '');
    type(field('Conseil plus facile'), '   ');
    type(field('Autre nom 2'), '');
    save();
    await until(() => puts(api).length === 1);
    const { setup: _s, easier_tip: _e, ...rest } = REVIEW_SHEET;
    const body = puts(api)[0];
    expect(body).toEqual({
      sheet: {
        ...rest,
        name: 'Squat goblet lourd',
        aliases: ['Goblet squat'],
        key_points: [...(REVIEW_SHEET.key_points ?? []), 'Regarde devant toi.'],
      },
      baseRevision: 4,
    });
    expect(hasNull(body)).toBe(false);
    await until(() => view.location() === PATH);
    expect(await screen.findByText('Version 5 enregistrée.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Squat goblet lourd');
    // La réponse suffit : pas de seconde lecture de la fiche.
    expect(callsTo(api, SHEET_API)).toHaveLength(1);
  });

  it('sans rien changer : la fiche part telle quelle, ordre des listes compris (aucun feu vert santé périmé)', async () => {
    const db = createTestLocalDb();
    await seedCatalog(db, [], [illustrationEntry('ek-squat-start'), illustrationEntry('ek-squat-end')]);
    const sheet: DraftSheet = {
      ...REVIEW_SHEET,
      review_notes: 'Vérifier le niveau.',
      // Ordre de la fiche, différent de celui des cases (MUSCLES, rôles start, mid, end).
      primary_muscles: ['quadriceps', 'glutes'],
      illustrations: [
        { illustration_id: 'ek-squat-end', role: 'end' },
        { illustration_id: 'ek-squat-start', role: 'start' },
      ],
    };
    const api = reviewApi({}).on('PUT', PUT_API, ok(adminView({ ...sheet, revision: 5 })));
    await openEditor(adminView(sheet), { api, db });
    save();
    await until(() => puts(api).length === 1);
    expect(JSON.stringify(puts(api)[0]?.sheet)).toBe(JSON.stringify(sheet));
  });

  it('matériel : option 1 vide = sans matériel ([[]]) ; muscles, articulations, niveau et illustrations', async () => {
    const api = reviewApi({}).on('PUT', PUT_API, ok(adminView({ revision: 5 })));
    await openEditor(adminView(), { api });
    type(select('Option 1, matériel 1'), '');
    type(select('Option 2, matériel 1'), '');
    fireEvent.click(box('Muscles principaux', 'Fessiers'));
    fireEvent.click(box('Muscles secondaires', 'Abdominaux'));
    fireEvent.click(box('Articulations sollicitées', 'Genoux'));
    type(select('Niveau'), '2');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Déconseillé aux mineurs' }));
    type(select('Mode de charge'), 'bodyweight');
    save();
    await until(() => puts(api).length === 1);
    expect(puts(api)[0]?.sheet).toMatchObject({
      equipment_options: [[]],
      primary_muscles: ['quadriceps'],
      secondary_muscles: ['adductors'],
      stressed_joints: ['hips'],
      level: 2,
      not_for_minors: true,
      load_mode: 'bodyweight',
      illustrations: [],
    });
  });

  it('brouillon (squelette) : les champs pas encore rédigés restent absents', async () => {
    const skeleton: DraftSheet = {
      id: 'goblet-squat',
      schema_version: 1,
      revision: 4,
      status: 'draft',
      batch: 'A',
      name: 'Squat goblet',
      movement_pattern: 'squat',
      mechanics: 'compound',
      unilateral: false,
      measure: 'reps',
      load_mode: 'dumbbell',
      equipment_options: [['dumbbells']],
      level: 1,
      not_for_minors: false,
    };
    const view = { ...adminView(), sheet: skeleton, queues: ['drafts' as const] };
    const api = reviewApi({}).on('PUT', PUT_API, ok({ ...view, sheet: { ...skeleton, revision: 5 } }));
    await openEditor(view, { api });
    save();
    await until(() => puts(api).length === 1);
    expect(puts(api)[0]).toEqual({ sheet: skeleton, baseRevision: 4 });
  });

  it('validation côté client : un message par champ, rien n’est envoyé', async () => {
    const { api } = await openEditor();
    type(field('Nom'), '');
    type(field('Consigne de sécurité 1'), '');
    type(field('Chaîne'), 'Chaîne Squat');
    type(field('Lot'), 'C');
    save();
    expect(
      await screen.findByText('La fiche ne passe pas la validation : corrige les champs signalés.'),
    ).toBeTruthy();
    expect(within(group('Sécurité')).getByText('Obligatoire.')).toBeTruthy();
    expect(field('Nom').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getAllByText('Obligatoire.')).toHaveLength(2);
    expect(screen.getByText('Lettres minuscules, chiffres et tirets seulement.')).toBeTruthy();
    expect(screen.getByText("A, B, ou E suivi d'un nombre de 1 à 99.")).toBeTruthy();
    // Champs corrigés : la règle entre champs (muscles disjoints) se lit à son tour.
    type(field('Nom'), 'Squat goblet');
    type(field('Consigne de sécurité 1'), 'Arrête si tu as mal.');
    type(field('Chaîne'), '');
    type(field('Lot'), 'E2');
    fireEvent.click(box('Muscles secondaires', 'Quadriceps'));
    save();
    expect(
      await within(group('Muscles secondaires')).findByText(
        'Un muscle ne peut pas être à la fois principal et secondaire.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Obligatoire.')).toBeNull();
    expect(puts(api)).toEqual([]);
  });

  it('422 invalid_sheet (règles entre fiches, vues par le serveur) : message du §3.6, saisie gardée', async () => {
    const api = reviewApi({}).on('PUT', PUT_API, {
      status: 422,
      body: { error: 'transition_blocked', blockers: ['invalid_sheet'] },
    });
    await openEditor(adminView(), { api });
    type(field('Autre nom 3'), 'Squat barre');
    save();
    expect(
      await screen.findByText('La fiche ne passe pas la validation complète (04 §13, critère 1).'),
    ).toBeTruthy();
    expect(field('Autre nom 3').value).toBe('Squat barre');
  });

  it('hors ligne : « Nécessite le réseau », saisie gardée', async () => {
    const { api } = await openEditor();
    type(field('Nom'), 'Squat goblet lourd');
    api.setOffline('reject');
    save();
    expect(await screen.findByText('Nécessite le réseau')).toBeTruthy();
    expect(field('Nom').value).toBe('Squat goblet lourd');
  });
});

describe('deux onglets admin, même révision de départ (Review Focus 3, §3.5)', () => {
  it('409 : « La fiche a changé depuis que tu l’as ouverte. », saisie gardée à côté de la version courante, nouvel envoi depuis elle', async () => {
    const current: DraftSheet = {
      ...REVIEW_SHEET,
      revision: 5,
      name: 'Squat gobelet',
      breathing: 'Souffle en remontant.',
    };
    const replies: FakeReply[] = [
      { status: 409, body: { error: 'revision_conflict', current } },
      ok(adminView({ ...current, name: 'Squat goblet lourd', revision: 6 })),
    ];
    const api = reviewApi({}).on('PUT', PUT_API, () => replies.shift() as FakeReply);
    await openEditor(adminView(), { api });
    type(field('Nom'), 'Squat goblet lourd');
    save();
    expect(await screen.findByText("La fiche a changé depuis que tu l'as ouverte.")).toBeTruthy();
    expect(
      screen.getByText(
        'Version 5 enregistrée entre-temps. Ta saisie est gardée : compare-la à la version courante, écrite sous chaque champ qui diffère, puis enregistre.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Champs qui diffèrent : Nom, Respiration.')).toBeTruthy();
    // La saisie reste ; la version courante est écrite sous le champ, qu'elle décrit.
    expect(field('Nom').value).toBe('Squat goblet lourd');
    const nameNote = screen.getByText('Version courante : Squat gobelet');
    expect(field('Nom').getAttribute('aria-describedby')).toContain(nameNote.id);
    expect(screen.getByText('Version courante : Souffle en remontant.')).toBeTruthy();
    expect(field('Respiration').value).toBe('Inspire en descendant, souffle en remontant.');
    // Reprendre la valeur courante d'un champ : la note disparaît.
    fireEvent.click(screen.getByRole('button', { name: 'Reprendre la version courante : Respiration' }));
    expect(field('Respiration').value).toBe('Souffle en remontant.');
    expect(screen.queryByText('Version courante : Souffle en remontant.')).toBeNull();
    save();
    await until(() => puts(api).length === 2);
    expect(puts(api)[1]).toMatchObject({
      baseRevision: 5,
      sheet: { name: 'Squat goblet lourd', breathing: 'Souffle en remontant.', revision: 5 },
    });
    expect(await screen.findByText('Version 6 enregistrée.')).toBeTruthy();
  });
});

describe('illustrations : une seule source par fiche (04 §12, règle 4)', () => {
  async function withManifest(sheet: Partial<DraftSheet>, api?: FakeApi) {
    const db = createTestLocalDb();
    await seedCatalog(
      db,
      [],
      [
        illustrationEntry('ek-squat-start'),
        illustrationEntry('ek-squat-end'),
        illustrationEntry('wg-squat-start', { source: 'workout_guide', creators: ['Bryl Lim'] }),
      ],
    );
    return openEditor(adminView(sheet), { db, api });
  }
  const options = (name: string) => [...select(name).options].map((o) => o.text);

  it('source déduite des illustrations de la fiche ; chaque pose ne propose que les fichiers de cette source', async () => {
    await withManifest({ illustrations: [{ illustration_id: 'ek-squat-start', role: 'start' }] });
    expect(select('Source des illustrations').value).toBe('everkinetic');
    expect(options('Source des illustrations')).toEqual([
      'Aucune illustration',
      'Everkinetic',
      'workout-guide',
    ]);
    expect(select('Position de départ').value).toBe('ek-squat-start');
    expect(options('Position de départ')).toEqual(['Aucune', 'ek-squat-end', 'ek-squat-start']);
    expect(options('Position de fin')).toEqual(['Aucune', 'ek-squat-end', 'ek-squat-start']);
  });

  it('changer de source vide les poses de l’autre source ; l’enregistrement garde une seule source', async () => {
    const api = reviewApi({}).on('PUT', PUT_API, ok(adminView({ revision: 5 })));
    await withManifest(
      {
        illustrations: [
          { illustration_id: 'ek-squat-start', role: 'start' },
          { illustration_id: 'ek-squat-end', role: 'end' },
        ],
      },
      api,
    );
    type(select('Source des illustrations'), 'workout_guide');
    expect(select('Position de départ').value).toBe('');
    expect(select('Position de fin').value).toBe('');
    expect(options('Position de départ')).toEqual(['Aucune', 'wg-squat-start']);
    type(select('Position de départ'), 'wg-squat-start');
    save();
    await until(() => puts(api).length === 1);
    const sent = puts(api)[0]?.sheet as DraftSheet | undefined;
    expect(sent?.illustrations).toEqual([{ illustration_id: 'wg-squat-start', role: 'start' }]);
  });

  it('« Aucune illustration » : liste vide ; illustration absente du manifeste local gardée et signalée', async () => {
    await withManifest({ illustrations: [{ illustration_id: 'old-squat-mid', role: 'mid' }] });
    expect(select('Position de milieu').value).toBe('old-squat-mid');
    expect(select('Position de milieu').selectedOptions[0]?.text).toBe(
      'old-squat-mid (absente du manifeste)',
    );
    type(select('Source des illustrations'), '');
    expect(select('Position de milieu').value).toBe('');
    expect(select('Position de milieu').disabled).toBe(true);
  });
});
