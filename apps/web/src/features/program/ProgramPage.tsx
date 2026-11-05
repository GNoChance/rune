import { type ReactNode, useId, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useServices, useSyncState } from '../../app-services';
import {
  type ProgramEditContext,
  type ProgramView,
  useProgramEditContext,
  useProgramView,
  useRepos,
} from '../../repos';
import { Badge, Banner, Button, EmptyState, Page } from '../../ui';
import { coachStoreFor } from '../coach/coach-store';
import { ENTRY_TEXTS, PROGRAM_PREFILL } from '../coach/coach-texts';
import { OfflineNotice } from './ActionError';
import { ChangeLog } from './ChangeLog';
import { EnrollSheet } from './EnrollSheet';
import { AddSlotSheet, DaysSheet, DeloadSheet } from './ProgramSheets';
import { ProposalCard } from './ProposalCard';
import styles from './program.module.css';
import {
  CAUTIOUS_NO_ADD,
  NEW_VERSION_ACTION,
  NEW_VERSION_TEXT,
  programFacts,
  weekLabel,
} from './program-labels';
import { programNames, slotDisplay } from './program-model';
import { SlotSheet } from './SlotSheet';

type OpenSheet =
  | { kind: 'slot'; slotId: string }
  | { kind: 'add'; workoutId: string }
  | { kind: 'days' }
  | { kind: 'deload' }
  | { kind: 'version' };

/** Ligne d'action du programme : libellé (son nom), valeur en description. */
function ActionRow(p: { label: string; value?: string; disabled: boolean; onClick(): void }) {
  const id = useId();
  return (
    <button
      type="button"
      className={styles.row}
      disabled={p.disabled}
      aria-labelledby={`${id}-label`}
      aria-describedby={p.value ? `${id}-value` : undefined}
      onClick={p.onClick}
    >
      <span id={`${id}-label`} className={styles.rowName}>
        {p.label}
      </span>
      {p.value ? (
        <span id={`${id}-value`} className={styles.rowValue}>
          {p.value}
        </span>
      ) : null}
    </button>
  );
}

function ProgramIcon() {
  return (
    <svg
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
      <rect x="4" y="4" width="16" height="17" rx="2" />
      <path d="M8 2.5v3M16 2.5v3M8 11h8M8 15h5" />
    </svg>
  );
}

/** Séances du modèle : chaque slot (exercice résolu au lieu principal, séries, repos, état), puis « Ajouter un exercice ». */
function Workouts(p: { view: ProgramView; ctx: ProgramEditContext; open(sheet: OpenSheet): void }) {
  const { view, ctx } = p;
  const titleId = useId();
  const cautious = ctx.profile === 'cautious';
  return (
    <section aria-labelledby={titleId} className={styles.section}>
      <h2 id={titleId} className={styles.sectionTitle}>
        Séances du modèle
      </h2>
      {cautious ? <p className={styles.muted}>{CAUTIOUS_NO_ADD}</p> : null}
      {view.program.template.workouts.map((w) => (
        <WorkoutBlock key={w.id} workoutId={w.id} {...p} />
      ))}
    </section>
  );
}

function WorkoutBlock(p: {
  workoutId: string;
  view: ProgramView;
  ctx: ProgramEditContext;
  open(sheet: OpenSheet): void;
}) {
  const { view, ctx } = p;
  const titleId = useId();
  const workout = view.program.template.workouts.find((w) => w.id === p.workoutId);
  if (workout === undefined) return null;
  return (
    <section aria-labelledby={titleId} className={styles.workout}>
      <h3 id={titleId} className={styles.workoutTitle}>
        {workout.name}
      </h3>
      <ul className={styles.slots}>
        {workout.slots.map((slot) => (
          <SlotRow
            key={slot.id}
            view={view}
            ctx={ctx}
            slotId={slot.id}
            onOpen={() => p.open({ kind: 'slot', slotId: slot.id })}
          />
        ))}
      </ul>
      {ctx.profile === 'cautious' ? null : (
        <Button
          variant="ghost"
          block
          aria-describedby={titleId}
          onClick={() => p.open({ kind: 'add', workoutId: workout.id })}
        >
          Ajouter un exercice
        </Button>
      )}
    </section>
  );
}

function SlotRow(p: { view: ProgramView; ctx: ProgramEditContext; slotId: string; onOpen(): void }) {
  const id = useId();
  const slot = p.view.program.template.workouts.flatMap((w) => w.slots).find((s) => s.id === p.slotId);
  if (slot === undefined) return null;
  const d = slotDisplay(slot, p.view, p.ctx);
  return (
    <li>
      <button
        type="button"
        className={styles.slot}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-summary${d.target || d.suspended ? ` ${id}-state` : ''}`}
        onClick={p.onOpen}
      >
        <span className={styles.slotText}>
          <span id={`${id}-name`} className={styles.rowName}>
            {d.name}
          </span>
          <span id={`${id}-summary`} className={styles.rowValue}>
            {d.summary}
          </span>
        </span>
        {d.suspended ? (
          <span id={`${id}-state`}>
            <Badge tone="warning">Suspendu</Badge>
          </span>
        ) : d.target ? (
          <span id={`${id}-state`} className={styles.target}>
            {d.target}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function Section(p: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.section}>
      <h2 id={titleId} className={styles.sectionTitle}>
        {p.title}
      </h2>
      {p.children}
    </section>
  );
}

/**
 * Mon programme (`/program`, spec brique 3 §7.7) : en-tête (nom, semaine et bloc, jours en vigueur — ceux du
 * programme effectif, ruling R35 —, date de début), bandeau de nouvelle version du modèle, propositions en attente,
 * séances du modèle et feuille de chaque slot, réglages du programme (jours, semaine allégée, changer de programme),
 * journal. Toute action passe par l'API (« Nécessite le réseau » hors ligne) ; le programme se relit du miroir après
 * le pull qui suit.
 */
export function ProgramPage() {
  const view = useProgramView();
  const ctx = useProgramEditContext();
  const repos = useRepos();
  const { connection } = useSyncState();
  const services = useServices();
  const [, navigate] = useLocation();
  const offline = connection === 'offline';
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const names = useMemo(() => (view && ctx ? programNames(view, ctx) : null), [view, ctx]);
  const close = () => setSheet(null);
  // Ne part rien : le début de message attend dans le champ du coach, que la personne complète et envoie.
  const askCoach = () => {
    coachStoreFor(services).setDraft(PROGRAM_PREFILL);
    navigate('/coach');
  };

  if (view === null) return <NoProgram />;
  if (view === undefined || ctx === undefined || names === null) {
    return (
      <Page title="Mon programme" back="/workout">
        {null}
      </Page>
    );
  }

  const { instance, program, replay } = view;
  const served = view.template;
  // Jamais de bascule automatique ; une nouvelle version que le catalogue ne permet pas de suivre n'est pas proposée.
  const newVersion = served?.available === true && served.template.version > instance.templateVersion;
  const sheetProps = { view, ctx, offline, onClose: close };

  return (
    <Page title="Mon programme" back="/workout">
      <div className={styles.page}>
        <header className={styles.header}>
          <h2 className={styles.programName}>{program.template.name}</h2>
          <p className={styles.week}>{weekLabel(replay.state, program.template)}</p>
          <p className={styles.muted}>{programFacts(program.daysPerWeek, instance.startedAt)}</p>
        </header>
        <OfflineNotice offline={offline} />
        {newVersion ? (
          <Banner tone="info">
            <div className={styles.bannerContent}>
              <p>{NEW_VERSION_TEXT}</p>
              <Button variant="secondary" disabled={offline} onClick={() => setSheet({ kind: 'version' })}>
                {NEW_VERSION_ACTION}
              </Button>
            </div>
          </Banner>
        ) : null}
        {view.proposals.length > 0 ? (
          <Section title="Propositions en attente">
            {view.proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                view={view}
                ctx={ctx}
                names={names}
                offline={offline}
              />
            ))}
          </Section>
        ) : null}
        <Workouts view={view} ctx={ctx} open={setSheet} />
        <Section title="Réglages du programme">
          <div className={styles.rows}>
            <ActionRow
              label="Jours par semaine"
              value={String(program.daysPerWeek)}
              disabled={offline}
              onClick={() => setSheet({ kind: 'days' })}
            />
            <ActionRow
              label="Commencer une semaine allégée"
              disabled={offline}
              onClick={() => setSheet({ kind: 'deload' })}
            />
            <Link href="/program/choose" className={styles.row}>
              <span className={styles.rowName}>Changer de programme</span>
            </Link>
            <ActionRow label={ENTRY_TEXTS.adjust} disabled={offline} onClick={askCoach} />
          </div>
        </Section>
        <ChangeLog changes={view.changes} names={names} />
      </div>
      {sheet?.kind === 'slot' ? <SlotSheet key={sheet.slotId} slotId={sheet.slotId} {...sheetProps} /> : null}
      {sheet?.kind === 'add' ? <AddSlotSheet workoutId={sheet.workoutId} {...sheetProps} /> : null}
      {sheet?.kind === 'days' ? <DaysSheet {...sheetProps} /> : null}
      {sheet?.kind === 'deload' ? <DeloadSheet {...sheetProps} /> : null}
      {sheet?.kind === 'version' && served !== null ? (
        <EnrollSheet
          template={served.template}
          title={NEW_VERSION_ACTION}
          confirmLabel={NEW_VERSION_ACTION}
          defaultDays={program.daysPerWeek}
          switching
          offline={offline}
          submit={(days) =>
            repos.program.change(
              [{ op: 'switch_template', templateId: instance.templateId, daysPerWeek: days }],
              instance.revision,
            )
          }
          onDone={close}
          onClose={close}
        />
      ) : null}
    </Page>
  );
}

/** Sans programme actif : « Choisis ton programme » vers `/program/choose` (spec §7.2). */
function NoProgram() {
  return (
    <Page title="Mon programme" back="/workout">
      <EmptyState
        icon={<ProgramIcon />}
        title="Pas encore de programme"
        text="Choisis un programme pour avoir ta séance du jour."
        action={
          <Link href="/program/choose" className={styles.linkButton}>
            Choisis ton programme
          </Link>
        }
      />
    </Page>
  );
}
