import { type InstanceChangeView, REASON_TEXTS } from '@rune/contracts';
import { useId, useMemo } from 'react';
import { type ProgramEditContext, type ProgramView, useRepos } from '../../repos';
import { Button } from '../../ui';
import { ActionError } from './ActionError';
import styles from './program.module.css';
import { expiryLabel, localRefusal, PROPOSAL_TITLES, type ProgramNames } from './program-labels';
import { changeCheck, changeLines, checkMessage } from './program-model';
import { useProgramAction } from './use-change';

/**
 * Proposition en attente (spec §7.7) : auteur (« Proposition de Rune » pour le moteur), raison, avant / après de
 * chaque opération calculé par le domaine, date limite, « Accepter » / « Refuser ». 409 `stale_revision` : le
 * programme a changé, la proposition reste ; 409 `expired` : elle a expiré ; dans les deux cas le dépôt tire avant de
 * rendre l'erreur (ruling R52), ce qui met à jour la révision et range une proposition expirée au journal. Le serveur
 * décide seul (ruling R41) : « Accepter » n'est jamais grisé par le validateur du téléphone, dont le catalogue et les
 * lieux peuvent être en retard ; un refus local ne s'affiche qu'en avertissement, et la réponse du serveur (422,
 * 409) s'affiche sous l'action.
 */
export function ProposalCard(p: {
  proposal: InstanceChangeView;
  view: ProgramView;
  ctx: ProgramEditContext;
  names: ProgramNames;
  offline: boolean;
}) {
  const { proposal, view, ctx } = p;
  const repos = useRepos();
  const action = useProgramAction();
  const titleId = useId();
  const hintId = useId();
  const lines = useMemo(() => changeLines(proposal, view, ctx, p.names), [proposal, view, ctx, p.names]);
  const refused = useMemo(
    () =>
      checkMessage(changeCheck(view, ctx, { author: proposal.author, id: proposal.id })(proposal.operations)),
    [proposal, view, ctx],
  );
  const busy = p.offline || action.pending;
  const accept = () => action.run('accept', () => repos.program.accept(proposal.id, view.instance.revision));
  const reject = () => action.run('reject', () => repos.program.reject(proposal.id));

  return (
    <article aria-labelledby={titleId} className={styles.card}>
      <h3 id={titleId} className={styles.cardTitle}>
        {PROPOSAL_TITLES[proposal.author]}
      </h3>
      <p>{REASON_TEXTS[proposal.reasonCode]}</p>
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
        </dl>
      ))}
      {proposal.expiresAt ? <p className={styles.muted}>{expiryLabel(proposal.expiresAt)}</p> : null}
      <div className={styles.pair}>
        <Button disabled={busy} aria-describedby={refused ? hintId : undefined} onClick={() => void accept()}>
          Accepter
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void reject()}>
          Refuser
        </Button>
      </div>
      {refused ? (
        <p id={hintId} className={styles.warning}>
          {localRefusal(refused)}
        </p>
      ) : null}
      <ActionError message={action.errorOf('accept') ?? action.errorOf('reject')} />
    </article>
  );
}
