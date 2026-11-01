import type { IllustrationEntry } from '@rune/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'wouter';
import { useLive } from '../../app-services';
import { type CatalogPlace, type ExerciseSearch, useCatalog, useExerciseView, useRepos } from '../../repos';
import { Field, ListGroup, ListRow, Page, plural, RankBadge, Switch } from '../../ui';
import { useProgress } from '../progression/use-progress';
import { CatalogMissing } from './CatalogMissing';
import { ExerciseList, thumbnailIds } from './ExerciseList';
import { BACK_IN_HISTORY, rememberScroll, useFeasibleOnly, useRestoreScroll } from './exercise-nav';
import styles from './exercises.module.css';

/** Délai de saisie : la recherche relit le catalogue local (jusqu'à 300 fiches) et l'adresse, pas à chaque frappe. */
export const SEARCH_DELAY_MS = 200;

const NO_PLACE = 'Choisis ton lieu principal pour ne voir que ce que tu peux faire';

const countText = (n: number) => `${n} ${plural(n, 'exercice', 'exercices')}`;

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}

/**
 * Interrupteur « Faisable : <lieu> » ; sans lieu principal, à sa place, la ligne qui mène à Profil › Mes lieux
 * (`withoutPlace`, sur l'accueil de l'onglet seulement).
 */
export function FeasibleFilter(p: {
  place: CatalogPlace | null;
  value: boolean;
  onChange(value: boolean): void;
  withoutPlace?: boolean;
}) {
  const id = useId();
  if (p.place === null) {
    return p.withoutPlace ? (
      <ListGroup>
        <ListRow icon={<PinIcon />} label={NO_PLACE} href="/places" />
      </ListGroup>
    ) : null;
  }
  return <Switch id={id} label={`Faisable : ${p.place.name}`} checked={p.value} onChange={p.onChange} />;
}

/** Résultats d'une recherche et la recherche (adresse) à laquelle ils répondent. */
type Found = ExerciseSearch & { query: string; entries: Map<string, IllustrationEntry> };

/**
 * Résultats (spec brique 2 §4.1) : la liste, filtrée comme les tuiles ; sans résultat, « Aucun exercice ne
 * correspond. » et, si le filtre en masque, « N exercices masqués par le filtre Faisable · Les voir » ; en profil
 * prudent, la phrase du mode prudent dès qu'une fiche `not_for_minors` correspond.
 */
function SearchResults(p: {
  found: Found;
  place: CatalogPlace | null;
  feasibleOnly: boolean;
  onShowAll(): void;
  onOpen(): void;
}) {
  const { found } = p;
  const n = found.results.length;
  const hidden = found.hiddenByFeasible;
  return (
    <div className={styles.results} data-query={found.query}>
      <p role="status" className={n > 0 ? styles.srOnly : styles.emptyLine}>
        {n > 0 ? `${countText(n)} ${plural(n, 'trouvé', 'trouvés')}` : 'Aucun exercice ne correspond.'}
      </p>
      {n > 0 ? (
        <ExerciseList
          label="Résultats"
          sheets={found.results}
          entries={found.entries}
          place={p.place}
          feasibleOnly={p.feasibleOnly}
          onOpen={p.onOpen}
        />
      ) : null}
      {n === 0 && hidden > 0 ? (
        <p className={styles.hint}>
          {`${hidden} ${plural(hidden, 'exercice masqué', 'exercices masqués')} par le filtre Faisable`}
          {' · '}
          <button type="button" className={styles.textButton} onClick={p.onShowAll}>
            Les voir
          </button>
        </p>
      ) : null}
      {found.hiddenByCautious ? (
        <p className={styles.hint}>Certains exercices sont masqués par le mode prudent.</p>
      ) : null}
    </div>
  );
}

/**
 * Recherche tenue dans l'adresse (`?q=`), remplacée après un petit délai de saisie : la fiche ouverte puis
 * Retour (l'historique) retrouvent la même recherche. Le champ suit l'adresse quand elle change d'ailleurs
 * (onglet Exercices touché pendant une recherche).
 */
function useSearchQuery(): { text: string; setText(v: string): void; query: string; flush(): void } {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [text, setText] = useState(query);
  const written = useRef(query);
  if (query !== written.current) {
    // État dérivé de l'adresse : posé pendant le rendu, React rend aussitôt de nouveau avec lui.
    written.current = query;
    setText(query);
  }
  const wanted = text.trim() === '' ? '' : text;
  const write = (value: string) => {
    written.current = value;
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (value === '') out.delete('q');
        else out.set('q', value);
        return out;
      },
      { replace: true },
    );
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: seule la saisie relance le délai.
  useEffect(() => {
    if (wanted === written.current) return;
    const timer = setTimeout(() => write(wanted), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [wanted]);
  return {
    text,
    setText,
    query,
    flush: () => {
      if (wanted !== written.current) write(wanted);
    },
  };
}

/**
 * Accueil de l'onglet Exercices (`/exercises`, spec brique 2 §4.1) : recherche en haut, interrupteur « Faisable :
 * <lieu principal> » (ou la ligne vers Mes lieux), puis les 9 tuiles des groupes musculaires avec la pierre de
 * rang et le nombre d'exercices visibles ; dès qu'on tape, les résultats remplacent les tuiles. Catalogue pas
 * encore téléchargé : « Le catalogue arrive… » ou, hors ligne, la phrase du Système (jamais 9 tuiles à 0).
 */
export function ExercisesHome() {
  const repos = useRepos();
  const catalog = useCatalog();
  const [feasibleOnly, setFeasibleOnly] = useFeasibleOnly();
  const view = useExerciseView({ feasibleOnly });
  const progress = useProgress();
  const search = useSearchQuery();
  const { query } = search;
  const found = useLive(async (): Promise<Found | null> => {
    if (query.trim() === '') return null;
    const result = await repos.catalog.searchExercises(query, { feasibleOnly });
    const entries = await repos.catalog.illustrationEntries(thumbnailIds(result.results));
    return { ...result, query, entries };
  }, [repos, query, feasibleOnly]);
  const searching = search.text.trim() !== '';
  const ready =
    catalog.state === 'ready' &&
    view !== undefined &&
    progress !== undefined &&
    (!searching || (found !== undefined && found !== null));
  useRestoreScroll(ready);

  if (catalog.state === 'loading') return null;
  if (catalog.state === 'missing') {
    return (
      <Page title="Exercices">
        <CatalogMissing />
      </Page>
    );
  }
  if (view === undefined || progress === undefined) return null;

  const leave = () => {
    search.flush();
    rememberScroll();
  };

  return (
    <Page title="Exercices">
      <div className={styles.search}>
        <Field label="Rechercher un exercice">
          <input
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            value={search.text}
            onChange={(e) => search.setText(e.target.value)}
          />
        </Field>
        <span className={styles.searchIcon} aria-hidden="true">
          <SearchIcon />
        </span>
      </div>
      <FeasibleFilter place={view.place} value={feasibleOnly} onChange={setFeasibleOnly} withoutPlace />
      {searching ? (
        found ? (
          <SearchResults
            found={found}
            place={view.place}
            feasibleOnly={feasibleOnly}
            onShowAll={() => setFeasibleOnly(false)}
            onOpen={leave}
          />
        ) : null
      ) : (
        <ul aria-label="Groupes musculaires" className={styles.tiles}>
          {view.groups.map((g) => {
            const rank = progress.summary.groups[g.code].rank;
            return (
              <li key={g.code}>
                <Link
                  href={`/exercises/group/${g.code}`}
                  state={BACK_IN_HISTORY}
                  onClick={leave}
                  aria-label={`${g.label}, rang ${rank}, ${countText(g.count)}`}
                  className={styles.tile}
                >
                  <RankBadge rank={rank} size={32} mini />
                  <span className={styles.tileLabel}>{g.label}</span>{' '}
                  <span className={styles.tileCount}>{countText(g.count)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
