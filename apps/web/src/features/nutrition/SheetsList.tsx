import { Link } from 'wouter';
import styles from './nutrition.module.css';
import { NUTRITION_TEXTS } from './nutrition-texts';

/** Une fiche telle que la liste la montre : de quoi la nommer et l'ouvrir. */
export interface SheetEntry {
  id: string;
  title: string;
}

/** Fiches visibles dans le mode de l'appareil (réseau, puis dernière copie), chacune vers sa lecture. `null` : pas encore lues. */
export function SheetsList(p: { sheets: readonly SheetEntry[] | null }) {
  if (p.sheets === null) return null;
  if (p.sheets.length === 0) return <p className={styles.muted}>{NUTRITION_TEXTS.qualitative.noSheets}</p>;
  return (
    <ul className={styles.sheetLinks}>
      {p.sheets.map((sheet) => (
        <li key={sheet.id}>
          <Link href={`/nutrition/sheets/${sheet.id}`} className={styles.textLink}>
            {sheet.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}
