import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLive } from '../../src/app-services';
import { ReadErrorBoundary } from '../../src/ui';

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
});
