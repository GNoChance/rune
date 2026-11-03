import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLive } from '../../src/app-services';
import { reposFor } from '../../src/repos';
import { ReadErrorBoundary } from '../../src/ui';
import { newcomer } from '../support/onboarding';
import { makeMe, renderApp } from '../support/render';

describe('lecture qui échoue (M5)', () => {
  it('une lecture qui échoue affiche le message et Réessayer relit', async () => {
    const query = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('IndexedDB fermée'))
      .mockResolvedValue('contenu lu');
    function Probe() {
      const value = useLive(query, []);
      return <p>{value ?? 'lecture…'}</p>;
    }

    render(
      <ReadErrorBoundary>
        <Probe />
      </ReadErrorBoundary>,
    );
    expect(await screen.findByText("Impossible d'afficher cette page.")).toBeTruthy();
    expect(query).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('contenu lu')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Impossible d'afficher cette page.")).toBeNull());
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("une lecture qui lève dans la barre d'onglets laisse le contenu de la page affiché", async () => {
    const { services } = await renderApp({ path: '/profile', me: makeMe() });
    // La barre n'est pas encore montée (la garde attend sa lecture de `meta.me`) : la lecture qui lève est la sienne.
    vi.spyOn(reposFor(services).workouts, 'activeSession').mockRejectedValue(new Error('lecture impossible'));

    expect(await screen.findByText("Impossible d'afficher cette page.")).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getAllByText("Impossible d'afficher cette page.")).toHaveLength(1);
  });

  it("une lecture qui lève dans l'onboarding affiche le message", async () => {
    const { services } = await renderApp({ path: '/onboarding', me: newcomer() });
    vi.spyOn(reposFor(services).profile, 'get').mockRejectedValue(new Error('lecture impossible'));

    expect(await screen.findByText("Impossible d'afficher cette page.")).toBeTruthy();
  });
});
