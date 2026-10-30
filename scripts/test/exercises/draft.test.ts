import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXERCISE_AI_FIELDS } from '@rune/contracts';
import { canonicalJson } from '@rune/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiError,
  type AiRequest,
  createFakeAiClient,
  type FakeAiResponse,
} from '../../../apps/server/src/ai/index';
import { DEFAULT_DATA_DIR, GLOSSARY_FILE, validateDataDir } from '../../data/validate';
import {
  DEFAULT_MODEL,
  DRAFT_EFFORT,
  draftExercises,
  MAX_ATTEMPTS,
  MAX_PARALLEL,
  main,
  PROMPT_VERSION,
} from '../../exercises/draft';

const AI_FIELDS: ReadonlySet<string> = new Set(EXERCISE_AI_FIELDS);
const NOW = new Date('2026-10-30T09:15:00.000Z');

/** Squelette valide (04 §8, étape 1) : champs « squelette » seulement, au statut `draft`. */
const skeleton = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  schema_version: 1,
  revision: 1,
  status: 'draft',
  batch: 'A',
  name: `Exercice ${id}`,
  movement_pattern: 'squat',
  mechanics: 'compound',
  unilateral: false,
  measure: 'reps',
  load_mode: 'bodyweight',
  equipment_options: [[]],
  level: 1,
  not_for_minors: false,
  ...extra,
});

/** Sortie IA valide : champs IA seulement, dans leurs bornes. */
const aiOutput = (id: string, extra: Record<string, unknown> = {}) => ({
  aliases: [`Alias ${id}`],
  primary_muscles: ['quadriceps', 'glutes'],
  secondary_muscles: ['adductors'],
  stressed_joints: ['knees'],
  instructions: [
    'Place les pieds à largeur de hanches.',
    'Descends en poussant les hanches en arrière.',
    'Remonte en poussant dans le sol.',
  ],
  key_points: ['Garde les talons au sol.', 'Garde le dos neutre, ni rond ni creusé.'],
  mistakes: [
    { mistake: "Les genoux rentrent vers l'intérieur.", fix: "Pousse les genoux dans l'axe des pieds." },
    { mistake: 'Les talons décollent.', fix: 'Recule le poids vers les talons.' },
  ],
  safety: ['Arrête la série si tu sens une douleur vive au genou.'],
  breathing: 'Inspire en descendant, souffle en remontant.',
  ...extra,
});

/** Sortie capturée de `main`. */
function capture() {
  const lines: string[] = [];
  return {
    lines,
    console: { log: (s: string) => lines.push(s), error: (s: string) => lines.push(s) },
  };
}

/** Id de la fiche demandée, lu dans le squelette envoyé. */
const requestedId = (req: AiRequest) => /"id": "([^"]+)"/.exec(req.user)?.[1] ?? '';

let dir: string;
const sheetPath = (id: string) => join(dir, 'exercises', `${id}.json`);
const writeSheet = (sheet: Record<string, unknown>) =>
  writeFile(sheetPath(String(sheet.id)), canonicalJson(sheet));
const readSheetText = (id: string) => readFile(sheetPath(id), 'utf8');

/** Aucun appel réseau : le `fetch` global échoue et ne doit jamais être appelé. */
let networkFetch: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  networkFetch = vi.fn(() => {
    throw new Error('Appel réseau interdit dans les tests.');
  });
  vi.stubGlobal('fetch', networkFetch);
  dir = await mkdtemp(join(tmpdir(), 'rune-draft-'));
  await mkdir(join(dir, 'exercises'));
  await copyFile(join(DEFAULT_DATA_DIR, GLOSSARY_FILE), join(dir, GLOSSARY_FILE));
});
afterEach(async () => {
  expect(networkFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

describe('exercises:draft, rédaction', () => {
  it('remplit les champs IA, drafting et revision + 1, garde le statut draft, en forme canonique', async () => {
    await writeSheet(skeleton('squat'));
    const fake = createFakeAiClient([{ value: aiOutput('squat'), costUsd: 0.08 }]);

    const result = await draftExercises({ dataDir: dir, client: fake, now: () => NOW });

    expect(result.outcomes).toEqual([{ id: 'squat', status: 'drafted', attempts: 1, costUsd: 0.08 }]);
    expect(result.costUsd).toBeCloseTo(0.08);
    const text = await readSheetText('squat');
    const written = JSON.parse(text);
    expect(text).toBe(canonicalJson(written));
    expect(written).toEqual({
      ...skeleton('squat'),
      ...aiOutput('squat'),
      revision: 2,
      status: 'draft',
      drafting: {
        origin: 'ai',
        model: DEFAULT_MODEL,
        prompt_version: PROMPT_VERSION,
        generated_at: '2026-10-30T09:15:00Z',
      },
    });
    expect((await validateDataDir(dir)).errors).toEqual([]);
  });

  it('ne modifie que les champs IA : les champs squelette sont identiques octet pour octet', async () => {
    const original = skeleton('pistol-squat', {
      revision: 4,
      name: 'Squat pistol',
      unilateral: true,
      level: 3,
      not_for_minors: true,
      equipment_options: [['suspension_trainer'], ['box']],
      chain_id: 'squat-une-jambe',
      easier_id: 'box-pistol-squat',
      updated_at: '2026-10-20T08:00:00Z',
    });
    await writeSheet(original);
    await writeSheet(
      skeleton('box-pistol-squat', { chain_id: 'squat-une-jambe', harder_id: 'pistol-squat' }),
    );
    const before = await readSheetText('pistol-squat');
    const fake = createFakeAiClient([{ value: aiOutput('pistol-squat', { setup: 'Règle les sangles.' }) }]);

    const result = await draftExercises({
      dataDir: dir,
      client: fake,
      ids: ['pistol-squat'],
      now: () => NOW,
    });

    const after = await readSheetText('pistol-squat');
    const strip = (text: string) =>
      canonicalJson(
        Object.fromEntries(
          Object.entries(JSON.parse(text)).filter(
            ([key]) => !AI_FIELDS.has(key) && key !== 'drafting' && key !== 'revision',
          ),
        ),
      );
    expect(strip(after)).toBe(strip(before));
    // Chaque champ squelette garde exactement ses lignes dans le fichier canonique.
    for (const key of Object.keys(original)) {
      if (key === 'revision') continue;
      const block = canonicalJson({ [key]: (original as Record<string, unknown>)[key] })
        .split('\n')
        .slice(1, -2)
        .join('\n');
      expect(after).toContain(block);
    }
    expect(result.outcomes).toMatchObject([{ id: 'pistol-squat', status: 'drafted' }]);
    expect(JSON.parse(after).revision).toBe(5);
  });

  it("remplace tous les champs IA d'une fiche redemandée par --ids", async () => {
    await writeSheet({ ...skeleton('squat'), ...aiOutput('ancien', { setup: 'Ancien réglage.' }) });
    const fake = createFakeAiClient([{ value: aiOutput('squat') }]);

    await draftExercises({ dataDir: dir, client: fake, ids: ['squat'], now: () => NOW });

    const written = JSON.parse(await readSheetText('squat'));
    expect(written.aliases).toEqual(['Alias squat']);
    expect(written).not.toHaveProperty('setup');
  });

  it("envoie le modèle, l'effort high, la partie fixe en cache et le schéma des seuls champs IA", async () => {
    await writeSheet(skeleton('squat'));
    const fake = createFakeAiClient([{ value: aiOutput('squat') }]);

    await draftExercises({ dataDir: dir, client: fake, now: () => NOW });

    expect(fake.calls).toHaveLength(1);
    const [req] = fake.calls as AiRequest[];
    expect(req?.model).toBe('claude-opus-5-5');
    expect(req?.effort).toBe(DRAFT_EFFORT);
    expect(DRAFT_EFFORT).toBe('high');
    // Partie fixe : prompt, guide de style, glossaire, taxonomie, étalons ; un seul point de cache, sur le dernier.
    const system = req?.system ?? [];
    expect(system.map((b) => b.cache === true)).toEqual([...system.slice(0, -1).map(() => false), true]);
    const fixed = system.map((b) => b.text).join('\n');
    expect(fixed).toContain('prompt v1');
    expect(fixed).toContain("Guide de style des fiches d'exercices");
    expect(fixed).toContain('charnière de hanche');
    expect(fixed).toContain('quadriceps');
    expect(fixed).not.toContain('Exercice squat');
    // Partie variable : le squelette.
    expect(req?.user).toContain('"id": "squat"');
    expect(req?.user).toContain('"name": "Exercice squat"');
    const schema = req?.schema as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(Object.keys(schema.properties).sort()).toEqual([...EXERCISE_AI_FIELDS].sort());
    expect(schema.required.sort()).toEqual(
      [
        'aliases',
        'breathing',
        'instructions',
        'key_points',
        'mistakes',
        'primary_muscles',
        'safety',
        'secondary_muscles',
        'stressed_joints',
      ].sort(),
    );
    expect(schema.additionalProperties).toBe(false);
  });

  it('donne les noms des voisines de chaîne', async () => {
    await writeSheet(
      skeleton('knee-push-up', { name: 'Pompe sur les genoux', chain_id: 'pompe', harder_id: 'push-up' }),
    );
    await writeSheet(
      skeleton('push-up', {
        name: 'Pompe',
        chain_id: 'pompe',
        easier_id: 'knee-push-up',
        harder_id: 'decline-push-up',
      }),
    );
    await writeSheet(
      skeleton('decline-push-up', { name: 'Pompe déclinée', chain_id: 'pompe', easier_id: 'push-up' }),
    );
    const fake = createFakeAiClient(() => ({ value: aiOutput('x') }));

    await draftExercises({ dataDir: dir, client: fake, ids: ['push-up'], now: () => NOW });

    const user = fake.calls[0]?.user ?? '';
    expect(user).toContain('knee-push-up');
    expect(user).toContain('Pompe sur les genoux');
    expect(user).toContain('decline-push-up');
    expect(user).toContain('Pompe déclinée');
  });

  it("n'envoie aucune donnée de compte ni champ système", async () => {
    await writeSheet(
      skeleton('squat', {
        revision: 3,
        reviewed_by: 'compte-7f3a',
        reviewed_at: '2026-10-21T10:00:00Z',
        illustrations: [],
        updated_at: '2026-10-22T10:00:00Z',
      }),
    );
    const fake = createFakeAiClient([{ value: aiOutput('squat') }]);

    await draftExercises({ dataDir: dir, client: fake, now: () => NOW });

    const sent = JSON.stringify(fake.calls);
    for (const marker of ['compte-7f3a', 'reviewed_by', '2026-10-21', 'updated_at', 'batch']) {
      expect(sent).not.toContain(marker);
    }
  });
});

describe('exercises:draft, choix des fiches', () => {
  it('sans --ids : seulement les brouillons aux champs IA vides', async () => {
    await writeSheet(skeleton('a-vide'));
    await writeSheet({ ...skeleton('b-deja-redige'), ...aiOutput('b') });
    await writeSheet({ ...skeleton('c-relu', { status: 'reviewed', illustrations: [] }), ...aiOutput('c') });
    await writeSheet(skeleton('d-retire', { status: 'retired' }));
    const fake = createFakeAiClient((req) => ({ value: aiOutput(requestedId(req)) }));

    const result = await draftExercises({ dataDir: dir, client: fake, now: () => NOW });

    expect(fake.calls.map(requestedId)).toEqual(['a-vide']);
    expect(result.outcomes.map((o) => [o.id, o.status])).toEqual([['a-vide', 'drafted']]);
  });

  it("refuse une fiche qui n'est pas draft, sans appel ni écriture", async () => {
    const reviewed = {
      ...skeleton('push-up', { status: 'reviewed', illustrations: [] }),
      ...aiOutput('push-up'),
    };
    await writeSheet(reviewed);
    const before = await readSheetText('push-up');
    const fake = createFakeAiClient([]);

    const result = await draftExercises({ dataDir: dir, client: fake, ids: ['push-up'], now: () => NOW });

    expect(fake.calls).toHaveLength(0);
    expect(result.outcomes).toEqual([
      {
        id: 'push-up',
        status: 'refused',
        attempts: 0,
        costUsd: 0,
        message: expect.stringMatching(/reviewed/),
      },
    ]);
    expect(await readSheetText('push-up')).toBe(before);
  });

  it('refuse un id inconnu et un squelette invalide', async () => {
    await writeSheet(skeleton('invalide', { level: 7 }));
    const fake = createFakeAiClient([]);

    const result = await draftExercises({
      dataDir: dir,
      client: fake,
      ids: ['absente', 'invalide'],
      now: () => NOW,
    });

    expect(fake.calls).toHaveLength(0);
    expect(result.outcomes.map((o) => [o.id, o.status])).toEqual([
      ['absente', 'refused'],
      ['invalide', 'refused'],
    ]);
  });
});

describe('exercises:draft, erreurs', () => {
  it(`rejette une sortie invalide après ${MAX_ATTEMPTS} essais et laisse le fichier intact`, async () => {
    await writeSheet(skeleton('squat'));
    const before = await readSheetText('squat');
    const fake = createFakeAiClient([
      { value: aiOutput('squat', { instructions: ['Une seule étape.'] }), costUsd: 0.05 },
      { value: aiOutput('squat', { name: 'Autre nom' }), costUsd: 0.06 },
    ]);

    const result = await draftExercises({ dataDir: dir, client: fake, now: () => NOW });

    expect(MAX_ATTEMPTS).toBe(2);
    expect(fake.calls).toHaveLength(2);
    expect(result.outcomes).toEqual([
      {
        id: 'squat',
        status: 'failed',
        attempts: 2,
        costUsd: expect.closeTo(0.11),
        message: expect.any(String),
      },
    ]);
    expect(result.outcomes[0]?.message).toMatch(/name/);
    expect(await readSheetText('squat')).toBe(before);
    // Le second essai dit au modèle ce qui a été refusé.
    expect(fake.calls[1]?.user).toContain('instructions');
    expect(fake.calls[1]?.system).toEqual(fake.calls[0]?.system);
  });

  it('accepte une sortie valide au second essai', async () => {
    await writeSheet(skeleton('squat'));
    const fake = createFakeAiClient([
      { text: 'pas du JSON', costUsd: 0.01 },
      { value: aiOutput('squat'), costUsd: 0.02 },
    ]);

    const result = await draftExercises({ dataDir: dir, client: fake, now: () => NOW });

    expect(result.outcomes).toEqual([
      { id: 'squat', status: 'drafted', attempts: 2, costUsd: expect.closeTo(0.03) },
    ]);
  });

  it("refuse un alias qui reprend le nom d'une autre fiche (règle de la CI)", async () => {
    await writeSheet(skeleton('squat'));
    await writeSheet({ ...skeleton('fente', { status: 'draft' }), ...aiOutput('fente') });
    const fake = createFakeAiClient([
      { value: aiOutput('squat', { aliases: ['Exercice fente'] }) },
      { value: aiOutput('squat', { aliases: ['Alias fente'] }) },
    ]);

    const result = await draftExercises({ dataDir: dir, client: fake, ids: ['squat'], now: () => NOW });

    expect(result.outcomes[0]).toMatchObject({ status: 'failed', attempts: 2 });
    expect(result.outcomes[0]?.message).toMatch(/duplicate_alias/);
  });

  it('stop_reason max_tokens : erreur claire, pas de nouvel essai, fichier intact', async () => {
    await writeSheet(skeleton('squat'));
    const before = await readSheetText('squat');
    const fake = createFakeAiClient([{ text: '{"aliases": [', stopReason: 'max_tokens', costUsd: 0.2 }]);

    const result = await draftExercises({ dataDir: dir, client: fake, now: () => NOW });

    expect(fake.calls).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', attempts: 1, costUsd: 0.2 });
    expect(result.outcomes[0]?.message).toMatch(/max_tokens/);
    expect(result.outcomes[0]?.message).toMatch(/--max-tokens/);
    expect(await readSheetText('squat')).toBe(before);
  });

  it('erreur fatale : les fiches pas encore lancées ne sont pas envoyées', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const id of ids) await writeSheet(skeleton(id));
    const fake = createFakeAiClient(() => ({
      error: new AiError('api', "Erreur de l'API Anthropic (401) : clé refusée.", { fatal: true }),
    }));

    const result = await draftExercises({ dataDir: dir, client: fake, now: () => NOW });

    expect(fake.calls.length).toBeLessThanOrEqual(MAX_PARALLEL);
    expect(result.outcomes.map((o) => o.status)).toEqual([
      ...Array(fake.calls.length).fill('failed'),
      ...Array(ids.length - fake.calls.length).fill('skipped'),
    ]);
  });
});

describe('exercises:draft, parallélisme', () => {
  it(`${MAX_PARALLEL} appels en parallèle au plus`, async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    for (const id of ids) await writeSheet(skeleton(id));
    let running = 0;
    let peak = 0;
    const fake = createFakeAiClient(async (req): Promise<FakeAiResponse> => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { value: aiOutput(requestedId(req)) };
    });

    const result = await draftExercises({ dataDir: dir, client: fake, now: () => NOW });

    expect(MAX_PARALLEL).toBe(4);
    expect(peak).toBe(MAX_PARALLEL);
    expect(result.outcomes.map((o) => [o.id, o.status])).toEqual(ids.map((id) => [id, 'drafted']));
    expect((await validateDataDir(dir)).errors).toEqual([]);
  });
});

describe('exercises:draft, ligne de commande', () => {
  it("sans .env.local ni variable d'environnement : sortie 1 et message clair, aucun client créé", async () => {
    const out = capture();
    const createClient = vi.fn();

    const code = await main(['--dir', dir], out.console, {
      envFile: join(dir, '.env.local'),
      env: {},
      createClient,
    });

    expect(code).toBe(1);
    expect(createClient).not.toHaveBeenCalled();
    expect(out.lines.join('\n')).toMatch(/\.env\.local/);
  });

  it("lit la clé dans .env.local sans jamais l'afficher", async () => {
    const envFile = join(dir, '.env.local');
    await writeFile(envFile, '# Clé du workspace de développement\nANTHROPIC_API_KEY=cle-de-test-secrete\n');
    await writeSheet(skeleton('squat'));
    const out = capture();
    const createClient = vi.fn(() => createFakeAiClient([{ value: aiOutput('squat'), costUsd: 0.1 }]));

    const code = await main(['--dir', dir, '--model', 'claude-sonnet-5-5'], out.console, {
      envFile,
      env: { ANTHROPIC_API_KEY: 'cle-de-la-variable' },
      createClient,
    });

    expect(code).toBe(0);
    expect(createClient).toHaveBeenCalledWith('cle-de-test-secrete', 'claude-sonnet-5-5');
    const printed = out.lines.join('\n');
    expect(printed).not.toContain('cle-de-test-secrete');
    expect(printed).toMatch(/squat/);
    expect(printed).toMatch(/Catalogue valide/);
    expect(JSON.parse(await readSheetText('squat')).drafting.model).toBe('claude-sonnet-5-5');
  });

  it("sans .env.local : repli sur la variable d'environnement du poste (procédure P5)", async () => {
    const out = capture();
    const createClient = vi.fn(() => createFakeAiClient([]));

    const code = await main(['--dir', dir], out.console, {
      envFile: join(dir, '.env.local'),
      env: { ANTHROPIC_API_KEY: 'cle-de-la-variable' },
      createClient,
    });

    expect(code).toBe(0);
    expect(createClient).toHaveBeenCalledWith('cle-de-la-variable', 'claude-opus-5-5');
    expect(out.lines.join('\n')).not.toContain('cle-de-la-variable');
  });

  it('option inconnue : sortie 2', async () => {
    const out = capture();
    expect(await main(['--force'], out.console, { envFile: join(dir, '.env.local') })).toBe(2);
  });

  it("échec d'une fiche : sortie 1", async () => {
    const envFile = join(dir, '.env.local');
    await writeFile(envFile, 'ANTHROPIC_API_KEY=cle-de-test-secrete\n');
    await writeSheet(skeleton('squat'));
    const out = capture();
    const createClient = () => createFakeAiClient([{ value: {}, stopReason: 'refusal' }]);

    expect(await main(['--dir', dir, '--ids', 'squat'], out.console, { envFile, createClient })).toBe(1);
  });
});
