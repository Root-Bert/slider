import { FilterChip, GlassPanel } from '@/ui';
import { useCommentThreads } from './hooks/useCommentThreads';
import type { StatusFilter } from './lib/comment-selectors';
import { statusSegments } from './lib/status-segments';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/**
 * Filter pill (B1): Ausgeblendet / Offen / KI / Erledigt as toggles – a click picks one, a
 * second click on it lets go again, and with none picked every comment shows ("Alle"). Every
 * slide's comments are always on screen in the timeline, so the counts are deck-wide. PowerPoint
 * comments are no filter of their own: they count like any other and are marked on the comment
 * itself. Icon and count only, right-aligned before the deck controls; the name is the tooltip.
 * Toggles, not a radio group: each chip is a checkbox (checked = picked), Space or Enter switches it.
 */
export function CommentFilterBar() {
  const { statusFilter } = useViewerState();
  const dispatch = useViewerDispatch();
  const { counts } = useCommentThreads();

  const toggle = (filter: StatusFilter) =>
    dispatch({ type: 'statusFilterChanged', filter: filter === statusFilter ? 'all' : filter });

  return (
    <GlassPanel className="scrollbar-none flex max-w-full min-w-0 items-center gap-3 overflow-x-auto p-1">
      <div
        role="group"
        aria-label="Kommentare nach Status filtern"
        className="flex items-center gap-1"
      >
        {statusSegments(counts).map((segment) => (
          <FilterChip
            key={segment.value}
            selected={segment.value === statusFilter}
            icon={segment.icon}
            count={segment.count}
            title={segment.title}
            onClick={() => toggle(segment.value)}
            iconOnly
          >
            {segment.label}
          </FilterChip>
        ))}
      </div>
    </GlassPanel>
  );
}
