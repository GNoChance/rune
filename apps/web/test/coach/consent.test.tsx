import { AI_COACH_CONSENT_TEXT } from '@rune/contracts';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STATE_TEXTS } from '../../src/features/coach/coach-texts';
import { coachStatus, serveCoach } from '../support/coach';
import { createFakeApi, type FakeApi } from '../support/fake-api';
import { makeMe, renderApp } from '../support/render';
import { until } from '../support/wait';

async function renderConsent(status = coachStatus({ consent: { active: false, textVersion: null } })) {
  const api: FakeApi = serveCoach(createFakeApi(), status);
  api.on('POST', '/api/me/consents', { status: 200, body: makeMe() });
  const view = await renderApp({ path: '/coach/consent', api });
  await screen.findByRole('heading', { level: 1, name: 'Accord pour le coach IA' });
  return { ...view, api };
}

const activate = () => screen.getByRole('button', { name: STATE_TEXTS.consentActivate }) as HTMLButtonElement;
const box = () => screen.getByRole('checkbox') as HTMLInputElement;
const grants = (api: FakeApi) =>
  api.calls.filter((c) => c.method === 'POST' && c.path === '/api/me/consents');

describe('ConsentPage (spec brique 4 §14.1)', () => {
  it('le texte de l’accord, mot pour mot, une case non cochée, « Activer le coach » inactif', async () => {
    await renderConsent();
    expect(screen.getByText(AI_COACH_CONSENT_TEXT.text)).toBeTruthy();
    expect(box().checked).toBe(false);
    expect(activate().disabled).toBe(true);
    fireEvent.click(box());
    expect(activate().disabled).toBe(false);
    fireEvent.click(box());
    expect(activate().disabled).toBe(true);
  });

  it('cochée : POST { type: ai_coach, textVersion: 1.0 }, puis la conversation', async () => {
    const { api, location } = await renderConsent();
    fireEvent.click(box());
    fireEvent.click(activate());
    await until(() => location() === '/coach');
    expect(grants(api).map((c) => c.body)).toEqual([{ type: 'ai_coach', textVersion: '1.0' }]);
  });

  it('adulte : lien « Bien utiliser le coach » vers /help/coach', async () => {
    await renderConsent();
    expect(screen.getByRole('link', { name: 'Bien utiliser le coach' }).getAttribute('href')).toBe(
      '/help/coach',
    );
    expect(screen.queryByRole('link', { name: 'Tu as 16 ou 17 ans' })).toBeNull();
  });

  it('mineur : lien « Tu as 16 ou 17 ans » vers /help/coach#jeunes', async () => {
    await renderConsent(coachStatus({ audience: 'minor', consent: { active: false, textVersion: null } }));
    expect(screen.getByRole('link', { name: 'Tu as 16 ou 17 ans' }).getAttribute('href')).toBe(
      '/help/coach#jeunes',
    );
  });

  it('texte changé : « Le texte de l’accord a changé. » ; sinon rien', async () => {
    const { unmount } = await renderConsent();
    expect(screen.queryByText(STATE_TEXTS.consentChanged)).toBeNull();
    unmount();
    await renderConsent(coachStatus({ consent: { needsRenewal: true, textVersion: '0.9' } }));
    expect(screen.getByText(STATE_TEXTS.consentChanged)).toBeTruthy();
  });

  it('quitter sans cocher ne retire rien : aucune requête d’accord', async () => {
    const { api, location } = await renderConsent(coachStatus({ consent: { needsRenewal: true } }));
    fireEvent.click(box());
    fireEvent.click(box());
    fireEvent.click(screen.getByRole('link', { name: /Retour/ }));
    await until(() => location() !== '/coach/consent');
    expect(grants(api)).toEqual([]);
    expect(api.calls.some((c) => c.path.includes('withdraw'))).toBe(false);
  });

  it('échec du serveur : message, la page reste, la case reste cochée', async () => {
    const { api, location } = await renderConsent();
    api.on('POST', '/api/me/consents', { status: 500, body: { error: 'internal' } });
    fireEvent.click(box());
    fireEvent.click(activate());
    await screen.findByRole('alert');
    expect(location()).toBe('/coach/consent');
    expect(box().checked).toBe(true);
  });
});
