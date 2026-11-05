import { type FormEvent, useCallback, useId, useRef, useState } from 'react';
import { Banner, Button, Dialog, Field, useAction } from '../../ui';
import { useRestoreFocus } from '../admin/admin-ui';
import { ExportButton } from '../privacy/ExportButton';
import { passwordActionError } from '../privacy/messages';
import styles from './coach-account.module.css';
import { useCoachStore } from './coach-store';
import { MY_COACH_TEXTS } from './coach-texts';

type SheetProps = { open: boolean; onClose(): void };

/**
 * Désactivation du coach IA (spec brique 4 §14.2) : ce qui sera supprimé, ce qui reste, l'export proposé d'abord,
 * puis le mot de passe ressaisi (P-AUT-5) et le retrait de l'accord. Réussi, le magasin du coach est vidé (rien du
 * fil ne reste en mémoire) et la feuille se ferme. Fermée, rien n'est monté : chaque ouverture repart vide.
 */
export function DeactivateSheet(p: SheetProps) {
  return p.open ? <OpenDeactivateSheet {...p} /> : null;
}

function OpenDeactivateSheet(p: SheetProps) {
  const { store } = useCoachStore();
  const formId = useId();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const latest = useRef(p);
  latest.current = p;
  useRestoreFocus();

  // Référence stable : la feuille ne reprend pas le focus à chaque rendu. Ni « Annuler » ni Échap pendant l'envoi.
  const close = useCallback(() => {
    if (!busy.current) latest.current.onClose();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current || password === '') return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await store.withdraw(password);
      busy.current = false;
      latest.current.onClose();
    } catch (err) {
      setError(passwordActionError(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      inertOutside
      title={MY_COACH_TEXTS.deactivate}
      onClose={close}
      actions={
        <>
          <Button variant="secondary" onClick={close} disabled={pending}>
            {MY_COACH_TEXTS.cancel}
          </Button>
          <Button type="submit" form={formId} variant="danger" disabled={pending || password === ''}>
            {MY_COACH_TEXTS.deactivate}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} noValidate onSubmit={(e) => void submit(e)}>
        <p>{MY_COACH_TEXTS.deactivateIntro}</p>
        <ul className={styles.items}>
          {MY_COACH_TEXTS.deactivateItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>{MY_COACH_TEXTS.deactivateKept}</p>
        <p>{MY_COACH_TEXTS.deactivateAnthropic}</p>
        <ExportButton label={MY_COACH_TEXTS.deactivateExport} />
        <Field label="Mot de passe">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error ? <Banner tone="error">{error}</Banner> : null}
      </form>
    </Dialog>
  );
}

type ConfirmProps = {
  open: boolean;
  title: string;
  body: string;
  /** Appelée à la confirmation ; une erreur reste dans la feuille, qui ne se ferme pas. */
  onConfirm(): Promise<void>;
  onClose(): void;
};

/**
 * Confirmation d'une suppression de conversations (spec §14.2) : sans mot de passe. Fermée, rien n'est monté.
 * Pendant l'envoi, ni « Annuler » ni Échap ne ferment.
 */
export function ConfirmDeleteSheet(p: ConfirmProps) {
  return p.open ? <OpenConfirmDeleteSheet {...p} /> : null;
}

function OpenConfirmDeleteSheet(p: ConfirmProps) {
  const run = useAction(async () => {
    await p.onConfirm();
    return true;
  });
  useRestoreFocus();
  const close = () => {
    if (!run.pending) p.onClose();
  };
  async function confirm() {
    if (await run.run()) p.onClose();
  }
  return (
    <Dialog
      open
      inertOutside
      title={p.title}
      onClose={close}
      actions={
        <>
          <Button variant="secondary" onClick={close} disabled={run.pending}>
            {MY_COACH_TEXTS.cancel}
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={run.pending}>
            {MY_COACH_TEXTS.delete}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p>{p.body}</p>
        {run.error ? <Banner tone="error">{run.error}</Banner> : null}
      </div>
    </Dialog>
  );
}
