import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, normalize } from '@rune/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkGlossary, DEFAULT_DATA_DIR, GLOSSARY_FILE, main, validateDataDir } from '../../data/validate';

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

/** Sortie capturée de `main`. */
function capture() {
  const lines: { out: string[]; err: string[] } = { out: [], err: [] };
  return {
    lines,
    console: { log: (s: string) => lines.out.push(s), error: (s: string) => lines.err.push(s) },
  };
}

describe('data:validate sur le dépôt', () => {
  it('le dossier data/ du dépôt est valide', async () => {
    const { errors } = await validateDataDir(DEFAULT_DATA_DIR);
    expect(errors).toEqual([]);
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
    expect((await validateDataDir(dir)).errors.map((e) => e.code)).toEqual(['retired_in_template']);
  });

  it('exige le glossaire', async () => {
    await rm(join(dir, GLOSSARY_FILE));
    expect((await validateDataDir(dir)).errors.map((e) => e.code)).toEqual(['invalid_glossary']);
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
