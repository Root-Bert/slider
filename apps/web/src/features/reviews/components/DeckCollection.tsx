import type { DragEvent, MouseEvent } from 'react';
import type { Deck, DeckSearchResult } from '@slider/shared';
import type { ShowToast } from '@/ui';
import { setDraggedDecks } from '../lib/deck-drag';
import { DeckCard, DeckRow } from './DeckCard';

export type DeckView = 'grid' | 'list';

interface DeckCollectionProps {
  decks: readonly Deck[];
  view: DeckView;
  onNotify: ShowToast;
  selected: ReadonlySet<string>;
  /** ⌘/Ctrl/Shift-click on a deck, or any click while some are selected; true when it changed the selection instead of opening it. */
  onModifiedClick: (deckId: string, event: MouseEvent) => boolean;
  /** Right click on one of several selected decks: their shared actions instead of its own. */
  onSelectionMenu: (at: { x: number; y: number }) => void;
  /** Search hits in the decks' text by deck id (BER-175). */
  searchHits?: ReadonlyMap<string, DeckSearchResult>;
}

/** Clicks on these keep their own meaning, even with a modifier key. */
const OWN_CONTROLS = '[data-deck-footer], button, input, [role="menu"]';

const GRID_CLASSES =
  'grid grid-cols-1 gap-x-14 gap-y-16 min-[700px]:grid-cols-2 min-[1200px]:grid-cols-3';

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
  const onClickCapture = (deckId: string) => (event: MouseEvent) => {
    if ((event.target as Element).closest(OWN_CONTROLS)) return;
    if (onModifiedClick(deckId, event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onContextMenuCapture = (deckId: string) => (event: MouseEvent) => {
    if (event.shiftKey || selected.size < 2 || !selected.has(deckId)) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectionMenu({ x: event.clientX, y: event.clientY });
  };
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
      className={view === 'grid' ? GRID_CLASSES : 'glass flex flex-col gap-1 rounded-panel p-1.5'}
    >
      {decks.map((deck) => (
        <li
          key={deck.id}
          data-deck-id={deck.id}
          className="min-w-0"
          onClickCapture={onClickCapture(deck.id)}
          onContextMenuCapture={onContextMenuCapture(deck.id)}
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
    <div className={GRID_CLASSES} aria-hidden>
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
