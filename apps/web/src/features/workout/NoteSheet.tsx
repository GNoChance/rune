import { currentRules } from '@rune/domain';
import { useState } from 'react';
import { WorkoutError } from '../../repos';
import { BottomSheet, Button, Field } from '../../ui';
import styles from './live.module.css';

/** Rappel sous chaque note (spec brique 3 §9, 06 §5). */
export const NOTE_REMINDER = "N'écris pas d'informations sur ton identité ni sur ta santé.";

const NOT_SAVED = "La note n'a pas été enregistrée.";

/**
 * Note de séance ou d'exercice (spec brique 3 §9) : 500 caractères au plus, avec le rappel. Une note trop longue est
 * refusée avant toute écriture, le message sous le champ ; un texte vide efface la note.
 */
export function NoteSheet(p: {
  title: string;
  initial: string | null;
  onSave(text: string): Promise<void>;
  onClose(): void;
}) {
  const max = currentRules().noteMaxLength;
  const [text, setText] = useState(p.initial ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const tooLong = `${max} caractères au plus.`;

  const save = async () => {
    if (text.trim().length > max) {
      setError(tooLong);
      return;
    }
    setPending(true);
    try {
      await p.onSave(text);
      p.onClose();
    } catch (e) {
      setError(e instanceof WorkoutError && e.code === 'note_too_long' ? tooLong : NOT_SAVED);
    } finally {
      setPending(false);
    }
  };

  return (
    <BottomSheet
      open
      title={p.title}
      onClose={p.onClose}
      actions={
        <>
          <Button block disabled={pending} onClick={() => void save()}>
            Enregistrer
          </Button>
          <Button variant="secondary" block onClick={p.onClose}>
            Annuler
          </Button>
        </>
      }
    >
      <Field label={p.title} help={NOTE_REMINDER} error={error}>
        <textarea
          className={styles.noteInput}
          rows={4}
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setError(null);
          }}
        />
      </Field>
      <p className={styles.counter} data-over={text.trim().length > max ? '' : undefined}>
        {`${text.trim().length} / ${max}`}
      </p>
    </BottomSheet>
  );
}
