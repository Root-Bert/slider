/*
 * The call's sounds, made in the browser (no files): ringing when one is called, a softer tone
 * while one's own call rings at the others. A page nobody has clicked yet may stay silent –
 * browsers only play sound after a first gesture.
 */

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume().catch(() => {});
  return context;
}

/** The shared context – also for hearing who speaks (`levels.ts`). */
export const audioContext = audio;

function tone(at: number, frequencies: number[], length: number, volume: number) {
  const ctx = audio();
  if (!ctx) return;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.02);
  gain.gain.setValueAtTime(volume, at + length - 0.05);
  gain.gain.linearRampToValueAtTime(0, at + length);
  for (const frequency of frequencies) {
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(at);
    oscillator.stop(at + length);
  }
}

/** Plays a pattern again and again until the returned function stops it. */
function repeat(pattern: (at: number) => void, every: number): () => void {
  const ctx = audio();
  if (!ctx) return () => {};
  pattern(ctx.currentTime + 0.05);
  const timer = window.setInterval(() => pattern(ctx.currentTime + 0.05), every);
  return () => window.clearInterval(timer);
}

/** Someone calls: two short rising chimes, every two seconds. */
export const ring = () =>
  repeat((at) => {
    tone(at, [659, 988], 0.18, 0.12);
    tone(at + 0.22, [784, 1175], 0.28, 0.12);
  }, 2000);

/** One's own call rings at the others: a quiet double beep, every three seconds. */
export const ringBack = () =>
  repeat((at) => {
    tone(at, [440, 480], 0.4, 0.05);
    tone(at + 0.6, [440, 480], 0.4, 0.05);
  }, 3000);

/** Someone came into the call (up) or left it (down). */
export function chime(up: boolean) {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime + 0.02;
  tone(at, [up ? 587 : 784], 0.12, 0.06);
  tone(at + 0.13, [up ? 784 : 587], 0.16, 0.06);
}
