import { type IllustrationEntry, MUSCLE_LABELS, type ServedSheet } from '@rune/contracts';
import { feasible } from '@rune/domain';
import { useId, useState } from 'react';
import { Link } from 'wouter';
import { type CatalogPlace, sheetIllustrations } from '../../repos';
import { Badge } from '../../ui';
import { equipmentText, levelText, shownEquipmentOption } from './exercise-labels';
import { BACK_IN_HISTORY } from './exercise-nav';
import styles from './exercises.module.css';
import { LevelBars } from './SheetContent';

/*
 * Lignes d'exercices de l'onglet Exercices (spec brique 2 §4.1), communes à la liste d'un groupe et aux résultats
 * de recherche : vignette, nom, muscles principaux, matériel, mention « Pas faisable : <lieu> » filtre coupé, et
 * niveau en 3 barres avec « Niveau 1 sur 3, débutant » pour les lecteurs d'écran.
 */

/** Ids d'illustration des vignettes de `sheets` (position de départ, sinon la première pose) : à lire en local. */
export function thumbnailIds(sheets: readonly ServedSheet[]): string[] {
  return sheets.flatMap((sheet) => {
    const first = sheetIllustrations(sheet.illustrations, new Map())[0];
    return first ? [first.illustration_id] : [];
  });
}

/** Pictogramme neutre d'un exercice sans vignette (haltère), décoratif : le nom de la ligne suffit. */
function Pictogram() {
  return (
    <svg
      data-pictogram=""
      aria-hidden="true"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12" />
    </svg>
  );
}

/**
 * Vignette (spec brique 2 §4.1) : la position de départ sur sa carte claire, en texte alternatif vide (le nom de
 * la ligne la nomme) ; sans illustration, entrée absente en local, ou image qui ne charge pas : le pictogramme.
 */
function Thumbnail(p: { sheet: ServedSheet; entries: ReadonlyMap<string, IllustrationEntry> }) {
  const [failed, setFailed] = useState(false);
  const first = sheetIllustrations(p.sheet.illustrations, p.entries)[0];
  const entry = first?.entry ?? null;
  return (
    <span className={styles.thumbnail} data-illustrated={entry && !failed ? '' : undefined}>
      {entry && !failed ? (
        <img
          src={`/illustrations/${entry.file}`}
          alt=""
          decoding="async"
          className={styles.thumbnailImage}
          onError={() => setFailed(true)}
        />
      ) : (
        <Pictogram />
      )}
    </span>
  );
}

function ExerciseRow(p: {
  sheet: ServedSheet;
  entries: ReadonlyMap<string, IllustrationEntry>;
  place: CatalogPlace | null;
  feasibleOnly: boolean;
  onOpen(): void;
}) {
  const id = useId();
  const nameId = `${id}-name`;
  const detailsId = `${id}-details`;
  const { sheet, place } = p;
  const option = shownEquipmentOption(sheet.equipment_options, place?.equipment ?? null);
  // Filtre coupé (ou sans effet) : une fiche infaisable au lieu principal le dit par écrit.
  const notFeasible = place !== null && !p.feasibleOnly && !feasible(sheet, place.equipment);
  return (
    <li className={styles.exerciseItem}>
      <Link
        href={`/exercises/${sheet.id}`}
        state={BACK_IN_HISTORY}
        onClick={p.onOpen}
        aria-labelledby={nameId}
        aria-describedby={detailsId}
        className={styles.exerciseRow}
      >
        <Thumbnail key={sheet.id} sheet={sheet} entries={p.entries} />
        <span className={styles.exerciseText}>
          <span id={nameId} data-name="" className={styles.exerciseName}>
            {sheet.name}
          </span>{' '}
          <span id={detailsId} className={styles.exerciseDetails}>
            <span className={styles.exerciseMeta}>
              {sheet.primary_muscles.map((m) => MUSCLE_LABELS[m]).join(' · ')}
            </span>{' '}
            <span className={styles.exerciseMeta}>{equipmentText(option)}</span>{' '}
            {notFeasible && place ? (
              <>
                <span className={styles.exerciseWarning}>
                  <Badge tone="warning">{`Pas faisable : ${place.name}`}</Badge>
                </span>{' '}
              </>
            ) : null}
            <span className={styles.exerciseLevel}>
              <LevelBars level={sheet.level} />
              <span className={styles.srOnly}>{levelText(sheet.level)}</span>
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Liste d'exercices nommée `label` (« Exercices », « Résultats ») : une ligne par fiche, chacune un lien vers sa
 * fiche, ouverte avec Retour par l'historique. `onOpen` part avant la navigation (défilement noté, recherche
 * écrite dans l'adresse).
 */
export function ExerciseList(p: {
  label: string;
  sheets: readonly ServedSheet[];
  entries: ReadonlyMap<string, IllustrationEntry>;
  place: CatalogPlace | null;
  feasibleOnly: boolean;
  onOpen(): void;
}) {
  return (
    <ul aria-label={p.label} className={styles.exerciseList}>
      {p.sheets.map((sheet) => (
        <ExerciseRow
          key={sheet.id}
          sheet={sheet}
          entries={p.entries}
          place={p.place}
          feasibleOnly={p.feasibleOnly}
          onOpen={p.onOpen}
        />
      ))}
    </ul>
  );
}
