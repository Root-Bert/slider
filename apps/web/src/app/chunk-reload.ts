import { readString, writeString } from '@/lib/storage';

const STORAGE_KEY = 'slider.chunkReloadAt';
/** A second failure this soon after a reload is a real outage, not an update: show the error. */
const LOOP_GUARD_MS = 10_000;

/**
 * A tab left open across an update still asks for the old build's hashed route chunks, which the
 * new container no longer has (404). Vite reports that as `vite:preloadError`; a reload fetches
 * the new build, and the router lands on the same URL. Guarded against reload loops: within
 * {@link LOOP_GUARD_MS} of the last such reload (or when this tab can't store when that was),
 * the error goes on to the route's error page.
 */
export function installChunkReload(
  target: Pick<Window, 'addEventListener'> = window,
  reload: () => void = () => window.location.reload(),
  now: () => number = Date.now,
): void {
  target.addEventListener('vite:preloadError', (event) => {
    const last = Number(readString(STORAGE_KEY, 'session') ?? 0);
    if (now() - last < LOOP_GUARD_MS) return;
    const at = String(now());
    writeString(STORAGE_KEY, at, 'session');
    // Without storage the guard can't remember this reload: no reload, or it could loop forever.
    if (readString(STORAGE_KEY, 'session') !== at) return;
    event.preventDefault();
    reload();
  });
}
