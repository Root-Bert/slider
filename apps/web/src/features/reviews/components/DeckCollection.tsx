import type { DragEvent } from 'react';
import type { Deck, DeckSearchResult } from '@slider/shared';
import { selectableItemProps, type SelectableItems } from '@/lib/collection-selection';
import { collectionGridClass, type ShowToast } from '@/ui';
import { setDraggedDecks } from '../lib/deck-drag';
import { DeckCard, DeckRow } from './DeckCard';

export type DeckView = 'grid' | 'list';

interface DeckCollectionProps extends SelectableItems {
  decks: readonly Deck[];
  view: DeckView;
  onNotify: ShowToast;
  /** Search hits in the decks' text by deck id (BER-175). */
  searchHits?: ReadonlyMap<string, DeckSearchResult>;
}

/** The comments button and avatars keep their clicks, even with a modifier key. */
const OWN_CONTROLS = '[data-deck-footer]';

export function DeckCollection({
  decks,
  view,
  onNotify,
  selected,
  onModifiedClick,
  onSelectionMenu,
  searchHits,
}: DeckCollectionProps) {
  const Item = view === 'grid' ? DeckCard : DeckRow;
  const selection = { selected, onModifiedClick, onSelectionMenu };
  // Onto a folder tile: the whole selection when the deck is part of it, else just this deck.
  const onDragStart = (deck: Deck) => (event: DragEvent) => {
    const ids = selected.has(deck.id)
      ? decks
          .filter((each) => selected.has(each.id) && each.permissions.canManage)
          .map((each) => each.id)
      : [deck.id];
    setDraggedDecks(event, ids);
  };
  return (
    <ul
      className={
        view === 'grid' ? collectionGridClass : 'glass flex flex-col gap-1 rounded-panel p-1.5'
      }
    >
      {decks.map((deck) => (
        <li
          key={deck.id}
          className="min-w-0"
          {...selectableItemProps(deck.id, selection, OWN_CONTROLS)}
          onDragStart={deck.permissions.canManage ? onDragStart(deck) : undefined}
        >
          <Item
            deck={deck}
            selected={selected.has(deck.id)}
            onNotify={onNotify}
            searchHit={searchHits?.get(deck.id)}
          />
        </li>
      ))}
    </ul>
  );
}

export function DeckCollectionSkeleton({ view, count = 6 }: { view: DeckView; count?: number }) {
  const items = Array.from({ length: count }, (_, index) => index);
  if (view === 'list') {
    return (
      <div className="glass flex flex-col gap-1 rounded-panel p-1.5" aria-hidden>
        {items.map((index) => (
          <div key={index} className="flex items-center gap-4 px-3 py-2.5">
            <div className="skeleton aspect-video w-24 rounded-badge" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="skeleton h-3.5 w-40 rounded-thumb" />
              <div className="skeleton h-3 w-56 rounded-thumb" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={collectionGridClass} aria-hidden>
      {items.map((index) => (
        <div key={index} className="flex flex-col gap-3">
          <div className="skeleton aspect-video rounded-control-sm" />
          <div className="skeleton h-4 w-2/5 rounded-thumb" />
          <div className="skeleton h-3 w-3/5 rounded-thumb" />
        </div>
      ))}
    </div>
  );
}
