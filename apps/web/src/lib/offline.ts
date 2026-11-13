import { useSyncExternalStore } from 'react';
import { forgetWebFiles } from './web-files';

/*
 * Offline (`public/sw.js`): the service worker keeps what was open once – the app, the decks'
 * slides and what the viewer and editor load – so it opens again without a connection. Only in
 * builds: under Vite's dev server (`import.meta.hot`) it would stand in the way of its reloads.
 * Not `import.meta.env.PROD`: a build made with `NODE_ENV=development` (the e2e bundle) has it off.
 */

const watchOnline = (change: () => void) => {
  window.addEventListener('online', change);
  window.addEventListener('offline', change);
  return () => {
    window.removeEventListener('online', change);
    window.removeEventListener('offline', change);
  };
};

/** Whether the browser has a connection (it may still not reach the server). */
export const useOnline = (): boolean =>
  useSyncExternalStore(
    watchOnline,
    () => navigator.onLine,
    () => true,
  );

/** Without a connection: what needs the server at once (the AI, photos, uploads) waits. */
export const OFFLINE_HINT = 'Geht erst wieder mit Verbindung.';

/** Registers the service worker once the page is loaded (it is not needed for the first view). */
export function installOffline(): void {
  if (import.meta.hot || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Without it the app works as before, online only.
    });
  });
}

/** The editor's outbox (`features/viewer/editing/outbox.ts`): edits not yet sent. */
export const OUTBOX_DB = 'slider-outbox';

/** Deletes the editor's outbox; an editor of this tab holding it open lets go of it at once. */
const forgetOutbox = () =>
  new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(OUTBOX_DB);
      // Blocked: another tab still has it open – deleted once it lets go, no need to wait.
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    } catch {
      // No IndexedDB: edits were kept in memory only.
      resolve();
    }
  });

/**
 * Drops what the browser kept of the account (logout, account deleted): the service worker's
 * stored answers and files, and the edits not sent yet – they would go out as the next account.
 */
export async function forgetOffline(): Promise<void> {
  await Promise.all([forgetOutbox(), forgetWebFiles()]);
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('slider-api-') || name.startsWith('slider-files-'))
        .map((name) => caches.delete(name)),
    );
  } catch {
    // No CacheStorage (an insecure origin, a private window): nothing was kept.
  }
}
