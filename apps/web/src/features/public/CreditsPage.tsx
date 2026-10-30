import { ILLUSTRATION_LICENSE_LABELS, ILLUSTRATION_ROLE_LABELS } from '@rune/contracts';
import type { IllustrationCredit, SourceCredit } from '@rune/domain';
import { Fragment, type ReactNode, useId } from 'react';
import { useLive } from '../../app-services';
import { type CreditsView, useRepos } from '../../repos';
import { Page } from '../../ui';
import { ExternalLink } from './ExternalLink';
import styles from './public.module.css';
import { usePublicBack } from './use-public-back';

/** Mention des textes des fiches (spec brique 2 §5.7, qui remplace celle de 04 §12). */
const TEXTS_CREDIT =
  "Rédigés avec l'aide d'une IA (Claude), relus par l'administrateur et des relectrices, dont une professionnelle de santé pour les exercices sensibles.";
/** Nos modifications des fichiers repris, et leur licence (04 §12). */
const OUR_MODIFICATIONS =
  'Rune modifie les fichiers repris (nettoyage, optimisation, renommage) ; ces versions modifiées sont sous licence CC BY-SA 4.0.';
const CATALOG_MISSING =
  "Les crédits des illustrations arrivent avec le catalogue d'exercices : connecte-toi une fois pour le récupérer.";

type Level = 2 | 3 | 4;

/** Titre de niveau `level`, qui nomme la section qui l'entoure. */
function Heading(p: { level: Level; id: string; className: string | undefined; children: ReactNode }) {
  const Tag = `h${p.level}` as const;
  return (
    <Tag id={p.id} className={p.className}>
      {p.children}
    </Tag>
  );
}

/** Usages d'un fichier : « Squat goblet : position de départ », séparés par « ; ». */
const usesLabel = (file: IllustrationCredit) =>
  file.uses.map((u) => `${u.exerciseName} : ${ILLUSTRATION_ROLE_LABELS[u.role]}`).join(' ; ');

/** Un fichier : ses usages, sa ligne de crédit, ses modifications, son marquage, puis sa source figée. */
function FileCredit(p: { file: IllustrationCredit }) {
  const { entry, line } = p.file;
  const label = usesLabel(p.file);
  return (
    <li className={styles.creditFile}>
      <p className={styles.creditUses}>{label}</p>
      <p>{line}</p>
      {entry.modifications !== undefined ? (
        <p className={styles.muted}>Modifications : {entry.modifications}</p>
      ) : null}
      {entry.replace_before_public ? (
        <p className={styles.muted}>À remplacer avant publication : provenance non documentée.</p>
      ) : null}
      <ExternalLink href={entry.source_url} context={label}>
        Source
      </ExternalLink>
    </li>
  );
}

/**
 * Une source (04 §12) : créateurs, licence, copie figée au commit, puis la liste de ses fichiers, repliée
 * (quelque 300 fichiers au total : Aide reste courte, la liste s'ouvre d'un toucher).
 */
function SourceCredits(p: { credit: SourceCredit; level: Level }) {
  const id = useId();
  const { credit } = p;
  const count = credit.files.length;
  const licenseUrl = (license: string) =>
    credit.files.find((f) => f.entry.license === license)?.entry.license_url;
  return (
    <section aria-labelledby={id} className={styles.creditSource}>
      <Heading level={p.level} id={id} className={styles.creditSourceTitle}>
        {credit.label}
      </Heading>
      <p>Créateurs : {credit.creators.join(', ')}</p>
      <p>
        {credit.licenses.length > 1 ? 'Licences' : 'Licence'} :{' '}
        {credit.licenses.map((license, i) => {
          const href = licenseUrl(license);
          const label = ILLUSTRATION_LICENSE_LABELS[license];
          return (
            <Fragment key={license}>
              {i > 0 ? ', ' : null}
              {href ? <ExternalLink href={href}>{label}</ExternalLink> : label}
            </Fragment>
          );
        })}
      </p>
      {credit.frozen.map((f) => (
        <p key={`${f.repository} ${f.commit}`}>
          Copie figée :{' '}
          <ExternalLink href={`${f.repository}/tree/${f.commit}`}>
            {`${f.repository.replace(/^https:\/\//, '')}, commit ${f.commit.slice(0, 7)}`}
          </ExternalLink>
        </p>
      ))}
      <details>
        <summary className={styles.creditSummary}>{`${count} illustration${count > 1 ? 's' : ''}`}</summary>
        {/* biome-ignore lint/a11y/noRedundantRoles: sans puces, Safari ôte la sémantique de liste (VoiceOver) ; le rôle explicite la garde */}
        <ul role="list" className={styles.creditList}>
          {credit.files.map((file) => (
            <FileCredit key={file.entry.id} file={file} />
          ))}
        </ul>
      </details>
    </section>
  );
}

function IllustrationsCredits(p: { view: CreditsView | undefined; level: Level }) {
  // Lecture du catalogue local en cours (quelques millisecondes) : rien à annoncer.
  if (p.view === undefined) return null;
  if (p.view.state === 'missing') return <p>{CATALOG_MISSING}</p>;
  if (p.view.sources.length === 0) return <p>Aucune illustration pour le moment.</p>;
  return (
    <>
      <p className={styles.muted}>{OUR_MODIFICATIONS}</p>
      {p.view.sources.map((credit) => (
        <SourceCredits key={credit.source} credit={credit} level={p.level} />
      ))}
    </>
  );
}

/** Une partie des crédits, titrée. */
function CreditsBlock(p: { level: Level; title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={styles.creditsBlock}>
      <Heading level={p.level} id={id} className={styles.creditsTitle}>
        {p.title}
      </Heading>
      {p.children}
    </section>
  );
}

/**
 * Contenu des crédits, montré dans Aide (spec refonte §5, P10 : titres en h3) et sur /credits (titres en h2) :
 * la mention des textes (spec brique 2 §5.7), puis les crédits des illustrations, générés depuis le manifeste du
 * catalogue local (04 §12) : chaque illustration de chaque fiche publiée, par source. Aucune requête : la page
 * se lit hors ligne et sans session dès que le catalogue a été téléchargé une fois sur l'appareil.
 */
export function CreditsContent(p: { headingLevel: 2 | 3 }) {
  const repos = useRepos();
  const view = useLive(() => repos.credits.illustrations(), [repos]);
  return (
    <div className={`${styles.card} ${styles.credits}`}>
      <CreditsBlock level={p.headingLevel} title="Textes des exercices">
        <p>{TEXTS_CREDIT}</p>
      </CreditsBlock>
      <CreditsBlock level={p.headingLevel} title="Illustrations">
        <IllustrationsCredits view={view} level={p.headingLevel === 2 ? 3 : 4} />
      </CreditsBlock>
    </div>
  );
}

/** /credits reste servi (P10) : le même contenu que la section Crédits d'Aide. */
export function CreditsPage() {
  const back = usePublicBack();
  return (
    <Page title="Crédits" back={back}>
      <CreditsContent headingLevel={2} />
    </Page>
  );
}
