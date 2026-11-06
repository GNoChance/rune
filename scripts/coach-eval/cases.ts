/**
 * Jeu d'évaluation du coach (spec brique 4 §19.1) : schéma d'un cas (`eval/coach/cases/<id>.json`), schéma d'un membre
 * fictif (`eval/coach/fixtures/members/<id>.json`) et leur lecture. Données fictives seulement : pseudo, date de
 * naissance et nom de salle de chaque membre sont des canaris, qui ne doivent jamais apparaître dans une requête.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AgeBandSchema,
  COACH_TOOL_NAMES,
  EquipmentCodeSchema,
  GuidedRequestSchema,
  HELP_RESOURCE_IDS,
  SportCodeSchema,
} from '@rune/contracts';
import { z } from 'zod';

export const EVAL_DIR = fileURLToPath(new URL('../../eval/coach/', import.meta.url));
export const CASES_DIR = join(EVAL_DIR, 'cases');
export const MEMBERS_DIR = join(EVAL_DIR, 'fixtures', 'members');
/** Catalogue fictif `published` (choix C47) : développement et réglage du pipeline, jamais une mise en service. */
export const CATALOG_FIXTURE_DIR = join(EVAL_DIR, 'fixtures', 'catalog');
export const REPORTS_DIR = join(EVAL_DIR, 'reports');

/** Instant fixé de l'évaluation : les séances des fixtures sont datées par rapport à lui. */
export const EVAL_NOW = '2026-11-05T10:00:00.000Z';

const ToolName = z.enum(COACH_TOOL_NAMES);

/**
 * Tour du faux client (JSON), converti par `run.ts` avec les aides de `ai/fake.ts` : texte, appel d'outil, refus,
 * ou repli côté serveur.
 */
export const FakeTurnSpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string().min(1) }),
  z.strictObject({ kind: z.literal('tool'), name: ToolName, input: z.unknown() }),
  z.strictObject({ kind: z.literal('refusal'), category: z.string().nullable() }),
  z.strictObject({
    kind: z.literal('fallback'),
    text: z.string().min(1),
    from: z.string(),
    to: z.string(),
  }),
]);
export type FakeTurnSpec = z.infer<typeof FakeTurnSpecSchema>;

export const EvalCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category: z.enum(['safety', 'proposal', 'technique', 'nutrition', 'injection', 'fake']),
  audience: AgeBandSchema,
  /** Accord coach toujours donné ; l'accord santé varie. */
  consents: z.strictObject({ health: z.boolean() }),
  /** Identifiant d'un membre de `fixtures/members`. */
  fixture: z.string().min(1),
  /** Messages de la personne, un par échange. Pour un cas guidé : le texte que le serveur recompose (un seul tour). */
  turns: z.array(z.string().min(1)).min(1),
  /**
   * Cas d'un parcours guidé (brique 4.1) : le lanceur envoie `guided` avec le message, comme l'appli, et le serveur
   * recompose le texte à partir des choix. Il porte le premier tour.
   */
  guided: GuidedRequestSchema.optional(),
  expect: z.strictObject({
    tools: z.array(ToolName).optional(),
    noTool: z.array(ToolName).optional(),
    help: z.enum(HELP_RESOURCE_IDS).optional(),
    proposal: z.enum(['valid', 'none']).optional(),
    /** Noms d'opérations (`op`) attendus dans la proposition. */
    opsInclude: z.array(z.string()).optional(),
    mustContain: z.array(z.string()).optional(),
    /** Au moins un de ces repères, sans figer la formulation. */
    mustContainAny: z.array(z.string()).optional(),
    mustNotContain: z.array(z.string()).optional(),
    /** Expressions régulières (insensibles à la casse) qui ne doivent correspondre à aucune réponse. */
    mustNotMatch: z
      .array(
        z.string().refine((source) => {
          try {
            new RegExp(source, 'i');
            return true;
          } catch {
            return false;
          }
        }, 'expression régulière invalide'),
      )
      .optional(),
    safety: z.boolean(),
  }),
  /** Seuls les cas « fake » (refus, repli, filtre) portent un script du faux client. */
  fakeScript: z.array(FakeTurnSpecSchema).optional(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

const Sets = z.array(
  z.strictObject({
    loadG: z.number().int().min(0).nullable(),
    reps: z.number().int().min(1),
    effort: z.enum(['easy', 'ok', 'hard', 'failed']).optional(),
  }),
);

/** Membre fictif complet : profil, lieux, programme, séances des 4 dernières semaines, limitations. */
export const MemberFixtureSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  user: z.strictObject({ username: z.string().min(1), birthDate: z.iso.date() }),
  consents: z.strictObject({ health: z.boolean() }),
  profile: z.strictObject({
    goal: z.enum(['muscle', 'strength', 'fat_loss', 'fitness', 'sport_support']),
    experience: z.enum(['none', 'lt_6_months', '6_to_24_months', 'gt_24_months']),
    daysPerWeek: z.number().int().min(1).max(7),
    sessionMinutes: z.number().int().min(10).max(180),
    sportCode: SportCodeSchema.optional(),
    cautiousMode: z.boolean().optional(),
    coach: z.enum(['ombre', 'skald', 'scribe']),
  }),
  /** Réponse du questionnaire de santé : `caution` vrai = mode prudent conseillé. */
  screening: z.strictObject({ caution: z.boolean() }).optional(),
  places: z.array(
    z.strictObject({
      ref: z.string().min(1),
      kind: z.enum(['home', 'gym']),
      primary: z.boolean(),
      equipment: z.array(EquipmentCodeSchema),
      /** Lieu de salle : la salle (nom canari) et son matériel. */
      gym: z.strictObject({ name: z.string().min(1), city: z.string().min(1) }).optional(),
    }),
  ),
  limitations: z.array(
    z.strictObject({
      bodyArea: z.enum([
        'shoulder',
        'elbow',
        'wrist_hand',
        'neck',
        'upper_back',
        'lower_back',
        'hip',
        'knee',
        'ankle_foot',
        'other',
      ]),
      side: z.enum(['left', 'right', 'both', 'not_applicable']),
      severity: z.enum(['mild', 'severe']),
      note: z.string().optional(),
    }),
  ),
  /** Modèle suivi (sans lui : aucun programme actif). */
  program: z
    .strictObject({ templateId: z.string().min(1), daysPerWeek: z.number().int().min(1).max(7) })
    .nullable(),
  sessions: z.array(
    z.strictObject({
      daysAgo: z.number().int().min(1).max(28),
      workoutId: z.string().min(1),
      place: z.string().min(1),
      note: z.string().optional(),
      exercises: z.array(
        z.strictObject({
          slotId: z.string().min(1),
          exerciseId: z.string().min(1),
          note: z.string().optional(),
          painLevel: z.enum(['none', 'discomfort', 'pain']).optional(),
          sets: Sets,
        }),
      ),
    }),
  ),
  /** Valeurs qui ne doivent apparaître ni dans une requête sérialisée ni dans une réponse. */
  canaries: z.array(z.string().min(1)),
});
export type MemberFixture = z.infer<typeof MemberFixtureSchema>;

async function loadJsonDir<T>(dir: string, schema: z.ZodType<T>): Promise<T[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  const items: T[] = [];
  for (const name of names) {
    const parsed = schema.safeParse(JSON.parse(await readFile(join(dir, name), 'utf8')));
    if (!parsed.success) {
      const where = parsed.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join(' ; ');
      throw new Error(`${name} : ${where}`);
    }
    items.push(parsed.data);
  }
  return items;
}

/** Cas triés par nom de fichier ; chaque fichier porte l'identifiant de son cas. */
export async function loadCases(dir: string = CASES_DIR): Promise<EvalCase[]> {
  const cases = await loadJsonDir(dir, EvalCaseSchema);
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`Cas en double : ${c.id}`);
    ids.add(c.id);
  }
  return cases;
}

export async function loadMembers(dir: string = MEMBERS_DIR): Promise<MemberFixture[]> {
  return loadJsonDir(dir, MemberFixtureSchema);
}
