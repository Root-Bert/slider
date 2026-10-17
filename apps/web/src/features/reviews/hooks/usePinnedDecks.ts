import { useSyncExternalStore } from 'react';
import type { Deck } from '@slider/shared';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useMe } from '@/lib/api';
import {
  MAX_PINNED,
  pinDeck,
  pinLimitMessage,
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
  const queryClient = useQueryClient();
  return {
    isPinned: (deckId: string) => ids.includes(deckId),
    full: ids.length >= MAX_PINNED,
    /** The reason when `full`, naming the pinned decks from the loaded deck list. */
    limitMessage: () => {
      const decks = queryClient.getQueryData<Deck[]>(queryKeys.deckList(workspaceId)) ?? [];
      const titles = ids.flatMap((id) => decks.find((deck) => deck.id === id)?.title ?? []);
      return pinLimitMessage(titles);
    },
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
