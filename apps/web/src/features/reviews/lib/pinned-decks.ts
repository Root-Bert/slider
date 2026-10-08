import { useSyncExternalStore } from 'react';

/**
 * Decks pinned to the top of "Meine Reviews", whatever the sort. Like the last visits kept per
 * browser in localStorage; at most {@link MAX_PINNED}, in the order they were pinned.
 */
export const MAX_PINNED = 3;

const STORAGE_KEY = 'slider.reviews.pinned.v1';
const NONE: readonly string[] = [];

const listeners = new Set<() => void>();
let pinned: readonly string[] | null = null;

function load(): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_PINNED);
    }
  } catch {
    // Corrupt or inaccessible storage – nothing pinned.
  }
  return NONE;
}

const getSnapshot = (): readonly string[] => (pinned ??= load());

function setPinned(next: readonly string[]) {
  pinned = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota) – the pins last for this session only.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Keep several open tabs in sync.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    pinned = load();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Pins the deck; returns false when {@link MAX_PINNED} decks are pinned already. */
export function pinDeck(deckId: string): boolean {
  const current = getSnapshot();
  if (current.includes(deckId)) return true;
  if (current.length >= MAX_PINNED) return false;
  setPinned([...current, deckId]);
  return true;
}

export function unpinDeck(deckId: string) {
  const current = getSnapshot();
  if (current.includes(deckId)) setPinned(current.filter((id) => id !== deckId));
}

/** Drops pins of decks that no longer exist, so they don't block a slot. */
export function prunePinnedDecks(existing: ReadonlySet<string>) {
  const current = getSnapshot();
  const kept = current.filter((id) => existing.has(id));
  if (kept.length !== current.length) setPinned(kept);
}

export function usePinnedDecks() {
  const ids = useSyncExternalStore(subscribe, getSnapshot);
  return {
    isPinned: (deckId: string) => ids.includes(deckId),
    full: ids.length >= MAX_PINNED,
  };
}
