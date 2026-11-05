import { HELP_RESOURCES, helpPhones } from '@rune/contracts';
import { useEffect, useId } from 'react';
import { useLocation } from 'wouter';
import { Page } from '../../ui';
import { Glyph } from './ExternalLink';
import styles from './public.module.css';
import { usePublicBack } from './use-public-back';

/*
 * « Bien utiliser le coach » (spec brique 4 §16.8, 06 §3) : page publique, lisible sans session depuis le tailnet.
 * Deux parties : « Pour tous » et « Tu as 16 ou 17 ans » (ancre `jeunes`). Les numéros viennent de `HELP_RESOURCES`.
 * Chaque phrase passe `outputFilter` et `FORBIDDEN_TERMS` dans coach-texts.test.ts (liste `COACH_HELP_TEXTS`).
 */

interface HelpBlock {
  title: string;
  lines: readonly string[];
}

const ALL: readonly HelpBlock[] = [
  {
    title: 'Ce que le coach fait',
    lines: [
      'Il répond à tes questions sur ton programme, ta technique et ta récupération.',
      'Il lit ton programme et ton historique récent, cherche des exercices, et peut te proposer un changement de programme.',
    ],
  },
  {
    title: "Ce qu'il ne fait pas",
    lines: [
      'Il ne pose aucun diagnostic et ne remplace pas un professionnel de santé : en cas de douleur, arrête et demande un avis.',
      'Il ne change jamais ton programme tout seul : chaque changement est une proposition que tu acceptes ou refuses.',
      "Il ne propose jamais d'augmenter une charge : seule la progression de ton programme le décide.",
      'Il peut se tromper : vérifie ce qui compte pour toi.',
    ],
  },
  {
    title: "D'où viennent ses chiffres",
    lines: [
      "Ses charges, ses répétitions et ses records viennent de ton dossier et des outils de l'appli, jamais de sa mémoire.",
      "L'appli bloque une phrase qui cite un chiffre absent de ton dossier.",
      'Le dossier se lit en entier dans Profil, Mon coach, « Ce que le coach voit ».',
    ],
  },
  {
    title: 'Accepter une proposition',
    lines: [
      'Une proposition apparaît sous la réponse du coach, avec ce qui change dans ton programme.',
      "« Accepter » la met dans ton programme, « Refuser » l'écarte. Sans réponse, elle expire au bout de 7 jours.",
    ],
  },
  {
    title: 'Signaler une réponse',
    lines: [
      "Sous chaque réponse, « Signaler » envoie l'échange à l'admin, qui pourra le lire et saura qu'il vient de toi.",
      "Signale une réponse inexacte, dangereuse ou déplacée : tu n'as pas à t'en justifier.",
    ],
  },
  {
    title: 'Désactiver le coach',
    lines: [
      'Dans Profil, Mon coach, « Désactiver le coach IA » retire ton accord et supprime tes conversations, tes signalements et les propositions en attente.',
      '« Supprimer mes conversations » les efface sans retirer ton accord.',
      'Tes conversations disparaissent aussi seules, 90 jours après le dernier message.',
    ],
  },
];

const YOUNG: readonly HelpBlock[] = [
  {
    title: 'Ce que le coach ne fera pas pour toi',
    lines: [
      "Le serveur sait que tu as moins de 18 ans d'après ta date de naissance, pas d'après ce que tu écris : le coach suit alors des règles de plus.",
      'Il ne te donne aucun chiffre de nutrition, aucun objectif à atteindre sur la balance et aucune consigne pour manger moins.',
      "Il ne te conseille aucun produit pour progresser plus vite. Sur le dopage, il t'oriente vers Écoute Dopage.",
      'Il ne te propose que des exercices adaptés à ton âge, et ses changements de programme restent prudents.',
    ],
  },
  {
    title: 'À qui en parler',
    lines: [
      'Pour une douleur, une inquiétude sur ton corps ou sur ton alimentation, parles-en à un parent, à un adulte de confiance ou à un professionnel de santé.',
      'Le coach te le rappelle quand le sujet est sensible. Ce rappel ne remplace pas cette conversation.',
    ],
  },
];

const NUMBERS_TITLE = 'Numéros utiles';
const NUMBERS_LINES: readonly string[] = HELP_RESOURCES.map((r) => r.label);

/** Tous les textes de la page, pour le test du filtre (coach-texts.test.ts). */
export const COACH_HELP_TEXTS: readonly string[] = [
  ...[...ALL, ...YOUNG].flatMap((b) => [b.title, ...b.lines]),
  NUMBERS_TITLE,
  ...NUMBERS_LINES,
];

const PHONE_PATH = (
  <path d="M5 4h3.5l2 5-2.5 1.5a11 11 0 0 0 5.5 5.5l1.5-2.5 5 2V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
);

function Block(p: { block: HelpBlock }) {
  return (
    <>
      <h3>{p.block.title}</h3>
      <ul className={`${styles.card} ${styles.privacyList}`}>
        {p.block.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </>
  );
}

/** Les numéros de `HELP_RESOURCES` : le libellé, puis un lien d'appel par numéro. */
function Numbers() {
  return (
    <>
      <h3>{NUMBERS_TITLE}</h3>
      {/* biome-ignore lint/a11y/noRedundantRoles: sans puces, Safari ôte la sémantique de liste (VoiceOver) */}
      <ul role="list" className={`${styles.card} ${styles.resources}`}>
        {HELP_RESOURCES.map((r) => (
          <li key={r.id} className={styles.resource}>
            <span>{r.label}</span>
            {r.phone ? (
              <span className={styles.phones}>
                {helpPhones(r).map((p) => (
                  <a
                    key={p.digits}
                    href={`tel:${p.digits}`}
                    aria-label={`Appeler le ${p.label}`}
                    className={styles.phone}
                  >
                    <Glyph size={18}>{PHONE_PATH}</Glyph>
                    {p.label}
                  </a>
                ))}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

export function CoachHelpPage() {
  const back = usePublicBack();
  const allId = useId();
  const [location] = useLocation();
  // Le lien « #jeunes » arrive avant que la page, chargée à la demande, existe : on y descend une fois montée.
  // biome-ignore lint/correctness/useExhaustiveDependencies: la page se monte une fois par visite
  useEffect(() => {
    if (window.location.hash === '#jeunes') document.getElementById('jeunes')?.scrollIntoView?.();
  }, [location]);
  return (
    <Page title="Bien utiliser le coach" back={back}>
      <div className={`stagger ${styles.stack}`}>
        <section aria-labelledby={allId} className={styles.section}>
          <h2 id={allId}>Pour tous</h2>
          {ALL.map((block) => (
            <Block key={block.title} block={block} />
          ))}
        </section>
        <section id="jeunes" aria-labelledby="jeunes-title" className={styles.section}>
          <h2 id="jeunes-title">Tu as 16 ou 17 ans</h2>
          {YOUNG.map((block) => (
            <Block key={block.title} block={block} />
          ))}
          <Numbers />
        </section>
      </div>
    </Page>
  );
}
