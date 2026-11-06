import { HELP_RESOURCES, helpPhones } from '@rune/contracts';
import { useId } from 'react';
import { Link } from 'wouter';
import { HealthWarning } from '../../ui';
import { ExternalLink, Glyph } from '../public/ExternalLink';
import styles from './nutrition.module.css';
import { NUTRITION_TEXTS } from './nutrition-texts';

const PHONE_PATH = (
  <path d="M5 4h3.5l2 5-2.5 1.5a11 11 0 0 0 5.5 5.5l1.5-2.5 5 2V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
);

/**
 * La ligne d'écoute des troubles du comportement alimentaire (07 §5.11) : libellé, lien d'appel `tel:` et lien vers
 * le site de l'association. Le numéro vient de `HELP_RESOURCES`, seule source ; des horaires n'y sont affichés
 * que lorsqu'ils sont vérifiés (`hours` non nul).
 */
export function TcaLine() {
  const resource = HELP_RESOURCES.find((r) => r.id === 'eating_disorder');
  if (!resource) return null;
  return (
    <div className={styles.tca}>
      <p className={styles.tcaLabel}>{resource.label}</p>
      <div className={styles.tcaActions}>
        {helpPhones(resource).map((p) => (
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
        {resource.sourceUrl ? (
          <ExternalLink href={resource.sourceUrl}>{NUTRITION_TEXTS.help.source}</ExternalLink>
        ) : null}
      </div>
      {resource.hours ? <p className={styles.muted}>{`Horaires : ${resource.hours}`}</p> : null}
    </div>
  );
}

/**
 * Pied du module, dans tous les modes (spec brique 5 §12.2) : « Besoin d'en parler ? », la ligne TCA, le lien vers
 * `/help/nutrition` et l'avertissement santé du socle.
 */
export function NutritionFooter() {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.footer}>
      <h2 id={titleId} className={styles.footerTitle}>
        {NUTRITION_TEXTS.footer.title}
      </h2>
      <p className={styles.muted}>{NUTRITION_TEXTS.footer.lead}</p>
      <TcaLine />
      <Link href="/help/nutrition" className={styles.textLink}>
        {NUTRITION_TEXTS.footer.helpLink}
      </Link>
      <HealthWarning />
    </section>
  );
}
