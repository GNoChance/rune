import type { NutritionCheckin, NutritionState } from '@rune/contracts';
import { useState } from 'react';
import { Link } from 'wouter';
import { useSyncState } from '../../app-services';
import {
  type NutritionCheckinView,
  type NutritionTargetView,
  type NutritionView,
  useRepos,
} from '../../repos';
import { Banner, Button, useAction } from '../../ui';
import { formatKg, formatLongDate, formatPct } from './format';
import { checkinToHandle } from './HomeNutritionCard';
import styles from './nutrition.module.css';
import { NUTRITION_TEXTS } from './nutrition-texts';
import type { SheetEntry } from './SheetsList';

const T = NUTRITION_TEXTS.full.checkin;
const D = NUTRITION_TEXTS.decisions;
export const WEIGHT_SHEET_ID = 'weight-fluctuations';

/** Le bilan tel que le serveur vient de le rendre, à la forme de la copie locale. */
function fromServer(c: NutritionCheckin): NutritionCheckinView {
  return {
    weekStart: c.week_start,
    weighInCount: c.weigh_in_count,
    meanWeightG: c.mean_weight_g,
    changePct: c.change_pct,
    representative: c.representative,
    decision: c.decision,
    position: c.position,
    proposedDeltaKcal: c.proposed_delta_kcal,
    response: c.response,
  };
}

/**
 * Phrase de la décision (§13). Les valeurs viennent du bilan et de la cible : le repère de départ d'une proposition est
 * la cible en vigueur, ou, une fois acceptée, la cible d'arrivée moins le pas.
 */
function decisionLine(c: NutritionCheckinView, target: NutritionTargetView | null): string | null {
  switch (c.decision) {
    case null:
      return null;
    case 'insufficient_data':
    case 'non_representative_week':
    case 'in_band':
      return D[c.decision];
    case 'out_of_band_pending':
      return c.position === 'above' || c.position === 'below' ? D.out_of_band_pending[c.position] : null;
    case 'proposal':
    case 'rapid_loss': {
      if (target === null || c.proposedDeltaKcal === null) return null;
      const accepted = c.response === 'accepted';
      const from = accepted ? target.kcalTarget - c.proposedDeltaKcal : target.kcalTarget;
      const to = accepted ? target.kcalTarget : target.kcalTarget + c.proposedDeltaKcal;
      return D[c.decision](from, to);
    }
    case 'limit_reached':
      return c.proposedDeltaKcal === 100 ? D.limit_reached.up : D.limit_reached.down;
    case 'safety_pause':
      // Règle 2 (IMC trop bas en perte) : décidée avant toute variation, donc sans position.
      return c.position === null ? D.safety_pause.rule2 : D.safety_pause.pause;
  }
}

/**
 * Bilan de la semaine (spec brique 5 §12.2) : le bilan à traiter en tête de module, avec « Accepter », « Garder mes
 * repères » et « Cette semaine n'était pas représentative » ; sinon le dernier, en résumé. Les bilans plus anciens
 * restés sans réponse sont dits « sans suite ». Les actions passent par le serveur : grisées hors ligne.
 */
export function CheckinCard(p: { view: NutritionView; sheets: readonly SheetEntry[] | null }) {
  const repos = useRepos();
  const { connection } = useSyncState();
  const offline = connection === 'offline';
  const [fresh, setFresh] = useState<NutritionCheckinView | null>(null);
  const settle = (state: NutritionState) => {
    if (state.effective_mode === 'full' && state.last_checkin) setFresh(fromServer(state.last_checkin));
  };
  const respond = useAction(async (week: string, response: 'accepted' | 'declined') =>
    settle(await repos.nutrition.respond(week, response)),
  );
  const mark = useAction(async (week: string) => settle(await repos.nutrition.markNonRepresentative(week)));

  // La copie locale suit le serveur au prochain tirage ; d'ici là, le bilan rendu par la réponse prend la place.
  const list = p.view.checkins.map((c) => (fresh && fresh.weekStart === c.weekStart ? fresh : c));
  const [latest, ...older] = list;
  if (latest === undefined) return <p className={styles.muted}>{T.none}</p>;

  const actionable = checkinToHandle({ ...p.view, checkins: list });
  const noFollowUp = older.filter(
    (c) => c.response === null && (c.decision === 'proposal' || c.decision === 'rapid_loss'),
  );
  const line = decisionLine(latest, p.view.target);
  const busy = respond.pending || mark.pending;
  const error = respond.error ?? mark.error;
  const weightSheet = p.sheets?.some((s) => s.id === WEIGHT_SHEET_ID) === true;

  return (
    <>
      <p>
        <strong>{T.week(formatLongDate(latest.weekStart))}</strong>
      </p>
      {latest.meanWeightG !== null ? <p>{T.mean(formatKg(latest.meanWeightG))}</p> : null}
      {latest.changePct !== null ? (
        <p className={styles.muted}>{T.change(formatPct(latest.changePct))}</p>
      ) : null}
      {line ? <p>{line}</p> : null}
      {latest.response === 'accepted' ? <p className={styles.muted}>{T.accepted}</p> : null}
      {latest.response === 'declined' ? <p className={styles.muted}>{T.declined}</p> : null}
      {actionable ? (
        <>
          {offline ? <Banner tone="warning">{NUTRITION_TEXTS.offline}</Banner> : null}
          <div className={styles.checkinActions}>
            <Button disabled={offline || busy} onClick={() => void respond.run(latest.weekStart, 'accepted')}>
              {T.accept}
            </Button>
            <Button
              variant="secondary"
              disabled={offline || busy}
              onClick={() => void respond.run(latest.weekStart, 'declined')}
            >
              {T.keep}
            </Button>
          </div>
          <Button
            variant="secondary"
            disabled={offline || busy}
            onClick={() => void mark.run(latest.weekStart)}
          >
            {T.nonRepresentative}
          </Button>
          {error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : null}
        </>
      ) : null}
      {weightSheet ? (
        <Link href={`/nutrition/sheets/${WEIGHT_SHEET_ID}`} className={styles.textLink}>
          {T.whyWeightVaries}
        </Link>
      ) : null}
      {noFollowUp.length > 0 ? (
        <ul className={styles.pastCheckins}>
          {noFollowUp.map((c) => (
            <li key={c.weekStart} className={styles.muted}>
              {T.week(formatLongDate(c.weekStart))} : {T.noFollowUp.toLowerCase()}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
