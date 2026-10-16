import { useSyncExternalStore } from 'react';
import { useMe } from '@/lib/api';
import {
  MAX_PINNED,
  pinDeck,
  pinnedDecksStore,
  pinnedIn,
  prunePinnedDecks,
  unpinDeck,
  type PinScope,
} from '../lib/pinned-decks';

/**
 * The signed-in account's pins on `workspaceId`'s page, and whether its {@link MAX_PINNED} slots
 * are taken. Without an account (still loading) nothing is pinned and pinning does nothing.
 */
export function usePinnedDecks(workspaceId: string) {
  const pins = useSyncExternalStore(pinnedDecksStore.subscribe, pinnedDecksStore.getSnapshot);
  const userId = useMe().data?.user?.id;
  const scope: PinScope | null = userId ? { userId, workspaceId } : null;
  const ids = scope ? pinnedIn(pins, scope) : [];
  return {
    isPinned: (deckId: string) => ids.includes(deckId),
    full: ids.length >= MAX_PINNED,
    /** False when every slot is taken. */
    pin: (deckId: string) => (scope ? pinDeck(scope, deckId) : false),
    unpin: (deckId: string) => {
      if (scope) unpinDeck(scope, deckId);
    },
    /** Drops pins of decks that are no longer in the workspace. */
    prune: (existing: ReadonlySet<string>) => {
      if (scope) prunePinnedDecks(scope, existing);
    },
  };
}
