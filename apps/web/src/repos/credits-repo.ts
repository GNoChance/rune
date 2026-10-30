import { ILLUSTRATION_ROLES, IllustrationEntry } from '@rune/contracts';
import { type CreditSheet, illustrationCredits, type SourceCredit } from '@rune/domain';
import { z } from 'zod';
import type { AppServices } from '../app-services';
import { getMeta } from '../local-db/meta';

/**
 * Crédits des illustrations, lus dans le catalogue local (magasins `exercises` et `illustrations`) : la page
 * Crédits se lit hors ligne et sans session (04 §12).
 * - `missing` : catalogue jamais téléchargé sur l'appareil ;
 * - `ready` : crédits de chaque illustration des fiches servies, groupés par source (`illustrationCredits`).
 */
export type CreditsView = { state: 'missing' } | { state: 'ready'; sources: SourceCredit[] };

export interface CreditsRepo {
  illustrations(): Promise<CreditsView>;
}

/** Ce que les crédits lisent d'une fiche du catalogue local ; une ligne illisible est ignorée. */
const SheetRow = z.looseObject({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  illustrations: z
    .array(z.looseObject({ illustration_id: z.string(), role: z.enum(ILLUSTRATION_ROLES) }))
    .optional(),
});

/** Lignes que `schema` accepte, les autres écartées (catalogue d'une version précédente). */
function parsedRows<T>(rows: readonly unknown[], schema: z.ZodType<T>): T[] {
  return rows.flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export function createCreditsRepo(s: AppServices): CreditsRepo {
  const { db } = s;
  return {
    async illustrations() {
      if ((await getMeta(db, 'catalogVersion')) === undefined) return { state: 'missing' };
      const sheets: CreditSheet[] = parsedRows(await db.table('exercises').toArray(), SheetRow);
      const manifest = parsedRows(await db.table('illustrations').toArray(), IllustrationEntry);
      return { state: 'ready', sources: illustrationCredits(sheets, manifest) };
    },
  };
}
