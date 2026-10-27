import { readString, writeString } from '@/lib/storage';

const STORAGE_KEY = 'slider.chunkReloadAt';
/** A second failure this soon after a reload is a real outage, not an update: show the error. */
const LOOP_GUARD_MS = 10_000;

/**
 * Reloads the page to fetch the current build – unless it did so within {@link LOOP_GUARD_MS}
 * (or this tab can't store when it last did). Returns whether it reloads.
 */
export function reloadForNewBuild(
  reload: () => void = () => window.location.reload(),
  now: () => number = Date.now,
): boolean {
  const last = Number(readString(STORAGE_KEY, 'session') ?? 0);
  if (now() - last < LOOP_GUARD_MS) return false;
  const at = String(now());
  writeString(STORAGE_KEY, at, 'session');
  // Without storage the guard can't remember this reload: no reload, or it could loop forever.
  if (readString(STORAGE_KEY, 'session') !== at) return false;
  reload();
  return true;
}

/**
 * A route module the browser could not load: a chunk gone after an update, or – in dev – a
 * module that failed once (the browser keeps that failure until the page reloads). The wording
 * is the browser's: Chrome, Safari, Firefox.
 */
export const isModuleLoadError = (error: unknown): boolean =>
  error instanceof TypeError &&
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    error.message,
  );

/**
 * A tab left open across an update still asks for the old build's hashed route chunks, which the
 * new container no longer has (404). Vite reports that as `vite:preloadError`; a reload fetches
 * the new build, and the router lands on the same URL. Guarded against reload loops (see
 * {@link reloadForNewBuild}): otherwise the error goes on to the route's error page.
 */
export function installChunkReload(
  target: Pick<Window, 'addEventListener'> = window,
  reload: () => void = () => window.location.reload(),
  now: () => number = Date.now,
): void {
  target.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild(reload, now)) event.preventDefault();
  });
}
