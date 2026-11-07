import type { ServedAdviceSheet } from '@rune/contracts';
import { useEffect, useId, useState } from 'react';
import { Redirect, useParams } from 'wouter';
import { useNutritionView, useRepos } from '../../repos';
import { Page } from '../../ui';
import { formatLongDate } from './format';
import { isWebUrl, MarkdownLite } from './markdown-lite';
import styles from './nutrition.module.css';
import { NUTRITION_TEXTS } from './nutrition-texts';

const T = NUTRITION_TEXTS.sheet;

/**
 * Une source en pied de fiche : un lien qui s'ouvre à part pour une adresse http(s), son titre en texte brut sinon
 * (défense en profondeur : le schéma des sources n'admet déjà que http(s)).
 */
export function SheetSource({ source }: { source: ServedAdviceSheet['sources'][number] }) {
  if (!isWebUrl(source.url)) return <>{source.title}</>;
  return (
    <a href={source.url} target="_blank" rel="noopener noreferrer" className={styles.textLink}>
      {source.title}
    </a>
  );
}

/**
 * Lecture d'une fiche conseil (`/nutrition/sheets/:id`, spec brique 5 §10.2 à §10.5) : le corps en Markdown restreint,
 * dont les seuls liens sont ceux des `sources`, puis ces sources et la date de relecture en pied. Les fiches viennent du
 * dépôt (réseau, sinon dernière copie) : lisibles hors ligne. Mode `disabled` : retour au module.
 */
export function SheetPage() {
  const { id } = useParams<{ id: string }>();
  const repos = useRepos();
  const view = useNutritionView();
  const sourcesId = useId();
  const [sheet, setSheet] = useState<ServedAdviceSheet | null | undefined>(undefined);
  const mode = view?.mode;

  useEffect(() => {
    if (mode === undefined || mode === 'disabled') return;
    let live = true;
    repos.nutrition.sheets().then(
      (list) => live && setSheet(list.find((s) => s.id === id) ?? null),
      () => live && setSheet(null),
    );
    return () => {
      live = false;
    };
  }, [repos, mode, id]);

  if (mode === undefined) return null;
  if (mode === 'disabled') return <Redirect to="/nutrition" replace />;
  if (sheet === undefined) return null;
  if (sheet === null || sheet.id !== id) {
    return (
      <Page title={NUTRITION_TEXTS.title} back="/nutrition">
        <p className={styles.muted}>{T.unavailable}</p>
      </Page>
    );
  }
  return (
    <Page title={sheet.title} back="/nutrition">
      <div className={`${styles.stack} stagger`}>
        <article className={`${styles.section} ${styles.sheetBody}`}>
          <MarkdownLite source={sheet.body_md} allowedLinks={sheet.sources.map((s) => s.url)} />
        </article>
        <section aria-labelledby={sourcesId} className={styles.section}>
          <h2 id={sourcesId}>{T.sources}</h2>
          {sheet.sources.length > 0 ? (
            <ul className={styles.list}>
              {sheet.sources.map((source) => (
                <li key={source.url}>
                  <SheetSource source={source} />
                </li>
              ))}
            </ul>
          ) : null}
          {sheet.reviewed_at ? (
            <p className={styles.muted}>{T.reviewedOn(formatLongDate(sheet.reviewed_at.slice(0, 10)))}</p>
          ) : null}
        </section>
      </div>
    </Page>
  );
}
