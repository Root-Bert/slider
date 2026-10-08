import type { Deck } from '@slider/shared';
import type { ShowToast } from '@/ui';
import { DeckCard, DeckRow } from './DeckCard';

export type DeckView = 'grid' | 'list';

interface DeckCollectionProps {
  decks: readonly Deck[];
  view: DeckView;
  isUnseen: (deck: Deck) => boolean;
  onNotify: ShowToast;
}

const GRID_CLASSES =
  'grid grid-cols-1 gap-x-7 gap-y-8 min-[700px]:grid-cols-2 min-[1200px]:grid-cols-3';

export function DeckCollection({ decks, view, isUnseen, onNotify }: DeckCollectionProps) {
  const Item = view === 'grid' ? DeckCard : DeckRow;
  return (
    <ul
      className={view === 'grid' ? GRID_CLASSES : 'glass flex flex-col gap-0.5 rounded-panel p-1.5'}
    >
      {decks.map((deck) => (
        <li key={deck.id} className="min-w-0">
          <Item deck={deck} unseen={isUnseen(deck)} onNotify={onNotify} />
        </li>
      ))}
    </ul>
  );
}

export function DeckCollectionSkeleton({ view, count = 6 }: { view: DeckView; count?: number }) {
  const items = Array.from({ length: count }, (_, index) => index);
  if (view === 'list') {
    return (
      <div className="glass flex flex-col gap-0.5 rounded-panel p-1.5" aria-hidden>
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
