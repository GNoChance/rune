/*
 * Scénarios de référence (05 §5 règle 9, §17.3) : les 6 modèles réels × 5 profils scriptés, 12 semaines de programme
 * avec le vrai moteur (`planWorkout` → séance simulée → `replayInstance`). Instantané lisible par modèle et profil
 * dans `__snapshots__/`, plus les propriétés qui doivent tenir quoi qu'il arrive (relues dans les instantanés).
 */

import { readFileSync } from 'node:fs';
import type { ProgramTemplate } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { findSlot } from '../../src/program/effective';
import { loadGrid, next } from '../../src/program/loads';
import { currentRules } from '../../src/program/rules';
import { PARITY_HISTORY, PARITY_SNAPSHOT, replayParityHistory } from '../support/parity';
import { SCRIPTED_PROFILES, type ScriptedProfile } from '../support/scripted-profiles';
import {
  formatSimulation,
  loadCatalog,
  loadTemplates,
  PROGRAM_WEEKS,
  type Simulation,
  type SimulationStep,
  simulate,
} from '../support/simulation';

const catalog = loadCatalog();
const templates = loadTemplates();
const byId = new Map(catalog.map((s) => [s.id, s]));
const rules = currentRules();

const cache = new Map<string, Simulation>();
function run(template: ProgramTemplate, profile: ScriptedProfile): Simulation {
  const key = `${template.id}|${profile.id}`;
  let sim = cache.get(key);
  if (sim === undefined) {
    sim = simulate(template, profile, catalog);
    cache.set(key, sim);
  }
  return sim;
}
const profileOf = (id: ScriptedProfile['id']): ScriptedProfile => {
  const p = SCRIPTED_PROFILES.find((x) => x.id === id);
  if (p === undefined) throw new Error(`profil ${id} absent`);
  return p;
};

/** Charge faite (la plus petite des séries de travail) d'un exercice de la séance simulée. */
const performedLoad = (step: SimulationStep, slotId: string): number | null => {
  const loads = (step.session.exercises.find((e) => e.slotId === slotId)?.sets ?? [])
    .filter((s) => s.kind === 'work' && s.loadG !== null)
    .map((s) => s.loadG as number);
  return loads.length === 0 ? null : Math.min(...loads);
};

/** Série de travail prévue d'un slot : sa première (charge, répétitions, RIR sont les mêmes sur toutes). */
const firstWork = (step: SimulationStep, slotId: string) =>
  step.planned.exercises.find((e) => e.slotId === slotId)?.sets.find((s) => s.kind === 'work');

describe('scénarios de référence sur 12 semaines', () => {
  it('charge 6 modèles, 84 fiches et 5 profils', () => {
    expect(templates).toHaveLength(6);
    expect(catalog).toHaveLength(84);
    expect(SCRIPTED_PROFILES).toHaveLength(5);
  });

  it('est déterministe : deux simulations donnent le même récit', () => {
    const t = templates[1];
    if (t === undefined) throw new Error('modèle absent');
    const p = profileOf('reports_pain');
    expect(formatSimulation(simulate(t, p, catalog))).toBe(formatSimulation(simulate(t, p, catalog)));
  });

  describe.each(templates)('$id', (template) => {
    it.each(SCRIPTED_PROFILES)('profil $id : instantané', async (profile) => {
      await expect(formatSimulation(run(template, profile))).toMatchFileSnapshot(
        `__snapshots__/${template.id}.${profile.id}.txt`,
      );
    });

    it.each(SCRIPTED_PROFILES)('profil $id : 12 semaines, séances et charges dans les bornes', (profile) => {
      const sim = run(template, profile);
      expect(sim.steps).toHaveLength(PROGRAM_WEEKS * template.daysPerWeek.default);
      expect(sim.final.state.weekIndex).toBe(PROGRAM_WEEKS);
      for (const step of sim.steps) {
        for (const d of step.decisions) {
          expect(d.nextTarget?.loadG ?? 0).toBeGreaterThanOrEqual(0);
          expect(d.nextTarget?.workSets ?? 1).toBeLessThanOrEqual(5);
        }
      }
      // Les propositions ne sont jamais acceptées : seules les suspensions pour douleur changent le programme.
      expect(sim.changes.every((c) => c.author === 'engine' && c.reasonCode === 'PAIN_SUSPEND')).toBe(true);
    });

    it.each(SCRIPTED_PROFILES)('profil $id : aucune hausse au-delà des plafonds', (profile) => {
      const sim = run(template, profile);
      for (const step of sim.steps) {
        for (const d of step.decisions) {
          const c = performedLoad(step, step.session.exercises.find((e) => e.id === d.id)?.slotId ?? '');
          const to = d.nextTarget?.loadG ?? null;
          if (c === null || to === null || to <= c) continue;
          const found = findSlot(template, d.slotId);
          const sheet =
            byId.get(d.exerciseId) ??
            byId.get(step.session.exercises.find((e) => e.id === d.id)?.exerciseId ?? '');
          if (found === undefined || sheet === undefined) continue;
          const grid = loadGrid(sheet.load_mode, sim.place.loadSettings);
          const stepUp = (next(grid, c) ?? c) - c;
          const increment = found.slot.progression.type === 'linear' ? found.slot.progression.incrementG : 0;
          const cap =
            profile.sessionProfile === 'cautious'
              ? (c * rules.raiseCapPct) / 100
              : Math.max(increment, (c * rules.raiseCapPct) / 100);
          const where = `${template.id}/${profile.id} séance ${step.index + 1} ${d.slotId} ${d.reasonCode}: ${c} -> ${to}`;
          // Au-delà du plafond : un seul pas de la grille, et seulement en mode somme ou en calibration.
          if (to - c > cap) {
            expect(['SUM_LOAD_UP', 'CALIBRATION_UP'], where).toContain(d.reasonCode);
            expect(to - c, where).toBeLessThanOrEqual(stepUp);
          }
          if (profile.sessionProfile === 'cautious') expect(to - c, where).toBeLessThanOrEqual(stepUp);
        }
      }
    });
  });

  describe.each(templates.filter((t) => t.block.mode === 'planned'))('$id : bloc planifié', (template) => {
    const block = template.block.mode === 'planned' ? template.block : null;
    it.each(SCRIPTED_PROFILES)('profil $id : allègement aux semaines 5 et 10, pas ailleurs', (profile) => {
      const sim = run(template, profile);
      expect(block).toEqual({ mode: 'planned', weeks: 5, deloadWeek: 5 });
      const deloads = new Set(
        sim.steps.filter((s) => s.planned.weekType === 'deload').map((s) => s.weekIndex + 1),
      );
      expect([...deloads].sort((a, b) => a - b)).toEqual([5, 10]);
      for (const step of sim.steps) {
        expect(step.planned.weekType === 'deload').toBe(step.blockWeek === 5);
        expect(step.session.weekType).toBe(step.planned.weekType);
        if (step.planned.weekType !== 'deload') continue;
        // Semaine allégée : état inchangé, séries de travail divisées par deux arrondi au-dessus, RIR plus haut.
        expect(step.decisions.every((d) => d.result === 'DELOAD')).toBe(true);
        const before = sim.steps[step.index - 1];
        for (const ex of step.planned.exercises) {
          const normal = before?.planned.exercises.find((e) => e.slotId === ex.slotId);
          const works = ex.sets.filter((s) => s.kind === 'work').length;
          const usual = normal?.sets.filter((s) => s.kind === 'work').length ?? 0;
          if (
            ex.exerciseId === null ||
            normal === undefined ||
            before?.planned.workoutId !== step.planned.workoutId
          ) {
            continue;
          }
          expect(works).toBeLessThanOrEqual(Math.ceil(usual / 2));
        }
      }
    });
  });

  describe.each(templates.filter((t) => t.block.mode === 'reactive'))('$id : bloc réactif', (template) => {
    it.each(SCRIPTED_PROFILES)('profil $id : aucune séance allégée sans allègement accepté', (profile) => {
      const sim = run(template, profile);
      expect(sim.steps.every((s) => s.planned.weekType === 'normal' && s.blockWeek === null)).toBe(true);
    });
  });

  describe.each(templates)('$id : propriétés des profils', (template) => {
    it("« ne saisit jamais l'effort » : aucune hausse de charge sur 12 semaines", () => {
      const sim = run(template, profileOf('never_logs_effort'));
      const top = new Map<string, number>();
      for (const step of sim.steps) {
        for (const ex of step.planned.exercises) {
          const to = firstWork(step, ex.slotId)?.targetLoadG ?? null;
          const key = `${ex.slotId}|${ex.exerciseId}`;
          const max = top.get(key);
          if (to !== null && max !== undefined)
            expect(to, `${key} séance ${step.index + 1}`).toBeLessThanOrEqual(max);
        }
        for (const e of step.session.exercises) {
          const c = performedLoad(step, e.slotId ?? '');
          const key = `${e.slotId}|${e.exerciseId}`;
          if (c !== null) top.set(key, Math.max(top.get(key) ?? 0, c));
        }
        for (const d of step.decisions) {
          expect(['LOAD_UP', 'SUM_LOAD_UP', 'REPS_UP', 'CALIBRATION_UP']).not.toContain(d.reasonCode);
        }
      }
    });

    it('« prudent » : toutes les cibles dans les bornes, aucune hausse avant la 3e séance', () => {
      const sim = run(template, profileOf('cautious'));
      const { cautious } = rules;
      const seen = new Map<string, { n: number; first: number | null }>();
      for (const step of sim.steps) {
        expect(step.session.profile).toBe('cautious');
        for (const ex of step.planned.exercises) {
          const works = ex.sets.filter((s) => s.kind === 'work');
          const lines = ex.unilateral ? 2 : 1;
          expect(works.length / lines).toBeLessThanOrEqual(cautious.maxWorkSets);
          for (const s of works) {
            expect(s.targetRir ?? cautious.minTargetRir).toBeGreaterThanOrEqual(cautious.minTargetRir);
            if (s.targetRepsMin === null || s.targetRepsMax === null) continue;
            expect(s.targetRepsMin).toBeGreaterThanOrEqual(cautious.repsMin);
            expect(s.targetRepsMax).toBeLessThanOrEqual(cautious.repsMax);
            const gap = s.targetRepsMax - s.targetRepsMin;
            expect(gap === 0 || gap >= cautious.minRepsGap).toBe(true);
          }
          const key = `${ex.slotId}|${ex.exerciseId}`;
          const entry = seen.get(key) ?? { n: 0, first: null };
          const planned = works[0]?.targetLoadG ?? null;
          // La charge de la 2e séance de l'exercice ne dépasse pas celle de la 1re.
          if (entry.n === 1 && planned !== null && entry.first !== null) {
            expect(planned, `${key} séance ${step.index + 1}`).toBeLessThanOrEqual(entry.first);
          }
          const done = performedLoad(step, ex.slotId);
          seen.set(key, { n: entry.n + 1, first: entry.n === 0 ? done : entry.first });
        }
      }
    });

    it('« douleur » : la 2e douleur de suite suspend le slot, une seule fois, sans trace de plus', () => {
      const sim = run(template, profileOf('reports_pain'));
      const first = template.workouts[0]?.slots[0]?.id ?? '';
      const suspends = sim.steps.flatMap((s) => s.events).filter((e) => e.kind === 'pain_suspend');
      expect(suspends).toHaveLength(1);
      expect(suspends[0]?.slotId).toBe(first);
      expect([...sim.final.program.suspended]).toEqual([first]);
      expect(sim.changes).toHaveLength(1);
      expect(sim.changes[0]?.author).toBe('engine');
      const painful = sim.steps.filter((s) =>
        s.session.exercises.some((e) => e.slotId === first && e.painLevel === 'pain'),
      );
      expect(painful).toHaveLength(2);
      // Le slot est mis de côté à partir de la séance qui suit la 2e douleur, sans série.
      const after = sim.steps.filter((s) => s.index > (painful[1]?.index ?? 0));
      for (const s of after) {
        const ex = s.planned.exercises.find((e) => e.slotId === first);
        if (ex === undefined) continue;
        expect(ex.resolution).toBe('suspended');
        expect(ex.sets).toHaveLength(0);
      }
    });
  });
});

describe('parité : historique de 9 séances rejoué sous Node', () => {
  it('rejoue parity-history.json et écrit le résultat en instantané', async () => {
    const result = replayParityHistory();
    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot(PARITY_SNAPSHOT);
  });

  it('couvre une douleur, un ajustement et un changement accepté', () => {
    const result = replayParityHistory() as {
      decisions: { result: string; reasonCode: string }[];
      state: { weekIndex: number };
      program: { template: { workouts: { slots: { id: string; sets: { count: number }[] }[] }[] } };
    };
    const codes = result.decisions.map((d) => d.reasonCode);
    expect(result.decisions).toHaveLength(
      (
        JSON.parse(readFileSync(PARITY_HISTORY, 'utf8')) as { sessions: { exercises: unknown[] }[] }
      ).sessions.reduce((n, s) => n + s.exercises.length, 0),
    );
    expect(codes).toContain('PAIN_LIGHTEN');
    expect(codes).toContain('USER_HOLD');
    expect(result.state.weekIndex).toBe(3);
    // change_sets +1 sur A4, accepté entre la 6e et la 7e séance : 2 séries de travail deviennent 3.
    const a4 = result.program.template.workouts.flatMap((w) => w.slots).find((s) => s.id === 'A4');
    expect(a4?.sets.find((s) => s.count === 3)).toBeDefined();
  });
});

/*
 * CONCERN (tâche 10, voir le rapport) : un membre qui atteint toujours le haut des répétitions d'un exercice au poids
 * du corps (aucune charge à monter) déclenche la même proposition de remplacement toutes les 3 séances
 * (home-beginner-full-body : 10 fois pour le même slot ; sport-beginner-complement : 6 fois). Ces deux assertions
 * attendent au plus 3 propositions identiques par slot sur 12 semaines ; elles échouent aujourd'hui (`it.fails`).
 * À retirer du `it.fails` quand le moteur ne répète plus une proposition identique.
 */
describe.each(['home-beginner-full-body', 'sport-beginner-complement'])(
  '%s : propositions répétées',
  (id) => {
    it.fails('« progresse toujours » : au plus 3 propositions de remplacement identiques par slot', () => {
      const template = templates.find((t) => t.id === id);
      if (template === undefined) throw new Error(`modèle ${id} absent`);
      const sim = run(template, profileOf('always_progresses'));
      const counts = new Map<string, number>();
      for (const e of sim.steps.flatMap((s) => s.events).filter((x) => x.kind === 'propose_replace')) {
        const key = `${e.slotId}|${JSON.stringify(e.operations)}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      expect(Math.max(0, ...counts.values())).toBeLessThanOrEqual(3);
    });
  },
);
