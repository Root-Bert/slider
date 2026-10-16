/**
 * Per-browser memory of which revision of each deck the user has seen, so the viewer can say
 * "Neue Version geladen" once – on the next visit, or live while the deck is open. Storage can
 * fail (private mode, blocked site data); then every visit just starts without the banner.
 */

const STORAGE_KEY = 'slider.seenRevisions.v1';
const DISMISSED_ERRORS_KEY = 'slider.dismissedSyncErrors.v1';

type Store = Record<string, number | string>;

function read(key: string): Store {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(key: string, store: Store) {
  try {
    localStorage.setItem(key, JSON.stringify(store));
  } catch {
    // Unavailable storage – the banner simply isn't remembered.
  }
}

export function seenRevision(deckId: string): number | null {
  const value = read(STORAGE_KEY)[deckId];
  return typeof value === 'number' ? value : null;
}

export function markRevisionSeen(deckId: string, revisionNumber: number) {
  const store = read(STORAGE_KEY);
  const previous = store[deckId];
  if (typeof previous === 'number' && previous >= revisionNumber) return;
  write(STORAGE_KEY, { ...store, [deckId]: revisionNumber });
}

/**
 * Whether opening the deck should announce its current revision: only when this browser saw an
 * older one. A first visit has nothing to compare with and stays quiet.
 */
export const shouldAnnounceRevision = (seen: number | null, current: number) =>
  seen !== null && current > 1 && current > seen;

/** A dismissed sync error stays hidden until a newer error (another `at`) comes in. */
export const isSyncErrorDismissed = (deckId: string, at: string) =>
  read(DISMISSED_ERRORS_KEY)[deckId] === at;

export function dismissSyncError(deckId: string, at: string) {
  write(DISMISSED_ERRORS_KEY, { ...read(DISMISSED_ERRORS_KEY), [deckId]: at });
}
