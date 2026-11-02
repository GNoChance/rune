/*
 * Son de fin de repos (spec brique 3 §7.3, D14) : deux bips courts générés par Web Audio, sans fichier ni adresse
 * externe (CSP `default-src 'self'`). Le navigateur, et iOS en premier, n'ouvre le son qu'après un geste : chaque
 * toucher de l'écran de séance débloque le contexte (`unlockRestSound`), si bien qu'il est prêt à la fin du repos.
 * Sans Web Audio, rien.
 */

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  try {
    context ??= new AudioContext();
  } catch {
    return null;
  }
  return context;
}

/** À appeler pendant un geste (toucher, touche) : le contexte audio peut alors démarrer. */
export function unlockRestSound(): void {
  const ctx = audio();
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
}

/** Fréquence des bips (la 5), leur durée et l'écart entre leurs débuts, en secondes. */
const TONE_HZ = 880;
const BEEP_S = 0.15;
const GAP_S = 0.25;

export function playRestSound(): void {
  const ctx = audio();
  if (ctx === null) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  const start = ctx.currentTime + 0.02;
  for (const at of [start, start + GAP_S]) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = TONE_HZ;
    // Montée et descente brèves : pas de clic au début ni à la fin du bip.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.3, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + BEEP_S);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + BEEP_S + 0.01);
  }
}
