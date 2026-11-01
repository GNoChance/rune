import { MUSCLE_GROUPS } from '@rune/contracts';
import { type CSSProperties, useId, useMemo } from 'react';
import { Link } from 'wouter';
import {
  CountUp,
  formatInt,
  formatLifted,
  LIFTED_TONNES_ABOVE_G,
  ListGroup,
  ListRow,
  Page,
  plural,
  RankBadge,
} from '../../ui';
import { BACK_IN_HISTORY } from '../exercises/exercise-nav';
import { doneExerciseIds, recentRecords } from './progress-lists';
import styles from './progression.module.css';
import { useProgress } from './use-progress';

const collator = new Intl.Collator('fr', { sensitivity: 'base' });

/** Adresse de la progression d'un exercice (page chargée à la demande). */
export const exerciseProgressPath = (id: string) => `/progression/exercises/${id}`;

/**
 * Onglet Progression (spec brique 3 §7.10, maquettes ProgressionSombre / ProgressionClair) : rang global en pierre
 * et sa barre d'XP (« Rang D · 1 240 / 5 000 XP », prochain rang), compteurs réels (séances, kg soulevés, semaines
 * d'assiduité), les 9 groupes musculaires à leur rang, les 5 derniers records, l'historique et « Mes exercices ».
 * Tout se recalcule depuis l'historique local (`progressSummary`) : rien n'est inventé, et sans séance terminée la
 * fenêtre du Système reste. Les cartes entrent en cascade, les compteurs défilent (`CountUp`, à leur valeur finale
 * tout de suite sous mouvement réduit), la barre se remplit (sans animation sous mouvement réduit).
 * Les groupes sont ceux de `MUSCLE_GROUPS` (spec brique 2 §4.3) : toucher un rang ouvre la liste de son groupe,
 * dont Retour revient ici par l'historique.
 */
export function ProgressionPage() {
  const rankTitle = useId();
  const musclesTitle = useId();
  const recordsTitle = useId();
  const progress = useProgress();
  const history = progress?.history;
  const records = useMemo(() => (history ? recentRecords(history) : []), [history]);
  const exercises = useMemo(() => (history ? doneExerciseIds(history) : []), [history]);
  if (!progress) return null;

  const { summary, names } = progress;
  const { rank, nextRank, nextRankXp, xp } = summary;
  const fill = nextRankXp === null ? 100 : Math.min(100, Math.round((xp / nextRankXp) * 1000) / 10);
  const xpText = nextRankXp === null ? formatInt(xp) : `${formatInt(xp)} / ${formatInt(nextRankXp)}`;
  const xpSpoken = `${formatInt(xp)} sur ${formatInt(nextRankXp ?? 0)}`;
  const inTonnes = summary.tonnageG > LIFTED_TONNES_ABOVE_G;
  const mine = exercises
    .map((id) => ({ id, name: names.get(id) ?? id }))
    .sort((a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));

  return (
    <Page title="Progression">
      <div className={`${styles.content} stagger`}>
        <section aria-labelledby={rankTitle} className={styles.hero}>
          <span className={styles.hudCorner} aria-hidden="true" />
          <span className={styles.heroBadge}>
            <RankBadge rank={rank} size={92} />
          </span>
          <div className={styles.heroInfo}>
            <h2 id={rankTitle} className={styles.kicker}>
              Rang global
            </h2>
            {nextRankXp === null ? (
              <p className={styles.rankName}>{`Rang ${rank} · ${xpText} XP`}</p>
            ) : (
              <p className={styles.rankName}>
                <span aria-hidden="true">{`Rang ${rank} · ${xpText} XP`}</span>
                <span className={styles.srOnly}>{`Rang ${rank} · ${xpSpoken} XP`}</span>
              </p>
            )}
            <div className={styles.xpBar} data-xp={xp} aria-hidden="true">
              {fill > 0 ? (
                <span className={styles.xpFill} data-fill="" style={{ width: `${fill}%` }} />
              ) : null}
              <span className={styles.xpSweep} />
            </div>
            {nextRank === null ? null : <p className={styles.xpMeta}>{`Prochain : ${nextRank}`}</p>}
          </div>
        </section>
        <ul className={styles.stats}>
          <li className={styles.stat}>
            <span className={styles.statValue}>
              <CountUp to={summary.sessions} format={formatInt} />
            </span>{' '}
            <span className={styles.statLabel}>{plural(summary.sessions, 'séance', 'séances')}</span>
          </li>
          <li className={styles.stat}>
            <span className={styles.statValue}>
              {inTonnes ? (
                formatLifted(summary.tonnageG)
              ) : (
                <>
                  <CountUp to={Math.round(summary.tonnageG / 1000)} format={formatInt} />
                  <small> kg</small>
                </>
              )}
            </span>{' '}
            <span className={styles.statLabel}>soulevés</span>
          </li>
          <li className={styles.stat}>
            <span className={styles.statValue}>
              <CountUp to={summary.assiduityWeeks} format={formatInt} />
              <small aria-hidden="true"> sem.</small>
              <span className={styles.srOnly}>
                {` ${plural(summary.assiduityWeeks, 'semaine', 'semaines')}`}
              </span>
            </span>{' '}
            <span className={styles.statLabel}>d'assiduité</span>
          </li>
        </ul>
        <section aria-labelledby={musclesTitle} className={styles.muscles}>
          <div className={styles.sectionHead}>
            <h2 id={musclesTitle} className={styles.sectionTitle}>
              Rangs par muscle
            </h2>
            <span className={styles.sectionCount}>{`${MUSCLE_GROUPS.length} groupes`}</span>
          </div>
          <ul className={styles.muscleGrid}>
            {MUSCLE_GROUPS.map((group, index) => {
              const groupRank = summary.groups[group.code].rank;
              return (
                <li key={group.code} className={styles.muscle} style={{ '--i': index } as CSSProperties}>
                  <Link
                    href={`/exercises/group/${group.code}`}
                    state={BACK_IN_HISTORY}
                    aria-label={`${group.label}, rang ${groupRank}`}
                    className={styles.muscleLink}
                  >
                    <RankBadge rank={groupRank} size={32} mini />
                    <span className={styles.muscleLabel}>{group.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
        {records.length > 0 ? (
          <section aria-labelledby={recordsTitle} className={styles.muscles}>
            <h2 id={recordsTitle} className={styles.sectionTitle}>
              Records récents
            </h2>
            <ul className={styles.recordList}>
              {records.map((r) => (
                <li key={r.key}>
                  <Link href={exerciseProgressPath(r.exerciseId)} className={styles.recordLink}>
                    <span className={styles.recordName}>{names.get(r.exerciseId) ?? r.exerciseId}</span>{' '}
                    <span className={styles.recordMeta}>{`${r.text} · ${r.date}`}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <ListGroup>
          <ListRow label="Historique des séances" href="/history" />
        </ListGroup>
        {mine.length > 0 ? (
          <ListGroup title="Mes exercices">
            {mine.map((e) => (
              <ListRow key={e.id} label={e.name} href={exerciseProgressPath(e.id)} />
            ))}
          </ListGroup>
        ) : null}
        {summary.sessions === 0 ? (
          <div role="note" className={styles.systemNote}>
            <p className={styles.systemLabel}>
              <span aria-hidden="true">[ </span>SYSTÈME<span aria-hidden="true"> ]</span>
            </p>{' '}
            <p className={styles.noteText}>Aucune séance gravée. Ta première séance débloque tes rangs.</p>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
