import { useCallback } from 'react';
import { useLocation } from 'wouter';
import { isLostAccess, useRepos } from '../../repos';

/** Message du Profil quand la relecture a été refusée en pleine session (spec brique 2, Review Focus 4). */
export const REVIEW_ACCESS_LOST_MESSAGE = "Tu n'as plus accès à la relecture.";

/** Raison passée au Profil : `/profile?reason=review_access_lost`. */
export const REVIEW_ACCESS_LOST_REASON = 'review_access_lost';

/**
 * Réponse des écrans de relecture à un refus du dépôt : accès perdu (drapeau retiré, admin rétrogradé) → retour
 * au Profil, qui affiche « Tu n'as plus accès à la relecture. », en remplaçant l'adresse (Retour ne ramène pas à
 * la relecture), puis profil relu : la ligne du Profil, la carte d'accueil et la garde de /review… suivent. On
 * quitte la relecture avant de relire le profil, pour que la garde n'affiche pas entre-temps une page introuvable ;
 * rien ne renvoie ensuite vers /review, d'où aucune boucle. Rend vrai si l'erreur était une perte d'accès.
 */
export function useOnLostAccess(): (error: unknown) => boolean {
  const [, navigate] = useLocation();
  const repos = useRepos();
  return useCallback(
    (error: unknown) => {
      if (!isLostAccess(error)) return false;
      navigate(`/profile?reason=${REVIEW_ACCESS_LOST_REASON}`, { replace: true });
      void repos.me.refresh().catch(() => null);
      return true;
    },
    [navigate, repos],
  );
}
