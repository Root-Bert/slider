/**
 * A call moves with the person into a window opened for another app (installed: Cloud opens a
 * presentation in Slider's window): the window is named after the call this one is in, and the
 * new one takes it over as soon as it hears of it (`CallProvider`). The desktop app does the same
 * for the tab it shows: it reads `data-call` off the page in front before, names the page now in
 * front and tells it with {@link HAND_OVER_EVENT} (`desktop/tabs.mjs`).
 */
const PREFIX = 'slider-call:';

/** Told by the desktop app once it named this page to take a call over. */
export const HAND_OVER_EVENT = 'slider:call-handover';

/** The call this window is in right now – kept up by `CallProvider`. */
let current: string | null = null;

export function setCallToHandOver(callId: string | null): void {
  current = callId;
  // Where the desktop app reads it (a script run in the page).
  if (typeof document === 'undefined') return;
  if (callId) document.documentElement.dataset.call = callId;
  else delete document.documentElement.dataset.call;
}

/**
 * The call stays in this page when the desktop app shows another tab: taken over, it joins anew
 * with the microphone on and without camera or screen. `sharing` (screen or camera): a tab closing
 * still hands it on; `muted`: never – it would come back unmuted.
 */
export function setCallStays(stays: 'sharing' | 'muted' | null): void {
  if (typeof document === 'undefined') return;
  if (stays) document.documentElement.dataset.callStays = stays;
  else delete document.documentElement.dataset.callStays;
}

/** The name for a window opened for another app: it takes over the call this one is in. */
export function handOverName(): string {
  return current ? PREFIX + current : '';
}

/** The call this window was opened to take over – read once, then the name is cleared. */
export function takeHandOver(): string | null {
  if (typeof window === 'undefined' || !window.name.startsWith(PREFIX)) return null;
  const callId = window.name.slice(PREFIX.length);
  window.name = '';
  return callId || null;
}
