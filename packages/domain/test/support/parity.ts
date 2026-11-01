import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AcceptedChange, SessionRecord } from '../../src/program/types';
import { loadCatalog, loadTemplate, placeFor, replayOf } from './simulation';

/*
 * Parité téléphone/serveur (05 §17.4) : le même historique, rejoué par la même fonction sous Node (projet domain) et
 * sous happy-dom (projet web), donne le même résultat. Le résultat de Node est l'instantané committé.
 */

export const FIXTURE_DIR = join(__dirname, '..', 'fixtures');
export const PARITY_HISTORY = join(FIXTURE_DIR, 'parity-history.json');
export const PARITY_SNAPSHOT = join(FIXTURE_DIR, 'parity-history.replay.json');

interface ParityFixture {
  instance: { id: string; templateId: string; daysPerWeek: number; startedAt: number };
  sessions: SessionRecord[];
  changes: AcceptedChange[];
}

/** Rejoue `parity-history.json` et rend le résultat en données JSON simples (les `Set` en listes triées). */
export function replayParityHistory(): unknown {
  const fixture = JSON.parse(readFileSync(PARITY_HISTORY, 'utf8')) as ParityFixture;
  const template = loadTemplate(fixture.instance.templateId);
  const replay = replayOf(
    template,
    fixture.instance.daysPerWeek,
    placeFor(template.context),
    loadCatalog(),
    fixture.sessions,
    fixture.changes,
  );
  const { program, ...rest } = replay;
  return JSON.parse(
    JSON.stringify({
      ...rest,
      program: { ...program, suspended: [...program.suspended].sort() },
    }),
  );
}
