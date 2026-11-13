import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GlassPanel, IconButton, Toolbar } from '@/ui';

export type CollectionView = 'grid' | 'list';

interface ViewToolbarProps {
  /** The filter (a `SegmentedControl`, `iconOnly` when asked), set in a glass pill. */
  filter: (iconOnly: boolean) => ReactNode;
  /** Right next to the filter – "Neue Präsentation", "Neues Asset"; only its icon when asked. */
  action?: ((iconOnly: boolean) => ReactNode) | undefined;
  /** Left of the sort select – a `<search>` field, 352px wide (full width below sm). */
  search: ReactNode;
  /** The sort `Select`. */
  sort: ReactNode;
  view: CollectionView;
  onViewChange: (view: CollectionView) => void;
}

/** 0 all labels, 1 the filter's icons only, 2 the action's icon only too. */
type Labels = 0 | 1 | 2;

/** `gap-3` between filter and action and between the two halves (px). */
const GAP = 12;
/** The search's width (`ViewSearch`, 352px) and how narrow it gets before the row wraps. */
const SEARCH = 352;
const SEARCH_MIN = 200;

interface Fit {
  labels: Labels;
  /** The search's width while it is narrowed; none at its own width. */
  search?: number | undefined;
}

/**
 * The toolbar of a workspace's views (Projekte, Bibliothek): filter and action left, search,
 * sort and grid/list right. Both views share it, so switching between them (`WorkspaceViews`)
 * keeps it in place: each part (`data-view-part`) morphs to the other view's size and only what
 * is in it crossfades – see `styles/index.css`.
 *
 * One row as long as it fits: when it gets too narrow the filter drops its labels (icon and
 * count stay), then the action, then the search narrows (352 → 200px) – only then does anything
 * wrap. Measured on invisible copies of filter and action in either form and on the search's own
 * width, so the choice never flips back and forth.
 */
export function ViewToolbar({
  filter,
  action,
  search,
  sort,
  view,
  onViewChange,
}: ViewToolbarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [{ labels, search: searchWidth }, setFit] = useState<Fit>({ labels: 0 });
  const hasAction = action !== undefined;

  useLayoutEffect(() => {
    const root = rootRef.current;
    const right = rightRef.current;
    const measure = measureRef.current;
    if (!root || !right || !measure) return;
    const width = (part: string) =>
      measure.querySelector(`[data-measure='${part}']`)?.getBoundingClientRect().width ?? 0;
    const choose = (): Fit => {
      const available = root.getBoundingClientRect().width;
      const left = (level: Labels) =>
        width(level >= 1 ? 'filter-icons' : 'filter') +
        (hasAction ? GAP + width(level >= 2 ? 'action-icon' : 'action') : 0);
      const levels: Labels[] = [0, 1, 2];
      const fitting = (room: number) => levels.find((level) => left(level) <= room) ?? 2;
      // Below sm search, sort and view always take their own rows.
      if (window.matchMedia('(width < 40rem)').matches) return { labels: fitting(available) };
      // Search, sort and view with the search at its own width, however narrow it is now.
      const searchNow = right.querySelector('[data-view-part="search"]');
      const besides =
        GAP +
        right.getBoundingClientRect().width -
        (searchNow?.getBoundingClientRect().width ?? SEARCH) +
        SEARCH;
      if (left(2) + besides <= available) return { labels: fitting(available - besides) };
      const over = left(2) + besides - available;
      if (over <= SEARCH - SEARCH_MIN) return { labels: 2, search: Math.floor(SEARCH - over) };
      // Not even then: they wrap into their own row, filter and action have the whole first one.
      return { labels: fitting(available) };
    };
    const fit = () => {
      const next = choose();
      setFit((now) => (now.labels === next.labels && now.search === next.search ? now : next));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    observer.observe(right);
    for (const part of measure.children) observer.observe(part);
    return () => observer.disconnect();
  }, [hasAction]);

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <GlassPanel className="p-1" data-view-part="filter">
          {filter(labels >= 1)}
        </GlassPanel>
        {action && (
          <div className="flex" data-view-part="action">
            {action(labels >= 2)}
          </div>
        )}
      </div>
      {/* Below sm the search takes its own full-width row, sort and view sit under it. */}
      <div ref={rightRef} className="flex items-center gap-2 max-sm:w-full max-sm:flex-wrap">
        <div
          className="max-sm:basis-full"
          style={searchWidth === undefined ? undefined : { width: searchWidth }}
          data-view-part="search"
        >
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
      {/* The invisible copies the row is measured by – out of reach for focus and readers. */}
      <div
        ref={measureRef}
        aria-hidden
        inert
        className="pointer-events-none invisible absolute top-0 left-0 flex h-0 w-max overflow-hidden"
      >
        <GlassPanel className="w-max shrink-0 p-1" data-measure="filter">
          {filter(false)}
        </GlassPanel>
        <GlassPanel className="w-max shrink-0 p-1" data-measure="filter-icons">
          {filter(true)}
        </GlassPanel>
        {action && (
          <>
            <div className="flex w-max shrink-0" data-measure="action">
              {action(false)}
            </div>
            <div className="flex w-max shrink-0" data-measure="action-icon">
              {action(true)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
