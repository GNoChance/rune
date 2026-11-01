import { parisDate } from '@rune/domain';

/**
 * Délai avant de libérer l'URL du fichier : Safari annule un téléchargement dont l'URL `blob:` est
 * révoquée trop tôt ; la valeur est celle de FileSaver.js.
 */
const REVOKE_AFTER_MS = 40_000;

/** `rune-export-AAAA-MM-JJ.json`, date civile de Paris (R-EXP-1). */
export function exportFileName(nowMs: number): string {
  return `rune-export-${parisDate(new Date(nowMs))}.json`;
}

/** Télécharge `data` en JSON indenté : lien `download` ajouté, cliqué puis retiré, URL libérée ensuite. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}

/** `rune-series-AAAA-MM-JJ.csv`, date civile de Paris (comme le nom envoyé par le serveur). */
export function setsCsvFileName(nowMs: number): string {
  return `rune-series-${parisDate(new Date(nowMs))}.csv`;
}

/**
 * Télécharge un CSV : le BOM UTF-8 est remis en tête (la lecture du corps l'a retiré) pour que le tableur
 * français lise les accents ; même mécanique que `downloadJson`.
 */
export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}
