import { Link } from 'wouter';
import { useRecommendationNotice, useRepos } from '../../repos';
import { Banner, Button } from '../../ui';
import { BETTER_PROGRAM } from '../recommendation/recommendation-labels';
import styles from './profile.module.css';

/**
 * R-REC-7 (spec brique 3 §7.8) : quand le modèle recommandé n'est plus celui suivi (un champ du profil a changé), un
 * bandeau propose « Un autre programme te correspond mieux » vers `/program/choose`, sans rien changer seul.
 * « Masquer » le range pour ce modèle sur l'appareil ; un autre modèle recommandé plus tard le rouvre.
 */
export function RecommendationBanner() {
  const repos = useRepos();
  const templateId = useRecommendationNotice();
  if (!templateId) return null;
  return (
    <Banner tone="info">
      <div className={styles.betterProgram}>
        <Link href="/program/choose">{BETTER_PROGRAM}</Link>
        <Button
          variant="ghost"
          onClick={() => void repos.program.acknowledgeRecommendation(templateId).catch(() => {})}
        >
          Masquer
        </Button>
      </div>
    </Banner>
  );
}
