import { AI_COACH_CONSENT_TEXT } from '@rune/contracts';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Banner, Button, Page, useAction } from '../../ui';
import styles from './coach-account.module.css';
import { useCoachStore } from './coach-store';
import { CONSENT_TEXTS, STATE_TEXTS } from './coach-texts';

/**
 * Accord du coach IA (spec brique 4 §14.1, P-CST-1) : le texte en vigueur en entier, une case non cochée, et
 * « Activer le coach » qui ne s'ouvre qu'une fois la case cochée. Le lien mène à « Bien utiliser le coach »
 * (la partie jeunes pour un 16-17 ans). Un texte changé le dit (`needsRenewal`). Quitter sans cocher ne retire
 * rien : l'écran n'écrit qu'au clic sur « Activer le coach ».
 */
export function ConsentPage() {
  const { state, store } = useCoachStore();
  const [, navigate] = useLocation();
  const [agreed, setAgreed] = useState(false);
  const grant = useAction(async () => {
    await store.grant();
    return true;
  });

  useEffect(() => {
    void store.load();
  }, [store]);

  const { status } = state;
  const minor = status?.audience === 'minor';

  async function activate() {
    if (await grant.run()) navigate('/coach');
  }

  return (
    <Page title={CONSENT_TEXTS.title} back="/profile/coach">
      <div className={styles.stack}>
        {status?.consent.needsRenewal ? <Banner tone="info">{STATE_TEXTS.consentChanged}</Banner> : null}
        <p className={styles.lead}>{CONSENT_TEXTS.intro}</p>
        <p className={styles.agreement}>{AI_COACH_CONSENT_TEXT.text}</p>
        <Link href={minor ? '/help/coach#jeunes' : '/help/coach'} className={styles.link}>
          {minor ? CONSENT_TEXTS.minorLink : CONSENT_TEXTS.adultLink}
        </Link>
        <label className={styles.check}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>{CONSENT_TEXTS.checkbox}</span>
        </label>
        {grant.error ? <Banner tone="error">{grant.error}</Banner> : null}
        <Button block disabled={!agreed || grant.pending} onClick={() => void activate()}>
          {STATE_TEXTS.consentActivate}
        </Button>
      </div>
    </Page>
  );
}
