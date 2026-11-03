/** Identifiants des ressources, dans l'ordre de `HELP_RESOURCES` (outil `refer_to_help`, spec brique 4 §10). */
export const HELP_RESOURCE_IDS = [
  'emergency',
  'pain',
  'eating_disorder',
  'doping',
  'pregnancy',
  'distress',
] as const;
export type HelpResourceId = (typeof HELP_RESOURCE_IDS)[number];

export interface HelpResource {
  id: HelpResourceId;
  label: string;
  phone: string | null;
  hours: string | null;
  sourceUrl: string | null;
  verifiedOn: string;
}

/** Page Aide (03 §13.7, 07 §5.11) : numéros revérifiés avant chaque mise en production. */
export const HELP_RESOURCES: readonly HelpResource[] = [
  {
    id: 'emergency',
    label: 'Urgence vitale (SAMU 15, numéro européen 112)',
    phone: '15 / 112',
    hours: null,
    sourceUrl: null,
    verifiedOn: '2026-10-06',
  },
  {
    id: 'pain',
    label: 'Douleur : consulte un médecin ou un kinésithérapeute',
    phone: null,
    hours: null,
    sourceUrl: null,
    verifiedOn: '2026-10-06',
  },
  {
    id: 'eating_disorder',
    label: 'Anorexie Boulimie Info Écoute (FFAB), appel non surtaxé',
    phone: '09 69 325 900',
    hours: null,
    sourceUrl: 'https://www.ffab.fr/500-ligne-tca-nouveau-numero',
    verifiedOn: '2026-10-06',
  },
  {
    id: 'doping',
    label: 'Écoute Dopage',
    phone: '0 800 15 2000',
    hours: null,
    sourceUrl: 'https://lannuaire.service-public.gouv.fr/centres-contact/R20697',
    verifiedOn: '2026-10-06',
  },
  {
    id: 'pregnancy',
    label: 'Grossesse ou allaitement : demande conseil à ton médecin ou à une sage-femme',
    phone: null,
    hours: null,
    sourceUrl: null,
    verifiedOn: '2026-10-06',
  },
  {
    id: 'distress',
    label: 'Prévention du suicide',
    phone: '3114',
    hours: '24 h/24, gratuit',
    sourceUrl: 'https://3114.fr/',
    verifiedOn: '2026-10-06',
  },
];

/**
 * Numéros d'une ressource, un par bouton `tel:` (spec brique 4 §16.4) : `'15 / 112'` → `15` et `112` ; un numéro
 * espacé garde son libellé (`'09 69 325 900'`) et ses seuls chiffres (`0969325900`).
 */
export function helpPhones(r: HelpResource): { label: string; digits: string }[] {
  if (r.phone === null) return [];
  return r.phone.split('/').map((part) => {
    const label = part.trim();
    return { label, digits: label.replace(/\D/g, '') };
  });
}

/** Chiffres des numéros de `HELP_RESOURCES` : les seuls numéros admis par le filtre du coach (spec brique 4 §11.3). */
export const HELP_PHONE_DIGITS: readonly string[] = HELP_RESOURCES.flatMap((r) =>
  helpPhones(r).map((p) => p.digits),
);
