import type { CoachTodayResponse } from '@rune/contracts';

/*
 * Fil du jour tel que la personne le voit (spec brique 4.1 §4.4) : un fil fermé par un changement de coach ou de
 * version n'est plus la conversation du jour. Le serveur le rend encore (il reste lisible dans « Conversations
 * précédentes »), mais le message suivant ouvre un fil neuf : l'écran repart vide, sans ses messages.
 */

/** Raisons de fermeture qui rendent le fil caduc au jour même. */
const RENEWED = new Set<string>(['persona_change', 'version_change']);

export const isRenewedThread = (today: CoachTodayResponse | null): boolean =>
  today?.thread != null && today.thread.closedReason !== null && RENEWED.has(today.thread.closedReason);

/** `today` sans le fil caduc : ni fil ni messages. */
export function liveToday(today: CoachTodayResponse | null): CoachTodayResponse | null {
  return today !== null && isRenewedThread(today) ? { ...today, thread: null, messages: [] } : today;
}
