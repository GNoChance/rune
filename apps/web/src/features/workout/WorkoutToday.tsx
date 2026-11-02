import { useState } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { useLive } from '../../app-services';
import {
  type PlannedSession,
  type ProgramView,
  type StartInput,
  useActiveSession,
  useCatalog,
  useOtherDeviceSession,
  usePlannedWorkout,
  useProgramView,
  useRepos,
} from '../../repos';
import { Badge, Banner, Button, ListRow, Page } from '../../ui';
import { CatalogMissing } from '../exercises/CatalogMissing';
import { OtherDeviceBanner } from './OtherDeviceBanner';
import { PlaceChips } from './PlaceChips';
import { ExerciseSheetSheet, PlanList } from './PlanList';
import { WorkoutPicker } from './WorkoutPicker';
import styles from './workout.module.css';
import { ALL_SKIPPED_TEXT, nameOf, noticeText } from './workout-labels';

const UPDATE_APP = "Mets à jour l'appli pour que tes cibles soient calculées ici.";

/**
 * Séance du jour (`/workout`, spec brique 3 §7.1 et §7.2) :
 * - une séance en cours sur cet appareil ouvre directement `/workout/:id` ;
 * - une séance en cours sur un autre appareil : « Continuer ici », « La terminer », « La supprimer » ;
 * - sinon la séance du jour : programme, semaine, lieu, liste des exercices, avis et actions ; sans programme,
 *   « Choisis ton programme » et « Séance libre ».
 * Tout est lu en local : « Commencer » comme « Séance libre » marchent hors ligne.
 */
export function WorkoutToday() {
  const active = useActiveSession();
  const other = useOtherDeviceSession();
  const catalog = useCatalog();
  if (active === undefined || other === undefined || catalog.state === 'loading') return null;
  if (active) return <Redirect to={`/workout/${active.id}`} replace />;
  if (other) return <OtherDeviceBanner session={other} />;
  if (catalog.state === 'missing') {
    return (
      <Page title="Séance">
        <CatalogMissing />
      </Page>
    );
  }
  return (
    <Today
      names={new Map(catalog.sheets.map((s) => [s.id, s.name]))}
      retired={new Set(catalog.sheets.filter((s) => s.status === 'retired').map((s) => s.id))}
    />
  );
}

function Today(p: { names: ReadonlyMap<string, string>; retired: ReadonlySet<string> }) {
  const repos = useRepos();
  const [, navigate] = useLocation();
  const view = useProgramView();
  const places = useLive(() => repos.places.list(), [repos]);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [openSheet, setOpenSheet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const planned = usePlannedWorkout(placeId, workoutId);
  if (view === undefined || places === undefined) return null;

  const chosenPlace = placeId ?? places.find((pl) => pl.isPrimary)?.id ?? null;
  const begin = (input: StartInput) => {
    setError(null);
    repos.workouts.start(input).then(
      (id) => navigate(`/workout/${id}`),
      () => setError('Impossible de commencer la séance pour le moment.'),
    );
  };
  const freeSession = () =>
    begin({ plan: null, placeId: chosenPlace, instanceId: null, workoutId: null, templateVersion: null });

  const chips =
    places.length > 0 ? <PlaceChips places={places} value={chosenPlace} onChange={setPlaceId} /> : null;
  const errorBanner = error ? <Banner tone="error">{error}</Banner> : null;

  if (view === null) {
    return (
      <Page title="Séance">
        <div className={styles.stack}>
          {chips}
          <ul className={styles.linkCard}>
            <ListRow
              label="Choisis ton programme"
              value="Un repère pour chaque séance"
              href="/program/choose"
            />
          </ul>
          {errorBanner}
          <Button variant="secondary" block onClick={freeSession}>
            Séance libre
          </Button>
        </div>
      </Page>
    );
  }

  const workouts = view.program.template.workouts;
  const currentId = planned?.workoutId ?? view.replay.state.nextWorkoutId;
  const workout = workouts.find((w) => w.id === currentId);
  const allSkipped =
    planned !== null && planned !== undefined && !planned.plan.exercises.some((e) => e.exerciseId !== null);

  return (
    <Page title={view.program.template.name}>
      <div className={styles.stack}>
        <Header
          view={view}
          workoutName={workout?.name ?? currentId}
          deload={planned?.plan.weekType === 'deload'}
        />
        {view.source === 'server' ? <Banner tone="info">{UPDATE_APP}</Banner> : null}
        {chips}
        {planned === undefined ? null : planned === null ? (
          <p className={styles.hint}>Ajoute un lieu dans ton profil pour voir la séance du jour.</p>
        ) : (
          <TodayPlan
            planned={planned}
            view={view}
            names={p.names}
            retired={p.retired}
            allSkipped={allSkipped}
            onChange={() => setPicking(true)}
            onOpen={setOpenSheet}
          />
        )}
        {errorBanner}
        <Actions
          planned={planned ?? null}
          allSkipped={allSkipped}
          onStart={(session) => begin(session)}
          onFree={freeSession}
        />
      </div>
      <WorkoutPicker
        open={picking}
        workouts={workouts}
        currentId={currentId}
        onPick={(id) => {
          setWorkoutId(id);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
      {openSheet ? (
        <ExerciseSheetSheet
          exerciseId={openSheet}
          name={nameOf(p.names, openSheet)}
          onClose={() => setOpenSheet(null)}
        />
      ) : null}
    </Page>
  );
}

/** « Semaine n · Séance B » et, s'il y a lieu, la pastille « Semaine allégée ». */
function Header(p: { view: ProgramView; workoutName: string; deload: boolean }) {
  return (
    <div className={styles.header}>
      <p className={styles.week}>{`Semaine ${p.view.replay.state.weekIndex + 1} · ${p.workoutName}`}</p>
      {p.deload ? <Badge tone="accent">Semaine allégée</Badge> : null}
    </div>
  );
}

function TodayPlan(p: {
  planned: PlannedSession;
  view: ProgramView;
  names: ReadonlyMap<string, string>;
  retired: ReadonlySet<string>;
  allSkipped: boolean;
  onChange(): void;
  onOpen(exerciseId: string): void;
}) {
  const { plan } = p.planned;
  const notices = plan.notices.filter((n) => n.code !== 'all_skipped');
  return (
    <>
      <div className={styles.workoutLine}>
        <p className={styles.hint}>{`Durée estimée : ${p.view.program.template.estimatedMinutes} min`}</p>
        <Button variant="ghost" onClick={p.onChange}>
          Changer
        </Button>
      </div>
      {notices.length > 0 || p.view.proposals.length > 0 ? (
        <div className={styles.notices}>
          {notices.map((n) => (
            <Banner key={`${n.code}-${'exerciseId' in n ? n.exerciseId : ''}`} tone="info">
              {noticeText(n, p.names)}
            </Banner>
          ))}
          {p.view.proposals.length > 0 ? (
            <Banner tone="info">
              Une proposition t'attend. <Link href="/program">Voir la proposition</Link>
            </Banner>
          ) : null}
        </div>
      ) : null}
      {p.allSkipped ? (
        <Banner tone="warning">{ALL_SKIPPED_TEXT}</Banner>
      ) : (
        <PlanList plan={plan} names={p.names} retired={p.retired} onOpen={p.onOpen} />
      )}
    </>
  );
}

function Actions(p: {
  planned: PlannedSession | null;
  allSkipped: boolean;
  onStart(session: PlannedSession): void;
  onFree(): void;
}) {
  return (
    <div className={styles.actions}>
      {p.planned && !p.allSkipped ? (
        <Button block onClick={() => p.planned && p.onStart(p.planned)}>
          Commencer
        </Button>
      ) : null}
      <Button variant="secondary" block onClick={p.onFree}>
        Séance libre
      </Button>
      <Link href={p.allSkipped ? '/program/choose' : '/program'} className={styles.link}>
        {p.allSkipped ? 'Changer de programme' : 'Mon programme'}
      </Link>
    </div>
  );
}
