import { type CoachProposalEvent, type InstanceChangeView, REASON_TEXTS } from '@rune/contracts';
import { useId, useMemo } from 'react';
import { Link } from 'wouter';
import { useServices } from '../../app-services';
import { type ProgramEditContext, type ProgramView, useRepos } from '../../repos';
import { Button, NETWORK_REQUIRED_MESSAGE } from '../../ui';
import { ActionError } from './ActionError';
import styles from './program.module.css';
import {
  AI_NOTE,
  DECIDED_LABELS,
  expiryLabel,
  localRefusal,
  PREPARING,
  PROPOSAL_TITLES,
  type ProgramNames,
  SEE_CONVERSATION,
} from './program-labels';
import { changeCheck, checkMessage, previewLines } from './program-model';
import { useProgramAction } from './use-change';

/**
 * Proposition en attente (spec §7.7) : auteur (« Proposition de Rune » pour le moteur), raison, avant / après de
 * chaque opération calculé par le domaine, date limite, « Accepter » / « Refuser ». 409 `stale_revision` : le
 * programme a changé, la proposition reste ; 409 `expired` : elle a expiré ; dans les deux cas le dépôt tire avant de
 * rendre l'erreur (ruling R52), ce qui met à jour la révision et range une proposition expirée au journal. Le serveur
 * décide seul (ruling R41) : « Accepter » n'est jamais grisé par le validateur du téléphone, dont le catalogue et les
 * lieux peuvent être en retard ; un refus local ne s'affiche qu'en avertissement, et la réponse du serveur (422,
 * 409) s'affiche sous l'action.
 *
 * Une proposition du coach IA (spec brique 4 §16.5) porte le badge « IA », `data-ai-generated`, la mention « Proposé
 * par l'IA, vérifié par l'appli », son motif sous la phrase du code, et « Voir la conversation ». Sous les
 * opérations, l'aperçu des charges (`previewLines`). `compact` : la carte du fil du coach ; `proposal` est alors
 * l'événement du flux tant que la ligne n'est pas arrivée par le pull (« en préparation », rien à accepter), puis la
 * ligne, qui s'accepte ou se refuse, puis se lit « Acceptée », « Refusée » ou « Expirée ».
 */
export function ProposalCard(p: {
  proposal: InstanceChangeView | CoachProposalEvent;
  view: ProgramView;
  ctx: ProgramEditContext;
  names: ProgramNames;
  offline: boolean;
  compact?: boolean;
}) {
  const { view, ctx } = p;
  const proposal = useMemo(() => normalized(p.proposal), [p.proposal]);
  const { now } = useServices();
  const repos = useRepos();
  const action = useProgramAction();
  const titleId = useId();
  const hintId = useId();
  const lines = useMemo(
    () => previewLines(proposal, view, ctx, p.names, now()),
    [proposal, view, ctx, p.names, now],
  );
  const decided = p.compact ? decision(proposal, now()) : null;
  const preparing = proposal.status === null;
  const refused = useMemo(
    () =>
      checkMessage(changeCheck(view, ctx, { author: proposal.author, id: proposal.id })(proposal.operations)),
    [proposal, view, ctx],
  );
  const busy = p.offline || action.pending || preparing;
  const accept = () => action.run('accept', () => repos.program.accept(proposal.id, view.instance.revision));
  const reject = () => action.run('reject', () => repos.program.reject(proposal.id));

  return (
    <article
      aria-labelledby={titleId}
      className={styles.card}
      data-ai-generated={proposal.author === 'coach' ? 'true' : undefined}
    >
      <h3 id={titleId} className={styles.cardTitle}>
        {PROPOSAL_TITLES[proposal.author]}
        {proposal.author === 'coach' ? <span className={styles.aiBadge}>IA</span> : null}
      </h3>
      {proposal.author === 'coach' ? <p className={styles.muted}>{AI_NOTE}</p> : null}
      <p>{REASON_TEXTS[proposal.reasonCode]}</p>
      {proposal.reason ? <p>{proposal.reason}</p> : null}
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: une ligne par opération, dans l'ordre du changement
        <dl key={i} className={styles.beforeAfter}>
          <div>
            <dt>Avant</dt>
            <dd>{line.before}</dd>
          </div>
          <div>
            <dt>Après</dt>
            <dd>{line.after}</dd>
          </div>
          {line.loads?.map((text) => (
            <div key={text}>
              <dt>Charge</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      ))}
      {proposal.expiresAt ? <p className={styles.muted}>{expiryLabel(proposal.expiresAt)}</p> : null}
      {decided === null ? (
        <div className={styles.pair}>
          <Button
            disabled={busy}
            aria-describedby={refused ? hintId : undefined}
            onClick={() => void accept()}
          >
            Accepter
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void reject()}>
            Refuser
          </Button>
        </div>
      ) : (
        <p className={styles.decided}>{DECIDED_LABELS[decided]}</p>
      )}
      {preparing ? <p className={styles.muted}>{PREPARING}</p> : null}
      {p.compact && p.offline && decided === null && !preparing ? (
        <p className={styles.muted}>{NETWORK_REQUIRED_MESSAGE}</p>
      ) : null}
      {proposal.author === 'coach' && proposal.coachThreadId !== null ? (
        <Link
          href={`/coach/threads/${encodeURIComponent(proposal.coachThreadId)}`}
          className={styles.cardLink}
        >
          {SEE_CONVERSATION}
        </Link>
      ) : null}
      {refused && decided === null ? (
        <p id={hintId} className={styles.warning}>
          {localRefusal(refused)}
        </p>
      ) : null}
      <ActionError message={action.errorOf('accept') ?? action.errorOf('reject')} />
    </article>
  );
}

/** Ce que la carte lit d'une proposition : une ligne du miroir, ou l'événement du flux (`status` nul : pas encore de ligne). */
interface Shown {
  id: string;
  author: InstanceChangeView['author'];
  operations: InstanceChangeView['operations'];
  reasonCode: InstanceChangeView['reasonCode'];
  reason: string | null;
  expiresAt: string | null;
  coachThreadId: string | null;
  status: InstanceChangeView['status'] | null;
}

function normalized(p: InstanceChangeView | CoachProposalEvent): Shown {
  if ('type' in p) return { ...p, author: 'coach', coachThreadId: null, status: null };
  return p;
}

/** « Acceptée », « Refusée » ou « Expirée » (une proposition en attente dont la date limite est passée l'est aussi). */
function decision(p: Shown, now: number): keyof typeof DECIDED_LABELS | null {
  if (p.status === 'accepted' || p.status === 'rejected' || p.status === 'expired') return p.status;
  if (p.status === 'proposed' && p.expiresAt !== null && Date.parse(p.expiresAt) <= now) return 'expired';
  return null;
}
