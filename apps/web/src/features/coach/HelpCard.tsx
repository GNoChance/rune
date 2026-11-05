import { HELP_RESOURCES, type HelpResourceId, helpPhones } from '@rune/contracts';
import { useId } from 'react';
import { Link } from 'wouter';
import styles from './coach-page.module.css';
import { callText, HELP_NOTES, HELP_OPEN, PARENT_LINE } from './coach-texts';

/**
 * Carte d'aide du fil (spec brique 4 §16.4) : la ressource de `HELP_RESOURCES` (le coach n'écrit jamais un numéro),
 * un lien `tel:` par numéro, les horaires s'il y en a, « Ouvrir l'aide » (`/help`) et, pour un mineur, la ligne qui
 * renvoie à un adulte (C39). Ni lien externe ni Markdown (C29).
 */
export function HelpCard(p: { resource: HelpResourceId; minor: boolean }) {
  const titleId = useId();
  const resource = HELP_RESOURCES.find((r) => r.id === p.resource);
  if (resource === undefined) return null;
  const note = p.resource === 'eating_disorder' ? HELP_NOTES.eating_disorder : null;
  return (
    <section aria-labelledby={titleId} className={styles.helpCard}>
      <h3 id={titleId} className={styles.cardHeading}>
        {resource.label}
      </h3>
      {resource.hours === null ? null : <p className={styles.cardText}>{resource.hours}</p>}
      {note === null ? null : <p className={styles.cardText}>{note}</p>}
      {p.minor ? <p className={styles.cardText}>{PARENT_LINE}</p> : null}
      <div className={styles.cardActions}>
        {helpPhones(resource).map((phone) => (
          <a key={phone.digits} href={`tel:${phone.digits}`} className={styles.action}>
            {callText(phone.label)}
          </a>
        ))}
        <Link href="/help" className={styles.action}>
          {HELP_OPEN}
        </Link>
      </div>
    </section>
  );
}
