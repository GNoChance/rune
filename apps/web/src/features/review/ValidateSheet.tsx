import type { ReviewListItem } from '@rune/contracts';
import { useCallback, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { revisionConflictOf, useRepos } from '../../repos';
import { Banner, BottomSheet, Button, errorMessage } from '../../ui';
import styles from './review.module.css';
import {
  type AdminFilters,
  inFilter,
  type ListFilter,
  NO_ADMIN_FILTERS,
  reviewListPath,
  reviewSheetPath,
} from './review-labels';
import { useOnLostAccess } from './use-lost-access';

/** « Ta file est vide. Merci ! » (spec brique 2 §4.5) : plus aucune fiche dans le filtre actif. */
export const EMPTY_QUEUE = 'Ta file est vide. Merci !';

/**
 * Fiche suivante dans le filtre actif (et ceux de l'admin) : la première qui passe les filtres après la fiche
 * courante dans l'ordre de la liste (nom, puis id), en repartant du début ; la fiche courante n'en est jamais une.
 * `null` : file vide.
 */
export function nextInFilter(
  items: readonly ReviewListItem[],
  currentId: string,
  filter: ListFilter,
  adminFilters: AdminFilters = NO_ADMIN_FILTERS,
): ReviewListItem | null {
  const index = items.findIndex((i) => i.id === currentId);
  const ordered = index < 0 ? items : [...items.slice(index + 1), ...items.slice(0, index)];
  return ordered.find((i) => i.id !== currentId && inFilter(i, filter, adminFilters)) ?? null;
}

type Phase =
  | { kind: 'confirm' }
  /** `next` : fiche suivante, `null` (file vide) ou `undefined` (liste illisible). */
  | { kind: 'done'; next: ReviewListItem | null | undefined };

/**
 * Feuille du bas de validation (spec brique 2 §3.4 et §4.5) :
 * - confirmation qui rappelle la version validée (« Valider la version N ») et ce qu'elle engage ; la relectrice
 *   santé lit que c'est son feu vert santé ;
 * - envoi avec la révision affichée ; un 409 `revision_conflict` (fiche changée depuis l'ouverture) ferme la feuille
 *   et laisse l'écran relire la fiche (`onConflict`) : on ne valide que ce qu'on a vu ;
 * - ensuite « Version N validée », la liste relue et « Fiche suivante » selon le filtre actif, ou « Ta file est
 *   vide. Merci ! » et « Retour à la liste » ; « Fermer » reste sur la fiche (l'écran la relit).
 */
export function ValidateSheet(p: {
  sheet: { id: string; name: string; revision: number };
  /** Libellé du bouton qui ouvre la feuille : « J'ai relu, rien à redire », « Sécurité vérifiée », « J'ai relu ». */
  label: string;
  health: boolean;
  filter: ListFilter;
  /** Filtres de la liste réservés à l'admin, gardés pour « Fiche suivante » et le retour à la liste. */
  adminFilters?: AdminFilters;
  onClose(validated: boolean): void;
  onConflict(): void;
}) {
  const repos = useRepos();
  const onLostAccess = useOnLostAccess();
  const [, navigate] = useLocation();
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const { sheet } = p;
  const done = phase.kind === 'done';
  const { onClose } = p;
  const close = useCallback(() => {
    if (!sending.current) onClose(done);
  }, [onClose, done]);

  async function validate() {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      await repos.review.validate(sheet.id, { baseRevision: sheet.revision });
    } catch (e) {
      sending.current = false;
      setPending(false);
      if (onLostAccess(e)) return;
      if (revisionConflictOf(e)) {
        p.onConflict();
        return;
      }
      setError(errorMessage(e));
      return;
    }
    let next: ReviewListItem | null | undefined;
    try {
      next = nextInFilter((await repos.review.list()).items, sheet.id, p.filter, p.adminFilters);
    } catch (e) {
      if (onLostAccess(e)) return;
      next = undefined;
    }
    sending.current = false;
    setPending(false);
    setPhase({ kind: 'done', next });
  }

  if (phase.kind === 'done') {
    const { next } = phase;
    return (
      <BottomSheet
        open
        title={`Version ${sheet.revision} validée`}
        onClose={close}
        actions={
          <>
            {next ? (
              <Button onClick={() => navigate(reviewSheetPath(next.id, p.filter, p.adminFilters))}>
                Fiche suivante
              </Button>
            ) : (
              <Button onClick={() => navigate(reviewListPath(p.filter, p.adminFilters))}>
                Retour à la liste
              </Button>
            )}
            <Button variant="secondary" onClick={close}>
              Fermer
            </Button>
          </>
        }
      >
        {next ? (
          <p className={styles.sheetText}>{`Fiche suivante : « ${next.name} ».`}</p>
        ) : next === null ? (
          <p className={styles.sheetText}>{EMPTY_QUEUE}</p>
        ) : (
          <p className={styles.sheetText}>Merci !</p>
        )}
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      open
      title={`Valider la version ${sheet.revision}`}
      onClose={close}
      actions={
        <>
          <Button onClick={() => void validate()} disabled={pending}>
            {`Valider la version ${sheet.revision}`}
          </Button>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Annuler
          </Button>
        </>
      }
    >
      <div className={styles.sheetStack}>
        <p className={styles.sheetText}>
          {`« ${p.label} » porte sur la version ${sheet.revision} de « ${sheet.name} ».`}
        </p>
        <p className={styles.sheetText}>
          {p.health
            ? "C'est ton feu vert santé : si la fiche change ensuite, il faudra le redonner."
            : 'Si la fiche change ensuite, il faudra la relire.'}
        </p>
        {error ? <Banner tone="error">{error}</Banner> : null}
      </div>
    </BottomSheet>
  );
}
