import type { ProgramTemplate } from '@rune/contracts';
import { type ReactNode, useId } from 'react';
import { Badge } from '../../ui';
import styles from './recommendation.module.css';
import {
  CURRENT_PROGRAM_LABEL,
  RECOMMENDED_LABEL,
  templateFacts,
  UNAVAILABLE_LABEL,
} from './recommendation-labels';

/**
 * Carte d'un modèle de programme (spec brique 3 §7.8) : nom, description, jours et durée estimée ; « Recommandé pour
 * toi » et ses raisons en phrases ; « Ton programme actuel » ; un modèle indisponible est grisé avec « Pas encore
 * disponible » (le texte le dit, pas la seule couleur). Un `<article>` nommé par son titre ; `children` : ses actions.
 */
export function TemplateCard(p: {
  template: Pick<ProgramTemplate, 'name' | 'description' | 'daysPerWeek' | 'estimatedMinutes'>;
  headingLevel: 2 | 3 | 4;
  recommended?: boolean;
  reasons?: readonly string[];
  current?: boolean;
  available?: boolean;
  children?: ReactNode;
}) {
  const titleId = useId();
  const Heading = `h${p.headingLevel}` as const;
  const unavailable = p.available === false;
  return (
    <article
      aria-labelledby={titleId}
      data-unavailable={unavailable ? 'true' : undefined}
      data-recommended={p.recommended ? 'true' : undefined}
      className={styles.card}
    >
      {p.recommended || p.current || unavailable ? (
        <div className={styles.badges}>
          {p.recommended ? <Badge tone="accent">{RECOMMENDED_LABEL}</Badge> : null}
          {p.current ? <Badge tone="success">{CURRENT_PROGRAM_LABEL}</Badge> : null}
          {unavailable ? <Badge tone="muted">{UNAVAILABLE_LABEL}</Badge> : null}
        </div>
      ) : null}
      <Heading id={titleId} className={styles.name}>
        {p.template.name}
      </Heading>
      <p className={styles.facts}>{templateFacts(p.template)}</p>
      <p className={styles.description}>{p.template.description}</p>
      {p.reasons && p.reasons.length > 0 ? (
        <ul className={styles.reasons}>
          {p.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {p.children}
    </article>
  );
}
