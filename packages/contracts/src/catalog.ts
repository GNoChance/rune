import { z } from 'zod';
import { type ILLUSTRATION_ROLES, ServedSheetSchema } from './exercise';

/** Nom d'un fichier d'illustration : `<id>.<empreinte 8 hex>.<ext>`, sans chemin. */
export const ILLUSTRATION_FILE_RE = /^([a-z0-9][a-z0-9-]*)\.([0-9a-f]{8})\.(svg|png|webp|jpg)$/;

/** Type de chaque extension de `ILLUSTRATION_FILE_RE` ; liste recoupée par le CHECK de `illustration.media_type`. */
export const ILLUSTRATION_MEDIA_TYPES = ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg'] as const;

/** Sources des illustrations (04 §12, 09 §2) ; recoupées par le CHECK de `illustration.source`. */
export const ILLUSTRATION_SOURCES = ['everkinetic', 'workout_guide'] as const;

/** Licences admises (04 §12, règle 1) ; recoupées par le CHECK de `illustration.license`. */
export const ILLUSTRATION_LICENSES = ['CC-BY-SA-4.0', 'CC-BY-4.0', 'CC0-1.0'] as const;

export type IllustrationSource = (typeof ILLUSTRATION_SOURCES)[number];
export type IllustrationLicense = (typeof ILLUSTRATION_LICENSES)[number];
export type IllustrationRole = (typeof ILLUSTRATION_ROLES)[number];

/** Nom affiché de chaque source (page Crédits), tel que ses auteurs l'écrivent (04 §12). */
export const ILLUSTRATION_SOURCE_LABELS = {
  everkinetic: 'Everkinetic',
  workout_guide: 'workout-guide',
} as const satisfies Record<IllustrationSource, string>;

/** Nom affiché de chaque licence (ligne de crédit, page Crédits, commentaire des SVG). */
export const ILLUSTRATION_LICENSE_LABELS = {
  'CC-BY-SA-4.0': 'CC BY-SA 4.0',
  'CC-BY-4.0': 'CC BY 4.0',
  'CC0-1.0': 'CC0 1.0',
} as const satisfies Record<IllustrationLicense, string>;

/** Pose d'une illustration, pour le texte alternatif « <nom> : position de départ » (04 §12). */
export const ILLUSTRATION_ROLE_LABELS = {
  start: 'position de départ',
  mid: 'position de milieu',
  end: 'position de fin',
} as const satisfies Record<IllustrationRole, string>;

/** Type de fichier de chaque extension de `ILLUSTRATION_FILE_RE`. */
export const ILLUSTRATION_MEDIA_TYPE_BY_EXTENSION = {
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
} as const satisfies Record<string, (typeof ILLUSTRATION_MEDIA_TYPES)[number]>;

export const IllustrationRef = z.object({
  id: z.string().min(1),
  file: z.string().regex(ILLUSTRATION_FILE_RE),
});
export type IllustrationRef = z.infer<typeof IllustrationRef>;

const HttpsUrl = z.url({ protocol: /^https$/ });

/**
 * Entrée du manifeste `data/illustrations/manifest.json` (04 §12 et modèle de données, table `illustration`) : un
 * fichier retenu et sa provenance. Les clés sont les colonnes de la table, dans leur ordre. C'est un
 * `IllustrationRef` (même `id`, même `file`) qui porte en plus :
 * - `sha256` : empreinte des octets du fichier, en hexadécimal minuscule ; le nom servi `<id>.<hash8>.<ext>` en
 *   reprend les 8 premiers caractères (04 §12, « Import et service ») ;
 * - `bytes`, `media_type` (celui de l'extension) ;
 * - `source`, `source_url` (figée à un commit), `creators` (au moins un : créateur identifié, règle 1), `license`,
 *   `license_url` ;
 * - `modifications` : facultatif (clé absente), nos modifications pour la page Crédits ;
 * - `replace_before_public` : provenance non documentée, « à remplacer avant publication » (règle 3).
 *
 * Le validateur du catalogue vérifie le reste : ids uniques, fichiers présents et empreinte des octets.
 */
export const IllustrationEntry = z
  .strictObject({
    ...IllustrationRef.shape,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().positive(),
    media_type: z.enum(ILLUSTRATION_MEDIA_TYPES),
    source: z.enum(ILLUSTRATION_SOURCES),
    source_url: HttpsUrl,
    creators: z.array(z.string().min(1).max(200)).min(1).max(10),
    license: z.enum(ILLUSTRATION_LICENSES),
    license_url: HttpsUrl,
    modifications: z.string().min(1).max(1000).optional(),
    replace_before_public: z.boolean(),
  })
  .superRefine((entry, ctx) => {
    const match = ILLUSTRATION_FILE_RE.exec(entry.file);
    if (match === null) return;
    const [, id, hash8, extension] = match;
    if (id !== entry.id) {
      ctx.addIssue({ code: 'custom', path: ['file'], message: "Le fichier ne porte pas l'id de l'entrée" });
    }
    if (hash8 !== entry.sha256.slice(0, 8)) {
      ctx.addIssue({ code: 'custom', path: ['file'], message: 'Le fichier ne porte pas le début du sha256' });
    }
    const expected =
      ILLUSTRATION_MEDIA_TYPE_BY_EXTENSION[extension as keyof typeof ILLUSTRATION_MEDIA_TYPE_BY_EXTENSION];
    if (expected !== entry.media_type) {
      ctx.addIssue({
        code: 'custom',
        path: ['media_type'],
        message: `Type attendu pour .${extension} : ${expected}`,
      });
    }
  });
export type IllustrationEntry = z.infer<typeof IllustrationEntry>;

/** Manifeste complet : `data/illustrations/manifest.json`, tableau éventuellement vide. */
export const IllustrationManifest = z.array(IllustrationEntry);
export type IllustrationManifest = z.infer<typeof IllustrationManifest>;

/**
 * Bloc servi par `GET /api/catalog` (04 §11), reconstruit depuis la base à chaque écriture (spec brique 2 §3.7) :
 * - `version` : `catalog_version`, sha256 de la forme canonique des quatre autres clés ; c'est aussi l'ETag ;
 * - `exercises` : fiches `published`, et `retired` déjà publiées, triées par `id` ;
 * - `illustrations` : manifeste complet (table `illustration`), trié par `id`, pour les crédits hors ligne ;
 * - `programTemplates` : modèles de `data/programs/*.json`, triés par nom de fichier ; `adviceSheets` : vide.
 */
export const CatalogBundle = z.object({
  version: z.string(),
  exercises: z.array(ServedSheetSchema),
  illustrations: IllustrationManifest,
  programTemplates: z.array(z.unknown()),
  adviceSheets: z.array(z.unknown()),
});
export type CatalogBundle = z.infer<typeof CatalogBundle>;
