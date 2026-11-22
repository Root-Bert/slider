import { useSyncExternalStore } from 'react';
import { createStoredStore } from './storage';

/** Whether this browser shows notifications, and whether it was allowed. */
export type NotifyState = 'on' | 'ask' | 'off' | 'none';

export function notifyState(): NotifyState {
  if (typeof Notification === 'undefined') return 'none';
  if (Notification.permission === 'granted') return 'on';
  if (Notification.permission === 'denied') return 'off';
  return 'ask';
}

// Kept as "1" before it was a store: either counts.
const yes = (value: unknown) => value === true || value === 1 || value === '1';

/** „Später“ on the offer in the header: hidden in this browser until settings bring it back. */
const laterStore = createStoredStore({
  key: 'sender:notify-later',
  parse: yes,
  fallback: false,
  crossTab: true,
});

/** Allowed in the browser, but silenced here (`/einstellungen` › Benachrichtigungen). */
const mutedStore = createStoredStore({
  key: 'sender:notify-muted',
  parse: yes,
  fallback: false,
  crossTab: true,
});

// The browser's answer: read anew when asked here and when the window comes back (it may have
// been allowed or blocked in the browser's site settings meanwhile).
const permissionListeners = new Set<() => void>();
let permission: NotifyState = notifyState();
function refreshPermission() {
  const now = notifyState();
  if (now === permission) return;
  permission = now;
  for (const listener of permissionListeners) listener();
}
// One window listener for all: removed only when the last one goes (the header's offer listens on
// after the settings page closes).
function subscribePermission(listener: () => void) {
  if (permissionListeners.size === 0) window.addEventListener('focus', refreshPermission);
  permissionListeners.add(listener);
  return () => {
    permissionListeners.delete(listener);
    if (permissionListeners.size === 0) window.removeEventListener('focus', refreshPermission);
  };
}

/** Whether a notification may show now: allowed by the browser and not silenced here. */
export function mayNotify(): boolean {
  return notifyState() === 'on' && !mutedStore.getSnapshot();
}

/** Asked at a click – browsers allow no other way. */
export async function askToNotify(): Promise<NotifyState> {
  if (typeof Notification === 'undefined') return 'none';
  await Notification.requestPermission();
  refreshPermission();
  return permission;
}

/**
 * Notifications in this browser, for the offer in the header and the settings: the browser's
 * answer, „Später“ and whether they are silenced – each change shows everywhere at once.
 */
export function useNotifyPrefs() {
  const state = useSyncExternalStore(subscribePermission, () => permission);
  const later = useSyncExternalStore(laterStore.subscribe, laterStore.getSnapshot);
  const muted = useSyncExternalStore(mutedStore.subscribe, mutedStore.getSnapshot);
  return { state, later, muted, setLater: laterStore.set, setMuted: mutedStore.set };
}
