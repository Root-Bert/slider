import { useSyncExternalStore } from 'react';
import { MAX_PINNED, pinnedDecksStore } from '../lib/pinned-decks';

/** Which decks are pinned, and whether all {@link MAX_PINNED} slots are taken. */
export function usePinnedDecks() {
  const ids = useSyncExternalStore(pinnedDecksStore.subscribe, pinnedDecksStore.getSnapshot);
  return {
    isPinned: (deckId: string) => ids.includes(deckId),
    full: ids.length >= MAX_PINNED,
  };
}
