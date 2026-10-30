import { Fragment, useEffect, useState } from 'react';
import { useRepos } from '../../repos';
import { BottomSheet } from '../../ui';
import styles from './review.module.css';

/** Les cinq mots de la relecture (spec brique 2 §4.4), chacun en une phrase. */
export const HOW_TO_REVIEW_TERMS: readonly { term: string; text: string }[] = [
  {
    term: 'Version',
    text: "La fiche telle qu'elle est à un moment donné : chaque modification crée une nouvelle version.",
  },
  {
    term: 'Sensible',
    text: 'Une fiche de niveau 2 ou plus, déconseillée aux mineurs, ou qui sollicite le bas du dos, les genoux, les épaules ou la nuque.',
  },
  {
    term: 'Feu vert santé',
    text: "La validation d'une relectrice professionnelle de santé, sans laquelle une fiche sensible ne se publie pas.",
  },
  {
    term: 'À revalider',
    text: 'Une fiche sensible déjà publiée, modifiée depuis son feu vert santé, qui en attend un nouveau.',
  },
  {
    term: 'Prête à publier',
    text: 'Une fiche relue sans aucun blocage : ses commentaires sont traités et, si elle est sensible, son feu vert santé est à jour.',
  },
];

/**
 * Feuille du bas « Comment relire » (spec brique 2 §4.4) : les cinq mots de la relecture et leur phrase. Ouverte
 * au premier passage sur la relecture (`HowToReviewFirstPass`) et depuis Aide ; sur ordinateur, la même fenêtre
 * se pose au centre.
 */
export function HowToReview(p: { open: boolean; onClose(): void }) {
  return (
    <BottomSheet open={p.open} onClose={p.onClose} title="Comment relire">
      <p className={styles.intro}>Cinq mots reviennent dans la relecture.</p>
      <dl className={styles.terms}>
        {HOW_TO_REVIEW_TERMS.map(({ term, text }) => (
          <Fragment key={term}>
            <dt>{term}</dt>
            <dd>{text}</dd>
          </Fragment>
        ))}
      </dl>
    </BottomSheet>
  );
}

/**
 * « Comment relire » au premier passage sur la relecture, une fois par compte : marqué vu dès l'ouverture (la
 * feuille reste ouverte jusqu'à ce qu'on la ferme). Monté par `App` sur toutes les pages /review….
 */
export function HowToReviewFirstPass() {
  const repos = useRepos();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void repos.review
      .introSeen()
      .then(async (seen) => {
        if (!live || seen) return;
        setOpen(true);
        await repos.review.markIntroSeen();
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [repos]);
  return <HowToReview open={open} onClose={() => setOpen(false)} />;
}
