import type { CoachId } from '@rune/contracts';
import { useCallback, useEffect, useId, useState } from 'react';
import { useMe } from '../../app-services';
import { useRepos } from '../../repos';
import { useTrainingProfile } from '../../repos/use-training-profile';
import {
  Banner,
  BottomSheet,
  Button,
  COACH_NAMES,
  CoachAvatar,
  CoachBubble,
  ListGroup,
  ListRow,
  Page,
  useAction,
} from '../../ui';
import { useFocusAfterClose } from '../profile/use-focus-after-close';
import { CoachChoices } from './CoachStep';
import accountStyles from './coach-account.module.css';
import { COACHES, coachText } from './coach-lines';
import { useCoachStore } from './coach-store';
import { MY_COACH_TEXTS, STATE_TEXTS } from './coach-texts';
import { ConfirmDeleteSheet, DeactivateSheet } from './DeactivateSheet';
import styles from './my-coach.module.css';

/** Bouton de confirmation de la feuille, le nom du coach en complément (prototype). */
const CHOOSE_LABELS: Readonly<Record<CoachId, string>> = {
  ombre: "Choisir L'Ombre",
  skald: 'Choisir le Skald',
  scribe: 'Choisir le Scribe',
};

const ignore = () => {};

/**
 * Profil › Mon coach (spec refonte §8, prototype « Mon coach ») : le coach choisi, ses deux avatars
 * (entraînement et nutrition), son nom, son tempérament et un aperçu de sa voix étiqueté, puis la mention que
 * la section du coach IA. « Changer de coach » ouvre une feuille avec les trois choix ;
 * confirmer l'enregistre sur le serveur (`setCoach`, classe E). Le coach confirmé s'affiche tout de suite,
 * jusqu'à la relecture du profil (pull après l'envoi), avec « <coach> est ton nouveau coach. », qui reste tant
 * qu'une relecture ne le contredit pas. La section « Coach IA » (spec brique 4 §16.7) vient en dessous. Sur un nouvel appareil avant le premier pull, le miroir vide ne dit pas
 * « pas de coach » : ni coach ni « Changer de coach » tant que le profil n'est pas connu.
 */
export function MyCoachPage() {
  const me = useMe();
  const { coach: saved, loaded, known } = useTrainingProfile();
  const [chosen, setChosen] = useState<CoachId | null>(null);
  const [announced, setAnnounced] = useState<CoachId | null>(null);
  const [sheet, setSheet] = useState(false);
  const changeId = useId();
  const closeSheet = useCallback(() => setSheet(false), []);
  useFocusAfterClose(sheet, () => document.getElementById(changeId));

  // Toute relecture du coach enregistré fait de nouveau foi : le choix affiché s'efface, et l'annonce aussi
  // quand la relecture la contredit (un autre appareil a choisi un autre coach depuis).
  useEffect(() => {
    setChosen(null);
    setAnnounced((c) => (c === saved ? c : null));
  }, [saved]);

  // Rien avant la lecture du profil : la feuille ouverte trop tôt n'aurait pas le coach actuel.
  if (!me || !loaded) return null;
  const coach = chosen ?? saved;
  // L'annonce ne vaut que pour le coach affiché, dès le rendu qui le change (avant l'effet qui l'efface).
  const notice = announced !== null && announced === coach ? announced : null;

  function changed(next: CoachId) {
    setChosen(next);
    setAnnounced(next);
    setSheet(false);
  }

  return (
    <Page title="Mon coach" back="/profile">
      {notice ? <Banner tone="info">{`${COACH_NAMES[notice]} est ton nouveau coach.`}</Banner> : null}
      {known && coach ? <CoachHero key={coach} coach={coach} pseudo={me.username} /> : null}
      {known ? (
        <>
          <Button
            id={changeId}
            variant="secondary"
            block
            onClick={() => {
              setAnnounced(null);
              setSheet(true);
            }}
          >
            Changer de coach
          </Button>
          <ChangeCoachSheet
            open={sheet}
            current={coach}
            pseudo={me.username}
            onClose={closeSheet}
            onChanged={changed}
          />
        </>
      ) : null}
      <CoachSection />
    </Page>
  );
}

/**
 * Section « Coach IA » (spec brique 4 §16.7) : l'état (désactivé, actif ou en pause) d'après `status`, « Activer le
 * coach IA » ou « Ouvrir la conversation », puis les liens du coach, « Supprimer mes conversations » (confirmation,
 * sans mot de passe) et, isolé en bas, « Désactiver le coach IA » (mot de passe). Désactivé, il n'y a ni
 * conversation à supprimer ni accord à retirer.
 */
function CoachSection() {
  const repos = useRepos();
  const { state, store } = useCoachStore();
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const closeConfirm = useCallback(() => setConfirming(false), []);
  const closeDeactivate = useCallback(() => setDeactivating(false), []);

  useEffect(() => {
    void store.load();
  }, [store]);

  const { status } = state;
  // Accord actif : on peut le retirer et effacer ses conversations, même si le texte a changé ; parler au coach
  // demande en plus le texte en vigueur.
  const active = status?.consent.active === true;
  const on = active && !status.consent.needsRenewal;
  const stateText =
    status === null
      ? state.error === null
        ? null
        : MY_COACH_TEXTS.unknown
      : !on
        ? status.consent.needsRenewal
          ? STATE_TEXTS.consentChanged
          : MY_COACH_TEXTS.disabled
        : status.available
          ? MY_COACH_TEXTS.active
          : MY_COACH_TEXTS.paused;

  async function deleteAll() {
    await repos.coach.deleteAllThreads();
    await store.load();
  }

  return (
    <section aria-labelledby={titleId} className={accountStyles.section}>
      <h2 id={titleId} className={accountStyles.title}>
        {MY_COACH_TEXTS.title}
      </h2>
      <p className={accountStyles.lead}>{MY_COACH_TEXTS.intro}</p>
      {stateText === null ? null : <p className={accountStyles.state}>{stateText}</p>}
      {status === null ? null : (
        <ListGroup>
          {on ? (
            <ListRow label={MY_COACH_TEXTS.open} href="/coach" />
          ) : (
            <ListRow label={MY_COACH_TEXTS.activate} href="/coach/consent" />
          )}
          {on ? <ListRow label={MY_COACH_TEXTS.brief} href="/coach/brief" /> : null}
          {active ? <ListRow label={STATE_TEXTS.previousThreads} href="/coach/threads" /> : null}
          <ListRow label={MY_COACH_TEXTS.usage} href="/help/coach" />
        </ListGroup>
      )}
      {active ? (
        <>
          <Button variant="secondary" block onClick={() => setConfirming(true)}>
            {MY_COACH_TEXTS.deleteAll}
          </Button>
          <div className={accountStyles.isolated}>
            <Button variant="danger" block onClick={() => setDeactivating(true)}>
              {MY_COACH_TEXTS.deactivate}
            </Button>
          </div>
        </>
      ) : null}
      <ConfirmDeleteSheet
        open={confirming}
        title={MY_COACH_TEXTS.deleteAll}
        body={MY_COACH_TEXTS.deleteAllBody}
        onConfirm={deleteAll}
        onClose={closeConfirm}
      />
      <DeactivateSheet open={deactivating} onClose={closeDeactivate} />
    </section>
  );
}

/**
 * Le coach en grand : ses deux avatars, nommés (« Le Skald », « Le Skald, mode nutrition ») et légendés
 * Entraînement et Nutrition, puis son nom, son tempérament et l'aperçu de sa voix. Remonté à chaque changement
 * de coach : les avatars grandissent de nouveau (un fondu sous mouvement réduit).
 */
function CoachHero(p: { coach: CoachId; pseudo: string }) {
  const nameId = useId();
  const texts = COACHES[p.coach];
  return (
    <section aria-labelledby={nameId} className={styles.hero}>
      <div className={styles.avatars}>
        <figure className={styles.figure}>
          <span className={styles.grow}>
            <CoachAvatar coach={p.coach} size={112} animated="brief" />
          </span>
          <figcaption className={styles.caption}>
            <i className={styles.diamond} data-tone="training" aria-hidden="true" />
            Entraînement
          </figcaption>
        </figure>
        <figure className={styles.figure}>
          <span className={styles.grow}>
            <CoachAvatar coach={p.coach} mode="nutrition" size={112} animated="brief" />
          </span>
          <figcaption className={styles.caption}>
            <i className={styles.diamond} data-tone="nutrition" aria-hidden="true" />
            Nutrition
          </figcaption>
        </figure>
      </div>
      <div className={styles.identity}>
        <h2 id={nameId} className={styles.name}>
          {texts.name}
        </h2>
        <p className={styles.temper}>{texts.temper}</p>
      </div>
      <CoachBubble coach={p.coach} label="Aperçu">
        {coachText(p.coach, 'sample', p.pseudo)}
      </CoachBubble>
    </section>
  );
}

type SheetProps = {
  open: boolean;
  current: CoachId | null;
  pseudo: string;
  onClose(): void;
  onChanged(coach: CoachId): void;
};

/**
 * Feuille « Changer de coach » : les trois coachs en cartes, l'actuel coché ; la confirmation, désactivée tant
 * que le choix est l'actuel, enregistre le nouveau coach. Pendant l'envoi, cartes et boutons sont figés et
 * Échap ne ferme pas ; un échec (hors ligne, serveur) laisse la feuille ouverte avec le message. Fermée, rien
 * n'est monté : chaque ouverture repart du coach actuel. Tant que rien n'est choisi, le coché suit le coach
 * actuel, même relu pendant que la feuille est ouverte (un autre appareil en a changé).
 */
function ChangeCoachSheet(p: SheetProps) {
  return p.open ? <OpenCoachSheet {...p} /> : null;
}

function OpenCoachSheet(p: SheetProps) {
  const repos = useRepos();
  const [picked, setPicked] = useState<CoachId | null>(null);
  const pick = picked ?? p.current;
  const save = useAction(async (coach: CoachId) => {
    await repos.profile.setCoach(coach);
    return true;
  });
  const next = pick !== null && pick !== p.current ? pick : null;

  async function confirm() {
    if (next === null) return;
    if (await save.run(next)) p.onChanged(next);
  }

  return (
    <BottomSheet
      open
      title="Changer de coach"
      onClose={save.pending ? ignore : p.onClose}
      actions={
        <>
          <Button disabled={next === null || save.pending} onClick={() => void confirm()}>
            {next !== null
              ? CHOOSE_LABELS[next]
              : p.current === null
                ? 'Choisis un coach'
                : 'Choisis un autre coach'}
          </Button>
          <Button variant="secondary" disabled={save.pending} onClick={p.onClose}>
            Annuler
          </Button>
        </>
      }
    >
      <div className={styles.sheetBody}>
        <CoachChoices
          name="coach-change"
          legend="Ton historique et tes rangs restent intacts. Seul le ton change."
          pseudo={p.pseudo}
          value={pick}
          disabled={save.pending}
          onChange={(coach) => {
            setPicked(coach);
            save.reset();
          }}
        />
        <p className={accountStyles.muted}>{MY_COACH_TEXTS.nextTone}</p>
        {save.error ? <Banner tone="error">{save.error}</Banner> : null}
      </div>
    </BottomSheet>
  );
}
