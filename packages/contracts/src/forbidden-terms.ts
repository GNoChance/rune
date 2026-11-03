/*
 * Termes interdits v1 du filtre de sortie du coach (spec brique 4 §11.3 et §11.4, choix C10), tenus ensuite par la
 * brique 5 (07 §5.10.4). `term` : l'entrée de la spec telle quelle, dans l'ordre ; `forms` : le terme et ses formes
 * fléchies (pluriel et féminin des noms et adjectifs ; infinitif, présent, participes et futur des verbes). Le filtre
 * compare ces formes au texte normalisé (NFKC, minuscules, accents retirés), aux limites de mots.
 */

export interface ForbiddenTerm {
  term: string;
  forms: readonly string[];
}

/** Le terme d'abord, puis ses formes, sans doublon. */
const entry = (term: string, forms: readonly string[] = []): ForbiddenTerm => ({
  term,
  forms: [...new Set([term, ...forms])],
});

const FUTURE = ['ai', 'as', 'a', 'ons', 'ez', 'ont'] as const;

/** Verbe du 1er groupe (`soign` → soigner) ; `stressed` : radical à accent grave du présent (`sèch` pour sécher). */
const firstGroup = (stem: string, stressed = stem): string[] => [
  `${stem}er`,
  `${stressed}e`,
  `${stressed}es`,
  `${stem}ons`,
  `${stem}ez`,
  `${stressed}ent`,
  ...['é', 'ée', 'és', 'ées', 'ant'].map((e) => stem + e),
  ...FUTURE.map((e) => `${stem}er${e}`),
];

/** Verbe du 2e groupe (`guér` → guérir). */
const secondGroup = (stem: string): string[] => [
  `${stem}ir`,
  ...['is', 'it', 'issons', 'issez', 'issent'].map((e) => stem + e),
  ...['i', 'ie', 'is', 'ies', 'issant'].map((e) => stem + e),
  ...FUTURE.map((e) => `${stem}ir${e}`),
];

/** Locution verbale : le complément suit chaque forme ; le participe passé, suivi de son complément, reste invariable. */
const withObject = (verb: readonly string[], object: string): string[] => verb.map((v) => `${v} ${object}`);

const PRESCRIRE = [
  'prescrire',
  'prescris',
  'prescrit',
  'prescrivons',
  'prescrivez',
  'prescrivent',
  'prescrite',
  'prescrits',
  'prescrites',
  'prescrivant',
  ...FUTURE.map((e) => `prescrir${e}`),
];

const BRULER = [
  'brûler',
  'brûle',
  'brûles',
  'brûlons',
  'brûlez',
  'brûlent',
  'brûlé',
  'brûlant',
  ...FUTURE.map((e) => `brûler${e}`),
];

const PERDRE = [
  'perdre',
  'perds',
  'perd',
  'perdons',
  'perdez',
  'perdent',
  'perdu',
  'perdant',
  ...FUTURE.map((e) => `perdr${e}`),
];

/** Verbe pronominal : pronom de chaque personne ; participe passé dans les formes composées (« ça s'est mérité »). */
const SE_MERITER = [
  'se mériter',
  'me mérite',
  'te mérites',
  'se mérite',
  'nous nous méritons',
  'vous vous méritez',
  'se méritent',
  "s'est mérité",
  "s'est méritée",
  'se sont mérités',
  'se sont méritées',
  'se méritant',
  'me mériterai',
  'te mériteras',
  'se méritera',
  'nous nous mériterons',
  'vous vous mériterez',
  'se mériteront',
];

export const FORBIDDEN_TERMS: {
  version: '1';
  all: readonly ForbiddenTerm[];
  minor: readonly ForbiddenTerm[];
  allowedForMinor: readonly string[];
} = {
  version: '1',
  /** Pour tous (07 §5.10, colonne « Ne jamais utiliser », telle quelle). */
  all: [
    entry('régime', ['régimes']),
    entry('prescription', ['prescriptions']),
    entry('prescrire', PRESCRIRE),
    entry('ordonnance', ['ordonnances']),
    entry('traitement', ['traitements']),
    entry('soigner', firstGroup('soign')),
    entry('guérir', secondGroup('guér')),
    entry('poids idéal', ['poids idéaux']),
    entry('échec', ['échecs']),
    entry('raté', ['ratée', 'ratés', 'ratées']),
    entry('objectif manqué', ['objectifs manqués']),
    entry('sèche', ['sèches']),
    entry('brûler les graisses', withObject(BRULER, 'les graisses')),
    entry('détox'),
    entry('bon aliment', ['bons aliments']),
    entry('mauvais aliment', ['mauvais aliments']),
    entry('aliment interdit', ['aliments interdits']),
    entry('triche', ['triches']),
    entry('cheat meal', ['cheat meals']),
    entry('se mériter', SE_MERITER),
    entry('culpabiliser', firstGroup('culpabilis')),
  ],
  /** En plus pour un mineur. */
  minor: [
    entry('perte de poids', ['pertes de poids']),
    entry('perdre du poids', withObject(PERDRE, 'du poids')),
    entry('maigrir', secondGroup('maigr')),
    entry('mincir', secondGroup('minc')),
    entry('déficit', ['déficits']),
    entry('sécher', firstGroup('séch', 'sèch')),
    entry('jeûne', ['jeûnes']),
    entry('jeûner', firstGroup('jeûn')),
    entry('calories', ['calorie']),
    entry('kcal'),
    entry('complément alimentaire', ['compléments alimentaires']),
    entry('créatine', ['créatines']),
    entry('whey', ['wheys']),
    entry('protéine en poudre', ['protéines en poudre']),
    entry('brûleur de graisse', ['brûleurs de graisse', 'brûleur de graisses', 'brûleurs de graisses']),
    entry('stéroïde', ['stéroïdes']),
    entry('anabolisant', ['anabolisante', 'anabolisants', 'anabolisantes']),
    entry('SARM', ['SARMs']),
    entry('hormone de croissance', ['hormones de croissance']),
  ],
  /** Restent permis pour un mineur : la carte d'aide Écoute Dopage et le refus des produits dopants en parlent. */
  allowedForMinor: ['dopage', 'produits dopants', 'Écoute Dopage'],
};
