import type { ReactNode } from 'react';
import { ViewToolbar } from '@/features/workspaces';
import { SegmentedControl, Select, type Segment } from '@/ui';
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
    <ViewToolbar
      filter={
        <SegmentedControl
          label="Präsentationen filtern"
          segments={segments}
          value={tab}
          onChange={onTabChange}
        />
      }
      action={action}
      search={search}
      sort={
        <Select
          aria-label="Sortieren nach"
          size="toolbar"
          value={sort}
          onChange={onSortChange}
          options={SORT_OPTIONS}
        />
      }
      view={view}
      onViewChange={onViewChange}
    />
  );
}
