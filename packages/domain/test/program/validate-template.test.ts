import { REFERENCE_PROFILES } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import { expandEquipment } from '../../src/catalog/equipment';
import type { CatalogSheet } from '../../src/catalog/usable';
import {
  FORBIDDEN_PROGRAM_NAMES,
  TEMPLATE_ISSUE_CODES,
  type TemplateIssue,
  templateAvailable,
  validateTemplate,
} from '../../src/program/validate-template';
import { VOLUME_GROUPS, VOLUME_RANGES, volumeRange, weeklyVolume } from '../../src/program/volume';
import { calfSlot, GYM_AB, gymAb, PROGRAM_CATALOG, slotOf } from '../fixtures/program';

const validate = (raw: unknown, catalog = PROGRAM_CATALOG) => validateTemplate(raw, [...catalog]);
const codes = (issues: TemplateIssue[]) => issues.map((i) => i.code);
const gymReference = expandEquipment(REFERENCE_PROFILES.gym_reference);
const homeBodyweight = expandEquipment(REFERENCE_PROFILES.home_bodyweight);

describe('validateTemplate : modèle valide', () => {
  it("l'extrait de 05 §4 complété passe sans aucune erreur", () => {
    expect(validate(GYM_AB)).toEqual([]);
  });

  it('les codes sont ceux de la règle 1 à 7 (05 §5)', () => {
    expect([...TEMPLATE_ISSUE_CODES]).toEqual([
      'schema',
      'duplicate_id',
      'reps_order',
      'rir_too_low',
      'work_sets_count',
      'rest_bounds',
      'days_bounds',
      'coverage_missing',
      'coverage_needs_bodyweight',
      'unknown_exercise',
      'pattern_mismatch',
      'unknown_chain',
      'gym_first_not_reference',
      'volume_out_of_range',
      'forbidden_name',
    ]);
  });
});

describe('validateTemplate : règle 1, schéma', () => {
  it('schema : champ inconnu, chemin donné', () => {
    expect(validate({ ...GYM_AB, author: 'x' })).toEqual([
      expect.objectContaining({ code: 'schema', path: '' }),
    ]);
    expect(validate('pas un modèle')).toEqual([expect.objectContaining({ code: 'schema' })]);
    const issues = validate(gymAb((t) => Object.assign(slotOf(t, 'A1'), { role: 'principal' })));
    expect(issues).toEqual([expect.objectContaining({ code: 'schema', path: 'workouts.0.slots.0.role' })]);
  });
});

describe('validateTemplate : règle 2, identifiants', () => {
  it('duplicate_id : slot en double, chaque doublon signalé avec son chemin', () => {
    const issues = validate(
      gymAb((t) => {
        slotOf(t, 'B4').id = 'A1';
      }),
    );
    expect(issues).toEqual([
      expect.objectContaining({ code: 'duplicate_id', path: 'workouts.1.slots.3.id' }),
    ]);
  });

  it('duplicate_id : séance en double', () => {
    const issues = validate(
      gymAb((t) => {
        const b = t.workouts[1];
        if (b !== undefined) b.id = 'A';
      }),
    );
    expect(codes(issues)).toEqual(['duplicate_id']);
    expect(issues[0]?.path).toBe('workouts.1.id');
  });
});

describe('validateTemplate : règle 3, cohérence', () => {
  it('reps_order : min > max', () => {
    const issues = validate(
      gymAb((t) => {
        slotOf(t, 'A3').sets = [
          { kind: 'work', count: 3, reps: { min: 12, max: 8 }, targetRir: 2, restS: 120 },
        ];
      }),
    );
    expect(issues).toEqual([
      expect.objectContaining({ code: 'reps_order', path: 'workouts.0.slots.2.sets.0.reps' }),
    ]);
  });

  it('rir_too_low : RIR 0 partout (schéma), RIR 1 sur un slot main d’un modèle débutant', () => {
    const zero = validate(
      gymAb((t) => {
        const set = slotOf(t, 'A3').sets[0];
        if (set !== undefined) set.targetRir = 0;
      }),
    );
    expect(zero).toEqual([
      expect.objectContaining({ code: 'rir_too_low', path: 'workouts.0.slots.2.sets.0.targetRir' }),
    ]);
    const main = validate(
      gymAb((t) => {
        const set = slotOf(t, 'A1').sets[1];
        if (set !== undefined) set.targetRir = 1;
      }),
    );
    expect(main).toEqual([
      expect.objectContaining({ code: 'rir_too_low', path: 'workouts.0.slots.0.sets.1.targetRir' }),
    ]);
    // Intermédiaire : RIR 1 admis sur un slot main (le volume change de fourchette, d'où le filtre).
    const intermediate = validate(
      gymAb((t) => {
        t.level = 'intermediate';
        const set = slotOf(t, 'A1').sets[1];
        if (set !== undefined) set.targetRir = 1;
      }),
    );
    expect(codes(intermediate)).not.toContain('rir_too_low');
  });

  it('work_sets_count : aucun groupe de travail, ou plus de 5 séries de travail dans un slot', () => {
    const none = validate(
      gymAb((t) => {
        slotOf(t, 'A1').sets = [{ kind: 'warmup', count: 2, reps: { min: 5, max: 5 }, pctWorkLoad: 50 }];
      }),
    );
    expect(none).toContainEqual(
      expect.objectContaining({ code: 'work_sets_count', path: 'workouts.0.slots.0.sets' }),
    );
    const six = validate(
      gymAb((t) => {
        slotOf(t, 'A4').sets = [
          { kind: 'work', count: 3, reps: { min: 10, max: 15 }, targetRir: 2, restS: 90 },
          { kind: 'work', count: 3, reps: { min: 10, max: 15 }, targetRir: 2, restS: 90 },
        ];
      }),
    );
    expect(six).toContainEqual(
      expect.objectContaining({ code: 'work_sets_count', path: 'workouts.0.slots.3.sets' }),
    );
  });

  it('rest_bounds : repos sous 30 s ou au-dessus de 300 s', () => {
    for (const restS of [20, 400]) {
      const issues = validate(
        gymAb((t) => {
          const set = slotOf(t, 'A3').sets[0];
          if (set !== undefined) set.restS = restS;
        }),
      );
      expect(issues).toEqual([
        expect.objectContaining({ code: 'rest_bounds', path: 'workouts.0.slots.2.sets.0.restS' }),
      ]);
    }
  });

  it('days_bounds : min > default, ou jours hors de 2 à 4', () => {
    expect(codes(validate({ ...GYM_AB, daysPerWeek: { min: 3, max: 3, default: 2 } }))).toEqual([
      'days_bounds',
    ]);
    expect(codes(validate({ ...GYM_AB, daysPerWeek: { min: 1, max: 3, default: 3 } }))).toEqual([
      'days_bounds',
    ]);
    expect(codes(validate({ ...GYM_AB, daysPerWeek: { min: 2, max: 5, default: 3 } }))).toEqual([
      'days_bounds',
    ]);
  });
});

describe('validateTemplate : règle 4, couverture', () => {
  it('coverage_missing : plus aucun slot de gainage', () => {
    const issues = validate(
      gymAb((t) => {
        const a = t.workouts[0];
        if (a !== undefined) a.slots = a.slots.filter((s) => s.id !== 'A5');
      }),
    );
    expect(issues).toEqual([expect.objectContaining({ code: 'coverage_missing', path: 'workouts' })]);
    expect(issues[0]?.message).toContain('core');
  });

  it('coverage_missing : vérifiée à chaque nombre de jours permis, sur chaque semaine du cycle', () => {
    // Trois séances, le gainage seulement dans C : à 2 jours, la semaine [A, B] n'en a pas.
    const issues = validate(
      gymAb((t) => {
        const [a, b] = t.workouts;
        if (a === undefined || b === undefined) return;
        const core = a.slots.filter((s) => s.id === 'A5');
        a.slots = a.slots.filter((s) => s.id !== 'A5');
        t.workouts.push({ id: 'C', name: 'Séance C', slots: [...core.map((s) => ({ ...s, id: 'C1' }))] });
        t.daysPerWeek = { min: 2, max: 3, default: 3 };
      }),
    );
    expect(codes(issues)).toContain('coverage_missing');
    expect(issues.find((i) => i.code === 'coverage_missing')?.message).toContain('2 jours');
  });

  it('coverage_needs_bodyweight : modèle maison dont la poussée exige du matériel', () => {
    const issues = validate(
      gymAb((t) => {
        t.context = 'home';
        for (const id of ['A2', 'A4', 'B2']) {
          const slot = slotOf(t, id);
          slot.exercises = slot.exercises?.filter((e) => !e.includes('push-up'));
        }
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'coverage_needs_bodyweight', path: 'workouts' }),
    );
    expect(codes(issues)).not.toContain('coverage_missing');
  });

  it('modèle maison : chaque groupe assuré au poids du corps, aucune erreur de couverture', () => {
    const issues = validate(gymAb((t) => Object.assign(t, { context: 'home' })));
    expect(codes(issues).filter((c) => c.startsWith('coverage'))).toEqual([]);
  });
});

describe('validateTemplate : règle 5, références', () => {
  it('unknown_exercise : slug absent du catalogue', () => {
    const issues = validate(
      gymAb((t) => {
        slotOf(t, 'A1').exercises?.push('hack-squat');
      }),
    );
    expect(issues).toEqual([
      expect.objectContaining({ code: 'unknown_exercise', path: 'workouts.0.slots.0.exercises.4' }),
    ]);
  });

  it('les brouillons et les fiches relues comptent (tous statuts)', () => {
    const issues = validate(
      gymAb((t) => {
        slotOf(t, 'A1').exercises?.push('draft-squat');
      }),
    );
    expect(issues).toEqual([]);
  });

  it('pattern_mismatch : fiche d’un autre type de mouvement', () => {
    const issues = validate(
      gymAb((t) => {
        slotOf(t, 'A1').exercises?.push('lat-pulldown');
      }),
    );
    expect(issues).toEqual([
      expect.objectContaining({ code: 'pattern_mismatch', path: 'workouts.0.slots.0.exercises.4' }),
    ]);
  });

  it('unknown_chain : chaîne absente du catalogue', () => {
    const issues = validate(
      gymAb((t) => {
        slotOf(t, 'A5').chain = 'hollow-hold';
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'unknown_chain', path: 'workouts.0.slots.4.chain' }),
    );
  });

  it('gym_first_not_reference : modèle de salle dont le premier exercice exige du matériel hors référence', () => {
    const issues = validate(
      gymAb((t) => {
        slotOf(t, 'A1').exercises?.unshift('smith-squat');
      }),
    );
    expect(issues).toEqual([
      expect.objectContaining({ code: 'gym_first_not_reference', path: 'workouts.0.slots.0.exercises.0' }),
    ]);
  });

  it('gym_first_not_reference ne vaut que pour les modèles de salle', () => {
    const issues = validate(
      gymAb((t) => {
        t.context = 'home';
        slotOf(t, 'A1').exercises?.unshift('smith-squat');
      }),
    );
    expect(codes(issues)).not.toContain('gym_first_not_reference');
  });
});

describe('validateTemplate : règle 6, volume', () => {
  it('weeklyVolume : moyenne par semaine, premier exercice faisable, comptage fractionnel', () => {
    expect(weeklyVolume(GYM_AB, PROGRAM_CATALOG, gymReference)).toEqual({
      quadriceps: 7.5,
      hamstrings: 6.75,
      glutes: 10.5,
      chest: 7.5,
      lats: 9,
      delts: 10.5,
    });
  });

  it('weeklyVolume : au poids du corps, le premier exercice faisable change (tirage vertical sauté)', () => {
    const volume = weeklyVolume(GYM_AB, PROGRAM_CATALOG, homeBodyweight);
    expect(volume.lats).toBe(4.5);
    expect(volume.quadriceps).toBe(7.5);
  });

  it('weeklyVolume : une série compte au plus une fois par groupe (deltoïdes), au poids le plus fort', () => {
    const catalog = PROGRAM_CATALOG.map(
      (s): CatalogSheet =>
        s.id === 'overhead-press'
          ? { ...s, primary_muscles: ['front_delts', 'side_delts'], secondary_muscles: ['rear_delts'] }
          : s,
    );
    expect(weeklyVolume(GYM_AB, catalog, gymReference).delts).toBe(10.5);
  });

  it('groupes et fourchettes', () => {
    expect(VOLUME_GROUPS).toEqual({
      quadriceps: ['quadriceps'],
      hamstrings: ['hamstrings'],
      glutes: ['glutes'],
      chest: ['chest'],
      lats: ['lats'],
      delts: ['front_delts', 'side_delts', 'rear_delts'],
    });
    expect(VOLUME_RANGES).toEqual({ beginner: [6, 12], intermediate: [10, 20], sport: [4, 10] });
    expect(volumeRange({ context: 'sport', level: 'intermediate' })).toEqual([4, 10]);
    expect(volumeRange({ context: 'gym', level: 'intermediate' })).toEqual([10, 20]);
  });

  it('volume_out_of_range : un modèle débutant à 4 séries de quadriceps par semaine', () => {
    const template = gymAb((t) => {
      t.daysPerWeek = { min: 2, max: 3, default: 2 };
      const lunge = slotOf(t, 'B4').sets[0];
      if (lunge !== undefined) lunge.count = 1;
    });
    expect(weeklyVolume(template, PROGRAM_CATALOG, gymReference).quadriceps).toBe(4);
    expect(validate(template)).toContainEqual(
      expect.objectContaining({ code: 'volume_out_of_range', path: 'volume.quadriceps' }),
    );
  });

  it('volume_out_of_range : au-dessus de la fourchette', () => {
    const template = gymAb((t) => {
      for (const id of ['A2', 'A4']) {
        const set = slotOf(t, id).sets.at(-1);
        if (set !== undefined) set.count = 5;
      }
    });
    // Pectoraux : (5 + 5) × 1,5 = 15 > 12.
    expect(weeklyVolume(template, PROGRAM_CATALOG, gymReference).chest).toBe(15);
    expect(validate(template)).toContainEqual(
      expect.objectContaining({ code: 'volume_out_of_range', path: 'volume.chest' }),
    );
  });

  it('bornes comprises : 12 séries de pectoraux passent', () => {
    // Pectoraux : (3 + 5) × 1,5 = 12, deltoïdes 12,75 : seul le second groupe sort.
    const issues = validate(
      gymAb((t) => {
        const fly = slotOf(t, 'A4').sets[0];
        if (fly !== undefined) fly.count = 5;
      }),
    );
    expect(issues).toEqual([expect.objectContaining({ code: 'volume_out_of_range', path: 'volume.delts' })]);
  });

  it('les slots de mollets ne changent pas le volume contrôlé', () => {
    const issues = validate(gymAb((t) => t.workouts[0]?.slots.push(calfSlot('A6'))));
    expect(issues).toEqual([]);
  });
});

describe('validateTemplate : règle 7, noms interdits', () => {
  it.each([
    ['name', 'Programme StrongLifts maison'],
    ['description', 'Inspiré de Starting Strength.'],
    ['name', 'Méthode 5/3/1 adaptée'],
  ])('forbidden_name : %s « %s »', (field, text) => {
    const issues = validate({ ...GYM_AB, [field]: text });
    expect(issues).toEqual([expect.objectContaining({ code: 'forbidden_name', path: field })]);
  });

  it('forbidden_name : nom de séance, casse et espaces ignorés', () => {
    const issues = validate(
      gymAb((t) => {
        const a = t.workouts[0];
        if (a !== undefined) a.name = 'Jour strong lifts';
      }),
    );
    expect(issues).toEqual([expect.objectContaining({ code: 'forbidden_name', path: 'workouts.0.name' })]);
  });

  it('la liste reprend les marques de 05 §1', () => {
    expect(FORBIDDEN_PROGRAM_NAMES).toEqual(['StrongLifts', 'Starting Strength', '5/3/1', 'Wendler']);
  });
});

describe('templateAvailable', () => {
  const served = PROGRAM_CATALOG.filter((s) => s.status === 'published');

  it('vrai si chaque slot a une fiche publiée (un membre publié pour une chaîne)', () => {
    expect(templateAvailable(GYM_AB, served)).toBe(true);
  });

  it('faux si un slot n’a plus aucune fiche publiée', () => {
    const template = gymAb((t) => {
      slotOf(t, 'B3').exercises = ['draft-squat'];
    });
    expect(templateAvailable(template, PROGRAM_CATALOG)).toBe(false);
  });

  it('faux si aucun membre de la chaîne n’est publié', () => {
    const catalog = PROGRAM_CATALOG.map((s) =>
      s.chain_id === 'front-plank' ? { ...s, status: 'retired' as const } : s,
    );
    expect(templateAvailable(GYM_AB, catalog)).toBe(false);
  });
});
