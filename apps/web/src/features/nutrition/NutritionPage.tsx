import type { NutritionState } from '@rune/contracts';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { Link } from 'wouter';
import { useLive, useMe } from '../../app-services';
import { type NutritionView, useNutritionView, useRepos } from '../../repos';
import { Button, CoachBubble, Page, useAction } from '../../ui';
import { coachText } from '../coach/coach-lines';
import { NutritionFooter } from './NutritionFooter';
import styles from './nutrition.module.css';
import { NUTRITION_TEXTS } from './nutrition-texts';
import { TargetsCard } from './TargetsCard';
import { WeightSummary } from './WeightSummary';

const T = NUTRITION_TEXTS;

/** Une section titrée en h2, nommée par son titre. */
function Section(p: { title: string; id?: string; children?: ReactNode }) {
  const titleId = useId();
  return (
    <section id={p.id} aria-labelledby={titleId} className={styles.section}>
      <h2 id={titleId}>{p.title}</h2>
      {p.children}
    </section>
  );
}

/** Mode `disabled` : ce que fait le module, ce qu'il ne fait pas, puis « Activer » (ou, pour un mineur, sans écran). */
function DisabledView(p: { minor: boolean }) {
  const repos = useRepos();
  const raise = useAction(() => repos.nutrition.setMode('qualitative'));
  return (
    <section className={styles.section}>
      <p>{T.disabled.intro}</p>
      <p>{T.disabled.does}</p>
      <p>{T.disabled.doesNot}</p>
      {p.minor ? (
        <>
          <p>{T.disabled.minor}</p>
          <Button disabled={raise.pending} onClick={() => void raise.run()}>
            {T.disabled.activateMinor}
          </Button>
          {raise.error ? (
            <p role="alert" className={styles.error}>
              {raise.error}
            </p>
          ) : null}
        </>
      ) : (
        <Link href="/nutrition/start" className={styles.action}>
          {T.disabled.activate}
        </Link>
      )}
    </section>
  );
}

/** Ligne neutre qui dit pourquoi le mode n'est pas celui du choix, avec l'action possible (`stored` : aucune ligne). */
function CauseLine(p: { state: NutritionState | null }) {
  const cause = p.state ? T.causes[p.state.cause] : null;
  if (!cause) return null;
  return (
    <div data-testid="mode-cause" className={styles.cause}>
      <p>{cause.line}</p>
      {cause.action ? (
        <Link href={cause.action.href} className={styles.textLink}>
          {cause.action.label}
        </Link>
      ) : null}
    </div>
  );
}

/** Titres des fiches visibles dans le mode de l'appareil (réseau puis dernière copie) ; leur lecture viendra plus tard. */
function SheetList(p: { titles: readonly string[] | null }) {
  if (p.titles === null || p.titles.length === 0) return null;
  return (
    <ul className={styles.list}>
      {p.titles.map((title) => (
        <li key={title}>{title}</li>
      ))}
    </ul>
  );
}

function QualitativeView(p: { state: NutritionState | null; sheets: readonly string[] | null }) {
  return (
    <>
      <section className={styles.section}>
        <h2>{T.qualitative.title}</h2>
        <CauseLine state={p.state} />
      </section>
      <Section title={T.qualitative.sheets}>
        <SheetList titles={p.sheets} />
      </Section>
      <Section title={T.qualitative.settings}>
        <Link href="/nutrition/settings" className={styles.textLink}>
          {T.qualitative.settings}
        </Link>
      </Section>
    </>
  );
}

/**
 * Mode `full` : les sections du §12.2 (repères, bilan, poids, fiches, réglages) avec leurs points d'entrée. Leur
 * contenu chiffré est branché par les composants des tâches suivantes (repères, bilan, courbe, fiches).
 */
function FullView(p: { view: NutritionView; sheets: readonly string[] | null }) {
  return (
    <>
      <Section title={T.full.targets.title}>
        <TargetsCard target={p.view.target} requestedGoal={p.view.settings?.goal ?? null} />
      </Section>
      <Section title={T.full.checkin.title} />
      <Section title={T.full.weight.title} id="poids">
        <WeightSummary />
      </Section>
      <Section title={T.full.sheets}>
        <SheetList titles={p.sheets} />
      </Section>
      <Section title={T.full.settings}>
        <Link href="/nutrition/settings" className={styles.textLink}>
          {T.full.settings}
        </Link>
      </Section>
    </>
  );
}

/**
 * Module Nutrition (spec brique 5 §12.2). La bulle du coach avec l'avatar « nutrition », puis le contenu du mode
 * effectif de l'appareil (lu sur place, descente hors ligne comprise), enfin le pied, toujours là. L'ouverture
 * (`POST /api/nutrition/open`) n'est que la source de la ligne de cause : hors ligne, elle échoue sans bruit et la page
 * reste celle de la dernière copie.
 */
export function NutritionPage() {
  const me = useMe();
  const repos = useRepos();
  const view: NutritionView | undefined = useNutritionView();
  const profile = useLive(() => repos.profile.get(), [repos]);
  const [state, setState] = useState<NutritionState | null>(null);
  const [sheets, setSheets] = useState<readonly string[] | null>(null);
  const mode = view?.mode;

  useEffect(() => {
    let live = true;
    repos.nutrition.open().then(
      (s) => live && setState(s),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [repos]);

  useEffect(() => {
    if (mode === undefined || mode === 'disabled') {
      setSheets(null);
      return;
    }
    let live = true;
    repos.nutrition.sheets().then(
      (list) => live && setSheets(list.map((sheet) => sheet.title)),
      () => live && setSheets([]),
    );
    return () => {
      live = false;
    };
  }, [repos, mode]);

  if (!me || view === undefined) return null;
  const coach = profile?.coach ?? null;
  // L'état du serveur ne parle que du mode qu'il a calculé : une descente locale plus récente le rend caduc.
  const current = state !== null && state.effective_mode === view.mode ? state : null;

  return (
    <Page title={T.title} back="/profile">
      <div className={`${styles.stack} stagger`}>
        {coach ? (
          <CoachBubble coach={coach} label="Aujourd'hui" mode="nutrition">
            <p>{coachText(coach, 'nutri', me.username)}</p>
          </CoachBubble>
        ) : null}
        {view.mode === 'disabled' ? (
          <DisabledView minor={me.ageBand === 'minor'} />
        ) : view.mode === 'qualitative' ? (
          <QualitativeView state={current} sheets={sheets} />
        ) : (
          <FullView view={view} sheets={sheets} />
        )}
        <NutritionFooter />
      </div>
    </Page>
  );
}
