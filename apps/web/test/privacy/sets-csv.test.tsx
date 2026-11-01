import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCsv, setsCsvFileName } from '../../src/ui/download';
import { createFakeApi } from '../support/fake-api';
import { createTestLocalDb } from '../support/local-db';
import { renderApp } from '../support/render';
import { until } from '../support/wait';

const CSV_PATH = '/api/me/export/sets.csv';
const CSV = 'date;heure\r\n2026-10-06;10:00\r\n';

let downloads: { download: string; href: string }[] = [];
let blobs: Blob[] = [];

beforeEach(() => {
  downloads = [];
  blobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return `blob:test/${blobs.length}`;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ download: this.download, href: this.getAttribute('href') ?? '' });
  });
});
afterEach(() => vi.restoreAllMocks());

describe('CSV des séries : téléchargement', () => {
  it('setsCsvFileName : date civile de Paris', () => {
    expect(setsCsvFileName(Date.parse('2026-10-06T12:00:00.000Z'))).toBe('rune-series-2026-10-06.csv');
    expect(setsCsvFileName(Date.parse('2026-10-06T22:30:00.000Z'))).toBe('rune-series-2026-10-07.csv');
  });

  it('downloadCsv : Blob text/csv avec BOM UTF-8 (la lecture du corps l’a retiré)', async () => {
    downloadCsv('f.csv', CSV);
    expect(downloads).toEqual([{ download: 'f.csv', href: 'blob:test/1' }]);
    expect(blobs[0]?.type).toBe('text/csv;charset=utf-8');
    const bytes = new Uint8Array((await blobs[0]?.arrayBuffer()) ?? new ArrayBuffer(0));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe(CSV);
  });
});

describe('« Télécharger mes séries (CSV) » dans Confidentialité', () => {
  async function renderPrivacy(api = createFakeApi()) {
    await renderApp({ path: '/profile/privacy', db: createTestLocalDb(), api });
    await screen.findByRole('heading', { level: 1, name: 'Confidentialité' });
    return api;
  }

  it('télécharge rune-series-AAAA-MM-JJ.csv depuis le serveur', async () => {
    const api = createFakeApi().on('GET', CSV_PATH, {
      status: 200,
      body: CSV,
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    });
    await renderPrivacy(api);
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger mes séries (CSV)' }));
    await until(() => downloads.length === 1);
    expect(downloads[0]?.download).toBe('rune-series-2026-10-06.csv');
    expect(api.calls.filter((c) => c.path === CSV_PATH)).toHaveLength(1);
  });

  it('hors ligne : « Nécessite le réseau », aucun téléchargement', async () => {
    const api = await renderPrivacy();
    api.setOffline('reject');
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger mes séries (CSV)' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nécessite le réseau');
    expect(downloads).toHaveLength(0);
  });
});
