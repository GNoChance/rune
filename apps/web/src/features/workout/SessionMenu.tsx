import { useEffect, useState } from 'react';
import { useLive } from '../../app-services';
import { useRepos, type WorkoutSessionView } from '../../repos';
import { Banner, BottomSheet, Button, CheckGlyph, Dialog } from '../../ui';
import styles from './live.module.css';
import { NoteSheet } from './NoteSheet';

const PLACE_FAILED = 'Impossible de changer de lieu pour le moment.';

function DotsIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

/** Bouton « ⋯ » de 48 px, nommé par `label`. */
export function MenuButton(p: { label: string; onClick(): void; menuFor?: string }) {
  return (
    <button
      type="button"
      className={styles.menuButton}
      aria-label={p.label}
      data-menu-for={p.menuFor}
      onClick={p.onClick}
    >
      <DotsIcon />
    </button>
  );
}

/**
 * Feuille ouverte depuis un menu « ⋯ » : elle attend que le menu soit fermé et que le focus soit revenu à son bouton
 * « ⋯ » (déclencheur du menu). Ce bouton devient ainsi celui de la seconde feuille, qui lui rend le focus à sa
 * fermeture, au lieu de l'élément du menu, démonté avec lui. Rend [feuille ouverte, ouvrir après le menu, fermer].
 */
export function useSheetAfterMenu<T>(menuOpen: boolean): [T | null, (next: T) => void, () => void] {
  const [sheet, setSheet] = useState<T | null>(null);
  const [queued, setQueued] = useState<T | null>(null);
  useEffect(() => {
    if (menuOpen || queued === null) return;
    setSheet(queued);
    setQueued(null);
  }, [menuOpen, queued]);
  return [sheet, setQueued, () => setSheet(null)];
}

/**
 * Menu « ⋯ » de la séance (spec brique 3 §7.3) : Note de séance ; Changer de lieu tant qu'aucune série n'est faite (le
 * plan est refait au lieu choisi, D2) ; Supprimer la séance, après confirmation (R-SYN-6). Tout se fait hors ligne.
 */
export function SessionMenu(p: {
  session: WorkoutSessionView;
  title: string;
  /** Une série est faite : le plan ne se refait plus. */
  anyDone: boolean;
  /** Action qui quitte l'écran : rend l'adresse où aller. */
  onLeave(action: () => Promise<string>): void;
}) {
  const repos = useRepos();
  const [open, setOpen] = useState(false);
  const [sub, openAfterMenu, closeSub] = useSheetAfterMenu<'note' | 'place' | 'delete'>(open);
  const pick = (next: 'note' | 'place' | 'delete') => {
    setOpen(false);
    openAfterMenu(next);
  };
  const { id } = p.session;
  const remove = () =>
    p.onLeave(async () => {
      await repos.workouts.remove(id);
      return '/workout';
    });

  return (
    <>
      <MenuButton label="Options de la séance" onClick={() => setOpen(true)} />
      <BottomSheet open={open} title={p.title} onClose={() => setOpen(false)}>
        <ul className={styles.menuList}>
          <li>
            <button type="button" className={styles.menuItem} onClick={() => pick('note')}>
              Note de séance
            </button>
          </li>
          {p.anyDone ? null : (
            <li>
              <button type="button" className={styles.menuItem} onClick={() => pick('place')}>
                Changer de lieu
              </button>
            </li>
          )}
          <li>
            <button
              type="button"
              className={styles.menuItem}
              data-tone="danger"
              onClick={() => pick('delete')}
            >
              Supprimer la séance
            </button>
          </li>
        </ul>
      </BottomSheet>
      {sub === 'note' ? (
        <NoteSheet
          title="Note de séance"
          initial={p.session.note}
          onSave={(text) => repos.workouts.setNote({ kind: 'session', id }, text)}
          onClose={closeSub}
        />
      ) : null}
      {sub === 'place' ? <PlaceSheet session={p.session} onClose={closeSub} /> : null}
      <Dialog
        open={sub === 'delete'}
        title="Supprimer cette séance ?"
        onClose={closeSub}
        actions={
          <>
            <Button variant="danger" block onClick={remove}>
              Supprimer
            </Button>
            <Button variant="secondary" block onClick={closeSub}>
              Annuler
            </Button>
          </>
        }
      >
        <p>La séance et ses séries seront supprimées.</p>
      </Dialog>
    </>
  );
}

/**
 * « Changer de lieu » : les lieux du membre, l'actuel marqué. Une séance de programme est refaite au lieu choisi
 * (`plannedWorkout` de la même séance du modèle) ; une séance libre ne change que de lieu.
 */
function PlaceSheet(p: { session: WorkoutSessionView; onClose(): void }) {
  const repos = useRepos();
  const places = useLive(() => repos.places.list(), [repos]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { session } = p;

  const choose = async (placeId: string) => {
    setPending(true);
    setError(null);
    try {
      let plan = null;
      if (session.instanceId !== null && session.workoutId !== null) {
        const planned = await repos.programView.plannedWorkout(placeId, session.workoutId);
        if (planned === null) throw new Error('plan');
        plan = planned.plan;
      }
      await repos.workouts.changePlace(session.id, plan, placeId);
      p.onClose();
    } catch {
      setError(PLACE_FAILED);
      setPending(false);
    }
  };

  return (
    <BottomSheet open title="Changer de lieu" onClose={p.onClose}>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <ul className={styles.menuList}>
        {(places ?? []).map((place) => {
          const current = place.id === session.placeId;
          return (
            <li key={place.id}>
              <button
                type="button"
                className={styles.menuItem}
                aria-current={current ? 'true' : undefined}
                disabled={pending || current}
                onClick={() => void choose(place.id)}
              >
                <span>{place.name}</span>
                {current ? <CheckGlyph /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
