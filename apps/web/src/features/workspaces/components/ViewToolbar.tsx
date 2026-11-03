import type { ReactNode } from 'react';
import { GlassPanel, IconButton, Toolbar } from '@/ui';

export type CollectionView = 'grid' | 'list';

interface ViewToolbarProps {
  /** The filter (a `SegmentedControl`), set in a glass pill. */
  filter: ReactNode;
  /** Right next to the filter – "Neue Review", "Hinzufügen". */
  action?: ReactNode;
  /** Left of the sort select – a `<search>` field, 300px wide (full width below sm). */
  search: ReactNode;
  /** The sort `Select`. */
  sort: ReactNode;
  view: CollectionView;
  onViewChange: (view: CollectionView) => void;
}

/**
 * The toolbar of a workspace's views (Projekte, Bibliothek): filter and action left, search,
 * sort and grid/list right. Both views share it, so switching between them (`WorkspaceViews`)
 * keeps it in place: each part (`data-view-part`) morphs to the other view's size and only what
 * is in it crossfades – see `styles/index.css`.
 */
export function ViewToolbar({
  filter,
  action,
  search,
  sort,
  view,
  onViewChange,
}: ViewToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <GlassPanel className="p-1" data-view-part="filter">
          {filter}
        </GlassPanel>
        {action && (
          <div className="flex" data-view-part="action">
            {action}
          </div>
        )}
      </div>
      {/* Below sm the search takes its own full-width row, sort and view sit under it. */}
      <div className="flex items-center gap-2 max-sm:w-full max-sm:flex-wrap">
        <div className="max-sm:basis-full" data-view-part="search">
          {search}
        </div>
        <div data-view-part="sort">{sort}</div>
        <Toolbar role="group" label="Ansicht" data-view-part="view">
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
