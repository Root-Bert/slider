import { IconButton, SegmentedControl, type Segment } from '@/ui';
import { DECK_SORTS, SORT_LABELS, type DeckSort, type ReviewTab } from '../lib/deck-filters';
import type { DeckView } from './DeckCollection';
import { Select } from '@/ui';

interface ReviewsToolbarProps {
  tab: ReviewTab;
  onTabChange: (tab: ReviewTab) => void;
  counts: Record<ReviewTab, number>;
  sort: DeckSort;
  onSortChange: (sort: DeckSort) => void;
  view: DeckView;
  onViewChange: (view: DeckView) => void;
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
    {
      value: 'shared',
      label: 'Geteilt',
      icon: 'iosShare',
      count: counts.shared > 0 ? counts.shared : undefined,
    },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="glass rounded-panel p-1">
        <SegmentedControl
          label="Reviews filtern"
          variant="tool"
          segments={segments}
          value={tab}
          onChange={onTabChange}
        />
      </div>
      <div className="flex items-center gap-2">
        <Select
          aria-label="Sortieren nach"
          value={sort}
          onChange={onSortChange}
          options={SORT_OPTIONS}
        />
        <div
          role="group"
          aria-label="Ansicht"
          className="glass flex items-center gap-1 rounded-panel p-1"
        >
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
        </div>
      </div>
    </div>
  );
}
