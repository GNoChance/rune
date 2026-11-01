import { PROGRAM_CONTEXTS, PROGRAM_LEVELS, type ServedProgramTemplate } from '@rune/contracts';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { useLive, useSyncState } from '../../app-services';
import { useProgramTemplates, useProgramView, useRecommendation, useRepos } from '../../repos';
import { Button, Page } from '../../ui';
import { NO_TEMPLATE_TEXT, reasonTexts } from '../recommendation/recommendation-labels';
import { TemplateCard } from '../recommendation/TemplateCard';
import { OfflineNotice } from './ActionError';
import { clampDays, EnrollSheet } from './EnrollSheet';
import styles from './program.module.css';

/** Ordre stable des cartes : le modèle recommandé, puis salle, maison, sport, débutant avant intermédiaire. */
function ordered(
  templates: readonly ServedProgramTemplate[],
  recommended: string | null,
): ServedProgramTemplate[] {
  const rank = (t: ServedProgramTemplate) =>
    (t.template.id === recommended ? -100 : 0) +
    PROGRAM_CONTEXTS.indexOf(t.template.context) * 10 +
    PROGRAM_LEVELS.indexOf(t.template.level);
  return [...templates].sort(
    (a, b) =>
      rank(a) - rank(b) || (a.template.id < b.template.id ? -1 : a.template.id > b.template.id ? 1 : 0),
  );
}

/**
 * Choisir un programme (`/program/choose`, spec brique 3 §7.8) : les modèles servis en cartes, le recommandé en
 * tête avec « Recommandé pour toi » et ses raisons ; un modèle indisponible est grisé, « Pas encore disponible ».
 * « Choisir » ouvre la feuille d'inscription (jours dans les bornes, préréglés). Sans programme : inscription ; avec
 * un programme actif : `switch_template` après l'avertissement de la calibration. Le modèle recommandé est alors vu
 * (le Profil ne le reproposera pas), puis Mon programme s'ouvre.
 */
export function ChooseProgram() {
  const repos = useRepos();
  const [, navigate] = useLocation();
  const templates = useProgramTemplates();
  const recommendation = useRecommendation();
  const view = useProgramView();
  const profile = useLive(() => repos.profile.get(), [repos]);
  const { connection } = useSyncState();
  const offline = connection === 'offline';
  const [chosen, setChosen] = useState<string | null>(null);

  if (
    templates === undefined ||
    recommendation === undefined ||
    view === undefined ||
    profile === undefined
  ) {
    return (
      <Page title="Choisir un programme" back="/program">
        {null}
      </Page>
    );
  }

  const recommendedId = recommendation?.templateId ?? null;
  const instance = view?.instance ?? null;
  const choice = templates.find((t) => t.template.id === chosen);
  const noTemplate = recommendation?.templateId === null || !templates.some((t) => t.available);
  const defaultDays = (t: ServedProgramTemplate) =>
    recommendation && t.template.id === recommendedId
      ? recommendation.daysPerWeek
      : clampDays(t.template, profile?.daysPerWeek ?? t.template.daysPerWeek.default);
  const submit = (t: ServedProgramTemplate, days: number) =>
    instance
      ? repos.program.change(
          [{ op: 'switch_template', templateId: t.template.id, daysPerWeek: days }],
          instance.revision,
        )
      : repos.program.enroll(t.template.id, days);
  const done = async () => {
    if (recommendedId) await repos.program.acknowledgeRecommendation(recommendedId).catch(() => {});
    navigate('/program');
  };

  return (
    <Page title="Choisir un programme" back="/program">
      <div className={styles.page}>
        <OfflineNotice offline={offline} />
        {noTemplate ? <p className={styles.muted}>{NO_TEMPLATE_TEXT}</p> : null}
        <div className={styles.cards}>
          {ordered(templates, recommendedId).map((t) => {
            const current = instance?.templateId === t.template.id;
            const choosable =
              t.available && (!current || t.template.version > (instance?.templateVersion ?? 0));
            const recommended = t.template.id === recommendedId;
            return (
              <TemplateCard
                key={t.template.id}
                template={t.template}
                headingLevel={2}
                recommended={recommended}
                reasons={recommended && recommendation ? reasonTexts(recommendation) : undefined}
                current={current}
                available={t.available}
              >
                {choosable ? (
                  <Button
                    variant={recommended ? 'primary' : 'secondary'}
                    block
                    disabled={offline}
                    aria-label={`Choisir ${t.template.name}`}
                    onClick={() => setChosen(t.template.id)}
                  >
                    Choisir
                  </Button>
                ) : null}
              </TemplateCard>
            );
          })}
        </div>
      </div>
      {choice ? (
        <EnrollSheet
          template={choice.template}
          title={choice.template.name}
          confirmLabel="Commencer ce programme"
          defaultDays={defaultDays(choice)}
          switching={instance !== null}
          offline={offline}
          submit={(days) => submit(choice, days)}
          onDone={() => void done()}
          onClose={() => setChosen(null)}
        />
      ) : null}
    </Page>
  );
}
