import { z } from 'zod';

/** Nom d'un fichier d'illustration : `<id>.<empreinte 8 hex>.<ext>`, sans chemin. */
export const ILLUSTRATION_FILE_RE = /^([a-z0-9][a-z0-9-]*)\.([0-9a-f]{8})\.(svg|png|webp|jpg)$/;

/** Type de chaque extension de `ILLUSTRATION_FILE_RE` ; liste recoupée par le CHECK de `illustration.media_type`. */
export const ILLUSTRATION_MEDIA_TYPES = ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg'] as const;

/** Sources des illustrations (04 §12, 09 §2) ; recoupées par le CHECK de `illustration.source`. */
export const ILLUSTRATION_SOURCES = ['everkinetic', 'workout_guide'] as const;

/** Licences admises (04 §12, règle 1) ; recoupées par le CHECK de `illustration.license`. */
export const ILLUSTRATION_LICENSES = ['CC-BY-SA-4.0', 'CC-BY-4.0', 'CC0-1.0'] as const;

export const IllustrationRef = z.object({
  id: z.string().min(1),
  file: z.string().regex(ILLUSTRATION_FILE_RE),
});
export type IllustrationRef = z.infer<typeof IllustrationRef>;

export const CatalogBundle = z.object({
  version: z.string(),
  exercises: z.array(z.unknown()),
  illustrations: z.array(IllustrationRef),
  programTemplates: z.array(z.unknown()),
  adviceSheets: z.array(z.unknown()),
});
export type CatalogBundle = z.infer<typeof CatalogBundle>;
