import { BottomSheet, Button } from '../../ui';
import styles from './live.module.css';

/**
 * Avant « Terminer » (spec brique 3 §7.3) : les exercices dont aucune série de travail faite n'a d'effort noté. Sans
 * effort, le moteur ne monte pas la charge (05 §7) ; « Noter maintenant » ouvre l'effort du premier, « Terminer quand
 * même » termine.
 */
export function FinishSheet(p: {
  open: boolean;
  exercises: readonly { id: string; name: string }[];
  onRate(): void;
  onFinish(): void;
  onClose(): void;
}) {
  return (
    <BottomSheet
      open={p.open}
      title="Avant de terminer"
      onClose={p.onClose}
      actions={
        <>
          <Button block onClick={p.onRate}>
            Noter maintenant
          </Button>
          <Button variant="secondary" block onClick={p.onFinish}>
            Terminer quand même
          </Button>
        </>
      }
    >
      <p className={styles.sheetDetail}>Effort non noté : la charge n'augmentera pas</p>
      <ul className={styles.finishList}>
        {p.exercises.map((e) => (
          <li key={e.id}>{e.name}</li>
        ))}
      </ul>
    </BottomSheet>
  );
}
