import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GlassPanel, IconButton, SegmentedControl, Select, Toolbar } from '@/ui';
import {
  CLOUD_SORTS,
  SORT_LABELS,
  TYPE_FILTERS,
  type CloudSort,
  type CloudView,
  type TypeFilter,
} from '../lib/kinds';

/** The row's gap (`gap-x-4`). */
const GAP = 16;
/** The search's width (`ViewSearch`, 352px) and how narrow it gets before the row wraps. */
const SEARCH = 352;
const SEARCH_MIN = 200;

const SORT_OPTIONS = CLOUD_SORTS.map((value) => ({ value, label: SORT_LABELS[value] }));

/**
 * Over a list: what kind of files, in which order, as rows or tiles; `lead` stands first, the
 * page's search (`ViewSearch`) right before the sort – as Post's and the presentations'.
 * The parts are Slider's (`ViewToolbar` over the presentations): the filter in a glass pill with
 * icons, the same sort select, tiles and list as two icon buttons – and columns where the list
 * is a place with folders to step into.
 *
 * One row as long as it fits: too narrow, the filter drops its labels (icons stay), then the
 * search narrows (352 → 200px), only then anything wraps – as `ViewToolbar` does, measured on
 * invisible copies of the filter and on the search's own width so the choice never flips back
 * and forth.
 */
export function ListToolbar({
  lead,
  search,
  filter,
  onFilterChange,
  count,
  sort,
  onSortChange,
  view,
  onViewChange,
  columns = false,
}: {
  lead?: ReactNode;
  /** The page's own search field, on the right. */
  search?: ReactNode;
  filter?: TypeFilter;
  onFilterChange?: (filter: TypeFilter) => void;
  /** How many files lie here, the folders' included: stands on „Alle“. */
  count?: number | undefined;
  sort?: CloudSort;
  onSortChange?: (sort: CloudSort) => void;
  /** Absent where there is nothing to draw as rows or tiles (an area's activity). */
  view?: CloudView;
  onViewChange: (view: CloudView) => void;
  /** The place can be shown as columns; elsewhere that choice shows as the list. */
  columns?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const iconsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const [{ iconOnly, searchWidth }, setFit] = useState<{
    iconOnly: boolean;
    searchWidth?: number | undefined;
  }>({ iconOnly: false });
  const hasFilter = filter !== undefined && onFilterChange !== undefined;
  const segments =
    count === undefined
      ? TYPE_FILTERS
      : TYPE_FILTERS.map((each) => (each.value === 'all' ? { ...each, count } : each));

  useLayoutEffect(() => {
    const root = rootRef.current;
    const right = rightRef.current;
    const measure = measureRef.current;
    if (!root || !right || !measure) return;
    const fit = () => {
      const available = root.getBoundingClientRect().width;
      const leadWidth = leadRef.current?.getBoundingClientRect().width ?? 0;
      // The right side with the search at its own width, however narrow it is now.
      const searchNow = searchRef.current?.getBoundingClientRect().width;
      const rightWidth =
        right.getBoundingClientRect().width + (searchNow === undefined ? 0 : SEARCH - searchNow);
      const needed = (filter: number) =>
        (leadWidth > 0 ? leadWidth + GAP : 0) + (filter > 0 ? filter + GAP : 0) + rightWidth;
      const labels = needed(measure.getBoundingClientRect().width);
      const icons = needed(iconsRef.current?.getBoundingClientRect().width ?? 0);
      const over = icons - available;
      const next =
        labels <= available
          ? { iconOnly: false }
          : {
              iconOnly: true,
              searchWidth:
                searchNow !== undefined && over > 0 && over <= SEARCH - SEARCH_MIN
                  ? Math.floor(SEARCH - over)
                  : undefined,
            };
      setFit((now) =>
        now.iconOnly === next.iconOnly && now.searchWidth === next.searchWidth ? now : next,
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    for (const part of [root, right, measure, iconsRef.current, leadRef.current])
      if (part) observer.observe(part);
    return () => observer.disconnect();
  }, [hasFilter]);

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-x-4 gap-y-2">
      {lead && (
        <div ref={leadRef} className="flex items-center">
          {lead}
        </div>
      )}
      {filter && onFilterChange && (
        <>
          <GlassPanel className="p-1">
            <SegmentedControl
              label="Nach Art filtern"
              segments={segments}
              value={filter}
              onChange={onFilterChange}
              iconOnly={iconOnly}
            />
          </GlassPanel>
          {/* The filter with its labels, unseen: how wide it would be. */}
          <div
            ref={measureRef}
            aria-hidden
            inert
            className="pointer-events-none invisible absolute top-0 left-0 flex h-0 w-max overflow-hidden"
          >
            <GlassPanel className="p-1">
              <SegmentedControl label="" segments={segments} value={filter} onChange={() => {}} />
            </GlassPanel>
          </div>
          {/* And with its icons only. */}
          <div
            ref={iconsRef}
            aria-hidden
            inert
            className="pointer-events-none invisible absolute top-0 left-0 flex h-0 w-max overflow-hidden"
          >
            <GlassPanel className="p-1">
              <SegmentedControl
                label=""
                segments={segments}
                value={filter}
                onChange={() => {}}
                iconOnly
              />
            </GlassPanel>
          </div>
        </>
      )}
      <div ref={rightRef} className="ml-auto flex min-w-0 items-center gap-2">
        {search && (
          <div
            ref={searchRef}
            className="min-w-0"
            style={searchWidth === undefined ? undefined : { width: searchWidth }}
          >
            {search}
          </div>
        )}
        {sort && onSortChange && (
          <Select
            aria-label="Sortieren nach"
            size="toolbar"
            value={sort}
            onChange={onSortChange}
            options={SORT_OPTIONS}
          />
        )}
        {view && (
          <Toolbar role="group" label="Ansicht">
            <IconButton
              icon="gridView"
              label="Kachelansicht"
              size="sm"
              iconSize={18}
              active={view === 'tiles'}
              onClick={() => onViewChange('tiles')}
            />
            <IconButton
              icon="viewList"
              label="Listenansicht"
              size="sm"
              iconSize={18}
              active={view === 'list' || (view === 'columns' && !columns)}
              onClick={() => onViewChange('list')}
            />
            {columns && (
              <IconButton
                icon="viewColumn"
                label="Spaltenansicht"
                size="sm"
                iconSize={18}
                active={view === 'columns'}
                onClick={() => onViewChange('columns')}
              />
            )}
          </Toolbar>
        )}
      </div>
    </div>
  );
}
