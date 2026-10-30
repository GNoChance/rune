import { MUSCLE_GROUPS } from '@rune/contracts';
import { Redirect } from 'wouter';
import { useLive } from '../../app-services';
import { useCatalog, useRepos } from '../../repos';
import { Button, Page } from '../../ui';
import { CatalogMissing } from './CatalogMissing';
import { ExerciseList, thumbnailIds } from './ExerciseList';
import { FeasibleFilter } from './ExercisesHome';
import { rememberScroll, useBack, useFeasibleOnly, useRestoreScroll } from './exercise-nav';
import styles from './exercises.module.css';

/**
 * Liste d'un groupe musculaire (`/exercises/group/:code`, spec brique 2 §4.1 et §4.3) : l'interrupteur « Faisable »
 * de l'onglet (même état), puis les fiches visibles du groupe, par niveau, nom (collation française) et id.
 * Groupe vide avec le filtre alors que d'autres fiches existent : « Rien de faisable à <lieu> dans ce groupe » et
 * « Tout voir », qui coupe le filtre. Code inconnu : retour à `/exercises`, sans entrée d'historique.
 */
export function GroupList(p: { params: { code: string } }) {
  const group = MUSCLE_GROUPS.find((g) => g.code === p.params.code);
  const repos = useRepos();
  const catalog = useCatalog();
  const back = useBack('/exercises');
  const [feasibleOnly, setFeasibleOnly] = useFeasibleOnly();
  const code = group?.code ?? null;
  const data = useLive(async () => {
    if (code === null) return null;
    const [ctx, sheets] = await Promise.all([
      repos.catalog.context(),
      repos.catalog.groupExercises(code, { feasibleOnly }),
    ]);
    if (sheets === null) return null;
    // Rien avec le filtre : y a-t-il quelque chose à « Tout voir » ?
    const withoutFilter =
      sheets.length === 0 && feasibleOnly && ctx.place !== null
        ? ((await repos.catalog.groupExercises(code, { feasibleOnly: false })) ?? [])
        : sheets;
    const entries = await repos.catalog.illustrationEntries(thumbnailIds(sheets));
    return { code, feasibleOnly, ctx, sheets, entries, hiddenByFeasible: withoutFilter.length };
  }, [repos, code, feasibleOnly]);
  // Liste de ce groupe et de ce filtre (pas celle gardée le temps de la nouvelle lecture).
  const current = data && data.code === code && data.feasibleOnly === feasibleOnly ? data : null;
  useRestoreScroll(catalog.state === 'ready' && current !== null);

  if (!group) return <Redirect to="/exercises" replace />;
  if (catalog.state === 'loading') return null;
  if (catalog.state === 'missing') {
    return (
      <Page title={group.label} back={back}>
        <CatalogMissing />
      </Page>
    );
  }
  if (!data) return null;
  const { ctx, sheets } = data;

  return (
    <Page title={group.label} back={back}>
      <FeasibleFilter place={ctx.place} value={feasibleOnly} onChange={setFeasibleOnly} />
      {sheets.length > 0 ? (
        <ExerciseList
          label="Exercices"
          sheets={sheets}
          entries={data.entries}
          place={ctx.place}
          feasibleOnly={data.feasibleOnly}
          onOpen={rememberScroll}
        />
      ) : data.feasibleOnly && ctx.place !== null && data.hiddenByFeasible > 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyLine}>{`Rien de faisable à ${ctx.place.name} dans ce groupe`}</p>
          <Button variant="secondary" onClick={() => setFeasibleOnly(false)}>
            Tout voir
          </Button>
        </div>
      ) : (
        <div className={styles.empty}>
          <p className={styles.emptyLine}>Aucun exercice dans ce groupe pour l'instant.</p>
        </div>
      )}
    </Page>
  );
}
