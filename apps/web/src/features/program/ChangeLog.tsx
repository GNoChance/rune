import type { InstanceChangeView } from '@rune/contracts';
import { useId } from 'react';
import { Badge, formatDate } from '../../ui';
import styles from './program.module.css';
import { AUTHOR_LABELS, changeSummary, type ProgramNames, STATUS_LABELS } from './program-labels';

const STATUS_TONES = {
  proposed: 'warning',
  accepted: 'success',
  rejected: 'muted',
  expired: 'muted',
} as const;

/**
 * Journal des changements (spec §7.7), du plus récent au plus ancien : date, auteur (« Toi », « Rune », « Coach
 * IA »), résumé et statut. Rien à montrer : pas de section.
 */
export function ChangeLog(p: { changes: readonly InstanceChangeView[]; names: ProgramNames }) {
  const titleId = useId();
  if (p.changes.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className={styles.section}>
      <h2 id={titleId} className={styles.sectionTitle}>
        Journal
      </h2>
      <ol className={styles.log}>
        {p.changes.map((c) => (
          <li key={c.id} className={styles.logItem}>
            <p className={styles.muted}>{`${formatDate(c.createdAt)} · ${AUTHOR_LABELS[c.author]}`}</p>
            <p>{changeSummary(c.operations, p.names)}</p>
            <Badge tone={STATUS_TONES[c.status]}>{STATUS_LABELS[c.status]}</Badge>
          </li>
        ))}
      </ol>
    </section>
  );
}
