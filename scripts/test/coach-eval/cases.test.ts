import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ExerciseSheetSchema } from '@rune/contracts';
import { describe, expect, it } from 'vitest';
import {
  CASES_DIR,
  CATALOG_FIXTURE_DIR,
  EVAL_NOW,
  EvalCaseSchema,
  loadCases,
  loadMembers,
  MEMBERS_DIR,
} from '../../coach-eval/cases';
import { validateDataDir } from '../../data/validate';

/** Les 18 cas de sécurité adultes : 17 obligatoires (06 §16, 07 §5.9) et « numéro écrit dans une liste ». */
const ADULT_SAFETY = [
  's-genou-squat',
  's-douleur-thoracique',
  's-regime-1000-kcal',
  's-baisse-calories-x',
  's-vomissements-repas',
  's-enceinte-secher',
  's-sarms',
  's-en-finir',
  's-tendinite',
  's-16-ans-compte-majeur',
  's-5kg-2-semaines',
  's-jeune-seche-express',
  's-deshydratation-combat',
  's-squat-sans-cible',
  's-injection-note-seance',
  's-tu-es-mon-medecin',
  's-prompt-systeme',
  's-numero-en-liste',
];
const MINOR_SAFETY = [
  'm-secher',
  'm-kcal',
  'm-creatine-whey',
  'm-steroides',
  'm-vomissements',
  'm-perdre-poids-competition',
  'm-exercice-deconseille',
  'm-chiffres-nutrition',
];

const cases = await loadCases();
const members = await loadMembers();
const byCategory = (category: string) => cases.filter((c) => c.category === category);

describe('jeu de cas', () => {
  it('charge environ 65 cas valides, un fichier par identifiant', async () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
    expect(cases.length).toBeLessThanOrEqual(70);
    const files = (await readdir(CASES_DIR)).filter((f) => f.endsWith('.json')).sort();
    expect(files).toEqual(cases.map((c) => `${c.id}.json`).sort());
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const f of files) {
      const raw: unknown = JSON.parse(await readFile(join(CASES_DIR, f), 'utf8'));
      expect(EvalCaseSchema.safeParse(raw).success, f).toBe(true);
    }
  });

  it('répartit les cas : sécurité (dont 8 mineurs), propositions, technique, nutrition, injection, faux', () => {
    expect(byCategory('safety')).toHaveLength(ADULT_SAFETY.length + MINOR_SAFETY.length);
    expect(byCategory('safety').filter((c) => c.audience === 'minor')).toHaveLength(8);
    expect(byCategory('proposal')).toHaveLength(15);
    expect(byCategory('technique')).toHaveLength(10);
    expect(byCategory('nutrition')).toHaveLength(5);
    expect(byCategory('injection')).toHaveLength(5);
    expect(byCategory('fake')).toHaveLength(5);
  });

  it('porte les cas obligatoires et les 8 cas mineurs, sans repli pour les mineurs', () => {
    const ids = new Set(cases.map((c) => c.id));
    for (const id of [...ADULT_SAFETY, ...MINOR_SAFETY]) expect(ids.has(id), id).toBe(true);
    for (const id of MINOR_SAFETY) {
      const c = cases.find((x) => x.id === id);
      expect(c?.audience, id).toBe('minor');
      expect(c?.fakeScript, id).toBeUndefined();
    }
    for (const id of ADULT_SAFETY) expect(cases.find((x) => x.id === id)?.audience, id).toBe('adult');
  });

  it('marque safety exactement les cas de la catégorie sécurité', () => {
    for (const c of cases) expect(c.expect.safety, c.id).toBe(c.category === 'safety');
  });

  it("ne laisse un fakeScript qu'aux 5 cas « fake »", () => {
    for (const c of cases) expect(c.fakeScript !== undefined, c.id).toBe(c.category === 'fake');
  });

  it('a pour chaque cas un membre, un public et des tours cohérents', () => {
    const byId = new Map(members.map((m) => [m.id, m]));
    for (const c of cases) {
      const member = byId.get(c.fixture);
      expect(member, `${c.id} : fixture ${c.fixture}`).toBeDefined();
      expect(c.turns.length, c.id).toBeGreaterThan(0);
      expect(
        c.turns.every((t) => t.trim() !== ''),
        c.id,
      ).toBe(true);
      if (member === undefined) continue;
      const birth = new Date(`${member.user.birthDate}T00:00:00Z`);
      const now = new Date(EVAL_NOW);
      const age =
        now.getUTCFullYear() -
        birth.getUTCFullYear() -
        (now.getUTCMonth() < birth.getUTCMonth() ||
        (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())
          ? 1
          : 0);
      expect(age < 18 ? 'minor' : 'adult', `${c.id} : public`).toBe(c.audience);
      expect(member.consents.health, c.id).toBe(c.consents.health);
    }
  });
});

describe('fixtures des membres', () => {
  it('donne à chaque membre un pseudo, une date de naissance et un nom de salle canaris', () => {
    expect(members.length).toBeGreaterThanOrEqual(6);
    for (const m of members) {
      expect(m.user.username, m.id).toMatch(/canari/i);
      expect(m.user.birthDate, m.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const gyms = m.places.filter((p) => p.gym !== undefined);
      expect(gyms.length, m.id).toBeGreaterThan(0);
      for (const g of gyms) expect(g.gym?.name, m.id).toMatch(/canari/i);
      expect(m.canaries, m.id).toEqual(
        expect.arrayContaining([m.user.username, m.user.birthDate, ...gyms.map((g) => g.gym?.name)]),
      );
    }
  });

  it('un fichier par membre, nommé par son identifiant', async () => {
    const files = (await readdir(MEMBERS_DIR)).filter((f) => f.endsWith('.json')).sort();
    expect(files).toEqual(members.map((m) => `${m.id}.json`).sort());
  });
});

describe('catalogue fictif', () => {
  it('passe validateDataDir, fiches published', async () => {
    const result = await validateDataDir(CATALOG_FIXTURE_DIR);
    expect(result.errors).toEqual([]);
    const dir = join(CATALOG_FIXTURE_DIR, 'exercises');
    const sheets = await Promise.all(
      (await readdir(dir)).map(async (f) =>
        ExerciseSheetSchema.parse(JSON.parse(await readFile(join(dir, f), 'utf8'))),
      ),
    );
    expect(sheets.length).toBeGreaterThan(20);
    expect(sheets.every((s) => s.status === 'published')).toBe(true);
    expect(sheets.some((s) => s.chain_id !== undefined)).toBe(true);
  });

  it('couvre maison, salle, sport, matériel manquant et chaînes', async () => {
    const dir = join(CATALOG_FIXTURE_DIR, 'programs');
    const contexts = new Set(
      await Promise.all(
        (await readdir(dir)).map(
          async (f) => JSON.parse(await readFile(join(dir, f), 'utf8')).context as string,
        ),
      ),
    );
    expect([...contexts].sort()).toEqual(['gym', 'home', 'sport']);
    // Matériel manquant : un membre sans aucun matériel à la maison.
    expect(members.some((m) => m.places.some((p) => p.equipment.length === 0 && p.gym === undefined))).toBe(
      true,
    );
  });
});
