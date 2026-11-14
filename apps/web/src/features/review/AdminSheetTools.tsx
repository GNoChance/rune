import type {
  DraftSheet,
  ExerciseStatus,
  PublishBlocker,
  ReviewSheetResponse,
  ReviewValidationView,
} from '@rune/contracts';
import { EXERCISE_TRANSITIONS, sheetForTransition, transitionBlockers } from '@rune/domain';
import { useCallback, useId, useRef, useState } from 'react';
import { revisionConflictOf, transitionBlockersOf, useRepos } from '../../repos';
import { Banner, BottomSheet, Button, errorMessage, formatDateTime } from '../../ui';
import styles from './review.module.css';
import { blockerMessage, transitionLabel } from './review-labels';
import { useOnLostAccess } from './use-lost-access';

/*
 * Outils de l'admin sur une fiche de la relecture (spec brique 2 §4.5, §3.6, 04 §8) : « Modifier », « Publier »
 * désactivé tant qu'un blocage existe (messages du §3.6 écrits dessous), les autres changements de statut du circuit
 * (`EXERCISE_TRANSITIONS`), la version exportée, et les validations nominatives (§3.1 : seul l'admin voit qui a
 * donné un feu vert santé).
 */

const openComments = (data: ReviewSheetResponse) => data.comments.filter((c) => c.resolvedAt === null).length;

/**
 * Blocages de `reviewed → published` connus de l'écran (`transitionBlockers`, la fonction du serveur) : commentaires
 * ouverts, feu vert santé, illustrations absentes du manifeste local. Le serveur fait foi : la file « Prête à
 * publier » dans `queues` ouvre « Publier ». S'il la refuse sans cause visible ici, il ne reste que
 * `illustrations_missing` (manifeste local en retard), seul autre blocage de cette transition.
 */
export function publishBlockers(
  data: ReviewSheetResponse,
  manifestIds: ReadonlySet<string> | undefined,
): PublishBlocker[] {
  if (data.sheet.status !== 'reviewed' || data.queues.includes('ready_to_publish')) return [];
  const known = transitionBlockers({
    sheet: data.sheet,
    to: 'published',
    comments: data.comments,
    greenLight: data.greenLight === 'ok',
    reviewChecked: true,
    minorsConfirmed: true,
    // Manifeste local pas encore lu : rien n'est compté absent avant de l'avoir lu.
    manifestIds: manifestIds ?? new Set((data.sheet.illustrations ?? []).map((i) => i.illustration_id)),
    templateRefs: new Set(),
    catalog: [],
  });
  return known.length > 0 ? known : ['illustrations_missing'];
}

/** Blocages d'une autre transition connus de l'écran ; ceux qui portent sur le catalogue restent au serveur (422). */
function knownBlockers(
  data: ReviewSheetResponse,
  to: ExerciseStatus,
  checks: { review: boolean; minors: boolean },
  manifestIds: ReadonlySet<string> | undefined,
): PublishBlocker[] {
  if (to === 'published') return publishBlockers(data, manifestIds);
  return transitionBlockers({
    sheet: sheetForTransition(data.sheet, to),
    to,
    comments: data.comments,
    greenLight: data.greenLight === 'ok',
    reviewChecked: checks.review,
    minorsConfirmed: checks.minors,
    manifestIds: manifestIds ?? new Set(),
    templateRefs: new Set(),
    catalog: [],
  });
}

/** Version exportée de la fiche (04 §10) : « Jamais exportée. », à jour, ou en retard sur la fiche. */
export function exportedText(sheet: DraftSheet, exportedRevision: number | null): string {
  if (exportedRevision === null) return 'Jamais exportée.';
  if (exportedRevision === sheet.revision) return `Version ${exportedRevision} exportée.`;
  return `Version ${exportedRevision} exportée, version ${sheet.revision} à exporter.`;
}

/** Titre de la feuille de confirmation d'un changement de statut. */
function transitionTitle(sheet: DraftSheet, to: ExerciseStatus): string {
  switch (to) {
    case 'published':
      return `Publier la version ${sheet.revision}`;
    case 'reviewed':
      return sheet.status === 'retired'
        ? `Réactiver « ${sheet.name} »`
        : `Marquer la version ${sheet.revision} relue`;
    case 'draft':
      return `Renvoyer « ${sheet.name} » en brouillon`;
    case 'retired':
      return `Retirer « ${sheet.name} »`;
  }
}

/** Ce que le changement de statut engage, écrit dans la feuille. */
function transitionText(sheet: DraftSheet, to: ExerciseStatus): string {
  switch (to) {
    case 'published':
      return `Les membres recevront la version ${sheet.revision} à leur prochaine synchronisation.`;
    case 'reviewed':
      return sheet.status === 'retired'
        ? 'La fiche revient en relue : il faudra la publier de nouveau pour les membres.'
        : `Les relectrices pourront valider la version ${sheet.revision}.`;
    case 'draft':
      return "La fiche retourne en rédaction : elle n'est plus proposée à la validation.";
    case 'retired':
      return 'La fiche ne sera plus proposée aux membres ; tu pourras la réactiver.';
  }
}

/** Liste des messages de blocage (§3.6), nommée pour les lecteurs d'écran. */
function BlockerList(p: { id?: string; label: string; blockers: readonly PublishBlocker[]; open: number }) {
  return (
    <ul id={p.id} aria-label={p.label} className={styles.blockers}>
      {p.blockers.map((code) => (
        <li key={code}>{blockerMessage(code, p.open)}</li>
      ))}
    </ul>
  );
}

/**
 * Feuille de confirmation d'un changement de statut : ce qu'il engage, les deux cases de l'entrée en `reviewed`
 * (« Consignes et sécurité vérifiées », « Déconseillé aux mineurs » confirmé), demandées aussi à la réactivation
 * d'une fiche retirée, qui a pu être modifiée depuis sa dernière relecture ; les blocages connus ici (bouton
 * inactif tant qu'il en reste), puis l'envoi avec la révision affichée.
 * - 422 : les blocages du serveur remplacent ceux de l'écran, la fiche est relue (`onBlocked`) ;
 * - 409 : la feuille se ferme, l'écran le dit et relit la fiche (`onConflict`) ;
 * - réussite : la fiche rendue par le serveur (`onDone`).
 */
function TransitionSheet(p: {
  data: ReviewSheetResponse;
  to: ExerciseStatus;
  manifestIds: ReadonlySet<string> | undefined;
  onClose(): void;
  onDone(next: ReviewSheetResponse): void;
  onConflict(): void;
  onBlocked(): void;
}) {
  const repos = useRepos();
  const onLostAccess = useOnLostAccess();
  const { sheet } = p.data;
  // `reviewed` ne s'atteint que depuis `draft` ou `retired` (04 §8).
  const entersReview = p.to === 'reviewed';
  const [checks, setChecks] = useState({ review: false, minors: false });
  const [refused, setRefused] = useState<PublishBlocker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const known = knownBlockers(p.data, p.to, checks, p.manifestIds);
  const shown = refused ?? known;
  const label = transitionLabel(sheet.status, p.to);
  const { onClose } = p;
  const close = useCallback(() => {
    if (!sending.current) onClose();
  }, [onClose]);

  async function send() {
    if (sending.current || known.length > 0) return;
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      const next = await repos.review.transition(sheet.id, {
        to: p.to,
        baseRevision: sheet.revision,
        ...(entersReview ? { reviewChecked: checks.review, minorsConfirmed: checks.minors } : {}),
      });
      sending.current = false;
      p.onDone(next);
    } catch (e) {
      sending.current = false;
      setPending(false);
      if (onLostAccess(e)) return;
      if (revisionConflictOf(e)) {
        p.onConflict();
        return;
      }
      const blockers = transitionBlockersOf(e);
      if (blockers) {
        setRefused(blockers);
        p.onBlocked();
        return;
      }
      setError(errorMessage(e));
    }
  }

  return (
    <BottomSheet
      open
      title={transitionTitle(sheet, p.to)}
      onClose={close}
      actions={
        <>
          <Button
            variant={p.to === 'retired' ? 'danger' : 'primary'}
            onClick={() => void send()}
            disabled={pending || known.length > 0}
          >
            {label}
          </Button>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Annuler
          </Button>
        </>
      }
    >
      <div className={styles.sheetStack}>
        <p className={styles.sheetText}>{transitionText(sheet, p.to)}</p>
        {entersReview ? (
          <div className={styles.sheetStack}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={checks.review}
                onChange={(e) => setChecks((c) => ({ ...c, review: e.target.checked }))}
              />
              <span>Consignes et sécurité vérifiées</span>
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={checks.minors}
                onChange={(e) => setChecks((c) => ({ ...c, minors: e.target.checked }))}
              />
              <span>{`Réglage « Déconseillé aux mineurs » confirmé : ${sheet.not_for_minors ? 'oui' : 'non'}`}</span>
            </label>
          </div>
        ) : null}
        {shown.length > 0 ? (
          <BlockerList label="Blocages" blockers={shown} open={openComments(p.data)} />
        ) : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
      </div>
    </BottomSheet>
  );
}

/**
 * Section « Administration » de la fiche : version exportée, « Modifier », « Publier » (désactivé tant qu'un
 * blocage existe, avec ses messages dessous), puis les autres changements de statut permis depuis le statut de la
 * fiche, « Retirer » en dernier. Chaque changement passe par sa feuille de confirmation.
 */
export function AdminSheetTools(p: {
  data: ReviewSheetResponse;
  manifestIds: ReadonlySet<string> | undefined;
  onEdit(): void;
  onDone(next: ReviewSheetResponse, to: ExerciseStatus): void;
  onConflict(): void;
  reload(): Promise<void>;
}) {
  const titleId = useId();
  const blockersId = useId();
  const [target, setTarget] = useState<ExerciseStatus | null>(null);
  const { sheet } = p.data;
  const targets = EXERCISE_TRANSITIONS[sheet.status];
  const canPublish = targets.includes('published');
  const blockers = canPublish ? publishBlockers(p.data, p.manifestIds) : [];
  const others = targets.filter((to) => to !== 'published');
  const forward = (to: ExerciseStatus) => to === 'reviewed';
  return (
    <section aria-labelledby={titleId} className={styles.section}>
      <h2 id={titleId} className={styles.sectionTitle}>
        Administration
      </h2>
      {p.data.exportedRevision !== undefined ? (
        <p className={styles.muted}>{exportedText(sheet, p.data.exportedRevision)}</p>
      ) : null}
      <div className={styles.adminActions}>
        <Button variant="secondary" block onClick={p.onEdit}>
          Modifier
        </Button>
        {canPublish ? (
          <div className={styles.publish}>
            <Button
              block
              disabled={blockers.length > 0}
              aria-describedby={blockers.length > 0 ? blockersId : undefined}
              onClick={() => setTarget('published')}
            >
              Publier
            </Button>
            {blockers.length > 0 ? (
              <BlockerList
                id={blockersId}
                label="Blocages de la publication"
                blockers={blockers}
                open={openComments(p.data)}
              />
            ) : null}
          </div>
        ) : null}
        {others.map((to) => (
          <Button
            key={to}
            block
            variant={to === 'retired' ? 'danger' : forward(to) ? 'primary' : 'secondary'}
            onClick={() => setTarget(to)}
          >
            {transitionLabel(sheet.status, to)}
          </Button>
        ))}
      </div>
      {target ? (
        <TransitionSheet
          key={target}
          data={p.data}
          to={target}
          manifestIds={p.manifestIds}
          onClose={() => setTarget(null)}
          onDone={(next) => {
            setTarget(null);
            p.onDone(next, target);
          }}
          onConflict={() => {
            setTarget(null);
            p.onConflict();
          }}
          onBlocked={() => void p.reload()}
        />
      ) : null}
    </section>
  );
}

/** Une validation, vue de l'admin : qui, quelle version, relecture ou feu vert santé (et s'il compte encore), quand. */
function validationText(v: ReviewValidationView): string {
  const who = v.reviewerName ?? 'Ancien relecteur';
  const kind = v.health ? (v.standing ? 'feu vert santé' : 'feu vert santé, ne compte plus') : 'relecture';
  return `${who} · version ${v.revision} · ${kind} · ${formatDateTime(v.createdAt)}`;
}

/** Validations nominatives de la fiche (spec brique 2 §3.1 et §3.9), admin seulement. */
export function ValidationsSection(p: { validations: readonly ReviewValidationView[] }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.section}>
      <h2 id={titleId} className={styles.sectionTitle}>
        Validations
      </h2>
      {p.validations.length === 0 ? (
        <p className={styles.muted}>Aucune validation pour l'instant.</p>
      ) : (
        <ul className={styles.validationList}>
          {p.validations.map((v) => (
            <li key={v.id}>{validationText(v)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
