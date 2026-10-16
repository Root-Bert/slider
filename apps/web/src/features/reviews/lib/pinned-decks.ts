import { createStoredStore } from '@/lib/storage';

/**
 * Decks pinned to the top of "Reviews", whatever the sort. Like the last visits kept per
 * browser in localStorage; at most {@link MAX_PINNED}, in the order they were pinned. The hook is
 * `usePinnedDecks`.
 */
export const MAX_PINNED = 3;

const STORAGE_KEY = 'slider.reviews.pinned.v1';
const NONE: readonly string[] = [];

/** The single store behind `usePinnedDecks`; several open tabs stay in sync. */
export const pinnedDecksStore = createStoredStore<readonly string[]>({
  key: STORAGE_KEY,
  parse: (value) =>
    Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string').slice(0, MAX_PINNED)
      : NONE,
  fallback: NONE,
  crossTab: true,
});

/** Pins the deck; returns false when {@link MAX_PINNED} decks are pinned already. */
export function pinDeck(deckId: string): boolean {
  const current = pinnedDecksStore.getSnapshot();
  if (current.includes(deckId)) return true;
  if (current.length >= MAX_PINNED) return false;
  pinnedDecksStore.set([...current, deckId]);
  return true;
}

export function unpinDeck(deckId: string) {
  const current = pinnedDecksStore.getSnapshot();
  if (current.includes(deckId)) pinnedDecksStore.set(current.filter((id) => id !== deckId));
}

/** Drops pins of decks that no longer exist, so they don't block a slot. */
export function prunePinnedDecks(existing: ReadonlySet<string>) {
  const current = pinnedDecksStore.getSnapshot();
  const kept = current.filter((id) => existing.has(id));
  if (kept.length !== current.length) pinnedDecksStore.set(kept);
}
