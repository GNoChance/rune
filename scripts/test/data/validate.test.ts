import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPERIENCES, GOALS, ProgramTemplateSchema } from '@rune/contracts';
import { canonicalJson, normalize, recommendTemplate, type TemplateDescriptor } from '@rune/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkGlossary,
  DEFAULT_DATA_DIR,
  GLOSSARY_FILE,
  main,
  PROGRAMS_DIR,
  validateDataDir,
} from '../../data/validate';

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

/**
 * Fiches d'un modèle maison valide : squelettes avec leurs muscles (champs facultatifs d'un brouillon). Volume par
 * semaine (une séance, 3 jours par défaut : × 3) : quadriceps 6, ischio-jambiers 9, fessiers 12, pectoraux 6,
 * dorsaux 6, deltoïdes 6.
 */
const HOME_SHEETS = [
  skeleton('air-squat', { primary_muscles: ['quadriceps', 'glutes'], secondary_muscles: ['hamstrings'] }),
  skeleton('hip-hinge', { movement_pattern: 'hip_hinge', primary_muscles: ['hamstrings', 'glutes'] }),
  skeleton('push-up', {
    movement_pattern: 'horizontal_push',
    primary_muscles: ['chest', 'triceps'],
    secondary_muscles: ['front_delts'],
  }),
  skeleton('inverted-row', {
    movement_pattern: 'horizontal_pull',
    equipment_options: [['table']],
    primary_muscles: ['lats'],
    secondary_muscles: ['rear_delts'],
  }),
  skeleton('plank', {
    movement_pattern: 'core_anti_extension',
    measure: 'duration',
    primary_muscles: ['abs'],
  }),
];

type Json = Record<string, unknown>;
const WORK_SETS: Json[] = [{ kind: 'work', count: 2, reps: { min: 8, max: 12 }, targetRir: 2, restS: 90 }];

const homeSlot = (
  id: string,
  movementPattern: string,
  exercise: string,
  sets: Json[] = WORK_SETS,
  progression: Json = { type: 'double' },
) => ({ id, movementPattern, role: 'main', exercises: [exercise], sets, progression });

/** Modèle maison valide (05 §4 et §5) : une séance qui couvre les 5 groupes au poids du corps. */
function homeTemplate() {
  const plank = homeSlot(
    'A5',
    'core_anti_extension',
    'plank',
    [{ kind: 'work', count: 2, durationS: { min: 20, max: 40 }, targetRir: 2, restS: 60 }],
    { type: 'duration', stepS: 5 },
  );
  return {
    schemaVersion: 1,
    id: 'home-test',
    version: 1,
    name: 'Maison · Test',
    description: 'Modèle de test.',
    context: 'home',
    level: 'beginner',
    daysPerWeek: { min: 2, max: 3, default: 3 },
    estimatedMinutes: 30,
    block: { mode: 'reactive' },
    workouts: [
      {
        id: 'A',
        name: 'Séance A',
        slots: [
          homeSlot('A1', 'squat', 'air-squat'),
          homeSlot('A2', 'hip_hinge', 'hip-hinge'),
          homeSlot('A3', 'horizontal_push', 'push-up'),
          homeSlot('A4', 'horizontal_pull', 'inverted-row'),
          plank,
        ],
      },
    ],
  };
}
type HomeTemplate = ReturnType<typeof homeTemplate>;

/** Sortie capturée de `main`. */
function capture() {
  const lines: { out: string[]; err: string[] } = { out: [], err: [] };
  return {
    lines,
    console: { log: (s: string) => lines.out.push(s), error: (s: string) => lines.err.push(s) },
  };
}

/** Identifiants stables des 6 modèles (05 §3), un par contexte et par niveau. */
const TEMPLATE_IDS = [
  'gym-beginner-full-body-ab',
  'gym-intermediate-upper-lower',
  'home-beginner-full-body',
  'home-intermediate-upper-lower',
  'sport-beginner-complement',
  'sport-intermediate-strength-prevention',
];

describe('data:validate sur le dépôt', () => {
  it('le dossier data/ du dépôt est valide, en strict (R-EQ-5 : chaque code de matériel utilisé)', async () => {
    const { errors } = await validateDataDir(DEFAULT_DATA_DIR, { strict: true });
    expect(errors).toEqual([]);
  });

  it('chaque modèle que recommendTemplate peut rendre existe dans data/programs (05 §17.6)', async () => {
    const dir = join(DEFAULT_DATA_DIR, PROGRAMS_DIR);
    const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
    const templates = await Promise.all(
      names.map(async (name) => {
        const template = ProgramTemplateSchema.parse(JSON.parse(await readFile(join(dir, name), 'utf8')));
        expect(name).toBe(`${template.id}.json`);
        return template;
      }),
    );
    expect(templates.map((t) => t.id)).toEqual(TEMPLATE_IDS);

    const descriptors: TemplateDescriptor[] = templates.map((t) => ({
      id: t.id,
      context: t.context,
      level: t.level,
      days: { min: t.daysPerWeek.min, max: t.daysPerWeek.max },
      available: true,
    }));
    // Tous les profils d'entrée de recommendTemplate (R-REC-1 à R-REC-6).
    const inputs = GOALS.flatMap((goal) =>
      [null, 'football'].flatMap((sportCode) =>
        (['gym', 'home'] as const).flatMap((primaryPlaceKind) =>
          EXPERIENCES.flatMap((experience) =>
            ([2, 3, 4] as const).map((daysPerWeek) => ({
              goal,
              sportCode,
              primaryPlaceKind,
              experience,
              daysPerWeek,
            })),
          ),
        ),
      ),
    );
    const returned = new Set<string>();
    for (const input of inputs) {
      const rec = recommendTemplate(input, descriptors);
      const template = descriptors.find((d) => d.id === rec.templateId);
      // Chaque profil reçoit un modèle du dépôt, de son contexte et du niveau retenu (jamais un repli).
      expect(template, JSON.stringify(input)).toMatchObject({ context: rec.context, level: rec.level });
      if (template !== undefined) returned.add(template.id);
    }
    expect([...returned].sort()).toEqual(TEMPLATE_IDS);
  });
});

describe('data:validate sur un dossier', () => {
  let dir: string;
  const write = async (file: string, content: string | Buffer) => {
    await mkdir(join(dir, file, '..'), { recursive: true });
    await writeFile(join(dir, file), content);
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rune-data-'));
    await mkdir(join(dir, 'exercises'));
    await copyFile(join(DEFAULT_DATA_DIR, GLOSSARY_FILE), join(dir, GLOSSARY_FILE));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('dossier des fiches vide : sortie 0', async () => {
    const io = capture();
    expect(await main(['--dir', dir], io.console)).toBe(0);
    expect(io.lines.err).toEqual([]);
    expect(io.lines.out).toEqual(['Catalogue valide : 0 fiche(s), 0 illustration(s), 0 modèle(s).']);
  });

  it('une fiche valide en forme canonique : sortie 0', async () => {
    await write('exercises/air-squat.json', canonicalJson(skeleton('air-squat')));
    expect(await main(['--dir', dir], capture().console)).toBe(0);
  });

  it('fiches invalides : sortie 1, une ligne par erreur, chemin compris', async () => {
    await write('exercises/air-squat.json', `${JSON.stringify(skeleton('squat'), null, 4)}\n`);
    await write('exercises/broken.json', '{ "id": ');
    const io = capture();
    expect(await main(['--dir', dir], io.console)).toBe(1);
    const lines = io.lines.err.map((line) => line.replace(/^.*?(exercises\/)/, '$1'));
    expect(lines).toEqual([
      expect.stringMatching(/^exercises\/air-squat\.json \[id_mismatch\] /),
      expect.stringMatching(/^exercises\/air-squat\.json \[not_canonical\] /),
      expect.stringMatching(/^exercises\/broken\.json \[invalid_json\] /),
      'Catalogue invalide : 3 erreur(s).',
    ]);
  });

  it('--strict exige R-EQ-5 : chaque code de matériel utilisé', async () => {
    const io = capture();
    expect(await main(['--dir', dir, '--strict'], io.console)).toBe(1);
    expect(io.lines.err.filter((line) => line.includes('[equipment_unused]'))).toHaveLength(23);
  });

  it('option inconnue : sortie 2 et usage', async () => {
    const io = capture();
    expect(await main(['--dir'], io.console)).toBe(2);
    expect(await main(['--fix'], io.console)).toBe(2);
    expect(io.lines.err[0]).toContain('Usage');
  });

  it("vérifie l'empreinte des fichiers d'illustrations et le manifeste", async () => {
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const file = `air-squat-start.${sha256.slice(0, 8)}.svg`;
    const entry = {
      id: 'air-squat-start',
      file,
      sha256,
      bytes: bytes.length,
      media_type: 'image/svg+xml',
      source: 'everkinetic',
      source_url: 'https://github.com/everkinetic/data/blob/0123abc/svg/air-squat-1.svg',
      creators: ['Greg Priday'],
      license: 'CC-BY-SA-4.0',
      license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      replace_before_public: false,
    };
    const illustrated = skeleton('air-squat', {
      illustrations: [{ illustration_id: 'air-squat-start', role: 'start' }],
    });
    await write('exercises/air-squat.json', canonicalJson(illustrated));
    await write('illustrations/manifest.json', JSON.stringify([entry]));
    await write(`illustrations/files/${file}`, bytes);
    expect((await validateDataDir(dir)).errors).toEqual([]);

    await write(`illustrations/files/${file}`, Buffer.concat([bytes, Buffer.from(' ')]));
    expect((await validateDataDir(dir)).errors.map((e) => e.code)).toEqual(['illustration_hash_mismatch']);

    await write('illustrations/manifest.json', JSON.stringify([{ ...entry, license: 'CC-BY-NC-4.0' }]));
    expect((await validateDataDir(dir)).errors.map((e) => e.code)).toEqual([
      'illustration_unknown',
      'invalid_manifest',
    ]);
  });

  it('lit les modèles de programmes : une fiche retirée citée est refusée', async () => {
    await write('exercises/air-squat.json', canonicalJson(skeleton('air-squat', { status: 'retired' })));
    await write(
      'programs/home-beginner-full-body.json',
      JSON.stringify({
        id: 'home-beginner-full-body',
        workouts: [{ slots: [{ exercises: ['air-squat'] }] }],
      }),
    );
    const codes = (await validateDataDir(dir)).errors.map((e) => e.code);
    expect(codes[0]).toBe('retired_in_template');
    // Le fichier ne passe pas non plus le schéma des modèles (règle 1 de 05 §5).
    expect(new Set(codes)).toEqual(new Set(['retired_in_template', 'schema']));
  });

  it('un modèle valide et ses fiches (brouillons compris) : aucune erreur, modèle compté', async () => {
    await writeHome();
    const { errors, counts } = await validateDataDir(dir);
    expect(errors).toEqual([]);
    expect(counts).toEqual({ sheets: 5, illustrations: 0, templates: 1 });
  });

  it('validateTemplate sur chaque modèle : une ligne par erreur, chemin du champ dans le message', async () => {
    await writeHome((t) => t.workouts[0]?.slots[0]?.exercises?.push('hack-squat'));
    const io = capture();
    expect(await main(['--dir', dir], io.console)).toBe(1);
    const lines = io.lines.err.map((line) => line.replace(/^.*?(programs\/)/, '$1'));
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^programs\/home-test\.json \[unknown_exercise\] workouts\.0\.slots\.0\.exercises\.1 : /,
      ),
    );
  });

  it('hors dépôt git, --base par défaut : avertissement seulement, sortie 0', async () => {
    await writeHome();
    const io = capture();
    expect(await main(['--dir', dir], io.console)).toBe(0);
    expect(io.lines.err).toEqual([expect.stringMatching(/^Avertissement : règle 8 non vérifiée.*« main »/)]);
    expect(io.lines.out).toEqual(['Catalogue valide : 5 fiche(s), 0 illustration(s), 1 modèle(s).']);
  });

  it('--base donné mais introuvable : erreur, même sans modèle', async () => {
    const io = capture();
    expect(await main(['--dir', dir, '--base', 'main'], io.console)).toBe(1);
    expect(io.lines.err.map((line) => line.replace(/^.*?(programs)/, '$1'))).toEqual([
      expect.stringMatching(/^programs \[base_not_found\] .*« main »/),
      'Catalogue invalide : 1 erreur(s).',
    ]);
  });

  it('identifiant de modèle unique entre les fichiers (règle 2)', async () => {
    await writeHome();
    await write('programs/copie.json', JSON.stringify(homeTemplate()));
    expect((await validateDataDir(dir)).errors).toEqual([
      expect.objectContaining({ file: 'programs/home-test.json', code: 'duplicate_id' }),
    ]);
  });

  /** Fiches et modèle maison valides (05 §5) ; `edit` modifie le modèle avant écriture. */
  async function writeHome(edit: (t: HomeTemplate) => void = () => {}) {
    for (const sheet of HOME_SHEETS) await write(`exercises/${sheet.id}.json`, canonicalJson(sheet));
    const template = homeTemplate();
    edit(template);
    await write('programs/home-test.json', JSON.stringify(template, null, 2));
  }

  it('exige le glossaire', async () => {
    await rm(join(dir, GLOSSARY_FILE));
    expect((await validateDataDir(dir)).errors.map((e) => e.code)).toEqual(['invalid_glossary']);
  });
});

describe('règle 8 : la version monte quand le contenu change (--base, 05 §5)', () => {
  let root: string;
  let repo: string;
  let data: string;
  let env: NodeJS.ProcessEnv;
  /** Dépôt de test hermétique : ni configuration globale ni système, auteur fixé. */
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, stdio: 'pipe' });
  const writeTemplate = (template: unknown, text = `${JSON.stringify(template, null, 2)}\n`) =>
    writeFile(join(data, 'programs/home-test.json'), text);
  const errors = async (base = 'main') => (await validateDataDir(data, { base })).errors;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'rune-git-'));
    repo = join(root, 'depot');
    data = join(repo, 'data');
    await writeFile(join(root, 'gitconfig'), '');
    env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    };
    await mkdir(join(data, 'exercises'), { recursive: true });
    await mkdir(join(data, 'programs'));
    await copyFile(join(DEFAULT_DATA_DIR, GLOSSARY_FILE), join(data, GLOSSARY_FILE));
    for (const sheet of HOME_SHEETS) {
      await writeFile(join(data, `exercises/${sheet.id}.json`), canonicalJson(sheet));
    }
    await writeTemplate(homeTemplate());
    git('init', '-q');
    git('add', 'data');
    git('commit', '-q', '-m', 'base');
    git('branch', '-M', 'main');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('contenu inchangé, mise en forme comprise ou non : rien', async () => {
    expect(await errors()).toEqual([]);
    await writeTemplate(homeTemplate(), JSON.stringify(homeTemplate()));
    expect(await errors()).toEqual([]);
  });

  it('contenu changé sans hausse de version → version_not_bumped', async () => {
    await writeTemplate({ ...homeTemplate(), description: 'Autre description.' });
    expect(await errors()).toEqual([
      expect.objectContaining({ file: 'programs/home-test.json', code: 'version_not_bumped' }),
    ]);
    const io = capture();
    expect(await main(['--dir', data], io.console)).toBe(1);
    expect(io.lines.err.filter((line) => line.includes('[version_not_bumped]'))).toHaveLength(1);
  });

  it('contenu changé avec une version plus haute : rien ; version plus basse → erreur', async () => {
    await writeTemplate({ ...homeTemplate(), version: 2, description: 'Autre description.' });
    expect(await errors()).toEqual([]);
    git('commit', '-q', '-am', 'v2');
    await writeTemplate({ ...homeTemplate(), version: 1, description: 'Encore autre.' });
    expect((await errors()).map((e) => e.code)).toEqual(['version_not_bumped']);
  });

  it('modèle absent de la référence : rien à comparer', async () => {
    await writeFile(join(data, 'programs/autre.json'), JSON.stringify({ ...homeTemplate(), id: 'autre' }));
    expect(await errors()).toEqual([]);
  });

  it('--base <ref> : comparaison avec cette référence', async () => {
    await writeTemplate({ ...homeTemplate(), version: 2, description: 'Autre description.' });
    git('commit', '-q', '-am', 'v2');
    await writeTemplate({ ...homeTemplate(), version: 2, description: 'Encore autre.' });
    expect((await errors('HEAD')).map((e) => e.code)).toEqual(['version_not_bumped']);
    expect(await errors('HEAD~1')).toEqual([]);
  });

  it('--base donné et introuvable : base_not_found, sortie 1', async () => {
    await writeTemplate({ ...homeTemplate(), description: 'Autre description.' });
    const io = capture();
    expect(await main(['--dir', data, '--base', 'inconnue'], io.console)).toBe(1);
    expect(io.lines.err.filter((line) => line.includes('[base_not_found]'))).toEqual([
      expect.stringMatching(/« inconnue »/),
    ]);
    expect(io.lines.out).toEqual([]);
  });

  it('main par défaut introuvable : avertissement, règle 8 non vérifiée, sortie 0', async () => {
    git('branch', '-M', 'autre');
    await writeTemplate({ ...homeTemplate(), description: 'Autre description.' });
    const io = capture();
    expect(await main(['--dir', data], io.console)).toBe(0);
    expect(io.lines.err).toEqual([expect.stringMatching(/^Avertissement : règle 8 non vérifiée.*« main »/)]);
    expect(io.lines.out).toEqual(['Catalogue valide : 5 fiche(s), 0 illustration(s), 1 modèle(s).']);
  });
});

describe('glossaire (04 §8, étape 0)', () => {
  it('le glossaire du dépôt contient les termes exigés', async () => {
    const { default: glossary } = await import('../../../data/glossary.json', { with: { type: 'json' } });
    expect(checkGlossary(glossary)).toEqual([]);
    const preferred = glossary.map((entry: { preferred: string }) => normalize(entry.preferred));
    for (const term of ['développé couché', 'charnière de hanche', 'dos neutre', 'répétitions en réserve']) {
      expect(preferred).toContain(normalize(term));
    }
    expect(glossary.find((e: { abbreviation?: string }) => e.abbreviation === 'RIR')?.preferred).toBe(
      'répétitions en réserve',
    );
    expect(JSON.stringify(glossary)).not.toContain('’');
  });

  it.each([
    ["un objet au lieu d'un tableau", {}],
    ['un terme préféré vide', [{ preferred: '', refused: [], english: 'x' }]],
    [
      'un terme en double',
      [
        { preferred: 'série', refused: [], english: 'set' },
        { preferred: 'Série', refused: [], english: 'set' },
      ],
    ],
    [
      'une variante refusée qui est un terme préféré',
      [
        { preferred: 'série', refused: ['répétition'], english: 'set' },
        { preferred: 'répétition', refused: [], english: 'rep' },
      ],
    ],
    ['une clé inconnue', [{ preferred: 'série', refused: [], english: 'set', definition: 'x' }]],
    ['sans équivalent anglais', [{ preferred: 'série', refused: [] }]],
  ])('refuse %s', (_, glossary) => {
    expect(checkGlossary(glossary).map((e) => e.code)).toContain('invalid_glossary');
  });
});
