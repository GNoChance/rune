import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdviceSheetFile } from '@rune/contracts';

/** Fiche valide pour `validateAdviceSheet` : une source, pas de chiffre, pas de terme interdit. */
export function adviceFile(id: string, over: Partial<AdviceSheetFile> = {}): AdviceSheetFile {
  return {
    id,
    title: `Fiche ${id}`,
    body_md: "Mange des repas variés et pense à bien t'hydrater.",
    audience: 'all',
    visible_modes: ['full', 'qualitative'],
    tags: ['base'],
    sources: [{ title: 'Source', url: 'https://example.org/source', accessed_on: '2026-10-01' }],
    draft_origin: 'human',
    ...over,
  };
}

/** Dossier de contenu temporaire avec `advice/<id>.json` pour chaque fiche. */
export function adviceDirs() {
  const dirs: string[] = [];
  return {
    create(files: AdviceSheetFile[]): string {
      const dir = mkdtempSync(join(tmpdir(), 'rune-advice-'));
      dirs.push(dir);
      mkdirSync(join(dir, 'advice'), { recursive: true });
      for (const f of files) writeFileSync(join(dir, 'advice', `${f.id}.json`), JSON.stringify(f, null, 2));
      return dir;
    },
    cleanup() {
      for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    },
  };
}
