import {
  EXERCISES_EXPORT_FILE,
  MOVEMENT_PATTERN_LABELS,
  type MovementPattern,
  type ReviewListItem,
  type ReviewListResponse,
} from '@rune/contracts';
import { useId, useRef, useState } from 'react';
import { useRepos } from '../../repos';
import { Banner, Button, downloadJson, errorMessage, Field, plural, Switch } from '../../ui';
import styles from './review.module.css';
import type { AdminFilters } from './review-labels';
import { useOnLostAccess } from './use-lost-access';

const collator = new Intl.Collator('fr', { sensitivity: 'base' });

/** Types de mouvement des fiches de la liste (et celui du filtre en cours), par libellé. */
function patternsOf(items: readonly ReviewListItem[], current: MovementPattern | null): MovementPattern[] {
  const present = new Set<MovementPattern>(items.map((item) => item.movementPattern));
  if (current) present.add(current);
  return [...present].sort((a, b) =>
    collator.compare(MOVEMENT_PATTERN_LABELS[a], MOVEMENT_PATTERN_LABELS[b]),
  );
}

/**
 * Outils de l'admin sous les filtres de la liste (spec brique 2 §4.5, 04 §8 étape 4 et §10, §12 règle 3) :
 * - filtres « Type de mouvement » et « Sans illustration », cumulés avec la file ;
 * - « N fiches à exporter » (révision pas encore exportée) et « N fichiers à remplacer avant publication »
 *   (illustrations du manifeste marquées \`replace_before_public\`) ;
 * - « Exporter le catalogue » : le fichier \`exercises-export.json\` tel que rendu par le serveur (JSON réindenté par
 *   \`downloadJson\`, relu tel quel par \`pnpm data:pull\`), puis la liste relue (compteur « à exporter » à jour).
 */
export function AdminListTools(p: {
  admin: NonNullable<ReviewListResponse['admin']>;
  items: readonly ReviewListItem[];
  filters: AdminFilters;
  onFilters(next: AdminFilters): void;
  reload(): Promise<void>;
}) {
  const repos = useRepos();
  const onLostAccess = useOnLostAccess();
  const titleId = useId();
  const switchId = useId();
  const [pending, setPending] = useState(false);
  const [exported, setExported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const { toExport, replaceBeforePublic } = p.admin;

  async function exportCatalog() {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setExported(false);
    setError(null);
    try {
      downloadJson(EXERCISES_EXPORT_FILE, await repos.review.exportCatalog());
      setExported(true);
      await p.reload();
    } catch (e) {
      if (onLostAccess(e)) return;
      setError(errorMessage(e));
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={titleId} className={styles.card}>
      <h2 id={titleId} className={styles.sectionTitle}>
        Administration
      </h2>
      <Field label="Type de mouvement">
        <select
          value={p.filters.pattern ?? ''}
          onChange={(e) =>
            p.onFilters({ ...p.filters, pattern: (e.target.value || null) as MovementPattern | null })
          }
        >
          <option value="">Tous les types</option>
          {patternsOf(p.items, p.filters.pattern).map((pattern) => (
            <option key={pattern} value={pattern}>
              {MOVEMENT_PATTERN_LABELS[pattern]}
            </option>
          ))}
        </select>
      </Field>
      <Switch
        id={switchId}
        label="Sans illustration"
        checked={p.filters.withoutIllustration}
        onChange={(withoutIllustration) => p.onFilters({ ...p.filters, withoutIllustration })}
      />
      <p className={styles.adminCount}>
        {`${toExport} ${plural(toExport, 'fiche à exporter', 'fiches à exporter')}`}
      </p>
      <p className={styles.adminCount}>
        {`${replaceBeforePublic} ${plural(
          replaceBeforePublic,
          'fichier à remplacer avant publication',
          'fichiers à remplacer avant publication',
        )}`}
      </p>
      <Button variant="secondary" onClick={() => void exportCatalog()} disabled={pending}>
        Exporter le catalogue
      </Button>
      {exported ? <Banner tone="info">{`Catalogue exporté : ${EXERCISES_EXPORT_FILE}.`}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
    </section>
  );
}
