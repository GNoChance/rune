import { type NutritionMode, type NutritionState, SAFETY_SCREEN, type ScreenAnswers } from '@rune/contracts';
import { parisDate } from '@rune/domain';
import { useEffect, useState } from 'react';
import { Redirect, useLocation, useSearchParams } from 'wouter';
import { useLive, useMe, useServices } from '../../app-services';
import { useRepos } from '../../repos';
import { Banner, Button, errorMessage, Page, useAction } from '../../ui';
import { HealthConsentPanel } from '../onboarding/HealthStep';
import styles from './nutrition.module.css';
import { NUTRITION_TEXTS } from './nutrition-texts';
import { OutcomeStep, QuestionStep, type ScreenAnswer, type ScreenQuestionId } from './SafetyScreenSteps';
import { type SetupAnswers, SetupStep } from './SetupSteps';

const T = NUTRITION_TEXTS;
const QUESTIONS = SAFETY_SCREEN.questions;

type Step =
  | { kind: 'intro' }
  | { kind: 'consent' }
  | { kind: 'question'; index: number }
  | { kind: 'outcome' }
  | { kind: 'setup' };

const NUTRITION_HOME = '/nutrition';

/**
 * Activation du module et écran de sécurité (§12.4), plein écran, une étape à la fois, retour possible. Rien n'est
 * envoyé avant la dernière étape (`POST /api/nutrition/screen`) ; seul l'état du serveur (`/open`) est lu au départ,
 * pour savoir si le mode complet est ouvert. Les réponses restent dans l'état de ce composant.
 *
 * `?screen=1` (le lien de Réglages, tâche 18) repasse l'écran : on part des questions (étape 3), puis l'issue (4) et
 * l'envoi (6) ; les réglages (5) ne s'intercalent que si le serveur dit qu'ils manquent (`needs = setup`).
 */
export function StartFlow() {
  const me = useMe();
  const repos = useRepos();
  const services = useServices();
  const [, navigate] = useLocation();
  const [params] = useSearchParams();
  const rescreen = params.get('screen') === '1';
  const profile = useLive(() => repos.profile.get(), [repos]);
  const minor = me?.ageBand === 'minor';

  const [info, setInfo] = useState<NutritionState | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [trail, setTrail] = useState<Step[]>([rescreen ? { kind: 'question', index: 0 } : { kind: 'intro' }]);
  const [answers, setAnswers] = useState<Partial<ScreenAnswers>>({});
  const [mode, setMode] = useState<NutritionMode | null>(null);

  useEffect(() => {
    if (minor) return;
    let live = true;
    repos.nutrition.open().then(
      (s) => live && setInfo(s),
      (e) => live && setOpenError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [repos, minor]);

  const refuse = useAction(async () => {
    await repos.nutrition.setMode('qualitative');
    navigate(NUTRITION_HOME);
  });
  const send = useAction(async (target: NutritionMode, setup?: SetupAnswers) => {
    const { pregnancy, eating_disorder, medical } = answers;
    if (!pregnancy || !eating_disorder || !medical) return;
    await repos.nutrition.screen({
      answers: { pregnancy, eating_disorder, medical },
      mode: target,
      ...(setup
        ? {
            setup: {
              sex_for_calc: setup.sex,
              height_cm: setup.heightCm,
              activity_level: setup.activity,
              goal: setup.goal,
              weigh_in: {
                id: services.newOpId(),
                date: parisDate(new Date(services.now())),
                weight_g: setup.weightG,
              },
            },
          }
        : {}),
    });
    navigate(NUTRITION_HOME);
  });

  if (!me || profile === undefined) return null;
  // Un mineur n'a aucune question : « Activer les conseils » est sur la page du module.
  if (minor) return <Redirect to={NUTRITION_HOME} replace />;

  const step = trail[trail.length - 1] ?? { kind: 'intro' };
  const go = (next: Step) => setTrail((t) => [...t, next]);
  const back = () => (trail.length > 1 ? setTrail((t) => t.slice(0, -1)) : navigate(NUTRITION_HOME));
  const firstQuestion = (): Step => ({ kind: 'question', index: 0 });
  const needsSetup = !rescreen || info?.needs === 'setup';

  const answer = (index: number) => (id: ScreenQuestionId, value: ScreenAnswer) => {
    setAnswers((a) => ({ ...a, [id]: value }));
    setMode(null);
    go(index + 1 < QUESTIONS.length ? { kind: 'question', index: index + 1 } : { kind: 'outcome' });
  };

  const complete: ScreenAnswers | null =
    answers.pregnancy && answers.eating_disorder && answers.medical
      ? { pregnancy: answers.pregnancy, eating_disorder: answers.eating_disorder, medical: answers.medical }
      : null;

  function body() {
    if (openError !== null) return <Banner tone="warning">{openError}</Banner>;
    if (info === null) return null;
    switch (step.kind) {
      case 'intro':
        return (
          <section className={styles.section}>
            <p>{T.disabled.intro}</p>
            <p>{T.disabled.does}</p>
            <p>{T.disabled.doesNot}</p>
            <Button onClick={() => go(me?.consents.health.active ? firstQuestion() : { kind: 'consent' })}>
              {T.start.begin}
            </Button>
          </section>
        );
      case 'consent':
        return (
          <section className={styles.section}>
            <h2>{T.start.consent.title}</h2>
            <p>{T.start.consent.lead}</p>
            <HealthConsentPanel
              acceptLabel={T.start.consent.accept}
              skipLabel={T.start.consent.refuse}
              onGranted={() => go(firstQuestion())}
              onSkip={() => void refuse.run()}
            />
            {refuse.error ? <Banner tone="error">{refuse.error}</Banner> : null}
          </section>
        );
      case 'question':
        return <QuestionStep index={step.index} onAnswer={answer(step.index)} />;
      case 'outcome': {
        if (!complete) return null;
        const toSetup = mode === 'full' && needsSetup;
        return (
          <>
            <OutcomeStep answers={complete} fullOpen={info.full_open} mode={mode} onMode={setMode} />
            {send.error ? <Banner tone="error">{send.error}</Banner> : null}
            <Button
              disabled={mode === null || send.pending}
              onClick={() => (toSetup ? go({ kind: 'setup' }) : mode && void send.run(mode))}
            >
              {toSetup ? T.start.next : T.start.send}
            </Button>
          </>
        );
      }
      case 'setup':
        return (
          <SetupStep
            onboardingGoal={profile?.goal ?? null}
            sportCode={profile?.sportCode ?? null}
            pending={send.pending}
            error={send.error}
            onSubmit={(setup) => void send.run('full', setup)}
          />
        );
    }
  }

  return (
    <Page title={T.title} back={back}>
      <div className={`${styles.stack} stagger`}>{body()}</div>
    </Page>
  );
}
