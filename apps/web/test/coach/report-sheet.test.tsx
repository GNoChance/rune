import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { REPORT_TEXTS } from '../../src/features/coach/coach-texts';
import { ReportSheet } from '../../src/features/coach/ReportSheet';
import { createFakeApi, type FakeApi } from '../support/fake-api';
import { renderWithServices } from '../support/render';

const REPORTS = '/api/coach/reports';

async function open(onClose = vi.fn()) {
  const api = createFakeApi();
  api.on('POST', REPORTS, { status: 201, body: { id: 'r-1' } });
  await renderWithServices(<ReportSheet threadId="t1" messageSeq={2} onClose={onClose} />, { api });
  return { api, onClose };
}

const sent = (api: FakeApi) => api.calls.filter((c) => c.path === REPORTS);
const sendButton = () => screen.getByRole('button', { name: 'Envoyer' }) as HTMLButtonElement;

describe('ReportSheet (spec brique 4 §16.6)', () => {
  it("l'avertissement exact et les quatre catégories", async () => {
    await open();
    expect(
      screen.getByText(
        "L'admin pourra lire cet échange (ton message et la réponse) et saura qu'il vient de toi.",
      ),
    ).toBeTruthy();
    for (const name of ['Inexact', 'Dangereux', 'Inapproprié', 'Autre']) {
      expect(screen.getByRole('radio', { name })).toBeTruthy();
    }
  });

  it('« Envoyer » attend une catégorie', async () => {
    await open();
    expect(sendButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Dangereux' }));
    expect(sendButton().disabled).toBe(false);
  });

  it('envoie {threadId, messageSeq, category, comment} puis confirme', async () => {
    const { api } = await open();
    fireEvent.click(screen.getByRole('radio', { name: 'Dangereux' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Conseil risqué' } });
    fireEvent.click(sendButton());
    await screen.findByText("Merci, l'admin le lira.");
    expect(sent(api).map((c) => c.body)).toEqual([
      { threadId: 't1', messageSeq: 2, category: 'unsafe', comment: 'Conseil risqué' },
    ]);
  });

  it('sans commentaire : le champ est omis', async () => {
    const { api } = await open();
    fireEvent.click(screen.getByRole('radio', { name: 'Autre' }));
    fireEvent.click(sendButton());
    await screen.findByText("Merci, l'admin le lira.");
    expect(sent(api)[0]?.body).toEqual({ threadId: 't1', messageSeq: 2, category: 'other' });
  });

  it('500 caractères passent, 501 sont refusés (rien n’est envoyé)', async () => {
    const { api } = await open();
    fireEvent.click(screen.getByRole('radio', { name: 'Inexact' }));
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'a'.repeat(501) } });
    expect(sendButton().disabled).toBe(true);
    expect(screen.getByText(REPORT_TEXTS.tooLong)).toBeTruthy();
    fireEvent.click(sendButton());
    expect(sent(api)).toHaveLength(0);
    fireEvent.change(field, { target: { value: 'a'.repeat(500) } });
    expect(sendButton().disabled).toBe(false);
    fireEvent.click(sendButton());
    await waitFor(() => expect(sent(api)).toHaveLength(1));
  });

  it('le serveur refuse : un message sous le bouton, la feuille reste', async () => {
    const api = createFakeApi();
    api.on('POST', REPORTS, { status: 404, body: { error: 'not_found' } });
    await renderWithServices(<ReportSheet threadId="t1" messageSeq={2} onClose={() => {}} />, { api });
    fireEvent.click(screen.getByRole('radio', { name: 'Inexact' }));
    fireEvent.click(sendButton());
    expect((await screen.findByRole('alert')).textContent).toBe(REPORT_TEXTS.failed);
    expect(screen.queryByText("Merci, l'admin le lira.")).toBeNull();
  });
});
