import type { ServedSheet } from '@rune/contracts';
import { type Ref, useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'wouter';
import { useLive } from '../../app-services';
import { type SheetView, useCatalog, useRepos } from '../../repos';
import { Badge, Banner, ListGroup, ListRow, Page } from '../../ui';
import { CatalogMissing } from './CatalogMissing';
import { levelText } from './exercise-labels';
import { BACK_IN_HISTORY, currentHistoryState, useBack } from './exercise-nav';
import styles from './exercises.module.css';
import { SheetIllustrations, SheetPills, type SheetTab, SheetTabs, sheetTabOf } from './SheetContent';

/**
 * Retour de la fiche : l'écran d'où on l'a ouverte, par l'historique (liste avec sa recherche et son défilement,
 * fiche d'où part une variante) ; ouverte par son adresse, l'onglet Exercices.
 */
const BACK = '/exercises';

const sheetPath = (id: string) => `/exercises/${id}`;

/** Une fiche de la liste des variantes : son nom (nom du lien), son niveau en valeur ; Retour revient ici. */
function SheetLink(p: { sheet: ServedSheet }) {
  return (
    <ListRow
      label={p.sheet.name}
      value={levelText(p.sheet.level)}
      href={sheetPath(p.sheet.id)}
      state={BACK_IN_HISTORY}
    />
  );
}

/**
 * Exercices proches (`substitutes`, déjà filtrés par le dépôt : utilisables, faisables au lieu principal, niveau
 * plafonné) ; « Aucun exercice proche pour l'instant. » s'il n'y en a aucun. `headingRef` : titre focalisable par
 * le script, cible de « Voir des exercices proches ».
 */
function NearbyExercises(p: { sheets: readonly ServedSheet[]; headingRef?: Ref<HTMLHeadingElement> }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.part}>
      <h2 id={titleId} ref={p.headingRef} tabIndex={-1} className={styles.partTitle}>
        Exercices proches
      </h2>
      {p.sheets.length > 0 ? (
        <ListGroup>
          {p.sheets.map((sheet) => (
            <SheetLink key={sheet.id} sheet={sheet} />
          ))}
        </ListGroup>
      ) : (
        <p className={styles.partText}>Aucun exercice proche pour l'instant.</p>
      )}
    </section>
  );
}

/** Variante plus facile ou plus dure : le conseil de la fiche, puis le voisin de chaîne s'il est proposé. */
function ChainStep(p: { title: string; tip: string | undefined; neighbor: ServedSheet | undefined }) {
  const titleId = useId();
  if (p.tip === undefined && p.neighbor === undefined) return null;
  return (
    <section aria-labelledby={titleId} className={styles.part}>
      <h2 id={titleId} className={styles.partTitle}>
        {p.title}
      </h2>
      {p.tip !== undefined ? <p className={styles.partText}>{p.tip}</p> : null}
      {p.neighbor ? (
        <ListGroup>
          <SheetLink sheet={p.neighbor} />
        </ListGroup>
      ) : null}
    </section>
  );
}

/**
 * Variantes (spec brique 2 §4.2) : voisins plus facile et plus dur de la chaîne (le dépôt ne garde que ceux de
 * `usableChainSteps` : rien au-delà d'une fiche `not_for_minors` en profil prudent), `easier_tip` et
 * `harder_tip`, puis jusqu'à 5 exercices proches.
 */
function VariantsPanel(p: { view: SheetView; nearbyRef: Ref<HTMLHeadingElement> }) {
  const { sheet, chain } = p.view;
  return (
    <>
      <ChainStep title="Plus facile" tip={sheet.easier_tip} neighbor={chain.easier} />
      <ChainStep title="Plus difficile" tip={sheet.harder_tip} neighbor={chain.harder} />
      <NearbyExercises sheets={p.view.substitutes} headingRef={p.nearbyRef} />
    </>
  );
}

/**
 * Fiche lisible : bandeau de retrait s'il y a lieu, en-tête (pastilles, « Pas faisable : <lieu> », illustrations),
 * puis les onglets. L'onglet vit dans l'URL (`?tab=`) et en change par remplacement : Retour ramène à la liste,
 * pas à l'onglet précédent.
 */
function SheetScreen(p: { view: SheetView; back(): void }) {
  const { sheet, place } = p.view;
  const [params, setParams] = useSearchParams();
  const tab = sheetTabOf(params.get('tab'));
  const nearbyRef = useRef<HTMLHeadingElement>(null);
  const [focusNearby, setFocusNearby] = useState(false);

  useEffect(() => {
    if (!focusNearby || tab !== 'variants') return;
    nearbyRef.current?.focus();
    setFocusNearby(false);
  }, [focusNearby, tab]);

  // Remplacement de l'entrée, son état d'historique gardé : Retour revient toujours à l'écran d'avant.
  const changeTab = (next: SheetTab) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set('tab', next);
        return out;
      },
      { replace: true, state: currentHistoryState() },
    );

  return (
    <Page title={sheet.name} back={p.back}>
      {sheet.status === 'retired' ? (
        <Banner tone="info">
          <p className={styles.bannerText}>Cet exercice n'est plus proposé.</p>
          {p.view.substitutes.length > 0 ? (
            <Link
              href={`${sheetPath(sheet.id)}?tab=variants`}
              replace
              state={currentHistoryState()}
              onClick={() => setFocusNearby(true)}
              className={styles.bannerLink}
            >
              Voir des exercices proches
            </Link>
          ) : (
            <p className={styles.bannerText}>Aucun exercice proche pour l'instant.</p>
          )}
        </Banner>
      ) : null}
      <div className={styles.header}>
        <SheetPills sheet={sheet} equipment={place?.equipment ?? null} />
        {place !== null && !p.view.feasibleHere ? (
          <p className={styles.notFeasible}>
            <Badge tone="warning">{`Pas faisable : ${place.name}`}</Badge>
          </p>
        ) : null}
        <SheetIllustrations name={sheet.name} illustrations={p.view.illustrations} />
      </div>
      <SheetTabs
        sheet={sheet}
        tab={tab}
        onTabChange={changeTab}
        variants={<VariantsPanel view={p.view} nearbyRef={nearbyRef} />}
      />
    </Page>
  );
}

/**
 * Fiche non utilisable (profil prudent et `not_for_minors`), ouverte par son URL : le bandeau et les exercices
 * proches utilisables, jamais le contenu de la fiche (Review Focus 2), quel que soit son statut ou l'onglet.
 */
function NotUsableScreen(p: { view: SheetView; back(): void }) {
  return (
    <Page title={p.view.sheet.name} back={p.back}>
      <Banner tone="warning">
        <p className={styles.bannerText}>Cet exercice n'est pas proposé avec tes réglages actuels.</p>
      </Banner>
      <NearbyExercises sheets={p.view.substitutes} />
    </Page>
  );
}

/**
 * Fiche d'un exercice (`/exercises/:id`, spec brique 2 §4.2), lue dans le catalogue local, hors ligne comprise :
 * - catalogue pas encore téléchargé : « Le catalogue arrive… » ou la phrase du Système hors ligne ;
 * - id inconnu du catalogue local : « Exercice introuvable. » ;
 * - non utilisable (profil prudent et `not_for_minors`) : bandeau sans contenu, avant tout autre cas ;
 * - sinon la fiche, retirée ou non, faisable au lieu principal ou non.
 */
export function ExerciseSheetPage(p: { params: { id: string } }) {
  const repos = useRepos();
  const catalog = useCatalog();
  const id = p.params.id;
  const view = useLive(() => repos.catalog.getSheetView(id), [repos, id]);
  const back = useBack(BACK);
  if (catalog.state === 'loading') return null;
  if (catalog.state === 'missing') {
    return (
      <Page title="Exercice" back={back}>
        <CatalogMissing />
      </Page>
    );
  }
  // Vue d'une autre fiche, gardée le temps que la nouvelle lecture arrive : on attend.
  if (view === undefined || (view !== null && view.sheet.id !== id)) return null;
  if (view === null) {
    return (
      <Page title="Exercice" back={back}>
        <p>Exercice introuvable.</p>
      </Page>
    );
  }
  // Une clé par fiche : d'une fiche à l'autre (variantes), images en échec et focus demandé repartent de zéro.
  if (!view.usable) return <NotUsableScreen key={view.sheet.id} view={view} back={back} />;
  return <SheetScreen key={view.sheet.id} view={view} back={back} />;
}
