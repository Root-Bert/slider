import type { ReactNode } from 'react';
import { GlassPanel, IconButton, SegmentedControl, Select, Toolbar, type Segment } from '@/ui';
import { DECK_SORTS, SORT_LABELS, type DeckSort, type ReviewTab } from '../lib/deck-filters';
import type { DeckView } from './DeckCollection';

interface ReviewsToolbarProps {
  tab: ReviewTab;
  onTabChange: (tab: ReviewTab) => void;
  counts: Record<ReviewTab, number>;
  sort: DeckSort;
  onSortChange: (sort: DeckSort) => void;
  view: DeckView;
  onViewChange: (view: DeckView) => void;
  /** Sits right next to the tabs – the "Neue Review" button. */
  action?: ReactNode;
  /** Sits left of the sort select – the deck search. */
  search?: ReactNode;
}

const SORT_OPTIONS = DECK_SORTS.map((value) => ({ value, label: SORT_LABELS[value] }));

export function ReviewsToolbar({
  tab,
  onTabChange,
  counts,
  sort,
  onSortChange,
  view,
  onViewChange,
  action,
  search,
}: ReviewsToolbarProps) {
  const segments: Segment<ReviewTab>[] = [
    { value: 'all', label: 'Alle', icon: 'description', count: counts.all },
    { value: 'open', label: 'Offen', icon: 'chatBubble', count: counts.open },
    {
      value: 'archive',
      label: 'Archiv',
      icon: 'archive',
      count: counts.archive > 0 ? counts.archive : undefined,
    },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <GlassPanel className="p-1">
          <SegmentedControl
            label="Reviews filtern"
            segments={segments}
            value={tab}
            onChange={onTabChange}
          />
        </GlassPanel>
        {action}
      </div>
      <div className="flex items-center gap-2 max-sm:w-full">
        {search}
        <Select
          aria-label="Sortieren nach"
          size="toolbar"
          value={sort}
          onChange={onSortChange}
          options={SORT_OPTIONS}
        />
        <Toolbar role="group" label="Ansicht">
          <IconButton
            icon="gridView"
            label="Kachelansicht"
            size="sm"
            iconSize={18}
            active={view === 'grid'}
            onClick={() => onViewChange('grid')}
          />
          <IconButton
            icon="viewList"
            label="Listenansicht"
            size="sm"
            iconSize={18}
            active={view === 'list'}
            onClick={() => onViewChange('list')}
          />
        </Toolbar>
      </div>
    </div>
  );
}
