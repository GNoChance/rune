import { type CoachBriefResponse, CoachBriefSchema, EQUIPMENT_LABELS } from '@rune/contracts';
import { sortedJson } from '@rune/domain';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BRIEF_TEXTS, STATE_TEXTS } from '../../src/features/coach/coach-texts';
import { EFFORT_LABELS } from '../../src/features/workout/EffortSheet';
import { coachStatus, serveCoach } from '../support/coach';
import { createFakeApi, type FakeApi } from '../support/fake-api';
import { renderApp } from '../support/render';

/** Programme minimal : un slot sans exercice résolu, sans répétitions, sans repos ni état (champs omis). */
const PROGRAM = {
  block_week: 2,
  days_per_week: 3,
  next_workout_id: 'w1',
  pending_proposals: [],
  revision: 4,
  template: { id: 'full-body', name: 'Full body', version: 1 },
  templates: [],
  week: 3,
  workouts: [
    {
      id: 'w1',
      name: 'Séance A',
      slots: [{ id: 'A1', movement_pattern: 'squat', role: 'main', sets: 3, target_rir: 2 }],
    },
  ],
};

/** Dossier courant, clés triées comme le serveur les écrit (le dossier omet nuls et valeurs par défaut). */
const BRIEF = {
  age_band: '18-29',
  audience: 'adult',
  history: {
    sessions: [
      {
        days_ago: 2,
        exercises: [{ id: 'goblet-squat', name: 'Squat <b>gobelet</b>', sets: [[20, 10, null, 'ok']] }],
        name: 'Séance A',
        place: 'lieu_1',
        user_notes: '<img src=x onerror=alert(1)> genou ok',
      },
      {
        days_ago: 5,
        exercises: [{ id: 'push-up', name: 'Pompes', sets: [[null, 12, null, null]] }],
        name: 'Séance libre',
        place: null,
      },
    ],
    truncated: false,
  },
  nutrition: null,
  places: [
    {
      equipment: ['dumbbells'],
      kind: 'home',
      load_settings: { bar_kg: 20, machine_step_kg: 5, smallest_plate_kg: 1.25 },
      name: 'lieu_1',
      primary: true,
    },
  ],
  profile: {
    cautious_mode: false,
    context: { kind: 'home', sport_code: null },
    days_per_week: 3,
    engine_profile: 'adult',
    goal: 'muscle',
    level: 'beginner',
    session_minutes: 45,
  },
  program: PROGRAM,
  records: [
    {
      best_set: { load_kg: 20, reps: 10 },
      e1rm_kg: 26.5,
      exercise_id: 'goblet-squat',
      longest_s: null,
      most_reps: 10,
      name: 'Squat gobelet',
    },
  ],
  schema: 'coach-brief/1',
  today: '2025-10-28',
};

const HEALTH = {
  limitations: [{ area: 'knee', note: 'douleur au genou', severity: 'mild', side: 'left' }],
};

function reply(brief: unknown, patch: Partial<CoachBriefResponse> = {}) {
  return { brief, threadId: 't1', day: '2025-10-28', preview: false, ...patch };
}

async function renderBrief(body: unknown, status = 200, api: FakeApi = createFakeApi()) {
  serveCoach(api, coachStatus());
  api.on('GET', '/api/coach/brief', { status, body });
  const view = await renderApp({ path: '/coach/brief', api });
  await screen.findByRole('heading', { level: 1, name: 'Ce que le coach voit' });
  return { ...view, api };
}

const h2 = () => screen.queryAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const jsonText = () => document.querySelector('pre')?.textContent;

describe('BriefPage : Ce que le coach voit (spec brique 4 §16.5)', () => {
  it('la fixture est un dossier courant', () => {
    expect(CoachBriefSchema.safeParse(BRIEF).error?.issues).toBeUndefined();
    expect(CoachBriefSchema.safeParse({ ...BRIEF, health: HEALTH }).error?.issues).toBeUndefined();
  });

  it('sections dans l’ordre, nutrition « rien pour l’instant », puis JSON et « Jamais envoyé »', async () => {
    await renderBrief(reply(BRIEF));
    await screen.findByRole('heading', { level: 2, name: 'Profil' });
    expect(h2()).toEqual([
      'Profil',
      'Lieux',
      'Programme',
      'Historique',
      'Records',
      'Nutrition',
      'Voir le JSON exact',
      'Jamais envoyé',
    ]);
    expect(screen.getByText("Nutrition : rien pour l'instant")).toBeTruthy();
  });

  it('une clé absente du dossier s’affiche « — », un booléen absent « non »', async () => {
    await renderBrief(reply(BRIEF));
    const program = within(await screen.findByRole('region', { name: 'Programme' }));
    const value = (label: string) => program.getByText(label).nextElementSibling?.textContent;
    expect(value('Exercice')).toBe('—');
    expect(value('Répétitions')).toBe('—');
    expect(value('Repos')).toBe('—');
    expect(value('Charge')).toBe('—');
    expect(value('Suspendu')).toBe('non');
    expect(value('Séries')).toBe('3');
  });

  it('une séance sans lieu s’affiche sans lieu', async () => {
    await renderBrief(reply(BRIEF));
    const history = within(await screen.findByRole('region', { name: 'Historique' }));
    const libre = history.getByText('Séance libre').closest('li') as HTMLElement;
    expect(libre.textContent).not.toMatch(/lieu_/);
    const a = history.getByText('Séance A').closest('li') as HTMLElement;
    expect(a.textContent).toContain('lieu_1');
  });

  it('JSON exact : caractère pour caractère le dossier reçu', async () => {
    await renderBrief(reply(BRIEF));
    await screen.findByRole('heading', { level: 2, name: 'Voir le JSON exact' });
    expect(jsonText()).toBe(JSON.stringify(BRIEF));
  });

  it('JSON exact : un dossier reçu dans le désordre (clés inversées) ressort trié', async () => {
    const reversed = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reversed)
        : v !== null && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, x]) => [k, reversed(x)]),
            )
          : v;
    const shuffled = reversed(BRIEF);
    expect(Object.keys(shuffled as object)).not.toEqual(Object.keys(BRIEF));
    await renderBrief(reply(shuffled));
    await screen.findByRole('heading', { level: 2, name: 'Voir le JSON exact' });
    expect(jsonText()).toBe(JSON.stringify(BRIEF));
  });

  it('matériel et effort en clair : « Haltères », « Encore 2 ou 3 », jamais les codes', async () => {
    await renderBrief(reply(BRIEF));
    const places = within(await screen.findByRole('region', { name: 'Lieux' }));
    expect(places.getByText(/lieu_1/).closest('li')?.textContent).toContain(EQUIPMENT_LABELS.dumbbells);
    expect(places.getByText(/lieu_1/).closest('li')?.textContent).not.toContain('dumbbells');
    const history = within(screen.getByRole('region', { name: 'Historique' }));
    expect(history.getByText(/Squat/).closest('p')?.textContent).toContain(EFFORT_LABELS.ok);
    expect(history.getByText(/Squat/).closest('p')?.textContent).not.toMatch(/· ok$/);
  });

  it('le bloc JSON défile (région au clavier) et porte la chasse fixe', async () => {
    await renderBrief(reply(BRIEF));
    await screen.findByRole('heading', { level: 2, name: 'Voir le JSON exact' });
    const region = screen.getByRole('region', { name: 'JSON exact du dossier' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.querySelector('pre')).toBeTruthy();
  });

  it('les textes du dossier (notes, noms d’exercices) restent du texte, jamais du HTML', async () => {
    const { container } = await renderBrief(reply(BRIEF));
    const history = within(await screen.findByRole('region', { name: 'Historique' }));
    expect(history.getByText(/<img src=x onerror=alert\(1\)> genou ok/)).toBeTruthy();
    expect(history.getByText(/Squat <b>gobelet<\/b>/)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('li b')).toBeNull();
  });

  it('Santé : absente sans bloc health', async () => {
    await renderBrief(reply(BRIEF));
    await screen.findByRole('heading', { level: 2, name: 'Profil' });
    expect(h2()).not.toContain('Santé');
  });

  it('Santé : présente avec le bloc health, entre Records et Nutrition', async () => {
    await renderBrief(reply({ ...BRIEF, health: HEALTH }));
    const health = within(await screen.findByRole('region', { name: 'Santé' }));
    expect(health.getByText(/douleur au genou/)).toBeTruthy();
    expect(h2().indexOf('Santé')).toBeGreaterThan(h2().indexOf('Records'));
    expect(h2().indexOf('Santé')).toBeLessThan(h2().indexOf('Nutrition'));
  });

  it('« Jamais envoyé » : pseudo, date de naissance, nom de lieu ou de salle', async () => {
    await renderBrief(reply(BRIEF));
    const never = within(await screen.findByRole('region', { name: 'Jamais envoyé' }));
    const text = never
      .getAllByRole('listitem')
      .map((li) => li.textContent)
      .join('\n');
    expect(text).toMatch(/pseudo/i);
    expect(text).toMatch(/date de naissance/i);
    expect(text).toMatch(/nom de tes lieux et de ta salle/i);
    expect(text).toMatch(/adresse IP/i);
  });

  it('aperçu sans fil : « Aperçu : ton dossier sera figé à ton premier message du jour. »', async () => {
    await renderBrief(reply(BRIEF, { preview: true, threadId: null }));
    expect(await screen.findByText(BRIEF_TEXTS.preview)).toBeTruthy();
    expect(BRIEF_TEXTS.preview).toBe('Aperçu : ton dossier sera figé à ton premier message du jour.');
  });

  it('avec un fil, pas de texte d’aperçu', async () => {
    await renderBrief(reply(BRIEF));
    await screen.findByRole('heading', { level: 2, name: 'Profil' });
    expect(screen.queryByText(BRIEF_TEXTS.preview)).toBeNull();
  });

  it('brief nul (retrait santé) : ni sections ni JSON, sans erreur', async () => {
    await renderBrief(reply(null));
    await screen.findByText(BRIEF_TEXTS.gone);
    expect(h2()).not.toContain('Profil');
    expect(h2()).not.toContain('Voir le JSON exact');
    expect(document.querySelector('pre')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ancien dossier (autre brief_schema) : le JSON exact seul, ni sections ni erreur', async () => {
    const old = { profile: { level: 'x' }, schema: 'coach-brief/0', zeta: 1 };
    await renderBrief(reply(old));
    await screen.findByRole('heading', { level: 2, name: 'Voir le JSON exact' });
    expect(jsonText()).toBe(sortedJson(old));
    expect(h2()).not.toContain('Profil');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('consent_required : le panneau d’accord, avec le bouton vers /coach/consent', async () => {
    await renderBrief({ error: 'consent_required' }, 403);
    const panel = await screen.findByRole('group', { name: STATE_TEXTS.consentMissing });
    expect(within(panel).getByRole('button', { name: STATE_TEXTS.consentActivate })).toBeTruthy();
    expect(document.querySelector('pre')).toBeNull();
  });
});
