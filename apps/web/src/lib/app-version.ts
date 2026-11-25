import { useSyncExternalStore } from 'react';
import type { Health } from '@slider/shared';
import { api } from './api-client';

/*
 * A new release while the app stays open – an installed one often does for days. The release this
 * page was loaded with is held against the one the server runs (`/api/health`, asked every few
 * minutes and whenever the window comes back or goes). A new one is taken over by reloading,
 * quietly, once that costs nothing: the window not in front, nobody typing or clicking for a
 * while, no call going on, nothing a `beforeunload` holds back (edits or uploads on their way)
 * and nothing half typed. Till then Einstellungen → Version offers „Neu laden“.
 */

/** How often the server is asked which release it runs. */
const CHECK_MS = 5 * 60_000;
/** How often a waiting release looks whether it may come in now. */
const RETRY_MS = 30_000;
/** No input for this long: nobody is at the window. */
const IDLE_MS = 2 * 60_000;

let loaded: string | null = null;
let latest: string | null = null;
let lastInput = Date.now();
const listeners = new Set<() => void>();
const holds = new Set<symbol>();

/** A release the server named (`/me`, `/health`); the first one is the page's own. */
export function sawVersion(version: string | null | undefined): void {
  if (!version) return;
  loaded ??= version;
  if (version === latest) return;
  latest = version;
  for (const listener of listeners) listener();
}

/** The release this page runs; `null` from a checkout (no release) or before the server said. */
export const loadedVersion = (): string | null => loaded;

/** A newer release the server runs than this page, else `null`. */
export const newerVersion = (): string | null =>
  loaded && latest && latest !== loaded ? latest : null;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** {@link newerVersion}, live. */
export const useNewerVersion = (): string | null =>
  useSyncExternalStore(subscribe, newerVersion, () => null);

/** Something a reload would end (a call): none until the returned release is called. */
export function holdReload(): () => void {
  const hold = Symbol('hold');
  holds.add(hold);
  return () => {
    holds.delete(hold);
  };
}

/** Text in a field not sent yet – a reload would lose it. */
const halfTyped = () =>
  [...document.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"]')].some(
    (field) =>
      !(field instanceof HTMLTextAreaElement && field.readOnly) &&
      (field instanceof HTMLTextAreaElement ? field.value : (field.textContent ?? '')).trim() !==
        '',
  );

/** What guards leaving the page (unsent edits, uploads) would hold a reload back too. */
const heldBack = () => {
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  return leaving.defaultPrevented;
};

/** Whether a reload now goes unnoticed and loses nothing. */
export const quiet = (now = Date.now()): boolean =>
  (document.hidden || !document.hasFocus()) &&
  now - lastInput >= IDLE_MS &&
  holds.size === 0 &&
  !halfTyped() &&
  !heldBack();

/** Reloads into the newer release when {@link quiet}; `true` when it did. */
export function reloadIfQuiet(reload: () => void = () => window.location.reload()): boolean {
  if (!newerVersion() || !quiet()) return false;
  reload();
  return true;
}

async function check() {
  try {
    sawVersion((await api.get<Health>('/health')).version);
  } catch {
    // Not reached (offline, restarting): asked again later.
  }
  reloadIfQuiet();
}

/** Watches for a new release from the start (main.tsx). */
export function installAppUpdates(): void {
  const touched = () => {
    lastInput = Date.now();
  };
  for (const type of ['pointerdown', 'keydown', 'wheel'] as const)
    window.addEventListener(type, touched, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => void check());
  window.addEventListener('focus', () => void check());
  window.addEventListener('blur', () => void check());
  setInterval(() => void check(), CHECK_MS);
  setInterval(() => reloadIfQuiet(), RETRY_MS);
  void check();
}
