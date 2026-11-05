import {
  BODY_AREA_LABELS,
  type CoachBrief,
  type CoachBriefResponse,
  CoachBriefSchema,
  GOAL_LABELS,
  LIMITATION_SEVERITY_LABELS,
  LIMITATION_SIDE_LABELS,
} from '@rune/contracts';
import { sortedJson } from '@rune/domain';
import { Fragment, type ReactNode, useEffect, useId, useState } from 'react';
import { useLocation } from 'wouter';
import { ApiError } from '../../api/client';
import { useRepos } from '../../repos';
import { Banner, Button, errorMessage, Page, SystemPanel } from '../../ui';
import styles from './brief.module.css';
import { BRIEF_TEXTS, STATE_TEXTS } from './coach-texts';

/** Clé absente du dossier : « — » (le dossier omet les champs nuls et ceux à leur valeur par défaut). */
const DASH = '—';
const show = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? DASH : String(value);
/** Booléen absent : « non ». */
const yesNo = (value: boolean | undefined): string => (value === true ? 'oui' : 'non');
const range = (r: { min: number; max: number } | undefined, unit = ''): string =>
  r === undefined ? DASH : `${r.min}–${r.max}${unit}`;

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; response: CoachBriefResponse }
  | { kind: 'consent' }
  | { kind: 'error'; message: string };

/** Une section du dossier, nommée par son titre (région). */
function BriefSection(p: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h2 id={id}>{p.title}</h2>
      {p.children}
    </section>
  );
}

/** Libellé puis valeur, côte à côte. Les valeurs sont du texte : jamais de HTML. */
function Fields(p: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className={styles.fields}>
      {p.rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

type BriefSet = CoachBrief['history']['sessions'][number]['exercises'][number]['sets'][number];

/** `[load_kg, reps, duration_s, effort]` en une ligne lisible. */
function setLine([load, reps, duration, effort]: BriefSet): string {
  const parts = [
    load === null ? null : `${load} kg`,
    reps === null ? null : `${reps} rép.`,
    duration === null ? null : `${duration} s`,
    effort,
  ].filter((part) => part !== null);
  return parts.length === 0 ? DASH : parts.join(' · ');
}

function ProfileSection({ brief }: { brief: CoachBrief }) {
  const p = brief.profile;
  return (
    <BriefSection title="Profil">
      <Fields
        rows={[
          ["Tranche d'âge", brief.age_band],
          ['Public', brief.audience],
          ['Niveau', show(p.level)],
          ['Objectif', p.goal === null ? DASH : GOAL_LABELS[p.goal]],
          ['Jours par semaine', show(p.days_per_week)],
          ['Durée de séance', p.session_minutes === null ? DASH : `${p.session_minutes} min`],
          ['Mode prudent', yesNo(p.cautious_mode)],
          ['Profil du moteur', p.engine_profile],
          ['Contexte', [p.context.kind, p.context.sport_code].filter((x) => x !== null).join(' · ')],
        ]}
      />
    </BriefSection>
  );
}

function PlacesSection({ brief }: { brief: CoachBrief }) {
  return (
    <BriefSection title="Lieux">
      {brief.places.length === 0 ? (
        <p className={styles.muted}>Aucun lieu.</p>
      ) : (
        <ul className={styles.list}>
          {brief.places.map((place) => (
            <li key={place.name}>
              <span className={styles.name}>{place.name}</span>
              {place.primary ? ' (principal)' : ''} · {place.kind} ·{' '}
              {place.equipment.length === 0 ? 'aucun matériel' : place.equipment.join(', ')}
              {place.load_settings
                ? ` · barre ${place.load_settings.bar_kg} kg, plus petit disque ${place.load_settings.smallest_plate_kg} kg, pas de machine ${place.load_settings.machine_step_kg} kg`
                : ''}
            </li>
          ))}
        </ul>
      )}
    </BriefSection>
  );
}

type Slot = NonNullable<CoachBrief['program']>['workouts'][number]['slots'][number];

function SlotFields({ slot }: { slot: Slot }) {
  const engine = slot.engine;
  return (
    <Fields
      rows={[
        ['Exercice', show(slot.exercise?.name)],
        ['Rôle', slot.role],
        ['Séries', show(slot.sets)],
        ['Répétitions', range(slot.reps)],
        ['Durée', range(slot.duration_s, ' s')],
        ['RIR cible', show(slot.target_rir)],
        ['Repos', slot.rest_s === undefined ? DASH : `${slot.rest_s} s`],
        ['Mode', show(engine?.mode)],
        ['Charge', engine?.load_kg === undefined ? DASH : `${engine.load_kg} kg`],
        ['Suspendu', yesNo(engine?.suspended)],
        [
          'Dernière décision',
          slot.last_decision
            ? `il y a ${slot.last_decision.days_ago} j · ${slot.last_decision.result}`
            : DASH,
        ],
      ]}
    />
  );
}

function ProgramSection({ brief }: { brief: CoachBrief }) {
  const program = brief.program;
  return (
    <BriefSection title="Programme">
      {program === null ? (
        <p className={styles.muted}>Aucun programme suivi.</p>
      ) : (
        <>
          <Fields
            rows={[
              ['Modèle', `${program.template.name} (version ${program.template.version})`],
              ['Révision', String(program.revision)],
              ['Semaine', String(program.week)],
              ['Semaine du bloc', show(program.block_week)],
              ['Jours par semaine', String(program.days_per_week)],
              ['Propositions en attente', String(program.pending_proposals.length)],
            ]}
          />
          {program.workouts.map((workout) => (
            <Fragment key={workout.id}>
              <h3>{workout.name}</h3>
              <ul className={styles.list}>
                {workout.slots.map((slot) => (
                  <li key={slot.id}>
                    <SlotFields slot={slot} />
                  </li>
                ))}
              </ul>
            </Fragment>
          ))}
        </>
      )}
    </BriefSection>
  );
}

function HistorySection({ brief }: { brief: CoachBrief }) {
  const { sessions, truncated } = brief.history;
  return (
    <BriefSection title="Historique">
      {sessions.length === 0 ? (
        <p className={styles.muted}>Aucune séance dans les 28 derniers jours.</p>
      ) : null}
      <ul className={styles.list}>
        {sessions.map((session, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: deux séances d'un même jour peuvent porter le même nom
          <li key={i}>
            <p>
              <span className={styles.name}>{session.name}</span>
              {` · il y a ${session.days_ago} j`}
              {session.place === null ? '' : ` · ${session.place}`}
            </p>
            {session.exercises.map((exercise) => (
              <p key={exercise.id}>
                <span>{exercise.name}</span>
                {` : ${exercise.sets.map(setLine).join(' ; ') || DASH}`}
                {exercise.pain === undefined ? '' : ` · douleur : ${exercise.pain}`}
              </p>
            ))}
            {session.user_notes === undefined ? null : <p>Note : {session.user_notes}</p>}
          </li>
        ))}
      </ul>
      {truncated ? (
        <p className={styles.muted}>Les séances les plus anciennes ont été retirées (taille).</p>
      ) : null}
    </BriefSection>
  );
}

function RecordsSection({ brief }: { brief: CoachBrief }) {
  return (
    <BriefSection title="Records">
      {brief.records.length === 0 ? <p className={styles.muted}>Aucun record.</p> : null}
      <ul className={styles.list}>
        {brief.records.map((r) => (
          <li key={r.exercise_id}>
            <span className={styles.name}>{r.name}</span>
            {r.best_set ? ` · meilleure série ${r.best_set.load_kg} kg × ${r.best_set.reps}` : ''}
            {r.most_reps === null ? '' : ` · ${r.most_reps} répétitions au plus`}
            {r.longest_s === null ? '' : ` · ${r.longest_s} s au plus`}
            {r.e1rm_kg === undefined ? '' : ` · charge maximale estimée ${r.e1rm_kg} kg`}
          </li>
        ))}
      </ul>
    </BriefSection>
  );
}

function HealthSection({ health }: { health: NonNullable<CoachBrief['health']> }) {
  return (
    <BriefSection title="Santé">
      {health.limitations.length === 0 ? <p className={styles.muted}>Aucune limitation.</p> : null}
      <ul className={styles.list}>
        {health.limitations.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: deux limitations peuvent être identiques
          <li key={i}>
            {`${BODY_AREA_LABELS[l.area]} · ${LIMITATION_SIDE_LABELS[l.side]} · ${LIMITATION_SEVERITY_LABELS[l.severity]}`}
            {l.note === null ? null : <p>{l.note}</p>}
          </li>
        ))}
      </ul>
    </BriefSection>
  );
}

/** Le JSON exact : les clés triées comme à l'envoi, en bloc à défilement et à chasse fixe. */
function JsonSection({ brief }: { brief: unknown }) {
  return (
    <BriefSection title="Voir le JSON exact">
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: bloc à défilement, atteignable au clavier */}
      <section aria-label="JSON exact du dossier" tabIndex={0} className={styles.json}>
        <pre>{sortedJson(brief)}</pre>
      </section>
    </BriefSection>
  );
}

function NeverSentSection() {
  return (
    <BriefSection title={BRIEF_TEXTS.neverSentTitle}>
      <ul className={styles.list}>
        {BRIEF_TEXTS.neverSent.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </BriefSection>
  );
}

function Content({ response }: { response: CoachBriefResponse }) {
  const { brief, preview } = response;
  // Un dossier d'un ancien `brief_schema` ne passe pas le schéma courant : son JSON exact seul, sans erreur.
  const parsed = brief === null ? null : CoachBriefSchema.safeParse(brief);
  return (
    <div className={styles.stack}>
      <p className={styles.lead}>{BRIEF_TEXTS.intro}</p>
      {preview ? <Banner tone="info">{BRIEF_TEXTS.preview}</Banner> : null}
      {brief === null ? <p className={styles.lead}>{BRIEF_TEXTS.gone}</p> : null}
      {parsed?.success ? (
        <>
          <ProfileSection brief={parsed.data} />
          <PlacesSection brief={parsed.data} />
          <ProgramSection brief={parsed.data} />
          <HistorySection brief={parsed.data} />
          <RecordsSection brief={parsed.data} />
          {parsed.data.health ? <HealthSection health={parsed.data.health} /> : null}
          <BriefSection title="Nutrition">
            <p className={styles.muted}>{BRIEF_TEXTS.nutrition}</p>
          </BriefSection>
        </>
      ) : null}
      {parsed && !parsed.success ? <p className={styles.lead}>{BRIEF_TEXTS.legacy}</p> : null}
      {brief === null ? null : <JsonSection brief={brief} />}
      <NeverSentSection />
    </div>
  );
}

/**
 * Ce que le coach voit (spec brique 4 §16.5) : le dossier du fil du jour, tel que stocké, en sections lisibles puis
 * en JSON exact, et la liste de ce qui ne part jamais. Sans fil, un aperçu calculé à l'instant. `brief: null`
 * (retrait de l'accord santé) : ni sections ni JSON. Un ancien dossier : son JSON seul. Tout texte du dossier est
 * rendu comme du texte. Un accord à donner (`consent_required`) ouvre le panneau d'accord.
 */
export function BriefPage() {
  const repos = useRepos();
  const [, navigate] = useLocation();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    repos.coach
      .brief()
      .then((response) => {
        if (!cancelled) setLoad({ kind: 'ready', response });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoad(
          e instanceof ApiError && e.code === 'consent_required'
            ? { kind: 'consent' }
            : { kind: 'error', message: errorMessage(e) },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [repos]);

  return (
    <Page title={BRIEF_TEXTS.title} back="/profile/coach">
      {load.kind === 'ready' ? <Content response={load.response} /> : null}
      {load.kind === 'error' ? <Banner tone="error">{load.message}</Banner> : null}
      {load.kind === 'consent' ? (
        <SystemPanel title={STATE_TEXTS.consentMissing}>
          <Button block onClick={() => navigate('/coach/consent')}>
            {STATE_TEXTS.consentActivate}
          </Button>
        </SystemPanel>
      ) : null}
    </Page>
  );
}
