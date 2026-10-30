import { z } from 'zod';

export const EXPORT_FORMAT = 'rune-export/1';

const Row = z.record(z.string(), z.unknown());

/**
 * `tables` est indexé par le nom SQL ; lignes en camelCase, valeurs telles que stockées (0/1, JSON en texte).
 * `reviewComments` et `reviewValidations` : commentaires et validations de relecture écrits par la personne
 * (spec brique 2 §3.9, exception déclarée à P-CAT-3), sans l'identifiant d'un autre compte ; les révisions des
 * fiches n'y sont pas.
 */
export const ExportV1 = z.object({
  format: z.literal(EXPORT_FORMAT),
  exportedAt: z.string(),
  account: Row,
  tables: z.record(z.string(), z.array(Row)),
  gyms: z.array(Row),
  gymHistory: z.array(Row),
  reviewComments: z.array(Row),
  reviewValidations: z.array(Row),
});
export type ExportV1 = z.infer<typeof ExportV1>;
