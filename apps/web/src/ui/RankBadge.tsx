import { lazy, Suspense } from 'react';
import type { Rank } from './art/art-types';
import { RankStoneE } from './art/RankStoneE';
import styles from './art.module.css';
import { useArtId } from './use-art-id';

/**
 * Pierres D à S : aucun rang au-dessus de E n'est encore atteint au socle, leurs dessins restent hors du bundle
 * initial et se chargent au premier affichage de l'un d'eux (fichier précaché par le SW, hors ligne compris).
 */
const RankStoneUpper = lazy(() =>
  import('./art/RankStoneUpper').then((m) => ({ default: m.RankStoneUpper })),
);

/**
 * Rang en pierre runique (spec refonte §9), lu « Rang E ». `mini` : la version dessinée pour 24–32 px.
 * `locked` : rang pas encore atteint, toujours visible et nommé, mais atténué. Le rang E est dessiné dès le
 * premier rendu ; un rang D à S montre, le temps du chargement, une image vide de même nom et de même taille.
 */
export function RankBadge({
  rank,
  size,
  mini = false,
  locked = false,
}: {
  rank: Rank;
  size: number;
  mini?: boolean;
  locked?: boolean;
}) {
  const idPrefix = useArtId(`rank-${rank}`);
  const label = `Rang ${rank}`;
  const className = [styles.art, locked ? styles.locked : null].filter(Boolean).join(' ');
  const svg = {
    role: 'img',
    'aria-label': label,
    width: size,
    height: size,
    className,
    'data-locked': locked,
  };
  if (rank === 'E') return <RankStoneE mini={mini} idPrefix={idPrefix} {...svg} />;
  return (
    <Suspense
      fallback={
        <svg
          role="img"
          aria-label={label}
          width={size}
          height={size}
          className={className}
          data-locked={locked}
        />
      }
    >
      <RankStoneUpper rank={rank} mini={mini} idPrefix={idPrefix} {...svg} />
    </Suspense>
  );
}
